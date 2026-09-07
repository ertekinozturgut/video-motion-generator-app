import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Live } from "./Live";
import { Notice, btn } from "@/components/ui";
import { Recover } from "./preview/Recover";

export default async function RunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const supabase = await createClient();

  const [{ data: run }, { data: motions }, { data: events }] = await Promise.all([
    supabase.from("video_runs")
      .select("run_id,title,status,created_at,claim_ledger_json").eq("run_id", runId).single(),
    supabase.from("motions")
      .select("motion_id,motion_index,name,start_ms,end_ms,status")
      .eq("run_id", runId).order("motion_index"),
    supabase.from("events")
      .select("event_id,event_type,prev_state,new_state,message,created_at")
      .eq("run_id", runId).order("event_id", { ascending: false }).limit(60),
  ]);

  if (!run) notFound();

  // Sayı flagged_claim_ids'ten değil needs_review'dan sayılıyor: ikisi
  // çeliştiğinde ekrandaki sayı, onay ekranında gerçekten karar
  // bekleyen satır sayısıyla aynı kalmalı.
  const ledger = run.claim_ledger_json as { claims?: Array<{ needs_review?: boolean }> } | null;
  const flaggedCount = (ledger?.claims ?? []).filter((c) => c.needs_review).length;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-8 flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <h1 className="mb-1 text-2xl font-semibold tracking-tight">
            {run.title ?? "Adsız çalışma"}
          </h1>
          <p className="tnum text-sm text-muted">
            {new Date(run.created_at).toLocaleString("tr-TR")}
          </p>
        </div>
        <div className="flex gap-2">
          {run.status === "AWAITING_APPROVAL" && (
            <Link href={`/runs/${runId}/approval`} className={btn.primary}>
              Onay bekliyor
            </Link>
          )}
          <Link href={`/runs/${runId}/preview`} className={btn.ghost}>
            Önizleme
          </Link>
          <Link href={`/runs/${runId}/logs`} className={btn.ghost}>
            Kayıtlar
          </Link>
        </div>
      </div>

      {/* Çıkmaz sokak olmasın: "insan bekliyor" diyen ekran, insanın
          basacağı düğmeyi de göstermeli. */}
      {run.status === "NEEDS_HUMAN" && (
        <div className="mb-6 space-y-3">
          <Notice tone="attention">
            {motions?.length
              ? "Bazı sahneler insan kararı bekliyor. Önizleme ekranından tek tek yeniden üretebilir ya da atlayabilirsin."
              : "Plan denetimi planı iki turda da reddetti. Yeniden planlayabilirsin; senaryoyu değiştirmeden denemek çoğu zaman aynı sonucu verir."}
          </Notice>
          {motions?.length ? (
            <Link href={`/runs/${runId}/preview`} className={btn.primary}>Önizlemeye git</Link>
          ) : (
            <Recover runId={runId} />
          )}
        </div>
      )}

      <Live
        runId={runId}
        initialStatus={run.status}
        initialMotions={motions ?? []}
        initialEvents={events ?? []}
        flaggedCount={flaggedCount}
      />
    </div>
  );
}
