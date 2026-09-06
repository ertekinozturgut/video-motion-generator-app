import { canJudge } from "./family";
import type { JsonModeTier, ModelCapabilities, ModelFamily } from "./types";

export type PipelineStep =
  | "PLAN_CLAIMS" | "PLAN_MOTIONS" | "PLAN_QA"
  | "GEN_SPEC" | "ASSET_QA" | "QA_MOTION" | "REPAIR";

export interface StepRequirement {
  label: string;
  json_schema: JsonModeTier[] | null;
  vision: boolean;
  tools: boolean;
  min_context: number;
  must_differ_from?: PipelineStep;
  sees_source_script: boolean;
  require_no_compression: boolean;
}

export const STEPS: Record<PipelineStep, StepRequirement> = {
  PLAN_CLAIMS: {
    label: "Bilgi denetimi ve hedef kitle",
    json_schema: ["native", "tool", "prompt"], vision: false, tools: false,
    min_context: 128_000, sees_source_script: true, require_no_compression: true,
  },
  PLAN_MOTIONS: {
    label: "Motion planı",
    json_schema: ["native", "tool", "prompt"], vision: false, tools: false,
    min_context: 128_000, sees_source_script: true, require_no_compression: true,
  },
  PLAN_QA: {
    label: "Plan kontrolü",
    json_schema: ["native", "tool", "prompt"], vision: false, tools: false,
    min_context: 128_000, must_differ_from: "PLAN_MOTIONS",
    sees_source_script: true, require_no_compression: true,
  },
  GEN_SPEC: {
    label: "Remotion spec üretimi",
    json_schema: ["native", "tool"], vision: false, tools: false,
    min_context: 32_000, sees_source_script: false, require_no_compression: true,
  },
  ASSET_QA: {
    label: "Görsel kabulü",
    json_schema: ["native", "tool", "prompt"], vision: true, tools: false,
    min_context: 16_000, sees_source_script: false, require_no_compression: false,
  },
  QA_MOTION: {
    label: "Video kontrolü",
    json_schema: ["native", "tool", "prompt"], vision: true, tools: false,
    min_context: 32_000, must_differ_from: "GEN_SPEC",
    sees_source_script: false, require_no_compression: true,
  },
  REPAIR: {
    label: "Onarım ajanı",
    json_schema: null, vision: false, tools: true,
    min_context: 64_000, sees_source_script: false, require_no_compression: false,
  },
};

export const STEP_ORDER: PipelineStep[] = [
  "PLAN_CLAIMS", "PLAN_MOTIONS", "PLAN_QA", "GEN_SPEC", "ASSET_QA", "QA_MOTION", "REPAIR",
];

export function checkEligibility(
  step: PipelineStep,
  caps: ModelCapabilities
): { eligible: boolean; reason?: string } {
  const req = STEPS[step];
  if (req.json_schema && !req.json_schema.includes(caps.json_schema)) {
    return {
      eligible: false,
      reason: `${req.json_schema.join("/")} şema desteği gerekiyor, model ${caps.json_schema} sunuyor`,
    };
  }
  if (req.vision && !caps.vision) return { eligible: false, reason: "Görsel girdi desteklemiyor" };
  if (req.tools && !caps.tools) return { eligible: false, reason: "Tool use desteklemiyor" };
  if (caps.context_window < req.min_context) {
    return {
      eligible: false,
      reason: `Context penceresi yetersiz (${caps.context_window.toLocaleString("tr-TR")} < ${req.min_context.toLocaleString("tr-TR")})`,
    };
  }
  return { eligible: true };
}

export interface ResolvedModel {
  model_id: string;
  display_name: string;
  family: ModelFamily;
  capabilities: ModelCapabilities;
  provider_label: string;
  data_policy: "no_training" | "unknown" | "may_train";
  network_scope: "public" | "local_worker_only";
}

export interface RouteInput {
  step: PipelineStep;
  primary: ResolvedModel;
  fallbacks: ResolvedModel[];
  disable_compression: boolean;
}

export interface Issue {
  severity: "error" | "warning";
  step: PipelineStep;
  message: string;
}

/**
 * En kritik kural judge çeşitliliği ve bu bir uyarı değil, kaydı reddeden
 * bir kontrol. Kendi çıktısını puanlayan bir pipeline sessizce yanlış
 * çalışır; bunu hiçbir metrikten anlayamazsın.
 */
export function validateRoutes(routes: RouteInput[]): Issue[] {
  const issues: Issue[] = [];
  const byStep = new Map(routes.map((r) => [r.step, r]));

  for (const step of STEP_ORDER) {
    const route = byStep.get(step);
    if (!route) continue; // atanmamış adım hata değil, sadece eksik
    const req = STEPS[step];
    const chain = [route.primary, ...route.fallbacks];

    chain.forEach((m, i) => {
      const e = checkEligibility(step, m.capabilities);
      if (!e.eligible) {
        issues.push({
          severity: "error", step,
          message: `${i === 0 ? "Birincil" : `Yedek ${i}`} ${m.display_name}: ${e.reason}`,
        });
      }
    });

    if (req.must_differ_from) {
      const other = byStep.get(req.must_differ_from);
      if (other) {
        const otherFamilies = new Set([other.primary, ...other.fallbacks].map((m) => m.family));
        chain.forEach((m, i) => {
          if (!canJudge(m.family)) {
            issues.push({
              severity: "error", step,
              message: `${m.display_name} hangi modele yönlendiğini bildirmiyor. Kontrol adımında pinlenmiş model zorunlu.`,
            });
          } else if (otherFamilies.has(m.family)) {
            issues.push({
              severity: "error", step,
              message: `${i === 0 ? "Birincil" : `Yedek ${i}`} ${m.display_name} (${m.family}) ile "${STEPS[req.must_differ_from!].label}" aynı aileden. Kontrol kendi çıktısını puanlayamaz.`,
            });
          }
        });
      }
    }

    if (req.sees_source_script) {
      chain.forEach((m) => {
        if (m.data_policy !== "no_training") {
          issues.push({
            severity: "warning", step,
            message: `${m.provider_label} veri politikası "${m.data_policy}". Bu adım yayınlanmamış senaryoyu görüyor.`,
          });
        }
      });
    }

    if (req.require_no_compression && !route.disable_compression) {
      issues.push({
        severity: "error", step,
        message: "Context sıkıştırma açık. Bu adım tam metne bağlı, sıkıştırma context'i değiştirir.",
      });
    }

    chain.forEach((m) => {
      if (m.network_scope === "local_worker_only") {
        issues.push({
          severity: "warning", step,
          message: `${m.provider_label} yalnız local worker'dan çağrılabilir; Vercel'de yedeğe düşer.`,
        });
      }
    });
  }
  return issues;
}

export const canSave = (issues: Issue[]) => !issues.some((i) => i.severity === "error");
