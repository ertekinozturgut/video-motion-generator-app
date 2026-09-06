import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/env";
import { Setup } from "@/components/Setup";
import { PageHeader, btn } from "@/components/ui";
import { LogViewer, type ArtifactRow, type EventRow, type TraceRow } from "./LogViewer";

export const dynamic = "force-dynamic";

/**
 * Bir çalışmanın tam kaydı. Üç ayrı kaynak tek ekranda birleşiyor:
 *   events      — durum geçişleri ve iş yaşam döngüsü
 *   step_traces — AI çağrılarının promptu, yanıtı, token'ı
 *   artifacts   — üretilen görsel ve videolar
 *
 * Hepsi RLS altında kullanıcı istemcisiyle okunuyor; bu sayfa yalnız
 * kendi çalışmanı gösterebilir.
 */
export default async function RunLogsPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  if (!isConfigured()) return <Setup />;
  const { runId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: run }, { data: events }, { data: traces }, { data: artifacts }] =
    await Promise.all([
      supabase.from("video_runs").select("run_id,title,status,created_at").eq("run_id", runId).maybeSingle(),
      supabase.from("events")
        .select("event_id,event_type,prev_state,new_state,message,metadata_json,motion_id,created_at")
        .eq("run_id", runId).order("event_id", { ascending: false }).limit(500),
      supabase.from("step_traces")
        .select("trace_id,attempt_id,step,provider_label,model_key,request_json,response_text,response_json,usage_json,error_text,motion_id,created_at")
        .eq("run_id", runId).order("created_at", { ascending: false }).limit(200),
      supabase.from("artifacts")
        .select("artifact_id,artifact_type,storage_path,local_path,gdrive_id,bytes,metadata_json,motion_id,created_at")
        .eq("run_id", runId).order("created_at", { ascending: false }).limit(200),
    ]);

  if (!run) notFound();

  // Ölçümler ayrı tabloda; trace'lerle attempt_id üzerinden eşleşiyor.
  const attemptIds = ((traces ?? []) as Array<{ attempt_id: string | null }>)
    .map((t) => t.attempt_id)
    .filter((id): id is string => Boolean(id));

  const { data: attempts } = attemptIds.length
    ? await supabase.from("attempts")
        .select("attempt_id,latency_ms,input_tokens,cached_input_tokens,output_tokens,cost_usd,result,error_code,fallback_index,json_mode_tier,schema_repair_count")
        .in("attempt_id", attemptIds)
    : { data: [] };

  const metrics = new Map(
    ((attempts ?? []) as Array<Record<string, unknown>>).map((a) => [String(a.attempt_id), a])
  );

  const rows: TraceRow[] = ((traces ?? []) as Array<Record<string, unknown>>).map((t) => {
    const m = t.attempt_id ? metrics.get(String(t.attempt_id)) : undefined;
    return {
      trace_id: String(t.trace_id),
      step: String(t.step),
      provider_label: (t.provider_label as string | null) ?? null,
      model_key: (t.model_key as string | null) ?? null,
      motion_id: (t.motion_id as string | null) ?? null,
      created_at: String(t.created_at),
      request_json: t.request_json ?? null,
      response_text: (t.response_text as string | null) ?? null,
      response_json: t.response_json ?? null,
      usage_json: t.usage_json ?? null,
      error_text: (t.error_text as string | null) ?? null,
      latency_ms: (m?.latency_ms as number | null) ?? null,
      input_tokens: (m?.input_tokens as number | null) ?? null,
      cached_input_tokens: (m?.cached_input_tokens as number | null) ?? null,
      output_tokens: (m?.output_tokens as number | null) ?? null,
      cost_usd: (m?.cost_usd as number | null) ?? null,
      result: (m?.result as string | null) ?? null,
      fallback_index: (m?.fallback_index as number | null) ?? null,
      json_mode_tier: (m?.json_mode_tier as string | null) ?? null,
      schema_repair_count: (m?.schema_repair_count as number | null) ?? null,
    };
  });

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        title="Kayıtlar"
        lede={
          <>
            {run.title ?? "Adsız çalışma"} — her adımın girdisi, çıktısı, harcadığı
            token ve ürettiği dosya. Kayıtlar sırayla, yeniden eskiye.
          </>
        }
        action={
          <Link href={`/runs/${runId}`} className={btn.ghost}>
            Çalışmaya dön
          </Link>
        }
      />

      <LogViewer
        traces={rows}
        events={((events ?? []) as unknown as EventRow[])}
        artifacts={((artifacts ?? []) as unknown as ArtifactRow[])}
      />
    </div>
  );
}
