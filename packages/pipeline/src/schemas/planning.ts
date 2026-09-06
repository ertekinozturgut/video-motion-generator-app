import { z } from "zod";

/** Senaryodan çıkarılan atomik iddia. */
export const ClaimSchema = z.object({
  claim_id: z.string().regex(/^C\d{3,}$/),
  text: z.string().min(1).max(600),
  type: z.enum(["fact", "statistic", "quote", "opinion", "instruction"]),
  source: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  risk: z.enum(["low", "medium", "high"]),
  needs_review: z.boolean(),
  review_reason: z.string().nullable(),
});
export type Claim = z.infer<typeof ClaimSchema>;

export const ClaimLedgerSchema = z.object({
  claims: z.array(ClaimSchema).min(1),
  /** LLM'in kendi belirsizliğini bildirdiği yerler; HITL paketine girer. */
  flagged_claim_ids: z.array(z.string()),
});
export type ClaimLedger = z.infer<typeof ClaimLedgerSchema>;

export const AudienceProfileSchema = z.object({
  knowledge_level: z.enum(["beginner", "intermediate", "advanced", "mixed"]),
  pacing: z.enum(["slow", "medium", "fast"]),
  terminology: z.enum(["plain", "mixed", "technical"]),
  text_density: z.enum(["low", "medium", "high"]),
  visual_complexity: z.enum(["low", "medium", "high"]),
  chart_complexity: z.enum(["none", "simple", "detailed"]),
  notes: z.string().max(800),
});
export type AudienceProfile = z.infer<typeof AudienceProfileSchema>;

export const StyleContractSchema = z.object({
  palette_id: z.string(),
  accent: z.string(),
  /** En fazla iki efekt katmanı — registry tarafında da zorlanır. */
  effects: z.array(z.string()).max(2),
  glow_opacity: z.number().min(0).max(0.4),
  grain: z.number().min(0.03).max(0.05),
  min_body_px: z.number().min(28),
  min_code_px: z.number().min(20),
  transition_frames: z.number().int().min(12).max(16),
  allowed_transitions: z.array(z.string()).max(2),
});
export type StyleContract = z.infer<typeof StyleContractSchema>;

/** PLAN_CLAIMS adımının tam çıktısı — tek çağrıda üretilir. */
export const ClaimsAndContextSchema = z.object({
  video_title: z.string().min(1).max(140),
  claim_ledger: ClaimLedgerSchema,
  audience_profile: AudienceProfileSchema,
  style_contract: StyleContractSchema,
});
export type ClaimsAndContext = z.infer<typeof ClaimsAndContextSchema>;
