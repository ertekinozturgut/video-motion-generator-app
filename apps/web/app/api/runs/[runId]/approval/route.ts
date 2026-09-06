import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueue, logEvent } from "@/lib/jobs/dispatch";
import type { Claim } from "@/lib/schemas";

/**
 * İddia dökümünü dondurup planlamayı serbest bırakır.
 *
 * Ledger burada "donuyor": kabul/ret kararı satıra yazılıyor ve
 * PLAN_MOTIONS yalnız kabul edilenleri görüyor. Karar sonradan
 * değiştirilemez — değiştirilebilseydi, plan hangi ledger'a göre
 * üretildiği belirsiz bir çalışma elde ederdik.
 */
const Body = z.object({
  rejected_claim_ids: z.array(z.string()).default([]),
  note: z.string().max(1000).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;

  // Onay kullanıcının kendi kararı: RLS altında, kendi oturumuyla.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "yetkisiz" }, { status: 401 });

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "geçersiz istek" }, { status: 400 });

  const { data: run } = await supabase
    .from("video_runs")
    .select("run_id,status,claim_ledger_json,approved_at")
    .eq("run_id", runId)
    .maybeSingle();
  if (!run) return NextResponse.json({ error: "çalışma bulunamadı" }, { status: 404 });

  const r = run as { status: string; claim_ledger_json: { claims: Claim[] } | null; approved_at: string | null };

  if (r.approved_at) {
    return NextResponse.json({ error: "Bu çalışmanın dökümü zaten donduruldu." }, { status: 409 });
  }
  if (r.status !== "AWAITING_APPROVAL") {
    return NextResponse.json(
      { error: `Çalışma onay beklemiyor (durum: ${r.status}).` },
      { status: 409 }
    );
  }
  if (!r.claim_ledger_json?.claims?.length) {
    return NextResponse.json({ error: "İddia dökümü boş." }, { status: 409 });
  }

  const rejected = new Set(parsed.data.rejected_claim_ids);
  const claims = r.claim_ledger_json.claims.map((c) => ({
    ...c,
    approved: !rejected.has(c.claim_id),
  }));
  const approvedCount = claims.filter((c) => c.approved).length;

  if (approvedCount === 0) {
    return NextResponse.json(
      { error: "Tüm iddialar reddedilirse plan üretilemez. En az bir iddia kabul edilmeli." },
      { status: 400 }
    );
  }

  // Yazma service role ile: durum geçişi ve kuyruk kaydı tek işlem gibi
  // ilerlemeli, RLS altında yarım kalmamalı.
  const db = createAdminClient();
  const { error } = await db.from("video_runs").update({
    claim_ledger_json: {
      ...r.claim_ledger_json,
      claims,
      rejected_claim_ids: [...rejected],
      approval_note: parsed.data.note ?? null,
    },
    status: "APPROVED_FOR_PLANNING",
    approved_at: new Date().toISOString(),
  }).eq("run_id", runId).eq("owner_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logEvent({
    ownerId: user.id, runId,
    eventType: "run_state", prevState: "AWAITING_APPROVAL", newState: "APPROVED_FOR_PLANNING",
    message: `Döküm donduruldu: ${approvedCount} kabul, ${rejected.size} ret`,
    metadata: { approved: approvedCount, rejected: [...rejected] },
  });

  await enqueue({ ownerId: user.id, runId, jobType: "PLAN_MOTIONS" });

  return NextResponse.json({ approved: approvedCount, rejected: rejected.size });
}
