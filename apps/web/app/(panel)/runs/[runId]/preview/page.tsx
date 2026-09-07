import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/env";
import { Setup } from "@/components/Setup";
import { Card, CardHeader, Chip, EmptyState, PageHeader, btn, type Tone } from "@/components/ui";

export const dynamic = "force-dynamic";

const MOTION_TONE: Record<string, Tone> = {
  UPLOADED: "good", QA_APPROVED: "good",
  RENDERED: "active", SPEC_VALIDATED: "active", ASSET_READY: "active", READY: "idle",
  NEEDS_REVISION: "attention", NEEDS_HUMAN: "attention",
  FAILED_TECHNICAL: "bad", SKIPPED: "idle",
};

const MOTION_LABEL: Record<string, string> = {
  READY: "sırada", ASSET_READY: "görseller hazır", SPEC_VALIDATED: "sahne tarifi hazır",
  RENDERED: "çizildi", QA_APPROVED: "denetimden geçti", UPLOADED: "yayında",
  NEEDS_REVISION: "yeniden üretiliyor", NEEDS_HUMAN: "insan bekliyor",
  FAILED_TECHNICAL: "teknik hata", SKIPPED: "atlandı",
};

export default async function PreviewPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  if (!isConfigured()) return <Setup />;
  const { runId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: run }, { data: motions }, { data: film }] = await Promise.all([
    supabase.from("video_runs").select("title,status").eq("run_id", runId).maybeSingle(),
    supabase.from("motions")
      .select("motion_id,motion_index,name,start_ms,end_ms,status,factuality_score,visual_score,style_qa_score")
      .eq("run_id", runId).order("motion_index"),
    supabase.from("artifacts")
      .select("metadata_json,bytes,created_at")
      .eq("run_id", runId).eq("artifact_type", "film").is("motion_id", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!run) notFound();

  const rows = (motions ?? []) as Array<{
    motion_id: string; motion_index: number; name: string | null;
    start_ms: number; end_ms: number; status: string;
    factuality_score: number | null; visual_score: number | null; style_qa_score: number | null;
  }>;
  const meta = (film as { metadata_json?: Record<string, unknown>; created_at?: string } | null);
  const rendered = rows.filter((m) => ["RENDERED", "QA_APPROVED", "UPLOADED"].includes(m.status));

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        title="Önizleme"
        lede={
          <>
            {run.title ?? "Adsız çalışma"} — sahneler tek bir zaman ekseninde.
            Boşluk çubuğu oynatır, zaman çubuğu sürüklenir, bölüm düğmeleri
            o sahneye atlar.
          </>
        }
        action={
          <div className="flex gap-2">
            <Link href={`/runs/${runId}`} className={btn.ghost}>Çalışmaya dön</Link>
            {meta && (
              <a href={`/api/runs/${runId}/film?download=1`} className={btn.primary} download>
                HTML indir
              </a>
            )}
          </div>
        }
      />

      {meta ? (
        <>
          {/* Filmi kendi kaynağında, sandbox altında çalıştırıyoruz:
              üretilen dosyanın panelin oturumuna erişmesi gerekmiyor. */}
          <iframe
            key={meta.created_at}
            src={`/api/runs/${runId}/film`}
            title="Film önizleme"
            className="h-[640px] w-full rounded-lg border border-line bg-ink"
          />
          <p className="mt-2 text-xs text-muted">
            {String((meta.metadata_json?.scene_count as number | undefined) ?? rendered.length)} sahne ·{" "}
            {(((meta.metadata_json?.duration_ms as number | undefined) ?? 0) / 1000).toFixed(1)} sn ·
            tek dosya, dış bağlantı yok
          </p>
        </>
      ) : rendered.length > 0 ? (
        <EmptyState
          title="Film henüz birleştirilmedi."
          detail="Sahnelerin bir kısmı çizildi ama kapanış raporu çalışmadı. Aşağıdan tek tek izleyebilirsin."
        />
      ) : (
        <EmptyState
          title="Henüz çizilmiş sahne yok."
          detail="Sahneler GEN_SPEC ve RENDER adımlarından sonra oluşuyor. Kuyruk ekranından bekleyen işleri başlatabilirsin."
          action={<Link href="/settings/queue" className={btn.primary}>Kuyruğa git</Link>}
        />
      )}

      <Card className="mt-8">
        <CardHeader
          title={`${rows.length} sahne`}
          hint="Puanlar denetim modelinden geliyor: olgu doğruluğu, görsel netlik, stil uyumu."
        />
        <ul className="divide-y divide-line">
          {rows.map((m) => {
            const watchable = ["RENDERED", "QA_APPROVED", "UPLOADED"].includes(m.status);
            return (
              <li key={m.motion_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                <span className="tnum w-8 shrink-0 text-sm text-muted">{m.motion_index + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{m.name ?? "—"}</div>
                  <div className="tnum mt-0.5 text-xs text-muted">
                    {(m.start_ms / 1000).toFixed(1)}–{(m.end_ms / 1000).toFixed(1)} sn
                  </div>
                </div>
                {m.factuality_score != null && (
                  <span className="tnum text-xs text-muted">
                    olgu {m.factuality_score} · görsel {m.visual_score} · stil {m.style_qa_score}
                  </span>
                )}
                <Chip tone={MOTION_TONE[m.status] ?? "idle"}>
                  {MOTION_LABEL[m.status] ?? m.status}
                </Chip>
                {watchable && (
                  <a
                    href={`/api/runs/${runId}/film?motion=${m.motion_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className={btn.ghost}
                  >
                    İzle
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
