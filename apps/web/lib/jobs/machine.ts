/**
 * State machine — LLM değil, kod karar verir.
 * Geçerli olmayan geçiş fırlatır; sessizce yanlış duruma düşmek yok.
 */

export type RunStatus =
  | "RECEIVED" | "CLAIMS_CHECKED" | "AWAITING_APPROVAL" | "APPROVED_FOR_PLANNING"
  | "PLAN_QA" | "READY" | "RUNNING" | "COMPLETED"
  | "NEEDS_HUMAN" | "APPROVAL_TIMEOUT" | "FAILED_TECHNICAL" | "CANCELLED";

export type MotionStatus =
  | "READY" | "ASSET_READY" | "SPEC_VALIDATED" | "RENDERED" | "QA_APPROVED" | "UPLOADED"
  | "NEEDS_REVISION" | "NEEDS_HUMAN" | "FAILED_TECHNICAL" | "SKIPPED";

export type JobType =
  | "PLAN_CLAIMS" | "PLAN_MOTIONS" | "PLAN_QA" | "GEN_ASSETS" | "GEN_SPEC"
  | "RENDER" | "RENDER_POLL" | "QA_MOTION" | "PUBLISH" | "REPORT";

const RUN_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  RECEIVED:              ["CLAIMS_CHECKED", "FAILED_TECHNICAL", "CANCELLED"],
  CLAIMS_CHECKED:        ["AWAITING_APPROVAL", "APPROVED_FOR_PLANNING", "FAILED_TECHNICAL"],
  AWAITING_APPROVAL:     ["APPROVED_FOR_PLANNING", "APPROVAL_TIMEOUT", "CANCELLED"],
  APPROVED_FOR_PLANNING: ["PLAN_QA", "FAILED_TECHNICAL"],
  PLAN_QA:               ["READY", "APPROVED_FOR_PLANNING", "NEEDS_HUMAN", "FAILED_TECHNICAL"],
  READY:                 ["RUNNING", "CANCELLED"],
  RUNNING:               ["COMPLETED", "NEEDS_HUMAN", "FAILED_TECHNICAL"],
  COMPLETED:             [],
  // APPROVED_FOR_PLANNING, plan denetimi reddettiğinde açılan tek çıkış:
  // sahne yoksa kurtarılacak sahne de yoktur, plan baştan üretilir.
  // Kararı insan veriyor; akış kendi kendine bu yolu kullanmıyor.
  NEEDS_HUMAN:           ["RUNNING", "APPROVED_FOR_PLANNING", "CANCELLED"],
  APPROVAL_TIMEOUT:      ["APPROVED_FOR_PLANNING", "CANCELLED"],
  FAILED_TECHNICAL:      ["RECEIVED", "CANCELLED"],
  CANCELLED:             [],
};

const MOTION_TRANSITIONS: Record<MotionStatus, MotionStatus[]> = {
  READY:            ["ASSET_READY", "SPEC_VALIDATED", "NEEDS_HUMAN", "FAILED_TECHNICAL", "SKIPPED"],
  ASSET_READY:      ["SPEC_VALIDATED", "NEEDS_REVISION", "NEEDS_HUMAN", "FAILED_TECHNICAL"],
  SPEC_VALIDATED:   ["RENDERED", "NEEDS_REVISION", "NEEDS_HUMAN", "FAILED_TECHNICAL"],
  RENDERED:         ["QA_APPROVED", "NEEDS_REVISION", "NEEDS_HUMAN", "FAILED_TECHNICAL"],
  QA_APPROVED:      ["UPLOADED", "FAILED_TECHNICAL"],
  UPLOADED:         [],
  NEEDS_REVISION:   ["ASSET_READY", "SPEC_VALIDATED", "NEEDS_HUMAN", "SKIPPED"],
  NEEDS_HUMAN:      ["READY", "SKIPPED"],
  FAILED_TECHNICAL: ["READY", "SKIPPED"],
  SKIPPED:          [],
};

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!RUN_TRANSITIONS[from].includes(to)) {
    throw new Error(`Geçersiz run geçişi: ${from} → ${to}`);
  }
}

export function assertMotionTransition(from: MotionStatus, to: MotionStatus): void {
  if (!MOTION_TRANSITIONS[from].includes(to)) {
    throw new Error(`Geçersiz motion geçişi: ${from} → ${to}`);
  }
}

export const TERMINAL_MOTION: MotionStatus[] = ["UPLOADED", "SKIPPED"];

/** Motion durumundan sıradaki job'ı türetir. Tek yer, tek doğru. */
export function nextJobForMotion(status: MotionStatus): JobType | null {
  switch (status) {
    case "READY":
    case "NEEDS_REVISION":  return "GEN_ASSETS";
    case "ASSET_READY":     return "GEN_SPEC";
    case "SPEC_VALIDATED":  return "RENDER";
    case "RENDERED":        return "QA_MOTION";
    case "QA_APPROVED":     return "PUBLISH";
    default:                return null;
  }
}
