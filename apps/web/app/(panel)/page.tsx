import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/env";
import { Setup } from "@/components/Setup";
import { RUN_LABEL, RUN_TONE, TONE_BG } from "@/components/status";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  if (!isConfigured()) return <Setup />;

  const supabase = await createClient();
  const { data: runs } = await supabase
    .from("video_runs")
    .select("run_id,title,status,created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="mb-8 text-2xl font-semibold tracking-tight">Çalışmalar</h1>

      {!runs?.length ? (
        <div className="rounded border border-line bg-panel p-8">
          <p className="mb-4">Henüz bir çalışma yok.</p>
          <Link href="/runs/new"
                className="inline-block rounded bg-text px-4 py-2 text-sm font-medium text-ink">
            Senaryo yükle
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-line rounded border border-line bg-panel">
          {runs.map((r) => (
            <li key={r.run_id}>
              <Link href={`/runs/${r.run_id}`}
                    className="flex items-center gap-4 px-4 py-3.5 hover:bg-raised">
                <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_BG[RUN_TONE[r.status] ?? "idle"]}`} aria-hidden />
                <span className="flex-1 truncate">{r.title ?? "Adsız çalışma"}</span>
                <span className="hidden text-sm text-muted sm:block">
                  {RUN_LABEL[r.status] ?? r.status}
                </span>
                <span className="tnum shrink-0 text-sm text-muted">
                  {new Date(r.created_at).toLocaleDateString("tr-TR")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
