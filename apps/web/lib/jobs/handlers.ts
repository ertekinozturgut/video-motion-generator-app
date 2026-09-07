import { createAdminClient } from "@/lib/supabase/admin";
import { enqueue, logEvent } from "./dispatch";
import { callStructured } from "@/lib/providers/route";
import {
  ClaimsAndContextSchema, MotionBatchSchema, PlanJudgementSchema,
  VisualJudgementSchema, SceneSpecSchema,
  type Claim, type MotionPlan, type SceneSpec,
} from "@/lib/schemas";
import {
  CLAIMS_SCHEMA_HINT, CLAIMS_SYSTEM, claimsUser,
  MOTIONS_SCHEMA_HINT, MOTIONS_SYSTEM,
  PLAN_QA_SCHEMA_HINT, PLAN_QA_SYSTEM,
} from "@/lib/prompts/planning";
import {
  SCENE_SYSTEM, SCENE_SCHEMA_HINT, sceneUser,
  MOTION_QA_SYSTEM, MOTION_QA_SCHEMA_HINT,
} from "@/lib/prompts/scene";
import { renderFilm, sceneDurationMs, type StyleContract } from "@/lib/render/scene";
import { checkScene } from "@/lib/render/guard";
import {
  assertMotionTransition, assertRunTransition, nextJobForMotion,
  type JobType, type MotionStatus,
} from "./machine";

/**
 * Akışın tamamı burada: senaryodan izlenebilir sahnelere kadar.
 * Planlama adımları ve sahne denetimi model çağırıyor; sahne çizimi
 * (RENDER) bilerek modelsiz — aynı tarif her zaman aynı dosyayı vermeli.
 */

export interface JobRow {
  job_id: string;
  owner_id: string;
  run_id: string;
  motion_id: string | null;
  job_type: JobType;
  payload_json: Record<string, unknown>;
  attempt: number;
}


export async function handleJob(job: JobRow): Promise<void> {
  switch (job.job_type) {
    case "PLAN_CLAIMS":  return planClaims(job);
    case "PLAN_MOTIONS": return planMotions(job);
    case "PLAN_QA":      return planQa(job);
    case "REPORT":       return report(job);
    default:             return motionStep(job);
  }
}

/* ---------- run seviyesi ---------- */

/**
 * Senaryo → iddia dökümü + hedef kitle + görsel sözleşme, tek çağrıda.
 * Üçü birlikte üretiliyor çünkü üçü de aynı metni okumayı gerektiriyor;
 * ayrı çağrılar senaryoyu üç kez göndermek demekti.
 */
async function planClaims(job: JobRow) {
  const db = createAdminClient();

  const { data: run } = await db
    .from("video_runs")
    .select("source_script,settings_json,status")
    .eq("run_id", job.run_id)
    .single();
  if (!run) throw new Error("Run bulunamadı");

  const r = run as { source_script: string; settings_json: Record<string, unknown>; status: string };
  const audienceHint = (r.settings_json?.audience_hint as string | null) ?? null;

  const result = await callStructured({
    ownerId: job.owner_id, runId: job.run_id, jobId: job.job_id,
    step: "PLAN_CLAIMS",
    system: CLAIMS_SYSTEM,
    schemaHint: CLAIMS_SCHEMA_HINT,
    user: claimsUser(r.source_script, audienceHint),
    schema: ClaimsAndContextSchema,
    temperature: 0.1,
  });

  // flagged listesi modele bırakılmıyor: needs_review alanından yeniden
  // türetiliyor. İkisi çeliştiğinde tek satırlık bir tutarsızlık, onay
  // ekranında görünmeyen riskli bir iddiaya dönüşürdü.
  const flagged = result.claim_ledger.claims
    .filter((c) => c.needs_review)
    .map((c) => c.claim_id);

  await transitionRun(job, "RECEIVED", "CLAIMS_CHECKED");

  await db.from("video_runs").update({
    title: result.video_title,
    claim_ledger_json: { ...result.claim_ledger, flagged_claim_ids: flagged },
    audience_profile_json: result.audience_profile,
    style_contract_json: result.style_contract,
  }).eq("run_id", job.run_id);

  await logEvent({
    ownerId: job.owner_id, runId: job.run_id,
    eventType: "claims_ready",
    message: `${result.claim_ledger.claims.length} iddia çıkarıldı, ${flagged.length} tanesi inceleme istiyor`,
    metadata: { total: result.claim_ledger.claims.length, flagged: flagged.length },
  });

  // İnceleme isteyen iddia varsa akış durur; insan onayı beklenir.
  if (flagged.length > 0) {
    await transitionRun(job, "CLAIMS_CHECKED", "AWAITING_APPROVAL");
    return;
  }
  await transitionRun(job, "CLAIMS_CHECKED", "APPROVED_FOR_PLANNING");
  await enqueue({ ownerId: job.owner_id, runId: job.run_id, jobType: "PLAN_MOTIONS" });
}

/** Onaylı iddialardan motion planı. Tek batch çağrı. */
async function planMotions(job: JobRow) {
  const db = createAdminClient();

  const { data: run } = await db
    .from("video_runs")
    .select("source_script,claim_ledger_json,audience_profile_json,style_contract_json,settings_json")
    .eq("run_id", job.run_id)
    .single();
  if (!run) throw new Error("Run bulunamadı");

  const r = run as Record<string, unknown>;
  const ledger = r.claim_ledger_json as { claims: Claim[] } | null;
  if (!ledger?.claims?.length) throw new Error("İddia dökümü yok; PLAN_CLAIMS çalışmamış.");

  // Reddedilenler modele hiç gösterilmiyor. "Bunu kullanma" demek yerine
  // vermemek daha güvenli; model göremediği şeyi kullanamaz.
  const approved = ledger.claims.filter((c) => (c as Claim & { approved?: boolean }).approved !== false);
  if (approved.length === 0) throw new Error("Onaylı iddia kalmadı; plan üretilemez.");

  const batch = await callStructured({
    ownerId: job.owner_id, runId: job.run_id, jobId: job.job_id,
    step: "PLAN_MOTIONS",
    system: MOTIONS_SYSTEM,
    schemaHint: MOTIONS_SCHEMA_HINT,
    user: [
      "HEDEF KİTLE PROFİLİ:",
      JSON.stringify(r.audience_profile_json, null, 2),
      "",
      "GÖRSEL SÖZLEŞME:",
      JSON.stringify(r.style_contract_json, null, 2),
      "",
      "ONAYLI İDDİALAR:",
      JSON.stringify(approved, null, 2),
      "",
      "SENARYO:",
      String(r.source_script),
    ].join("\n"),
    schema: MotionBatchSchema,
    temperature: 0.4,
    maxTokens: 16000,
  });

  const guard = checkMotionsAgainstClaims(batch.motions, approved.map((c) => c.claim_id));
  if (guard.length > 0) {
    // Model onaylanmamış iddiaya bağlanmışsa bu bir içerik hatası, retry
    // ile düzelmez; insana gitmeli.
    throw new Error(`Motion planı onaylı iddialarla uyuşmuyor: ${guard.join("; ")}`);
  }

  const rows = batch.motions.map((m, i) => ({
    owner_id: job.owner_id,
    run_id: job.run_id,
    motion_index: i,
    name: m.intent.slice(0, 120),
    start_ms: m.start_ms,
    end_ms: m.end_ms,
    motion_type: m.component,
    original_description: m.intent,
    motion_plan_json: m,
    status: "READY" as MotionStatus,
  }));
  await db.from("motions").insert(rows);

  await logEvent({
    ownerId: job.owner_id, runId: job.run_id,
    eventType: "motions_planned",
    message: `${rows.length} motion planlandı`,
    metadata: { count: rows.length },
  });

  await transitionRun(job, "APPROVED_FOR_PLANNING", "PLAN_QA");
  // Deneme sayacı PLAN_QA'ya taşınmak zorunda: devre kesici o işte
  // okunuyor. Taşınmazsa reddedilen her plan yeniden planlanır, yeni
  // PLAN_QA yine sıfır sayaçla gelir ve döngü hiç kapanmaz.
  await enqueue({
    ownerId: job.owner_id, runId: job.run_id, jobType: "PLAN_QA",
    payload: { qa_retry: Number(job.payload_json.qa_retry ?? 0) },
  });
}

/**
 * Plan kontrolü. Modeli routing tablosunda PLAN_MOTIONS'tan farklı
 * aileden olmak zorunda — o kural /settings/routing ekranında zorlanıyor,
 * burada tekrar edilmiyor.
 */
async function planQa(job: JobRow) {
  const db = createAdminClient();

  const [{ data: run }, { data: motions }] = await Promise.all([
    db.from("video_runs")
      .select("claim_ledger_json,audience_profile_json").eq("run_id", job.run_id).single(),
    db.from("motions")
      .select("motion_id,motion_index,motion_plan_json").eq("run_id", job.run_id).order("motion_index"),
  ]);
  if (!run) throw new Error("Run bulunamadı");

  const plans = ((motions ?? []) as Array<{ motion_plan_json: MotionPlan }>).map((m) => m.motion_plan_json);
  if (plans.length === 0) throw new Error("Değerlendirilecek motion yok.");

  const judgement = await callStructured({
    ownerId: job.owner_id, runId: job.run_id, jobId: job.job_id,
    step: "PLAN_QA",
    system: PLAN_QA_SYSTEM,
    schemaHint: PLAN_QA_SCHEMA_HINT,
    user: [
      "HEDEF KİTLE PROFİLİ:",
      JSON.stringify((run as Record<string, unknown>).audience_profile_json, null, 2),
      "",
      "İDDİA DÖKÜMÜ:",
      JSON.stringify((run as Record<string, unknown>).claim_ledger_json, null, 2),
      "",
      "DEĞERLENDİRİLECEK MOTION PLANI:",
      JSON.stringify(plans, null, 2),
    ].join("\n"),
    schema: PlanJudgementSchema,
    temperature: 0.1,
    maxTokens: 8000,
  });

  const values = Object.values(judgement.scores);
  const average = values.reduce((a, b) => a + b, 0) / values.length;

  await logEvent({
    ownerId: job.owner_id, runId: job.run_id,
    eventType: "plan_judged",
    message: judgement.hard_fail
      ? `Plan kontrolü reddetti: ${judgement.hard_fail_reasons.join("; ").slice(0, 300)}`
      : `Plan kontrolünden geçti (ortalama ${average.toFixed(1)})`,
    metadata: { scores: judgement.scores, average, hard_fail: judgement.hard_fail, patches: judgement.patches.length },
  });

  // Devre kesici: yeniden planlama denemesi bir kez. İkinci turda da
  // reddediliyorsa sorun planlamada değil girdide; insana gitmeli.
  if (judgement.hard_fail || average < 6) {
    const retried = Number(job.payload_json.qa_retry ?? 0);
    if (retried >= 1) {
      await transitionRun(job, "PLAN_QA", "NEEDS_HUMAN");
      return;
    }
    await db.from("motions").delete().eq("run_id", job.run_id);
    await transitionRun(job, "PLAN_QA", "APPROVED_FOR_PLANNING");
    await enqueue({
      ownerId: job.owner_id, runId: job.run_id, jobType: "PLAN_MOTIONS",
      payload: { qa_retry: retried + 1 },
    });
    return;
  }

  await transitionRun(job, "PLAN_QA", "READY");
  await transitionRun(job, "READY", "RUNNING");

  for (const m of (motions ?? []) as Array<{ motion_id: string }>) {
    await enqueue({
      ownerId: job.owner_id, runId: job.run_id,
      motionId: m.motion_id, jobType: "GEN_ASSETS",
    });
  }
}

/**
 * Kapanış: bütün sahneler tek bir izlenebilir dosyada birleştirilir.
 *
 * Çalışmanın teslim edilebilir çıktısı bu — bir durum tablosu değil,
 * açılıp izlenen bir dosya. İnsan bekleyen motion varsa çalışma
 * COMPLETED değil NEEDS_HUMAN kapanıyor; film yine de üretiliyor ki
 * eksiğin ne olduğu izlenerek görülebilsin.
 */
async function report(job: JobRow) {
  const db = createAdminClient();

  const [{ data: totals }, { data: run }, { data: motions }] = await Promise.all([
    db.from("attempts").select("cost_usd").eq("run_id", job.run_id),
    db.from("video_runs").select("title,status,style_contract_json").eq("run_id", job.run_id).single(),
    db.from("motions")
      .select("motion_index,name,status,remotion_spec_json")
      .eq("run_id", job.run_id).order("motion_index"),
  ]);

  // Son motion'lar farklı invocation'larda aynı anda bitebilir ve her
  // biri REPORT kuyruğa yazabilir. İlki çalışmayı kapattıktan sonra
  // ikincisi COMPLETED'dan çıkış aramaya kalkar ve geçersiz geçişle
  // patlardı. Kapanmış çalışma için rapor işi sessizce bitiyor.
  const runStatus = (run as { status?: string } | null)?.status;
  if (runStatus === "COMPLETED" || runStatus === "NEEDS_HUMAN") return;

  const cost = ((totals ?? []) as Array<{ cost_usd: number }>)
    .reduce((sum, a) => sum + Number(a.cost_usd ?? 0), 0);

  const rows = (motions ?? []) as Array<{
    motion_index: number; name: string | null; status: string; remotion_spec_json: unknown;
  }>;
  const scenes = rows
    .filter((m) => m.remotion_spec_json && m.status !== "SKIPPED")
    .map((m) => ({
      motionIndex: m.motion_index,
      title: m.name ?? `Sahne ${m.motion_index + 1}`,
      spec: m.remotion_spec_json as SceneSpec,
    }));

  const r = (run ?? {}) as Record<string, unknown>;
  const title = (r.title as string | null) ?? "Adsız çalışma";

  if (scenes.length > 0) {
    const html = renderFilm({
      title,
      style: (r.style_contract_json ?? null) as StyleContract | null,
      scenes,
    });
    // Eski film varsa yerini yenisi alıyor: bir çalışmanın tek bir
    // güncel teslimi olmalı, sürüm arşivi değil.
    await db.from("artifacts")
      .delete().eq("run_id", job.run_id).eq("artifact_type", "film").is("motion_id", null);
    await db.from("artifacts").insert({
      owner_id: job.owner_id, run_id: job.run_id,
      artifact_type: "film",
      bytes: html.length,
      metadata_json: {
        html,
        scene_count: scenes.length,
        duration_ms: scenes.reduce((s, x) => s + sceneDurationMs(x.spec), 0),
      },
    });
  }

  const stuck = rows.filter((m) => m.status === "NEEDS_HUMAN" || m.status === "FAILED_TECHNICAL");
  const to = stuck.length > 0 ? "NEEDS_HUMAN" : "COMPLETED";

  await transitionRun(job, "RUNNING", to);
  await db.from("video_runs").update({
    // completed_at yalnız gerçekten tamamlandığında yazılıyor. İnsan
    // bekleyen bir çalışmaya bitiş zamanı yazmak, listeyi okuyan kişiye
    // işin bittiğini söyler — oysa iş orada duruyor.
    completed_at: to === "COMPLETED" ? new Date().toISOString() : null,
    actual_cost: cost,
    final_report_path: scenes.length > 0 ? `/api/runs/${job.run_id}/film` : null,
  }).eq("run_id", job.run_id);

  await logEvent({
    ownerId: job.owner_id, runId: job.run_id,
    eventType: "run_report",
    message: stuck.length > 0
      ? `${scenes.length} sahne birleştirildi; ${stuck.length} motion insan bekliyor`
      : `${scenes.length} sahne birleştirildi, film hazır`,
    metadata: { scenes: scenes.length, stuck: stuck.length, cost },
  });
}

/* ---------- motion seviyesi ---------- */

async function motionStep(job: JobRow) {
  if (!job.motion_id) throw new Error(`${job.job_type} motion_id gerektiriyor`);
  switch (job.job_type) {
    case "GEN_ASSETS": return genAssets(job);
    case "GEN_SPEC":   return genSpec(job);
    case "RENDER":     return renderMotion(job);
    case "QA_MOTION":  return qaMotion(job);
    case "PUBLISH":    return publish(job);
    default:           throw new Error(`Bilinmeyen motion adımı: ${job.job_type}`);
  }
}

/**
 * Görsel varlıkların çözümü.
 *
 * Sahneler tipografik üretiliyor: metin, sayı, çubuk, panel. Bu bir
 * eksiklik değil bilinçli bir seçim — üretilen her karenin ne göstereceği
 * önceden belli, doğrulanabilir ve maliyeti sıfır. Plan görsel istemişse
 * istek kayda geçiyor; bir görsel modeli dağıtıma girdiğinde bu adım
 * onları burada üretecek, akışın geri kalanı değişmeyecek.
 */
async function genAssets(job: JobRow) {
  const db = createAdminClient();
  const motion = await loadMotion(job);
  const plan = motion.motion_plan_json as MotionPlan | null;
  const wanted = plan?.required_assets ?? [];

  if (wanted.length > 0) {
    await clearArtifacts(job, "asset_request");
    await db.from("artifacts").insert(
      wanted.map((a) => ({
        owner_id: job.owner_id, run_id: job.run_id, motion_id: job.motion_id,
        artifact_type: "asset_request",
        metadata_json: { ...a, resolution: "typographic", note: "Sahne tipografik üretiliyor; görsel model dağıtımda yok." },
      }))
    );
  }

  await advance(job, motion.status as MotionStatus, "ASSET_READY",
    wanted.length > 0
      ? `${wanted.length} görsel isteği kaydedildi; sahne tipografik üretilecek`
      : "Görsel gerekmiyor");
}

/**
 * Motion planı → sahne tarifi. Gerçek model çağrısı.
 *
 * Modelin çıktısı iki kez süzülüyor: önce Zod (şekil), sonra checkScene
 * (yerleşim). İkincisi başarısızsa hata modele geri veriliyor ve bir kez
 * daha isteniyor; ikinci turda da düzelmiyorsa bu bir tasarım sorunu,
 * teknik arıza değil — iş yeniden denenmiyor, motion insana gidiyor.
 */
async function genSpec(job: JobRow) {
  const db = createAdminClient();
  const motion = await loadMotion(job);
  const plan = motion.motion_plan_json as MotionPlan;
  if (!plan) throw new Error("Motion planı yok; PLAN_MOTIONS çalışmamış.");

  const { data: run } = await db
    .from("video_runs")
    .select("claim_ledger_json,audience_profile_json,style_contract_json")
    .eq("run_id", job.run_id).single();
  const r = (run ?? {}) as Record<string, unknown>;

  const ledger = (r.claim_ledger_json as { claims: Claim[] } | null)?.claims ?? [];
  const linked = ledger.filter((c) => plan.source_claim_ids.includes(c.claim_id));
  const duration = plan.end_ms - plan.start_ms;

  const base = {
    ownerId: job.owner_id, runId: job.run_id, motionId: job.motion_id, jobId: job.job_id,
    step: "GEN_SPEC" as const,
    system: SCENE_SYSTEM,
    schemaHint: SCENE_SCHEMA_HINT,
    schema: SceneSpecSchema,
    temperature: 0.5,
    maxTokens: 6000,
  };
  const user = sceneUser({
    motion: { ...plan, duration_ms: duration },
    style: r.style_contract_json, audience: r.audience_profile_json, claims: linked,
  });

  let spec = await callStructured({ ...base, user });
  let problems = checkScene(spec, duration);

  if (problems.length > 0) {
    spec = await callStructured({
      ...base,
      temperature: 0.2,
      user: [
        user, "",
        "ÖNCEKİ DENEMEN ŞU YERLEŞİM KUSURLARIYLA REDDEDİLDİ:",
        ...problems.map((p) => `- ${p}`),
        "",
        "Aynı sahneyi bu kusurları gidererek yeniden üret.",
      ].join("\n"),
    });
    problems = checkScene(spec, duration);
  }

  if (problems.length > 0) {
    await needsHuman(job, motion.status as MotionStatus,
      `Sahne yerleşimi iki denemede de düzelmedi: ${problems.join("; ")}`);
    return;
  }

  await db.from("motions").update({ remotion_spec_json: spec }).eq("motion_id", job.motion_id);
  await clearArtifacts(job, "spec");
  await db.from("artifacts").insert({
    owner_id: job.owner_id, run_id: job.run_id, motion_id: job.motion_id,
    artifact_type: "spec",
    metadata_json: { layers: spec.layers.length, duration_ms: spec.duration_ms },
  });

  await advance(job, motion.status as MotionStatus, "SPEC_VALIDATED",
    `${spec.layers.length} katmanlı sahne tarifi doğrulandı`);
}

/**
 * Sahne tarifi → izlenebilir HTML. Model yok, kod var.
 *
 * Render'ın deterministik olması QA'nın anlamlı olmasının şartı:
 * denetlenen tarif ile yayınlanan dosya aynı kaynaktan çıkıyor.
 */
async function renderMotion(job: JobRow) {
  const db = createAdminClient();
  const motion = await loadMotion(job);
  const spec = motion.remotion_spec_json as SceneSpec | null;
  if (!spec) throw new Error("Sahne tarifi yok; GEN_SPEC çalışmamış.");

  const { data: run } = await db
    .from("video_runs").select("title,style_contract_json").eq("run_id", job.run_id).single();
  const r = (run ?? {}) as Record<string, unknown>;

  const html = renderFilm({
    title: `${r.title ?? "Sahne"} — ${motion.name ?? spec.motion_id}`,
    style: (r.style_contract_json ?? null) as StyleContract | null,
    scenes: [{ motionIndex: motion.motion_index, title: motion.name ?? spec.motion_id, spec }],
  });

  await clearArtifacts(job, "scene");
  await db.from("artifacts").insert({
    owner_id: job.owner_id, run_id: job.run_id, motion_id: job.motion_id,
    artifact_type: "scene",
    bytes: html.length,
    metadata_json: { html, duration_ms: sceneDurationMs(spec) },
  });

  await advance(job, motion.status as MotionStatus, "RENDERED",
    `Sahne çizildi (${(html.length / 1024).toFixed(1)} KB, ${(sceneDurationMs(spec) / 1000).toFixed(1)} sn)`);
}

/**
 * Sahne denetimi. GEN_SPEC'ten farklı aileden bir model — dağıtım
 * ekranında zorlanıyor, burada tekrar edilmiyor.
 *
 * Reddedilen sahne bir kez yeniden üretiliyor; ikincide de reddedilirse
 * sorun üretimde değil girdide, insana gidiyor.
 */
async function qaMotion(job: JobRow) {
  const db = createAdminClient();
  const motion = await loadMotion(job);
  const spec = motion.remotion_spec_json as SceneSpec | null;
  if (!spec) throw new Error("Denetlenecek sahne yok.");

  const { data: run } = await db
    .from("video_runs")
    .select("claim_ledger_json,audience_profile_json,style_contract_json")
    .eq("run_id", job.run_id).single();
  const r = (run ?? {}) as Record<string, unknown>;

  const plan = motion.motion_plan_json as MotionPlan;
  const ledger = (r.claim_ledger_json as { claims: Claim[] } | null)?.claims ?? [];
  const linked = ledger.filter((c) => plan?.source_claim_ids?.includes(c.claim_id));

  const verdict = await callStructured({
    ownerId: job.owner_id, runId: job.run_id, motionId: job.motion_id, jobId: job.job_id,
    step: "QA_MOTION",
    system: MOTION_QA_SYSTEM,
    schemaHint: MOTION_QA_SCHEMA_HINT,
    schema: VisualJudgementSchema,
    temperature: 0.1,
    maxTokens: 4000,
    user: [
      "GÖRSEL SÖZLEŞME:", JSON.stringify(r.style_contract_json, null, 2), "",
      "HEDEF KİTLE:", JSON.stringify(r.audience_profile_json, null, 2), "",
      "ONAYLI İDDİALAR:", JSON.stringify(linked, null, 2), "",
      "MOTION PLANI:", JSON.stringify(plan, null, 2), "",
      "DENETLENECEK SAHNE TARİFİ:", JSON.stringify(spec, null, 2),
    ].join("\n"),
  });

  // Ledger dışı iddia her zaman ret: model "önemsiz" dese de bu kural
  // modele bırakılmıyor.
  const rejected =
    verdict.hard_fail ||
    verdict.unsupported_claims.length > 0 ||
    verdict.factuality_score < 7 ||
    Math.min(verdict.visual_score, verdict.style_qa_score) < 6;

  await db.from("motions").update({
    factuality_score: verdict.factuality_score,
    visual_score: verdict.visual_score,
    style_qa_score: verdict.style_qa_score,
    qa_attempt: motion.qa_attempt + 1,
  }).eq("motion_id", job.motion_id);

  if (!rejected) {
    await advance(job, motion.status as MotionStatus, "QA_APPROVED",
      `Denetimden geçti (olgu ${verdict.factuality_score}, görsel ${verdict.visual_score}, stil ${verdict.style_qa_score})`);
    return;
  }

  const reasons = [
    ...verdict.findings.filter((f) => f.severity !== "minor").map((f) => f.detail),
    ...verdict.unsupported_claims.map((c) => `dökümde olmayan içerik: ${c}`),
  ].join("; ").slice(0, 500) || "Puanlar eşiğin altında";

  if (motion.qa_attempt >= 1) {
    await needsHuman(job, motion.status as MotionStatus, `Sahne ikinci denetimde de reddedildi: ${reasons}`);
    return;
  }

  await advance(job, motion.status as MotionStatus, "NEEDS_REVISION", `Sahne reddedildi, yeniden üretilecek: ${reasons}`);
}

async function publish(job: JobRow) {
  const motion = await loadMotion(job);
  await advance(job, motion.status as MotionStatus, "UPLOADED", "Sahne yayına hazır");
}

/* ---------- motion yardımcıları ---------- */

interface MotionRow {
  motion_id: string;
  motion_index: number;
  name: string | null;
  status: string;
  qa_attempt: number;
  motion_plan_json: unknown;
  remotion_spec_json: unknown;
}

/**
 * Bir sahnenin önceki üretimini siler.
 *
 * Adımlar yeniden çalışabiliyor: QA reddedince, ya da insan "yeniden
 * üret" deyince. Her tur yeni satır bırakırsa tablo aynı sahnenin
 * eskimiş sürümleriyle doluyor ve "bu sahnenin tarifi hangisi" sorusu
 * cevapsız kalıyor. Bir sahnenin tek bir güncel üretimi olmalı.
 */
async function clearArtifacts(job: JobRow, type: string) {
  await createAdminClient()
    .from("artifacts").delete()
    .eq("motion_id", job.motion_id!)
    .eq("artifact_type", type);
}

async function loadMotion(job: JobRow): Promise<MotionRow> {
  const db = createAdminClient();
  const { data } = await db
    .from("motions")
    .select("motion_id,motion_index,name,status,qa_attempt,motion_plan_json,remotion_spec_json")
    .eq("motion_id", job.motion_id!)
    .single();
  if (!data) throw new Error("Motion bulunamadı");
  return data as MotionRow;
}

/** Durum geçişi + kayıt + sıradaki işi kuyruğa alma, tek yerde. */
async function advance(job: JobRow, from: MotionStatus, to: MotionStatus, message: string) {
  const db = createAdminClient();
  if (from !== to) {
    assertMotionTransition(from, to);
    await db.from("motions").update({ status: to }).eq("motion_id", job.motion_id!);
  }
  await logEvent({
    ownerId: job.owner_id, runId: job.run_id, motionId: job.motion_id,
    eventType: "motion_state", prevState: from, newState: to, message,
  });

  const next = nextJobForMotion(to);
  if (next) {
    await enqueue({
      ownerId: job.owner_id, runId: job.run_id, motionId: job.motion_id, jobType: next,
    });
    return;
  }
  await maybeFinishRun(job);
}

async function needsHuman(job: JobRow, from: MotionStatus, message: string) {
  const db = createAdminClient();
  assertMotionTransition(from, "NEEDS_HUMAN");
  await db.from("motions").update({ status: "NEEDS_HUMAN" }).eq("motion_id", job.motion_id!);
  await logEvent({
    ownerId: job.owner_id, runId: job.run_id, motionId: job.motion_id,
    eventType: "motion_state", prevState: from, newState: "NEEDS_HUMAN", message,
  });
  await maybeFinishRun(job);
}

/**
 * Son motion bittiğinde raporu kuyruğa alır.
 *
 * "Biten" = ilerlemesi duran: yayınlanmış, atlanmış ya da insan bekleyen.
 * İnsan bekleyeni saymasaydık, bir motion takıldığında rapor hiç
 * üretilmez ve çalışma sonsuza kadar RUNNING'de kalırdı.
 */
async function maybeFinishRun(job: JobRow) {
  const db = createAdminClient();
  const { count } = await db
    .from("motions")
    .select("motion_id", { count: "exact", head: true })
    .eq("run_id", job.run_id)
    .not("status", "in", "(UPLOADED,SKIPPED,NEEDS_HUMAN,FAILED_TECHNICAL)");

  if ((count ?? 0) === 0) {
    await enqueue({ ownerId: job.owner_id, runId: job.run_id, jobType: "REPORT" });
  }
}

/* ---------- ortak ---------- */

/**
 * Modelin uydurmadığını kodla doğruluyoruz. LLM'e "yeni iddia üretme"
 * demek yeterli değil; ürettiğinde yakalanması gerekiyor.
 */
function checkMotionsAgainstClaims(motions: MotionPlan[], approvedIds: string[]): string[] {
  const allowed = new Set(approvedIds);
  const problems: string[] = [];

  for (const m of motions) {
    const unknown = m.source_claim_ids.filter((id) => !allowed.has(id));
    if (unknown.length) {
      problems.push(`${m.motion_id} onaylı olmayan iddiaya bağlı: ${unknown.join(", ")}`);
    }
  }

  const sorted = [...motions].sort((a, b) => a.start_ms - b.start_ms);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start_ms < sorted[i - 1].end_ms) {
      problems.push(`${sorted[i].motion_id} ile ${sorted[i - 1].motion_id} zamanda çakışıyor`);
    }
  }
  return problems;
}

async function transitionRun(job: JobRow, from: string, to: string) {
  const db = createAdminClient();
  const { data: run } = await db
    .from("video_runs").select("status").eq("run_id", job.run_id).single();
  if (!run) throw new Error("Run bulunamadı");

  // Idempotency: cron aynı işi tekrar denerse zaten geçmiş durumu bozma.
  if (run.status === to) return;
  assertRunTransition(run.status as never, to as never);

  await db.from("video_runs").update({ status: to }).eq("run_id", job.run_id);
  await logEvent({
    ownerId: job.owner_id, runId: job.run_id,
    eventType: "run_state", prevState: from, newState: to,
  });
}
