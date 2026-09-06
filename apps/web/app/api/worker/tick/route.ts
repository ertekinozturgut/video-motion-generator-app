import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { drainQueue } from "@/lib/jobs/runner";

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

  // Bu çağrının hatası eskiden yutuluyordu; requeue_expired_jobs bozukken
  // (bkz. migration 0006) kimse fark etmedi. Artık rapora giriyor.
  const { data: requeued, error: requeueError } = await db.rpc("requeue_expired_jobs");

  try {
    const result = await drainQueue({
      workerId: `tick-${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}`,
      limit: 5,
    });
    return NextResponse.json({
      requeued: requeued ?? 0,
      requeue_error: requeueError?.message ?? null,
      claimed: result.claimed,
      processed: result.done,
      failed: result.failed,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const GET = POST; // Vercel Cron GET ile çağırır


function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? request.headers.get("x-cron-secret") ?? "";
  return header === secret || header === `Bearer ${secret}`;
}
