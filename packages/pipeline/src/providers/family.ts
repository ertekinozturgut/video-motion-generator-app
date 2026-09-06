import type { ModelFamily, ProviderKind } from "./types";

/**
 * Model ailesini ALTTA YATAN modelden çıkarır, gateway adından değil.
 *
 * Bu, judge çeşitliliğinin dayandığı fonksiyon. OpenRouter üzerinden
 * "anthropic/claude-…" seçtiğinde aile 'claude' olmalı; aksi halde
 * generator ve judge'ın ikisi de "openrouter" görünür ve sistem
 * kendi çıktısını puanladığını fark etmez.
 *
 * OmniRoute'un auto/* alias'ları hangi modelin cevaplayacağını
 * söylemediği için 'unknown' döner — bu da judge adımlarında
 * route kaydını reddettirir.
 */

const PATTERNS: Array<[RegExp, ModelFamily]> = [
  [/(^|\/)auto\//i, "unknown"],
  [/\b(best|cheapest|fastest)-/i, "unknown"],
  [/claude|anthropic/i, "claude"],
  [/gpt|o[1-9](-|$)|codex|openai/i, "gpt"],
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

  // Azure'da deployment adı serbest metin ("prod-gpt4-eu"), model adını
  // taşımayabilir. Bu yüzden Azure modelleri panelde ailesi manuel
  // girilerek eklenir; buraya sadece tahmin için düşer.
  for (const [re, family] of PATTERNS) {
    if (re.test(key)) return family;
  }

  if (kind === "anthropic") return "claude";
  if (kind === "openai") return "gpt";
  return "unknown";
}

/** Aile bilinmiyorsa judge olamaz. */
export function canJudge(family: ModelFamily): boolean {
  return family !== "unknown";
}
