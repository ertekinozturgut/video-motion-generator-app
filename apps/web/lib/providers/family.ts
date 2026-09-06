import type { ModelFamily, ProviderKind } from "./types";

/**
 * Aile ALTTA YATAN modelden çıkarılır, gateway adından değil.
 * Judge çeşitliliği buna dayanıyor: OpenRouter üzerinden seçilen
 * "anthropic/claude-…" ailesi "openrouter" değil "claude"dur.
 * OmniRoute'un auto/* alias'ları hangi modele gideceğini söylemediği için
 * "unknown" döner ve judge adımına atanamaz.
 */
const PATTERNS: Array<[RegExp, ModelFamily]> = [
  [/(^|\/)auto\//i, "unknown"],
  [/\b(best|cheapest|fastest)-/i, "unknown"],
  [/claude|anthropic/i, "claude"],
  [/gpt|codex|openai|(^|[^a-z])o[1-9]([^a-z]|$)/i, "gpt"],
  [/gemini|google/i, "gemini"],
  [/llama|meta-/i, "llama"],
  [/qwen/i, "qwen"],
  [/deepseek/i, "deepseek"],
  [/mistral|mixtral|magistral/i, "mistral"],
  [/glm|zhipu/i, "glm"],
  [/kimi|moonshot/i, "kimi"],
];

export function resolveFamily(modelKey: string, kind: ProviderKind): ModelFamily {
  const key = modelKey.toLowerCase();
  for (const [re, family] of PATTERNS) if (re.test(key)) return family;
  if (kind === "anthropic") return "claude";
  if (kind === "openai") return "gpt";
  return "unknown";
}

export const canJudge = (family: ModelFamily) => family !== "unknown";
