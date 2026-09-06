import { z } from "zod";

export const OnScreenTextSchema = z.object({
  text: z.string().max(160),
  role: z.enum(["headline", "body", "label", "caption", "code"]),
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().positive(),
});

export const RequiredAssetSchema = z.object({
  asset_index: z.number().int().min(0).max(2),
  purpose: z.string().max(200),
  prompt_hint: z.string().max(600),
});

export const MotionPlanSchema = z
  .object({
    motion_id: z.string().regex(/^M\d{3,}$/),
    start_ms: z.number().int().nonnegative(),
    end_ms: z.number().int().positive(),
    intent: z.string().min(1).max(400),
    /** Her motion onaylı claim'lere bağlanmak zorunda. Yeni claim üretilemez. */
    source_claim_ids: z.array(z.string().regex(/^C\d{3,}$/)).min(1),
    visual_beats: z.array(z.string().max(240)).max(4),
    on_screen_text: z.array(OnScreenTextSchema).max(6),

    // Aşağıdakiler registry ID'leriyle çapraz doğrulanır (specGuard).
    layout: z.string(),
    component: z.string(),
    variant: z.string(),
    accent: z.string(),
    effects: z.array(z.string()).max(2),
    transition: z.string(),

    /** 0-3 görsel kuralı burada zorlanıyor. */
    required_assets: z.array(RequiredAssetSchema).max(3),
    acceptance_criteria: z.array(z.string().max(240)).min(1).max(6),
  })
  .refine((m) => m.end_ms > m.start_ms, {
    message: "end_ms, start_ms'den büyük olmalı",
    path: ["end_ms"],
  });

export type MotionPlan = z.infer<typeof MotionPlanSchema>;

export const MotionBatchSchema = z.object({
  motions: z.array(MotionPlanSchema).min(1),
});
export type MotionBatch = z.infer<typeof MotionBatchSchema>;

/** Judge çıktısı. hard_fail true ise ortalama skora bakılmaz. */
export const PlanJudgementSchema = z.object({
  scores: z.object({
    script_fidelity: z.number().min(0).max(10),
    factual_accuracy: z.number().min(0).max(10),
    audience_fit: z.number().min(0).max(10),
    visual_clarity: z.number().min(0).max(10),
    cognitive_load: z.number().min(0).max(10),
    renderability: z.number().min(0).max(10),
  }),
  hard_fail: z.boolean(),
  hard_fail_reasons: z.array(z.string()).default([]),
  /** Yalnız alan bazlı patch. Timing, motion ID ve onaylı claim'ler korunur. */
  patches: z
    .array(
      z.object({
        motion_id: z.string(),
        op: z.enum(["replace", "add", "remove"]),
        path: z.string(),
        value: z.unknown().optional(),
        reason: z.string().max(300),
      })
    )
    .default([]),
});
export type PlanJudgement = z.infer<typeof PlanJudgementSchema>;

export const VisualJudgementSchema = z.object({
  factuality_score: z.number().min(0).max(10),
  visual_score: z.number().min(0).max(10),
  style_qa_score: z.number().min(0).max(10),
  hard_fail: z.boolean(),
  findings: z.array(
    z.object({
      severity: z.enum(["hard_fail", "major", "minor"]),
      area: z.enum([
        "readability", "composition", "smoothness", "transition",
        "coherence", "audience_fit", "cognitive_load", "claim_consistency",
      ]),
      detail: z.string().max(400),
      suggested_fix: z.string().max(400).nullable(),
    })
  ),
  /** Ledger'da olmayan iddia bulunduysa buraya yazılır — otomatik hard fail. */
  unsupported_claims: z.array(z.string()).default([]),
});
export type VisualJudgement = z.infer<typeof VisualJudgementSchema>;
