import { canJudge } from "../providers/family";
import type { ModelFamily } from "../providers/types";
import { STEP_REQUIREMENTS, checkEligibility, type PipelineStep } from "./steps";
import type { ModelCapabilities } from "../providers/types";

export interface RouteInput {
  step: PipelineStep;
  primary: ResolvedModel;
  fallbacks: ResolvedModel[];
  flags: { disable_compression: boolean; allow_auto_alias: boolean };
}

export interface ResolvedModel {
  model_id: string;
  model_key: string;
  display_name: string;
  family: ModelFamily;
  capabilities: ModelCapabilities;
  provider_kind: string;
  provider_label: string;
  data_policy: "no_training" | "unknown" | "may_train";
  network_scope: "public" | "local_worker_only";
}

export interface ValidationIssue {
  severity: "error" | "warning";
  step: PipelineStep;
  code:
    | "missing_route" | "not_eligible" | "judge_same_family"
    | "judge_unknown_family" | "data_policy" | "compression_on"
    | "unreachable_from_vercel";
  message: string;
}

/**
 * Route tablosunun tamamını doğrular.
 *
 * En kritik kural judge çeşitliliği: bir hata değil, kaydı reddeden bir
 * kontrol. Kendi çıktısını puanlayan bir pipeline sessizce yanlış çalışır
 * ve bunu hiçbir metrikten anlayamazsın.
 */
export function validateRoutes(routes: RouteInput[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byStep = new Map(routes.map((r) => [r.step, r]));

  for (const step of Object.keys(STEP_REQUIREMENTS) as PipelineStep[]) {
    const route = byStep.get(step);
    if (!route) {
      issues.push({
        severity: "error", step, code: "missing_route",
        message: `${STEP_REQUIREMENTS[step].label} için model atanmamış`,
      });
      continue;
    }

    const req = STEP_REQUIREMENTS[step];

    // 1) Yetenek uygunluğu — primary ve tüm fallback'ler
    for (const [i, m] of [route.primary, ...route.fallbacks].entries()) {
      const e = checkEligibility(step, m.capabilities);
      if (!e.eligible) {
        issues.push({
          severity: "error", step, code: "not_eligible",
          message: `${i === 0 ? "Primary" : `Fallback #${i}`} ${m.display_name}: ${e.reason}`,
        });
      }
    }

    // 2) Judge aile çeşitliliği — fallback zinciri dahil.
    //    Fallback'i atlarsan failover sırasında sessizce self-judge olursun.
    if (req.must_differ_from) {
      const other = byStep.get(req.must_differ_from);
      if (other) {
        const otherFamilies = new Set(
          [other.primary, ...other.fallbacks].map((m) => m.family)
        );
        for (const [i, m] of [route.primary, ...route.fallbacks].entries()) {
          if (!canJudge(m.family)) {
            issues.push({
              severity: "error", step, code: "judge_unknown_family",
              message:
                `${m.display_name} hangi modele yönlendiğini bildirmiyor ` +
                `(auto/* alias). Judge adımında pinlenmiş model zorunlu.`,
            });
          } else if (otherFamilies.has(m.family)) {
            issues.push({
              severity: "error", step, code: "judge_same_family",
              message:
                `${i === 0 ? "Primary" : `Fallback #${i}`} ${m.display_name} ` +
                `(${m.family}) ile ${STEP_REQUIREMENTS[req.must_differ_from].label} ` +
                `aynı aileden. Judge kendi çıktısını puanlayamaz.`,
            });
          }
        }
      }
    }

    // 3) Veri politikası — senaryo metnini gören adımlar
    if (req.sees_source_script) {
      for (const m of [route.primary, ...route.fallbacks]) {
        if (m.data_policy !== "no_training") {
          issues.push({
            severity: "warning", step, code: "data_policy",
            message:
              `${m.provider_label} veri politikası "${m.data_policy}". ` +
              `Bu adım yayınlanmamış senaryo metnini görüyor.`,
          });
        }
      }
    }

    // 4) Gateway sıkıştırması
    if (req.require_no_compression && !route.flags.disable_compression) {
      issues.push({
        severity: "error", step, code: "compression_on",
        message:
          "Context sıkıştırma açık. Bu adım claim sadakati ve strict JSON'a " +
          "bağlı, sıkıştırma context'i değiştirir.",
      });
    }

    // 5) Vercel'den erişilebilirlik
    for (const m of [route.primary, ...route.fallbacks]) {
      if (m.network_scope === "local_worker_only") {
        issues.push({
          severity: "warning", step, code: "unreachable_from_vercel",
          message:
            `${m.provider_label} yalnız local worker'dan çağrılabilir. ` +
            `Bu adım Vercel'de çalışıyorsa fallback'e düşer.`,
        });
      }
    }
  }

  return issues;
}

export function canSave(issues: ValidationIssue[]): boolean {
  return !issues.some((i) => i.severity === "error");
}
