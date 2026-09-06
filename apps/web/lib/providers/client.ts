import type {
  HealthResult, JsonModeTier, ModelPricing, ProviderKind, ProviderModel,
} from "./types";
import { resolveFamily } from "./family";
import { DEFAULT_BASE_URL } from "./types";

export interface ProviderConfig {
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  config: Record<string, unknown>;
}

async function post(url: string, headers: Record<string, string>, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${res.status} ${detail.slice(0, 300)}`);
  }
  return res.json();
}

function headersFor(p: ProviderConfig): Record<string, string> {
  switch (p.kind) {
    case "anthropic":
      return {
        "x-api-key": p.apiKey,
        "anthropic-version": String(p.config.anthropic_version ?? "2023-06-01"),
      };
    case "azure_foundry":
      return p.config.auth_mode === "entra"
        ? { authorization: `Bearer ${p.apiKey}` }
        : { "api-key": p.apiKey };
    case "openrouter":
      return {
        authorization: `Bearer ${p.apiKey}`,
        "http-referer": String(p.config.app_url ?? "https://vercel.app"),
        "x-title": String(p.config.app_title ?? "Video Panel"),
      };
    default:
      return p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {};
  }
}

function chatUrl(p: ProviderConfig, modelKey: string): string {
  if (p.kind === "anthropic") return `${p.baseUrl}/messages`;
  if (p.kind === "azure_foundry") {
    const v = String(p.config.api_version ?? "2024-10-21");
    return p.config.flavor === "inference"
      ? `${p.baseUrl}/models/chat/completions?api-version=${v}`
      : `${p.baseUrl}/openai/deployments/${encodeURIComponent(modelKey)}/chat/completions?api-version=${v}`;
  }
  return `${p.baseUrl}/chat/completions`;
}

export function resolveBaseUrl(kind: ProviderKind, given?: string | null): string {
  const url = (given || DEFAULT_BASE_URL[kind] || "").replace(/\/+$/, "");
  if (!url) throw new Error(`${kind} için adres zorunlu`);
  return url;
}

/** Küçük bir çağrı: erişim, gecikme ve JSON modu doğrulanır. */
export async function healthCheck(
  p: ProviderConfig,
  modelKey: string
): Promise<HealthResult> {
  const started = Date.now();
  try {
    const h = headersFor(p);
    if (p.kind === "anthropic") {
      const res = await post(chatUrl(p, modelKey), h, {
        model: modelKey,
        max_tokens: 32,
        messages: [{ role: "user", content: 'Yalnızca {"ok":true} JSON nesnesini döndür.' }],
      });
      const text = (res.content ?? [])
        .filter((b: { type: string }) => b.type === "text")
        .map((b: { text: string }) => b.text).join("");
      return {
        ok: true,
        latency_ms: Date.now() - started,
        json_mode_verified: safeOk(text),
      };
    }
    const res = await post(chatUrl(p, modelKey), h, {
      model: modelKey,
      max_tokens: 32,
      messages: [{ role: "user", content: 'Yalnızca {"ok":true} JSON nesnesini döndür.' }],
      response_format: { type: "json_object" },
    });
    const text = res?.choices?.[0]?.message?.content ?? "";
    return { ok: true, latency_ms: Date.now() - started, json_mode_verified: safeOk(text) };
  } catch (e) {
    return {
      ok: false,
      latency_ms: Date.now() - started,
      json_mode_verified: false,
      detail: (e as Error).message,
    };
  }
}

function safeOk(text: string): boolean {
  try {
    return JSON.parse(text.trim().replace(/^```(?:json)?|```$/g, "")).ok === true;
  } catch {
    return false;
  }
}

/**
 * Model kataloğu. Azure boş döner: orada model adı değil deployment adı
 * kullanılıyor ve deployment listesi yönetim API'sinde — çoğu kurumsal
 * kurulumda o yetki verilmiyor. Panelden manuel giriliyor.
 */
export async function listModels(p: ProviderConfig): Promise<ProviderModel[]> {
  if (p.kind === "azure_foundry") return [];

  const res = await fetch(`${p.baseUrl}/models`, { headers: headersFor(p) });
  if (!res.ok) throw new Error(`Model listesi alınamadı: ${res.status}`);
  const json = await res.json();
  const rows: Array<Record<string, unknown>> = json.data ?? [];

  return rows.map((m) => {
    const key = String(m.id ?? m.name);
    if (p.kind === "openrouter") return mapOpenRouter(m, key);
    if (p.kind === "anthropic") {
      return {
        model_key: key,
        display_name: String(m.display_name ?? key),
        family: "claude" as const,
        capabilities: {
          json_schema: "tool" as JsonModeTier,
          vision: true, tools: true,
          context_window: 200_000, max_output: 8192, reasoning: true,
        },
      };
    }
    const isAlias = /^auto\//i.test(key) || /\b(best|cheapest|fastest)-/i.test(key);
    return {
      model_key: key,
      display_name: isAlias ? `${key} (yönlendirme alias'ı)` : key,
      family: resolveFamily(key, p.kind),
      capabilities: {
        json_schema: (p.kind === "openai" ? "native" : "prompt") as JsonModeTier,
        vision: p.kind === "openai",
        tools: p.kind === "openai",
        context_window: Number(m.context_length ?? (p.kind === "openai" ? 128_000 : 0)),
        max_output: 8192,
        reasoning: false,
      },
    };
  });
}

/** OpenRouter kataloğu fiyat ve yetenek döndüren tek kaynak. */
function mapOpenRouter(m: Record<string, any>, key: string): ProviderModel {
  const params: string[] = m.supported_parameters ?? [];
  const modalities: string[] = m.architecture?.input_modalities ?? [];
  const pricing: ModelPricing | undefined = m.pricing
    ? {
        input_per_mtok: Number(m.pricing.prompt) * 1e6,
        output_per_mtok: Number(m.pricing.completion) * 1e6,
        source: "synced",
      }
    : undefined;
  return {
    model_key: key,
    display_name: String(m.name ?? key),
    family: resolveFamily(key, "openrouter"),
    capabilities: {
      json_schema: params.includes("structured_outputs") ? "native" : "prompt",
      vision: modalities.includes("image"),
      tools: params.includes("tools"),
      context_window: Number(m.context_length ?? 0),
      max_output: Number(m.top_provider?.max_completion_tokens ?? 8192),
      reasoning: params.includes("reasoning") || params.includes("include_reasoning"),
    },
    pricing,
  };
}
