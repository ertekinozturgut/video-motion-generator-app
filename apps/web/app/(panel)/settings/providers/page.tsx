import { getAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/ui";
import { ProviderManager, type ProviderRow } from "./ProviderManager";

export const dynamic = "force-dynamic";

export default async function ProvidersPage() {
  const admin = (await getAdmin())!; // layout doğruladı
  const db = createAdminClient();

  const [{ data: providers }, { data: models }, { data: creds }] = await Promise.all([
    db.from("providers")
      .select("provider_id,kind,label,base_url,status,data_policy,network_scope,last_latency_ms,last_error")
      .eq("owner_id", admin.userId).order("created_at"),
    db.from("provider_models").select("provider_id,family,enabled").eq("owner_id", admin.userId),
    db.from("provider_credentials").select("provider_id,last4").eq("owner_id", admin.userId),
  ]);

  const counts = new Map<string, number>();
  const families = new Map<string, Set<string>>();
  for (const row of (models ?? []) as Array<{ provider_id: string; family: string; enabled: boolean }>) {
    if (!row.enabled) continue;
    counts.set(row.provider_id, (counts.get(row.provider_id) ?? 0) + 1);
    if (!families.has(row.provider_id)) families.set(row.provider_id, new Set());
    if (row.family !== "unknown") families.get(row.provider_id)!.add(row.family);
  }

  const last4 = new Map(
    ((creds ?? []) as Array<{ provider_id: string; last4: string }>)
      .map((c) => [c.provider_id, c.last4] as const)
  );

  // select listesi ProviderRow'un bir alt kümesini döndürüyor; eksik olan
  // üç alan aşağıda hesaplanıyor. Bu yüzden cast değil Omit ile daralt.
  type Fetched = Omit<ProviderRow, "model_count" | "last4" | "families">;
  const rows: ProviderRow[] = ((providers ?? []) as unknown as Fetched[]).map((p) => ({
    ...p,
    model_count: counts.get(p.provider_id) ?? 0,
    families: [...(families.get(p.provider_id) ?? [])],
    last4: last4.get(p.provider_id) ?? null,
  }));

  const allFamilies = new Set(rows.flatMap((r) => r.families));

  return (
    <>
      <PageHeader
        title="Sağlayıcılar"
        lede="API anahtarları AES-256-GCM ile şifrelenip saklanır ve kaydedildikten sonra bir daha okunamaz; panel yalnız son dört haneyi görür."
      />
      <ProviderManager providers={rows} familyCount={allFamilies.size} />
    </>
  );
}
