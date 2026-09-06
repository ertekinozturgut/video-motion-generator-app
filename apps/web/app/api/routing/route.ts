import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  canSave, validateRoutes,
  type PipelineStep, type ResolvedModel, type RouteInput,
} from "@/lib/providers/routing";

const Body = z.object({
  preset_id: z.string().uuid(),
  routes: z.array(z.object({
    step: z.enum([
      "PLAN_CLAIMS", "PLAN_MOTIONS", "PLAN_QA",
      "GEN_SPEC", "ASSET_QA", "QA_MOTION", "REPAIR",
    ]),
    primary_model_id: z.string().uuid(),
    fallback_model_ids: z.array(z.string().uuid()).max(3).default([]),
    disable_compression: z.boolean().default(true),
  })),
});

export async function PUT(request: NextRequest) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: "yetkisiz" }, { status: 403 });

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz istek" }, { status: 400 });

  const db = createAdminClient();
  const { data } = await db
    .from("provider_models")
    .select("model_id,display_name,family,capabilities,providers(label,data_policy,network_scope)")
    .eq("owner_id", admin.userId);

  const byId = new Map<string, ResolvedModel>();
  for (const row of (data ?? []) as Array<Record<string, any>>) {
    const p = Array.isArray(row.providers) ? row.providers[0] : row.providers;
    byId.set(row.model_id, {
      model_id: row.model_id,
      display_name: row.display_name ?? row.model_key,
      family: row.family,
      capabilities: row.capabilities,
      provider_label: p?.label ?? "?",
      data_policy: p?.data_policy ?? "unknown",
      network_scope: p?.network_scope ?? "public",
    });
  }

  const routes: RouteInput[] = [];
  for (const r of parsed.data.routes) {
    const primary = byId.get(r.primary_model_id);
    if (!primary) {
      return NextResponse.json({ error: `Model bulunamadı: ${r.primary_model_id}` }, { status: 400 });
    }
    routes.push({
      step: r.step as PipelineStep,
      primary,
      fallbacks: r.fallback_model_ids.map((id) => byId.get(id)).filter(Boolean) as ResolvedModel[],
      disable_compression: r.disable_compression,
    });
  }

  // Doğrulama sunucu tarafında da çalışır. Panel uyarıyor, API engelliyor.
  const issues = validateRoutes(routes);
  if (!canSave(issues)) {
    return NextResponse.json({ error: "Doğrulama başarısız", issues }, { status: 422 });
  }

  const rows = parsed.data.routes.map((r) => ({
    owner_id: admin.userId,
    preset_id: parsed.data.preset_id,
    step: r.step,
    primary_model_id: r.primary_model_id,
    fallback_model_ids: r.fallback_model_ids,
    flags: { disable_compression: r.disable_compression, allow_auto_alias: false },
  }));

  const { error } = await db
    .from("model_routes")
    .upsert(rows, { onConflict: "preset_id,step" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ saved: rows.length, issues });
}
