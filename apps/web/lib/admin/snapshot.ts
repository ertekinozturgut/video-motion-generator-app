import { createAdminClient } from "@/lib/supabase/admin";
import {
  STEP_ORDER, validateRoutes,
  type Issue, type PipelineStep, type ResolvedModel, type RouteInput,
} from "@/lib/providers/routing";
import type { ModelFamily } from "@/lib/providers/types";

/**
 * Yönetim ekranlarının tek veri kaynağı.
 *
 * Genel bakış ile model dağıtımı ekranı aynı doğrulamayı çalıştırmalı;
 * ikisi ayrı ayrı hesaplarsa bir gün biri "temiz", öbürü "engelli" der.
 * Bu yüzden model çözümleme ve validateRoutes çağrısı burada, tek yerde.
 */

export interface ResolvedModelOption extends ResolvedModel {
  model_key: string;
  provider_id: string;
}

export interface SavedRouteRow {
  step: PipelineStep;
  primary_model_id: string;
  fallback_model_ids: string[];
  disable_compression: boolean;
}

export interface ProviderSummary {
  provider_id: string;
  kind: string;
  label: string;
  status: string;
  data_policy: string;
  network_scope: string;
  last_error: string | null;
  last_latency_ms: number | null;
  last_checked_at: string | null;
}

export interface AdminSnapshot {
  presetId: string | null;
  providers: ProviderSummary[];
  models: ResolvedModelOption[];
  routes: SavedRouteRow[];
  issues: Issue[];
  families: ModelFamily[];
  jobCounts: Record<string, number>;
  runCounts: Record<string, number>;
  env: { encryptionKey: boolean; cronSecret: boolean; serviceRole: boolean };
}

export async function loadAdminSnapshot(ownerId: string): Promise<AdminSnapshot> {
  const db = createAdminClient();

  const [{ data: preset }, { data: providerRows }, { data: modelRows }, { data: jobRows }, { data: runRows }] =
    await Promise.all([
      db.from("model_presets").select("preset_id").eq("owner_id", ownerId)
        .order("is_default", { ascending: false }).limit(1).maybeSingle(),
      db.from("providers")
        .select("provider_id,kind,label,status,data_policy,network_scope,last_error,last_latency_ms,last_checked_at")
        .eq("owner_id", ownerId).order("created_at"),
      db.from("provider_models")
        .select("model_id,provider_id,model_key,display_name,family,capabilities,enabled,providers(label,data_policy,network_scope)")
        .eq("owner_id", ownerId).eq("enabled", true),
      db.from("jobs").select("status").eq("owner_id", ownerId),
      db.from("video_runs").select("status").eq("owner_id", ownerId),
    ]);

  const presetId = (preset as { preset_id: string } | null)?.preset_id ?? null;

  const models: ResolvedModelOption[] = (modelRows ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    // PostgREST gömülü ilişkiyi tekil ya da dizi olarak döndürebiliyor.
    const rel = r.providers as { label?: string; data_policy?: string; network_scope?: string } | Array<{ label?: string; data_policy?: string; network_scope?: string }> | null;
    const p = Array.isArray(rel) ? rel[0] : rel;
    return {
      model_id: String(r.model_id),
      provider_id: String(r.provider_id),
      model_key: String(r.model_key),
      display_name: (r.display_name as string | null) ?? String(r.model_key),
      family: r.family as ModelFamily,
      capabilities: r.capabilities as ResolvedModel["capabilities"],
      provider_label: p?.label ?? "?",
      data_policy: (p?.data_policy ?? "unknown") as ResolvedModel["data_policy"],
      network_scope: (p?.network_scope ?? "public") as ResolvedModel["network_scope"],
    };
  });

  const { data: routeRows } = presetId
    ? await db.from("model_routes")
        .select("step,primary_model_id,fallback_model_ids,flags")
        .eq("preset_id", presetId)
    : { data: [] as unknown[] };

  const routes: SavedRouteRow[] = (routeRows ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      step: r.step as PipelineStep,
      primary_model_id: String(r.primary_model_id),
      fallback_model_ids: (r.fallback_model_ids as string[] | null) ?? [],
      disable_compression:
        (r.flags as { disable_compression?: boolean } | null)?.disable_compression ?? true,
    };
  });

  const byId = new Map(models.map((m) => [m.model_id, m]));
  const inputs: RouteInput[] = routes
    .filter((r) => byId.has(r.primary_model_id))
    .map((r) => ({
      step: r.step,
      primary: byId.get(r.primary_model_id)!,
      fallbacks: r.fallback_model_ids
        .map((id) => byId.get(id))
        .filter((m): m is ResolvedModelOption => Boolean(m)),
      disable_compression: r.disable_compression,
    }));

  return {
    presetId,
    providers: (providerRows ?? []) as unknown as ProviderSummary[],
    models,
    routes,
    issues: validateRoutes(inputs),
    families: [...new Set(models.map((m) => m.family))].filter((f) => f !== "unknown"),
    jobCounts: tally(jobRows, "status"),
    runCounts: tally(runRows, "status"),
    env: {
      encryptionKey: Boolean(process.env.PROVIDER_ENC_KEY_V1),
      cronSecret: Boolean(process.env.CRON_SECRET),
      serviceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    },
  };
}

export const assignedSteps = (routes: SavedRouteRow[]) =>
  STEP_ORDER.filter((s) => routes.some((r) => r.step === s && r.primary_model_id));

function tally(rows: unknown[] | null, key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows ?? []) {
    const value = String((row as Record<string, unknown>)[key]);
    out[value] = (out[value] ?? 0) + 1;
  }
  return out;
}
