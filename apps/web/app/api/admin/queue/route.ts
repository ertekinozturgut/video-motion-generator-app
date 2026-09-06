import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { drainQueue } from "@/lib/jobs/runner";

/**
 * Kuyruk müdahalesi:
 *   retry            — başarısız işi baştan kuyruğa al
 *   cancel           — bir daha denenmesin
 *   requeue_expired  — lease'i dolmuş RUNNING işleri toparla
 *   process          — sıradakileri şimdi işle
 *
 * process aynı drainQueue döngüsünü çağırıyor; claim_next_jobs
 * FOR UPDATE SKIP LOCKED kullandığı için cron veya dispatch aynı anda
 * çalışsa bile iş çiftlenmez. Kendi işleme döngümüzü yazmıyoruz.
 */
const Body = z.object({
  action: z.enum(["retry", "cancel", "requeue_expired", "process"]),
  job_id: z.string().uuid().optional(),
});

// Sıradakileri işlemek stub adımlarda saniyeler sürüyor; Sprint 3'te
// gerçek çağrılar gelince bu route da 300'e çıkacak.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: "yetkisiz" }, { status: 403 });

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "geçersiz istek" }, { status: 400 });
  }
  const { action, job_id } = parsed.data;
  const db = createAdminClient();

  if (action === "requeue_expired") {
    const { data, error } = await db.rpc("requeue_expired_jobs");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ requeued: data ?? 0 });
  }

  if (action === "process") {
    try {
      const result = await drainQueue({ workerId: "admin-manual", limit: 5 });
      return NextResponse.json(result);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  if (!job_id) return NextResponse.json({ error: "job_id gerekli" }, { status: 400 });

  // owner_id filtresi service role ile de zorunlu: RLS bypass edildiği için
  // tek koruma bu koşul.
  const patch =
    action === "retry"
      ? {
          status: "QUEUED",
          attempt: 0,
          lease_until: null,
          worker_id: null,
          last_error: null,
          scheduled_for: new Date().toISOString(),
        }
      : { status: "CANCELLED", lease_until: null, worker_id: null };

  const { data, error } = await db
    .from("jobs")
    .update(patch)
    .eq("job_id", job_id)
    .eq("owner_id", admin.userId)
    .select("job_id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "job bulunamadı" }, { status: 404 });

  return NextResponse.json({ ok: true, action });
}
