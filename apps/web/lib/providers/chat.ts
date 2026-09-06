import type { ProviderConfig } from "./client";
import type { TokenUsage } from "@/lib/jobs/trace";

/**
 * Sağlayıcı farklarını tek yerde eritir: Anthropic'in messages API'si ile
 * OpenAI uyumlu chat/completions arasındaki gövde, başlık ve yanıt
 * biçimi farkları burada bitiyor. Çağıran taraf tek bir şekil görüyor.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  text: string;
  usage: TokenUsage | null;
}

export async function chatComplete({
  provider, modelKey, messages, jsonMode, temperature, maxTokens,
}: {
  provider: ProviderConfig;
  modelKey: string;
  messages: ChatMessage[];
  jsonMode: boolean;
  temperature: number;
  maxTokens: number;
}): Promise<ChatResult> {
  return provider.kind === "anthropic"
    ? anthropic({ provider, modelKey, messages, temperature, maxTokens })
    : openaiCompatible({ provider, modelKey, messages, jsonMode, temperature, maxTokens });
}

async function openaiCompatible({
  provider, modelKey, messages, jsonMode, temperature, maxTokens,
}: {
  provider: ProviderConfig; modelKey: string; messages: ChatMessage[];
  jsonMode: boolean; temperature: number; maxTokens: number;
}): Promise<ChatResult> {
  const body: Record<string, unknown> = {
    model: modelKey,
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  // json_object yalnız destekleyen modellerde açılıyor. Desteklemeyen bir
  // modele gönderilirse çağrı komple reddediliyor; şema zaten prompt'ta
  // anlatıldığı ve Zod ile doğrulandığı için bu mod bir garanti değil,
  // sadece yardım.
  if (jsonMode) body.response_format = { type: "json_object" };

  const json = await post(chatUrl(provider, modelKey), headersFor(provider), body);
  const text: string = json?.choices?.[0]?.message?.content ?? "";
  const u = json?.usage ?? null;

  return {
    text,
    usage: u
      ? {
          input_tokens: num(u.prompt_tokens ?? u.input_tokens),
          output_tokens: num(u.completion_tokens ?? u.output_tokens),
          cached_input_tokens: num(u.prompt_tokens_details?.cached_tokens),
        }
      : null,
  };
}

async function anthropic({
  provider, modelKey, messages, temperature, maxTokens,
}: {
  provider: ProviderConfig; modelKey: string; messages: ChatMessage[];
  temperature: number; maxTokens: number;
}): Promise<ChatResult> {
  // Anthropic system'i ayrı alan olarak istiyor, messages dizisinde kabul
  // etmiyor; sistem mesajları birleştirilip oraya taşınıyor.
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  const json = await post(`${provider.baseUrl}/messages`, headersFor(provider), {
    model: modelKey,
    system: system || undefined,
    messages: rest,
    temperature,
    max_tokens: maxTokens,
  });

  const text: string = (json?.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("");

  const u = json?.usage ?? null;
  return {
    text,
    usage: u
      ? {
          input_tokens: num(u.input_tokens),
          output_tokens: num(u.output_tokens),
          cached_input_tokens: num(u.cache_read_input_tokens),
        }
      : null,
  };
}

/* ------------------------------------------------------------ ortak */

async function post(url: string, headers: Record<string, string>, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    // Fonksiyonun kendi süre sınırının ALTINDA kalmalı. Hobby planında
    // sınır 60 sn; timeout onun üstünde olsaydı fonksiyon çağrı bitmeden
    // öldürülür, elimizde ne yanıt ne de "timeout" kaydı kalırdı.
    // Pro'ya geçilip maxDuration 300 yapılınca bu da yükseltilmeli.
    signal: AbortSignal.timeout(50_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${res.status} ${detail.slice(0, 400)}`);
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
  if (p.kind === "azure_foundry") {
    const v = String(p.config.api_version ?? "2024-10-21");
    return p.config.flavor === "inference"
      ? `${p.baseUrl}/models/chat/completions?api-version=${v}`
      : `${p.baseUrl}/openai/deployments/${encodeURIComponent(modelKey)}/chat/completions?api-version=${v}`;
  }
  return `${p.baseUrl}/chat/completions`;
}

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
