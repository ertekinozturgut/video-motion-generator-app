import { createAdminClient } from "@/lib/supabase/admin";
import { enqueue, logEvent } from "./dispatch";
import {
  assertMotionTransition, assertRunTransition, nextJobForMotion,
  type JobType, type MotionStatus,
} from "./machine";

/**
 * SPRINT 1 — STUB HANDLER'LAR
 *
 * Buradaki hiçbir fonksiyon LLM çağırmıyor, render yapmıyor, para harcamıyor.
 * Amaç iskeleti doğrulamak: kuyruk, lease, state geçişleri, Realtime akışı.
 * Sprint 2-6'da her stub gerçek işiyle değiştirilecek; imzalar aynı kalacak.
 */

export interface JobRow {
  job_id: string;
  owner_id: string;
  run_id: string;
  motion_id: string | null;
  job_type: JobType;
  payload_json: Record<string, unknown>;
  attempt: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function handleJob(job: JobRow): Promise<void> {
  switch (job.job_type) {
    case "PLAN_CLAIMS":  return planClaims(job);
    case "PLAN_MOTIONS": return planMotions(job);
    case "PLAN_QA":      return planQa(job);
    case "REPORT":       return report(job);
    default:             return motionStep(job);
  }
}

/* ---------- run seviyesi ---------- */

async function planClaims(job: JobRow) {
  const db = createAdminClient();
  await sleep(800); // gerçek çağrının yerini tutuyor

  await transitionRun(job, "RECEIVED", "CLAIMS_CHECKED");

  // Stub: riskli claim varmış gibi davranıp onay kapısını test ediyoruz.
  const needsApproval = true;
  if (needsApproval) {
    await transitionRun(job, "CLAIMS_CHECKED", "AWAITING_APPROVAL");
    await db.from("video_runs")
      .update({ claim_ledger_json: { claims: [], flagged_claim_ids: [], _stub: true } })
      .eq("run_id", job.run_id);
    return; // Akış burada durur. Onay gelince PLAN_MOTIONS kuyruğa girer.
  }
  await transitionRun(job, "CLAIMS_CHECKED", "APPROVED_FOR_PLANNING");
  await enqueue({ ownerId: job.owner_id, runId: job.run_id, jobType: "PLAN_MOTIONS" });
}

async function planMotions(job: JobRow) {
  const db = createAdminClient();
  await sleep(1000);

  const count = Number(job.payload_json.stub_motion_count ?? 8);
  const rows = Array.from({ length: count }, (_, i) => ({
    owner_id: job.owner_id,
    run_id: job.run_id,
    motion_index: i,
    name: `Motion ${String(i + 1).padStart(2, "0")}`,
    start_ms: i * 7000,
    end_ms: (i + 1) * 7000,
    motion_type: i % 3 === 0 ? "kinetic_typography" : i % 3 === 1 ? "metric" : "image_focus",
    status: "READY" as MotionStatus,
  }));
  await db.from("motions").insert(rows);

  await transitionRun(job, "APPROVED_FOR_PLANNING", "PLAN_QA");
  await enqueue({ ownerId: job.owner_id, runId: job.run_id, jobType: "PLAN_QA" });
}

async function planQa(job: JobRow) {
  const db = createAdminClient();
  await sleep(600);

  await transitionRun(job, "PLAN_QA", "READY");
  await transitionRun(job, "READY", "RUNNING");

  const { data: motions } = await db
    .from("motions").select("motion_id").eq("run_id", job.run_id).order("motion_index");

  // Motion'lar paralel işlenir; eşzamanlılık sınırı kuyruk tarafında.
  for (const m of motions ?? []) {
    await enqueue({
      ownerId: job.owner_id, runId: job.run_id,
      motionId: m.motion_id, jobType: "GEN_ASSETS",
    });
  }
}

async function report(job: JobRow) {
  await sleep(400);
  await transitionRun(job, "RUNNING", "COMPLETED");
  const db = createAdminClient();
  await db.from("video_runs")
    .update({ completed_at: new Date().toISOString() })
    .eq("run_id", job.run_id);
}

/* ---------- motion seviyesi ---------- */

const STEP_RESULT: Partial<Record<JobType, MotionStatus>> = {
  GEN_ASSETS: "ASSET_READY",
  GEN_SPEC:   "SPEC_VALIDATED",
  RENDER:     "RENDERED",
  QA_MOTION:  "QA_APPROVED",
  PUBLISH:    "UPLOADED",
};

async function motionStep(job: JobRow) {
  if (!job.motion_id) throw new Error(`${job.job_type} motion_id gerektiriyor`);
  const db = createAdminClient();
  await sleep(500);

  const { data: motion } = await db
    .from("motions").select("status").eq("motion_id", job.motion_id).single();
  if (!motion) throw new Error("Motion bulunamadı");

  const from = motion.status as MotionStatus;
  const to = STEP_RESULT[job.job_type];
  if (!to) throw new Error(`Bilinmeyen motion adımı: ${job.job_type}`);

  assertMotionTransition(from, to);
  await db.from("motions").update({ status: to }).eq("motion_id", job.motion_id);
  await logEvent({
    ownerId: job.owner_id, runId: job.run_id, motionId: job.motion_id,
    eventType: "motion_state", prevState: from, newState: to,
    message: `${job.job_type} tamamlandı`,
  });

  const next = nextJobForMotion(to);
  if (next) {
    await enqueue({
      ownerId: job.owner_id, runId: job.run_id,
      motionId: job.motion_id, jobType: next,
    });
    return;
  }

  // Bu motion bitti. Hepsi bittiyse run raporunu tetikle.
  const { count } = await db
    .from("motions")
    .select("motion_id", { count: "exact", head: true })
    .eq("run_id", job.run_id)
    .not("status", "in", "(UPLOADED,SKIPPED)");

  if ((count ?? 0) === 0) {
    await enqueue({ ownerId: job.owner_id, runId: job.run_id, jobType: "REPORT" });
  }
}

/* ---------- ortak ---------- */

async function transitionRun(job: JobRow, from: string, to: string) {
  const db = createAdminClient();
  const { data: run } = await db
    .from("video_runs").select("status").eq("run_id", job.run_id).single();
  if (!run) throw new Error("Run bulunamadı");

  // Idempotency: cron aynı işi tekrar denerse zaten geçmiş durumu bozma.
  if (run.status === to) return;
  assertRunTransition(run.status as never, to as never);

  await db.from("video_runs").update({ status: to }).eq("run_id", job.run_id);
  await logEvent({
    ownerId: job.owner_id, runId: job.run_id,
    eventType: "run_state", prevState: from, newState: to,
  });
}
