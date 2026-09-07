import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/env";
import { Setup } from "@/components/Setup";
import { EmptyState, PageHeader, btn } from "@/components/ui";
import { ApprovalForm } from "./ApprovalForm";
import type { Claim } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export default async function ApprovalPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  if (!isConfigured()) return <Setup />;
  const { runId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: run } = await supabase
    .from("video_runs")
    .select("run_id,title,status,source_script,claim_ledger_json,audience_profile_json,approved_at")
    .eq("run_id", runId)
    .maybeSingle();
  if (!run) notFound();

  const r = run as {
    title: string | null;
    status: string;
    source_script: string | null;
    claim_ledger_json: { claims: Claim[]; flagged_claim_ids?: string[] } | null;
    audience_profile_json: Record<string, unknown> | null;
    approved_at: string | null;
  };

  const claims = r.claim_ledger_json?.claims ?? [];

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        title="İddia onayı"
        lede={
          <>
            {r.title ?? "Adsız çalışma"} — üretim buradan devam etmeden önce
            iddiaları gözden geçir. Reddettiklerin motion planına hiç
            gösterilmez; model göremediği şeyi kullanamaz.
          </>
        }
        action={<Link href={`/runs/${runId}`} className={btn.ghost}>Çalışmaya dön</Link>}
      />

      {claims.length === 0 ? (
        <EmptyState
          title="Henüz iddia dökümü yok."
          detail="PLAN_CLAIMS adımı çalışmadan bu ekran dolmaz. Kuyruk ekranından sıradaki işi çalıştırabilirsin."
          action={<Link href="/settings/queue" className={btn.primary}>Kuyruğa git</Link>}
        />
      ) : r.approved_at ? (
        <EmptyState
          title="Bu çalışmanın dökümü donduruldu."
          detail={`Karar ${new Date(r.approved_at).toLocaleString("tr-TR")} tarihinde verildi ve değiştirilemez. Plan bu dökümle üretildi.`}
          action={<Link href={`/runs/${runId}/logs`} className={btn.ghost}>Kayıtlara bak</Link>}
        />
      ) : r.status !== "AWAITING_APPROVAL" ? (
        <EmptyState
          title="Çalışma onay beklemiyor."
          detail={`Şu anki durum: ${r.status}. Onay kapısı yalnız AWAITING_APPROVAL durumunda açılır.`}
        />
      ) : (
        <ApprovalForm
          runId={runId}
          claims={claims}
          audience={r.audience_profile_json}
          script={r.source_script}
        />
      )}
    </div>
  );
}
