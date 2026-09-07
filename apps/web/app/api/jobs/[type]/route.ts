import { NextResponse, type NextRequest } from "next/server";
import { drainQueue } from "@/lib/jobs/runner";

/**
 * Adım başına ayrı route → adım başına ayrı maxDuration.
 *
 * 60, Hobby planının tavanı; yükseltilemez. Model çağrılarının süre
 * bütçesi (callStructured) bu sayının altında kalacak şekilde
 * seçiliyor — üstünde olsaydı fonksiyon çağrı bitmeden öldürülür,
 * elimizde ne sonuç ne de hata kaydı kalırdı.
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
  try {
    const result = await drainQueue({ workerId: `dispatch-${type}` });
    return NextResponse.json({ processed: result.done, failed: result.failed });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
