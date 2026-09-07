import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Bir AI adımının tek kayıt noktası.
 *
 * İki tabloya birden yazar: ölçümler `attempts`e (hangi model, kaç token,
 * kaç ms, sonuç ne), içerik `step_traces`e (gönderilen prompt, dönen
 * yanıt). Ayrımın sebebi boyut — attempts liste ekranlarında taranıyor,
 * prompt gövdeleri orada olsa her listeleme megabaytlar çekerdi.
 *
 * callStructured() buraya bağlı;
 * çağrı yapan her yer bunu çağırdığı sürece panel dolu kalır. Ayrı ayrı
 * insert yazılmamalı, yoksa bir gün biri trace yazmayı unutur ve o adım
 * panelde görünmez olur.
 */
export interface AttemptRecord {
  ownerId: string;
  runId: string;
  motionId?: string | null;
  jobId?: string | null;

  /** PLAN_CLAIMS, GEN_SPEC, QA_MOTION… */
  step: string;
  providerId?: string | null;
  providerLabel?: string | null;
  modelKey?: string | null;

  /** 0 = birincil model, 1+ = yedeğe düşüldü. */
  fallbackIndex?: number;
  jsonModeTier?: "native" | "tool" | "prompt" | null;
  schemaRepairCount?: number;

  latencyMs?: number | null;
  usage?: TokenUsage | null;
  costUsd?: number;

  result: "ok" | "schema_fail" | "provider_error" | "timeout";
  errorCode?: string | null;
  scoreBefore?: number | null;
  scoreAfter?: number | null;

  /** Gönderilen mesajlar ve parametreler, olduğu gibi. */
  request?: unknown;
  responseText?: string | null;
  responseJson?: unknown;
  errorText?: string | null;
}

export interface TokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  [key: string]: unknown;
}

export async function recordAttempt(rec: AttemptRecord): Promise<string | null> {
  const db = createAdminClient();

  const { data, error } = await db
    .from("attempts")
    .insert({
      owner_id: rec.ownerId,
      run_id: rec.runId,
      motion_id: rec.motionId ?? null,
      step: rec.step,
      provider_id: rec.providerId ?? null,
      model_key: rec.modelKey ?? null,
      fallback_index: rec.fallbackIndex ?? 0,
      json_mode_tier: rec.jsonModeTier ?? null,
      schema_repair_count: rec.schemaRepairCount ?? 0,
      latency_ms: rec.latencyMs ?? null,
      input_tokens: rec.usage?.input_tokens ?? null,
      cached_input_tokens: rec.usage?.cached_input_tokens ?? null,
      output_tokens: rec.usage?.output_tokens ?? null,
      cost_usd: rec.costUsd ?? 0,
      result: rec.result,
      error_code: rec.errorCode ?? null,
      score_before: rec.scoreBefore ?? null,
      score_after: rec.scoreAfter ?? null,
    })
    .select("attempt_id")
    .single();

  // Kayıt tutmak işin kendisini düşürmemeli: burada patlarsak adım zaten
  // yapılmış olan işi kaybeder. Hata yutulmuyor ama yükseltilmiyor da.
  if (error || !data) {
    console.error("attempt kaydedilemedi", error?.message);
    return null;
  }

  const attemptId = data.attempt_id as string;

  const { error: traceError } = await db.from("step_traces").insert({
    attempt_id: attemptId,
    owner_id: rec.ownerId,
    run_id: rec.runId,
    motion_id: rec.motionId ?? null,
    job_id: rec.jobId ?? null,
    step: rec.step,
    provider_label: rec.providerLabel ?? null,
    model_key: rec.modelKey ?? null,
    request_json: rec.request ?? null,
    response_text: rec.responseText ?? null,
    response_json: rec.responseJson ?? null,
    usage_json: rec.usage ?? null,
    error_text: rec.errorText ?? null,
  });
  if (traceError) console.error("trace kaydedilemedi", traceError.message);

  return attemptId;
}

/**
 * Bir AI çağrısını ölçüp kaydeden sarmalayıcı. Süreyi burada tutuyoruz ki
 * her çağıran kendi kronometresini kurmasın — biri unutursa o adım
 * panelde süresiz görünür.
 */
export async function traced<T>(
  base: Omit<AttemptRecord, "result" | "latencyMs" | "responseText" | "responseJson" | "errorText" | "usage">,
  call: () => Promise<{ value: T; responseText?: string; responseJson?: unknown; usage?: TokenUsage; costUsd?: number }>
): Promise<T> {
  const started = Date.now();
  try {
    const out = await call();
    await recordAttempt({
      ...base,
      result: "ok",
      latencyMs: Date.now() - started,
      usage: out.usage ?? null,
      costUsd: out.costUsd ?? base.costUsd ?? 0,
      responseText: out.responseText ?? null,
      responseJson: out.responseJson ?? null,
    });
    return out.value;
  } catch (e) {
    const err = e as Error;
    await recordAttempt({
      ...base,
      result: "provider_error",
      latencyMs: Date.now() - started,
      errorCode: err.name,
      errorText: err.message,
    });
    throw err;
  }
}
