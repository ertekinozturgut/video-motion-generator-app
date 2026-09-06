import type { ModelCapabilities, JsonModeTier } from "../providers/types";

export type PipelineStep =
  | "PLAN_CLAIMS" | "PLAN_MOTIONS" | "PLAN_QA"
  | "GEN_SPEC" | "ASSET_QA" | "QA_MOTION" | "REPAIR";

export interface StepRequirement {
  step: PipelineStep;
  label: string;
  /** null = JSON şema gerekmiyor */
  json_schema: JsonModeTier[] | null;
  vision: boolean;
  tools: boolean;
  min_context: number;
  /** Judge adımı: primary'nin ailesi karşılaştırılan adımdan farklı olmalı. */
  must_differ_from?: PipelineStep;
  /** Bu adım yayınlanmamış senaryo metnini görüyor mu? */
  sees_source_script: boolean;
  /** Gateway context sıkıştırması kapatılmalı mı? */
  require_no_compression: boolean;
}

export const STEP_REQUIREMENTS: Record<PipelineStep, StepRequirement> = {
  PLAN_CLAIMS: {
    step: "PLAN_CLAIMS", label: "Claim ledger + hedef kitle + style contract",
    json_schema: ["native", "tool", "prompt"], vision: false, tools: false,
    min_context: 128_000, sees_source_script: true, require_no_compression: true,
  },
  PLAN_MOTIONS: {
    step: "PLAN_MOTIONS", label: "Motion batch planı",
    json_schema: ["native", "tool", "prompt"], vision: false, tools: false,
    min_context: 128_000, sees_source_script: true, require_no_compression: true,
  },
  PLAN_QA: {
    step: "PLAN_QA", label: "Plan judge",
    json_schema: ["native", "tool", "prompt"], vision: false, tools: false,
    min_context: 128_000, must_differ_from: "PLAN_MOTIONS",
    sees_source_script: true, require_no_compression: true,
  },
  GEN_SPEC: {
    step: "GEN_SPEC", label: "Remotion spec üretimi",
    json_schema: ["native", "tool"], vision: false, tools: false,
    min_context: 32_000, sees_source_script: false, require_no_compression: true,
  },
  ASSET_QA: {
    step: "ASSET_QA", label: "Görsel kabul kontrolü",
    json_schema: ["native", "tool", "prompt"], vision: true, tools: false,
    min_context: 16_000, sees_source_script: false, require_no_compression: false,
  },
  QA_MOTION: {
    step: "QA_MOTION", label: "Video içerik + görsel QA",
    json_schema: ["native", "tool", "prompt"], vision: true, tools: false,
    min_context: 32_000, must_differ_from: "GEN_SPEC",
    sees_source_script: false, require_no_compression: true,
  },
  REPAIR: {
    step: "REPAIR", label: "Kod/spec onarım ajanı",
    json_schema: null, vision: false, tools: true,
    min_context: 64_000, sees_source_script: false, require_no_compression: false,
  },
};

export interface EligibilityResult {
  eligible: boolean;
  /** Panelde soluk gösterilen modelin tooltip'i. */
  reason?: string;
}

export function checkEligibility(
  step: PipelineStep,
  caps: ModelCapabilities
): EligibilityResult {
  const req = STEP_REQUIREMENTS[step];

  if (req.json_schema && !req.json_schema.includes(caps.json_schema)) {
    return {
      eligible: false,
      reason: `Bu adım ${req.json_schema.join("/")} şema desteği istiyor, model ${caps.json_schema} sunuyor`,
    };
  }
  if (req.vision && !caps.vision) {
    return { eligible: false, reason: "Bu model görsel girdi desteklemiyor" };
  }
  if (req.tools && !caps.tools) {
    return { eligible: false, reason: "Bu model tool use desteklemiyor" };
  }
  if (caps.context_window < req.min_context) {
    return {
      eligible: false,
      reason: `Context penceresi yetersiz (${caps.context_window.toLocaleString()} < ${req.min_context.toLocaleString()})`,
    };
  }
  return { eligible: true };
}
