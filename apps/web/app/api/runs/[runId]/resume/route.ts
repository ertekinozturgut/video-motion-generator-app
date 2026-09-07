import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueue, logEvent } from "@/lib/jobs/dispatch";
import { assertRunTransition, type MotionStatus } from "@/lib/jobs/machine";

/**
 * "İnsan bekliyor" durumundan çıkış.
 *
 * Akış bir sahneyi ya da planı insana bırakabiliyordu ama panelde
 * insanın basacağı bir düğme yoktu: durum çıkmaz sokaktı. Kararı burada
 * insan veriyor — yeniden dene ya da atla — ve akış kaldığı yerden
 * devam ediyor.
 *
 * Yeniden denemede sayaçlar sıfırlanıyor. Sıfırlanmasaydı devre kesici
 * ilk turda tekrar kapanır, düğme hiçbir şey yapmamış gibi görünürdü.
 */
const Body = z.object({
  motion_id: z.string().uuid().nullish(),
  action: z.enum(["retry", "skip"]).default("retry"),
});

const STUCK: MotionStatus[] = ["NEEDS_HUMAN", "FAILED_TECHNICAL"];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "yetkisiz" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "geçersiz istek" }, { status: 400 });
  const { motion_id: motionId, action } = parsed.data;

  // Okuma kullanıcının kendi oturumuyla: başkasının çalışmasını
  // kurtaramasın diye sahiplik RLS'te doğrulanıyor.
  const { data: run } = await supabase
    .from("video_runs").select("run_id,status").eq("run_id", runId).maybeSingle();
  if (!run) return NextResponse.json({ error: "çalışma bulunamadı" }, { status: 404 });

  const { data: motionRows } = await supabase
    .from("motions").select("motion_id,motion_index,status").eq("run_id", runId).order("motion_index");
  const motions = (motionRows ?? []) as Array<{ motion_id: string; motion_index: number; status: MotionStatus }>;

  const db = createAdminClient();
  const runStatus = (run as { status: string }).status;

  /* ---------------------------------------------- tek sahne */

  if (motionId) {
    const motion = motions.find((m) => m.motion_id === motionId);
    if (!motion) return NextResponse.json({ error: "sahne bulunamadı" }, { status: 404 });
    if (!STUCK.includes(motion.status)) {
      return NextResponse.json(
        { error: `Bu sahne insan beklemiyor (durum: ${motion.status}).` },
        { status: 409 }
      );
    }

    await reopenRun(runStatus);

    if (action === "skip") {
      await db.from("motions").update({ status: "SKIPPED" }).eq("motion_id", motionId);
      await logEvent({
        ownerId: user.id, runId, motionId,
        eventType: "motion_state", prevState: motion.status, newState: "SKIPPED",
        message: "Sahne insan kararıyla atlandı",
      });
      // Atlanan sahne akışın son engeliyse kapanışı biz tetikliyoruz;
      // aksi halde çalışma hiç kapanmaz.
      await finishIfDone();
      return NextResponse.json({ skipped: motion.motion_index + 1 });
    }

    await retryMotion(motionId, motion.status);
    return NextResponse.json({ retried: motion.motion_index + 1 });
  }

  /* ---------------------------------------------- çalışma geneli */

  const stuck = motions.filter((m) => STUCK.includes(m.status));

  if (stuck.length > 0) {
    await reopenRun(runStatus);
    for (const m of stuck) await retryMotion(m.motion_id, m.status);
    return NextResponse.json({ retried: stuck.length });
  }

  // Sahne yoksa takılan şey plan denetimidir: baştan planlanıyor.
  if (motions.length === 0 && runStatus === "NEEDS_HUMAN") {
    assertRunTransition("NEEDS_HUMAN", "APPROVED_FOR_PLANNING");
    await db.from("video_runs")
      .update({ status: "APPROVED_FOR_PLANNING", completed_at: null }).eq("run_id", runId);
    await logEvent({
      ownerId: user.id, runId,
      eventType: "run_state", prevState: "NEEDS_HUMAN", newState: "APPROVED_FOR_PLANNING",
      message: "Plan insan kararıyla yeniden üretiliyor",
    });
    await enqueue({ ownerId: user.id, runId, jobType: "PLAN_MOTIONS", payload: { qa_retry: 0 } });
    return NextResponse.json({ replanned: true });
  }

  return NextResponse.json({ error: "Kurtarılacak bir şey yok." }, { status: 409 });

  /* ---------------------------------------------- yardımcılar */

  async function reopenRun(from: string) {
    if (from !== "NEEDS_HUMAN" && from !== "COMPLETED") return;
    // COMPLETED'ın çıkışı yok ve olmamalı: kapanmış bir çalışmanın
    // geçmişi sabit kalmalı. Ama içinde takılı sahne varken NEEDS_HUMAN
    // kapanıyor, dönüş oradan yapılıyor.
    if (from === "COMPLETED") return;
    assertRunTransition("NEEDS_HUMAN", "RUNNING");
    await db.from("video_runs")
      .update({ status: "RUNNING", completed_at: null }).eq("run_id", runId);
    await logEvent({
      ownerId: user!.id, runId,
      eventType: "run_state", prevState: "NEEDS_HUMAN", newState: "RUNNING",
      message: "Çalışma insan kararıyla sürdürülüyor",
    });
  }

  async function retryMotion(id: string, from: MotionStatus) {
    await db.from("motions").update({
      status: "READY",
      // Sayaçlar sıfırlanmazsa devre kesici ilk turda tekrar kapanır.
      qa_attempt: 0, plan_attempt: 0, image_attempt: 0, render_attempt: 0,
      same_error_count: 0, no_improvement_count: 0,
      last_error_code: null, last_error_fingerprint: null,
    }).eq("motion_id", id);

    await logEvent({
      ownerId: user!.id, runId, motionId: id,
      eventType: "motion_state", prevState: from, newState: "READY",
      message: "Sahne insan kararıyla yeniden üretiliyor",
    });
    await enqueue({ ownerId: user!.id, runId, motionId: id, jobType: "GEN_ASSETS" });
  }

  async function finishIfDone() {
    const { count } = await db
      .from("motions")
      .select("motion_id", { count: "exact", head: true })
      .eq("run_id", runId)
      .not("status", "in", "(UPLOADED,SKIPPED,NEEDS_HUMAN,FAILED_TECHNICAL)");
    if ((count ?? 0) === 0) {
      await enqueue({ ownerId: user!.id, runId, jobType: "REPORT" });
    }
  }
}
