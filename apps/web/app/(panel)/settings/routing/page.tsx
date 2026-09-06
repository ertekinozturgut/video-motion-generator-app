import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/auth";
import { isConfigured } from "@/lib/supabase/env";
import { Setup } from "@/components/Setup";
import { createAdminClient } from "@/lib/supabase/admin";
import { RoutingMatrix, type ModelOption, type SavedRoute } from "./RoutingMatrix";

export const dynamic = "force-dynamic";

export default async function RoutingPage() {
  if (!isConfigured()) return <Setup />;
  const admin = await getAdmin();
  if (!admin) redirect("/");

  const db = createAdminClient();

  const { data: preset } = await db
    .from("model_presets")
    .select("preset_id")
    .eq("owner_id", admin.userId)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: modelRows } = await db
    .from("provider_models")
    .select("model_id,model_key,display_name,family,capabilities,providers(label,data_policy,network_scope)")
    .eq("owner_id", admin.userId)
    .eq("enabled", true);

  const models: ModelOption[] = ((modelRows ?? []) as Array<Record<string, any>>).map((row) => {
    const p = Array.isArray(row.providers) ? row.providers[0] : row.providers;
    return {
      model_id: row.model_id,
      model_key: row.model_key,
      display_name: row.display_name ?? row.model_key,
      family: row.family,
      capabilities: row.capabilities,
      provider_label: p?.label ?? "?",
      data_policy: p?.data_policy ?? "unknown",
      network_scope: p?.network_scope ?? "public",
    };
  });

  const { data: routeRows } = preset
    ? await db.from("model_routes")
        .select("step,primary_model_id,fallback_model_ids,flags")
        .eq("preset_id", (preset as { preset_id: string }).preset_id)
    : { data: [] };

  const initial: SavedRoute[] = ((routeRows ?? []) as Array<Record<string, any>>).map((r) => ({
    step: r.step,
    primary_model_id: r.primary_model_id,
    fallback_model_ids: r.fallback_model_ids ?? [],
    disable_compression: r.flags?.disable_compression ?? true,
  }));

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">Model dağıtımı</h1>
      <p className="mb-8 text-sm text-muted">
        Her adım kendi gereksinimini bildirir; uymayan modeller seçilemez.
        Kontrol adımları üreten adımdan farklı bir model ailesinde olmak
        zorunda, aksi halde sistem kendi çıktısını puanlar.
      </p>

      {preset ? (
        <RoutingMatrix
          presetId={(preset as { preset_id: string }).preset_id}
          models={models}
          initial={initial}
        />
      ) : (
        <p className="rounded border border-line bg-panel p-6 text-sm text-muted">
          Model profili bulunamadı. 0003 migration&apos;ı uygulandı mı?
        </p>
      )}
    </div>
  );
}
