import { createAdminClient } from "@/lib/supabase/admin";
import { enqueue, logEvent } from "./dispatch";
import { callStructured } from "@/lib/providers/route";
import {
  ClaimsAndContextSchema, MotionBatchSchema, PlanJudgementSchema,
  type Claim, type MotionPlan,
} from "@/lib/schemas";
import {
  CLAIMS_SCHEMA_HINT, CLAIMS_SYSTEM, claimsUser,
  MOTIONS_SCHEMA_HINT, MOTIONS_SYSTEM,
  PLAN_QA_SCHEMA_HINT, PLAN_QA_SYSTEM,
} from "@/lib/prompts/planning";
import {
  assertMotionTransition, assertRunTransition, nextJobForMotion,
  type JobType, type MotionStatus,
} from "./machine";

/**
 * SPRINT 3 — planlama adımları gerçek model çağrısı yapıyor.
 * GEN_ASSETS / GEN_SPEC / RENDER / QA_MOTION / PUBLISH hâlâ stub;
 * onlar Sprint 4-6'da geliyor. İmzalar değişmiyor.
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  await enqueue({ ownerId: job.owner_id, runId: job.run_id, jobType: "PLAN_QA" });
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

async function report(job: JobRow) {
  const db = createAdminClient();
  const { data: totals } = await db
    .from("attempts").select("cost_usd").eq("run_id", job.run_id);

  const cost = ((totals ?? []) as Array<{ cost_usd: number }>)
    .reduce((sum, a) => sum + Number(a.cost_usd ?? 0), 0);

  await transitionRun(job, "RUNNING", "COMPLETED");
  await db.from("video_runs")
    .update({ completed_at: new Date().toISOString(), actual_cost: cost })
    .eq("run_id", job.run_id);
}

/* ---------- motion seviyesi (Sprint 4-6'da gerçekleşecek) ---------- */

const STEP_RESULT: Partial<Record<JobType, MotionStatus>> = {
  GEN_ASSETS: "ASSET_READY",
  GEN_SPEC:   "SPEC_VALIDATED",
  RENDER:     "RENDERED",
  QA_MOTION:  "QA_APPROVED",
  PUBLISH:    "UPLOADED",
};

async function motionStep(job: JobRow) {
  if (!job.motion_id) throw new Error(`${job.job_type} motion_id gerektiriyor`);
  const db = createAdminClient();
  await sleep(300);

  const { data: motion } = await db
    .from("motions").select("status").eq("motion_id", job.motion_id).single();
  if (!motion) throw new Error("Motion bulunamadı");

  const from = motion.status as MotionStatus;
  const to = STEP_RESULT[job.job_type];
  if (!to) throw new Error(`Bilinmeyen motion adımı: ${job.job_type}`);

  assertMotionTransition(from, to);
  await db.from("motions").update({ status: to }).eq("motion_id", job.motion_id);
  await logEvent({
    ownerId: job.owner_id, runId: job.run_id, motionId: job.motion_id,
    eventType: "motion_state", prevState: from, newState: to,
    message: `${job.job_type} tamamlandı`,
  });

  const next = nextJobForMotion(to);
  if (next) {
    await enqueue({
      ownerId: job.owner_id, runId: job.run_id,
      motionId: job.motion_id, jobType: next,
    });
    return;
  }

  const { count } = await db
    .from("motions")
    .select("motion_id", { count: "exact", head: true })
    .eq("run_id", job.run_id)
    .not("status", "in", "(UPLOADED,SKIPPED)");

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
