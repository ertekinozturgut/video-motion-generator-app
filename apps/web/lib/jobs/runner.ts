import { createAdminClient } from "@/lib/supabase/admin";
import { handleJob, type JobRow } from "./handlers";

/**
 * Kuyruktan iş alıp yürüten tek döngü.
 *
 * Üç çağıran var: adım dispatch route'u, cron tick'i ve dispatch'in
 * inline yedeği. Üçü de aynı sırayı izlemek zorunda — claim, işle,
 * tamamla/başarısız — yoksa biri lease'i bırakmayı unutur ve iş asılı
 * kalır. Bu yüzden döngü kopyalanmıyor.
 *
 * Belirli bir job değil "sıradaki" alınır: iki dispatch aynı anda gelse
 * bile claim_next_jobs FOR UPDATE SKIP LOCKED kullandığı için iş
 * çiftlenmez.
 */
export interface DrainResult {
  claimed: number;
  done: number;
  failed: number;
}

// Inline yedek kendi kendini tetiklemesin diye: bir drain sürerken
// içeriden kuyruğa yazılan iş yeni bir drain başlatmamalı, yoksa tek
// invocation içinde özyinelemeli bir zincir oluşur.
let draining = false;

export const isDraining = () => draining;

export async function drainQueue({
  workerId, limit = 3, leaseMinutes = 5,
}: {
  workerId: string;
  limit?: number;
  leaseMinutes?: number;
}): Promise<DrainResult> {
  const db = createAdminClient();

  const { data: jobs, error } = await db.rpc("claim_next_jobs", {
    p_worker_id: workerId,
    p_limit: limit,
    p_lease_minutes: leaseMinutes,
  });
  if (error) throw new Error(error.message);

  const claimed = (jobs ?? []) as JobRow[];
  let done = 0;
  let failed = 0;

  draining = true;
  try {
    for (const job of claimed) {
      try {
        await handleJob(job);
        await db.rpc("complete_job", { p_job_id: job.job_id });
        done++;
      } catch (e) {
        // Hata yutulmaz ama döngüyü de durdurmaz: bir işin patlaması
        // sıradakini engellememeli.
        await db.rpc("fail_job", {
          p_job_id: job.job_id,
          p_error: (e as Error).message.slice(0, 500),
          p_retry_in_seconds: Math.min(300, 30 * 2 ** job.attempt),
        });
        failed++;
      }
    }
  } finally {
    draining = false;
  }

  return { claimed: claimed.length, done, failed };
}
