import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/auth";
import { isConfigured } from "@/lib/supabase/env";
import { Setup } from "@/components/Setup";
import { createAdminClient } from "@/lib/supabase/admin";
import { ProviderManager, type ProviderRow } from "./ProviderManager";

export const dynamic = "force-dynamic";

export default async function ProvidersPage() {
  if (!isConfigured()) return <Setup />;
  const admin = await getAdmin();
  if (!admin) redirect("/");

  const db = createAdminClient();
  const [{ data: providers }, { data: models }, { data: creds }] = await Promise.all([
    db.from("providers")
      .select("provider_id,kind,label,base_url,status,data_policy,network_scope,last_latency_ms,last_error")
      .eq("owner_id", admin.userId).order("created_at"),
    db.from("provider_models").select("provider_id").eq("owner_id", admin.userId),
    db.from("provider_credentials").select("provider_id,last4").eq("owner_id", admin.userId),
  ]);

  const counts = new Map<string, number>();
  for (const m of (models ?? []) as Array<{ provider_id: string }>) {
    counts.set(m.provider_id, (counts.get(m.provider_id) ?? 0) + 1);
  }
  const last4 = new Map(
    ((creds ?? []) as Array<{ provider_id: string; last4: string }>)
      .map((c) => [c.provider_id, c.last4])
  );

  const rows: ProviderRow[] = ((providers ?? []) as Array<Record<string, never>>).map((p) => ({
    ...(p as unknown as ProviderRow),
    model_count: counts.get((p as unknown as ProviderRow).provider_id) ?? 0,
    last4: last4.get((p as unknown as ProviderRow).provider_id) ?? null,
  }));

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">Sağlayıcılar</h1>
      <p className="mb-8 text-sm text-muted">
        API anahtarları şifrelenerek saklanır ve kaydedildikten sonra bir daha
        okunamaz. Yalnız son dört hane gösterilir.
      </p>
      <ProviderManager providers={rows} />
    </div>
  );
}
