import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleJob, type JobRow } from "@/lib/jobs/handlers";

/**
 * Adım başına ayrı route → adım başına ayrı maxDuration.
 * Sprint 1'de hepsi stub olduğu için 60 yeterli; Sprint 3'te planlama
 * route'ları 300'e çıkacak.
 */
export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("x-cron-secret") ?? "";
  if (!secret || header !== secret) {
    return NextResponse.json({ error: "yetkisiz" }, { status: 401 });
  }

  const { type } = await params;
  const db = createAdminClient();

  // Bu çağrı belirli bir job'ı değil, kuyruktan sıradakini alır.
  // Böylece iki dispatch aynı anda gelse bile iş çiftlenmez.
  const { data: jobs, error } = await db.rpc("claim_next_jobs", {
    p_worker_id: `dispatch-${type}`,
    p_limit: 3,
    p_lease_minutes: 5,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let done = 0;
  for (const job of (jobs ?? []) as JobRow[]) {
    try {
      await handleJob(job);
      await db.rpc("complete_job", { p_job_id: job.job_id });
      done++;
    } catch (e) {
      await db.rpc("fail_job", {
        p_job_id: job.job_id,
        p_error: (e as Error).message.slice(0, 500),
        p_retry_in_seconds: Math.min(300, 30 * 2 ** job.attempt),
      });
    }
  }
  return NextResponse.json({ processed: done });
}
