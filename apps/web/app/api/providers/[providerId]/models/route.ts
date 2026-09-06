import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadProvider } from "@/lib/providers/load";
import { listModels } from "@/lib/providers/client";
import { resolveFamily } from "@/lib/providers/family";

export const maxDuration = 60;

const ManualModel = z.object({
  mode: z.literal("manual"),
  model_key: z.string().trim().min(1),
  display_name: z.string().trim().optional(),
  family: z.string().trim().optional(),
  json_schema: z.enum(["native", "tool", "prompt"]).default("prompt"),
  vision: z.boolean().default(false),
  tools: z.boolean().default(false),
  context_window: z.coerce.number().int().min(1000).default(128000),
  max_output: z.coerce.number().int().min(256).default(8192),
  input_per_mtok: z.coerce.number().min(0).optional(),
  output_per_mtok: z.coerce.number().min(0).optional(),
});

const SyncModels = z.object({ mode: z.literal("sync") });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ providerId: string }> }
) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: "yetkisiz" }, { status: 403 });

  const { providerId } = await params;
  const parsed = z.union([SyncModels, ManualModel]).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz istek" }, { status: 400 });

  const db = createAdminClient();

  if (parsed.data.mode === "manual") {
    const m = parsed.data;
    const { error } = await db.from("provider_models").upsert({
      provider_id: providerId,
      owner_id: admin.userId,
      model_key: m.model_key,
      display_name: m.display_name || m.model_key,
      family: m.family || "unknown",
      capabilities: {
        json_schema: m.json_schema,
        vision: m.vision,
        tools: m.tools,
        context_window: m.context_window,
        max_output: m.max_output,
        reasoning: false,
      },
      pricing: m.input_per_mtok != null
        ? {
            input_per_mtok: m.input_per_mtok,
            output_per_mtok: m.output_per_mtok ?? 0,
            source: "manual",
          }
        : {},
      source: "manual",
      last_synced_at: new Date().toISOString(),
    }, { onConflict: "provider_id,model_key" });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ added: 1 });
  }

  let models;
  try {
    const provider = await loadProvider(providerId, admin.userId);
    models = await listModels(provider);
    // Aile, gateway adından değil model kimliğinden yeniden çözülür.
    models = models.map((m) => ({ ...m, family: m.family || resolveFamily(m.model_key, provider.kind) }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  if (models.length === 0) {
    return NextResponse.json({
      synced: 0,
      note: "Bu sağlayıcı katalog sunmuyor; modelleri elle eklemen gerekiyor.",
    });
  }

  const rows = models.map((m) => ({
    provider_id: providerId,
    owner_id: admin.userId,
    model_key: m.model_key,
    display_name: m.display_name,
    family: m.family,
    capabilities: m.capabilities,
    pricing: m.pricing ?? {},
    source: "synced",
    last_synced_at: new Date().toISOString(),
  }));

  const { error } = await db
    .from("provider_models")
    .upsert(rows, { onConflict: "provider_id,model_key" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ synced: rows.length });
}
