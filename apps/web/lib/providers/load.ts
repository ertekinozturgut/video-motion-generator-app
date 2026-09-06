import { createAdminClient } from "@/lib/supabase/admin";
import { fromHex, open } from "./crypto";
import type { ProviderConfig } from "./client";
import type { ProviderKind } from "./types";

/**
 * Provider'ı çalıştırılabilir hale getirir: anahtarı çözer.
 * Yalnız server tarafında çağrılır; dönen apiKey hiçbir yanıta konmaz.
 */
export async function loadProvider(
  providerId: string,
  ownerId: string
): Promise<ProviderConfig & { label: string }> {
  const db = createAdminClient();

  const { data: provider } = await db
    .from("providers")
    .select("kind,label,base_url,config_json")
    .eq("provider_id", providerId)
    .eq("owner_id", ownerId)
    .single();
  if (!provider) throw new Error("Sağlayıcı bulunamadı");

  const { data: cred } = await db
    .from("provider_credentials")
    .select("ciphertext,iv,auth_tag,key_version")
    .eq("provider_id", providerId)
    .single();
  if (!cred) throw new Error("Sağlayıcının anahtarı kayıtlı değil");

  const c = cred as Record<string, string | number>;
  const apiKey = open({
    ciphertext: fromHex(String(c.ciphertext)),
    iv: fromHex(String(c.iv)),
    authTag: fromHex(String(c.auth_tag)),
    keyVersion: Number(c.key_version),
  });

  const p = provider as Record<string, unknown>;
  return {
    kind: p.kind as ProviderKind,
    label: String(p.label),
    baseUrl: String(p.base_url),
    apiKey,
    config: (p.config_json ?? {}) as Record<string, unknown>,
  };
}
