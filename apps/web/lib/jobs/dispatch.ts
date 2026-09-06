import { createAdminClient } from "@/lib/supabase/admin";
import type { JobType } from "./machine";

export interface EnqueueInput {
  ownerId: string;
  runId: string;
  motionId?: string | null;
  jobType: JobType;
  payload?: Record<string, unknown>;
  priority?: number;
  delaySeconds?: number;
}

/**
 * İki mekanizma birlikte çalışır:
 *   1. Kuyruğa yaz  → kalıcı, kaybolmaz
 *   2. Anında tetikle → kullanıcı cron'u beklemesin
 * Tetikleme kaçarsa dakikalık cron zaten toplar.
 */
export async function enqueue(input: EnqueueInput): Promise<string> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("jobs")
    .insert({
      owner_id: input.ownerId,
      run_id: input.runId,
      motion_id: input.motionId ?? null,
      job_type: input.jobType,
      payload_json: input.payload ?? {},
      priority: input.priority ?? 0,
      scheduled_for: new Date(Date.now() + (input.delaySeconds ?? 0) * 1000).toISOString(),
    })
    .select("job_id")
    .single();

  if (error) throw new Error(`Job kuyruğa alınamadı: ${error.message}`);

  if (!input.delaySeconds) {
    void kick(input.jobType);
  }
  return data.job_id as string;
}

/** Job handler route'unu uyandırır; yanıtı beklemez. */
async function kick(jobType: JobType): Promise<void> {
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");
  try {
    await fetch(`${base}/api/jobs/${jobType}`, {
      method: "POST",
      headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // Sessiz: kuyruk kalıcı, cron toparlar.
  }
}

export async function logEvent(args: {
  ownerId: string; runId: string; motionId?: string | null;
  eventType: string; prevState?: string | null; newState?: string | null;
  message?: string; metadata?: Record<string, unknown>;
}): Promise<void> {
  const db = createAdminClient();
  await db.from("events").insert({
    owner_id: args.ownerId,
    run_id: args.runId,
    motion_id: args.motionId ?? null,
    event_type: args.eventType,
    prev_state: args.prevState ?? null,
    new_state: args.newState ?? null,
    message: args.message ?? null,
    metadata_json: args.metadata ?? {},
  });
}
