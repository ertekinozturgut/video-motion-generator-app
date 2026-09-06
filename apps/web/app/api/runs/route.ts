import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { enqueue, logEvent } from "@/lib/jobs/dispatch";

const CreateRunSchema = z.object({
  title: z.string().trim().max(140).optional(),
  script: z.string().trim().min(40, "Senaryo en az 40 karakter olmalı"),
  audience_hint: z.string().trim().max(300).optional(),
  format: z.enum(["youtube_16_9", "shorts_9_16"]).default("youtube_16_9"),
  language: z.string().default("tr"),
  budget_limit: z.coerce.number().min(0).max(500).default(5),
  dry_run: z.boolean().default(true),
  stub_motion_count: z.coerce.number().int().min(1).max(24).default(8),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "yetkisiz" }, { status: 401 });

  const parsed = CreateRunSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join(", ") },
      { status: 400 }
    );
  }
  const input = parsed.data;

  const { data: run, error } = await supabase
    .from("video_runs")
    .insert({
      owner_id: user.id,
      title: input.title || null,
      source_script: input.script,
      budget_limit: input.budget_limit,
      settings_json: {
        format: input.format,
        language: input.language,
        audience_hint: input.audience_hint ?? null,
        dry_run: input.dry_run,
      },
    })
    .select("run_id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logEvent({
    ownerId: user.id, runId: run.run_id,
    eventType: "run_created", newState: "RECEIVED",
    message: `${input.script.length} karakterlik senaryo alındı`,
  });

  await enqueue({
    ownerId: user.id,
    runId: run.run_id,
    jobType: "PLAN_CLAIMS",
    payload: { stub_motion_count: input.stub_motion_count },
  });

  return NextResponse.json({ run_id: run.run_id }, { status: 201 });
}
