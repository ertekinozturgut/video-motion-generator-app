import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadProvider } from "@/lib/providers/load";
import { healthCheck } from "@/lib/providers/client";

export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ providerId: string }> }
) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: "yetkisiz" }, { status: 403 });

  const { providerId } = await params;
  const body = z.object({ model_key: z.string().trim().min(1) })
    .safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: "Test için bir model adı gerekiyor" }, { status: 400 });
  }

  const db = createAdminClient();
  let result;
  try {
    const provider = await loadProvider(providerId, admin.userId);
    result = await healthCheck(provider, body.data.model_key);
  } catch (e) {
    result = {
      ok: false, latency_ms: 0, json_mode_verified: false,
      detail: (e as Error).message,
    };
  }

  await db.from("provider_health").insert({
    provider_id: providerId,
    owner_id: admin.userId,
    ok: result.ok,
    latency_ms: result.latency_ms,
    detail: { json_mode_verified: result.json_mode_verified, message: result.detail ?? null },
  });

  await db.from("providers").update({
    status: result.ok ? "active" : "degraded",
    last_checked_at: new Date().toISOString(),
    last_latency_ms: result.latency_ms,
    last_error: result.ok ? null : (result.detail ?? "bilinmeyen hata"),
    consecutive_failures: result.ok ? 0 : 1,
  }).eq("provider_id", providerId).eq("owner_id", admin.userId);

  return NextResponse.json(result);
}
