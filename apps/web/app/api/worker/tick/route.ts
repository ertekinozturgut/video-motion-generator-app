import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleJob, type JobRow } from "@/lib/jobs/handlers";

export const maxDuration = 300;

/**
 * Güvenlik ağı. Dakikada bir çalışır ve iki şeyi yapar:
 *   1. Lease'i dolmuş RUNNING job'ları geri kuyruğa alır
 *   2. Dispatch'i kaçmış veya zamanı gelmiş job'ları işler
 * Anında dispatch çalışıyorken bu çoğunlukla boş döner.
 */
export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "yetkisiz" }, { status: 401 });
  }

  const db = createAdminClient();
  const { data: requeued } = await db.rpc("requeue_expired_jobs");

  const { data: jobs, error } = await db.rpc("claim_next_jobs", {
    p_worker_id: `tick-${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}`,
    p_limit: 5,
    p_lease_minutes: 5,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results = await Promise.allSettled(
    (jobs ?? []).map((j: JobRow) => runOne(j))
  );

  return NextResponse.json({
    requeued: requeued ?? 0,
    claimed: jobs?.length ?? 0,
    failed: results.filter((r) => r.status === "rejected").length,
  });
}

export const GET = POST; // Vercel Cron GET ile çağırır

async function runOne(job: JobRow) {
  const db = createAdminClient();
  try {
    await handleJob(job);
    await db.rpc("complete_job", { p_job_id: job.job_id });
  } catch (e) {
    await db.rpc("fail_job", {
      p_job_id: job.job_id,
      p_error: (e as Error).message.slice(0, 500),
      p_retry_in_seconds: Math.min(300, 30 * 2 ** job.attempt),
    });
  }
}

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? request.headers.get("x-cron-secret") ?? "";
  return header === secret || header === `Bearer ${secret}`;
}
