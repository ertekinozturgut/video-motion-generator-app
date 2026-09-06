import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Live } from "./Live";

export default async function RunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const supabase = await createClient();

  const [{ data: run }, { data: motions }, { data: events }] = await Promise.all([
    supabase.from("video_runs").select("run_id,title,status,created_at").eq("run_id", runId).single(),
    supabase.from("motions")
      .select("motion_id,motion_index,name,start_ms,end_ms,status")
      .eq("run_id", runId).order("motion_index"),
    supabase.from("events")
      .select("event_id,event_type,prev_state,new_state,message,created_at")
      .eq("run_id", runId).order("event_id", { ascending: false }).limit(60),
  ]);

  if (!run) notFound();

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">
        {run.title ?? "Adsız çalışma"}
      </h1>
      <p className="tnum mb-8 text-sm text-muted">
        {new Date(run.created_at).toLocaleString("tr-TR")}
      </p>

      <Live
        runId={runId}
        initialStatus={run.status}
        initialMotions={motions ?? []}
        initialEvents={events ?? []}
      />
    </div>
  );
}
