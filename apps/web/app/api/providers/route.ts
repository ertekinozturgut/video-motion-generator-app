import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { seal, toHex } from "@/lib/providers/crypto";
import { checkBaseUrl } from "@/lib/providers/ssrf";
import { resolveBaseUrl } from "@/lib/providers/client";

const Body = z.object({
  kind: z.enum(["openai", "azure_foundry", "anthropic", "openrouter", "omniroute"]),
  label: z.string().trim().min(2).max(60),
  base_url: z.string().trim().optional().nullable(),
  api_key: z.string().trim().min(8, "API anahtarı çok kısa görünüyor"),
  data_policy: z.enum(["no_training", "unknown", "may_train"]).default("unknown"),
  config: z.record(z.unknown()).default({}),
});

export async function POST(request: NextRequest) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: "yetkisiz" }, { status: 403 });

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      { status: 400 }
    );
  }
  const input = parsed.data;

  let baseUrl: string;
  try { baseUrl = resolveBaseUrl(input.kind, input.base_url); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }

  // Kullanıcının girdiği adres sunucudan çağrılacak; SSRF kontrolü şart.
  const check = await checkBaseUrl(baseUrl);
  const scope = check.ok ? "public" : check.suggestedScope;
  if (!check.ok && scope !== "local_worker_only") {
    return NextResponse.json({ error: check.reason }, { status: 400 });
  }

  const db = createAdminClient();
  const { data, error } = await db
    .from("providers")
    .insert({
      owner_id: admin.userId,
      kind: input.kind,
      label: input.label,
      base_url: baseUrl,
      config_json: input.config,
      data_policy: input.data_policy,
      network_scope: scope,
      status: "unverified",
    })
    .select("provider_id")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Kaydedilemedi" }, { status: 500 });
  }
  const providerId = (data as { provider_id: string }).provider_id;

  // Anahtar ayrı tabloda ve şifreli. Hiçbir yanıt düz metin döndürmez.
  const sealed = seal(input.api_key);
  const { error: credError } = await db.from("provider_credentials").insert({
    provider_id: providerId,
    owner_id: admin.userId,
    ciphertext: toHex(sealed.ciphertext),
    iv: toHex(sealed.iv),
    auth_tag: toHex(sealed.authTag),
    key_version: sealed.keyVersion,
    last4: sealed.last4,
  });
  if (credError) {
    await db.from("providers").delete().eq("provider_id", providerId);
    return NextResponse.json({ error: credError.message }, { status: 500 });
  }

  await db.from("events").insert({
    owner_id: admin.userId,
    run_id: null,
    event_type: "provider_added",
    message: `${input.label} eklendi`,
    metadata_json: { kind: input.kind, network_scope: scope },
  });

  return NextResponse.json(
    { provider_id: providerId, network_scope: scope, note: check.ok ? null : check.reason },
    { status: 201 }
  );
}
