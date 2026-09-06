import type { ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  ProviderError, type HealthResult, type JsonModeTier, type LLMProvider,
  type ModelPricing, type NormalizedRequest, type ProviderKind,
  type ProviderModel, type StructuredResult, type Usage,
} from "./types";
import { resolveFamily } from "./family";

/**
 * OpenAI uyumlu /v1/chat/completions konuşan her şeyin ortak temeli:
 * OpenAI, Azure AI Foundry, OpenRouter, OmniRoute.
 *
 * Alt sınıflar yalnız üç şeyi değiştirir: URL kurgusu, header'lar ve
 * gövdeye eklenen sağlayıcıya özgü alanlar.
 */
export abstract class OpenAICompatibleProvider implements LLMProvider {
  abstract readonly kind: ProviderKind;

  constructor(
    readonly providerId: string,
    protected readonly baseUrl: string,
    protected readonly apiKey: string,
    protected readonly config: Record<string, unknown> = {}
  ) {}

  protected abstract headers(): Record<string, string>;
  protected abstract chatUrl(modelKey: string): string;

  /** Sağlayıcıya özgü gövde alanları (OpenRouter provider tercihi vb.). */
  protected extraBody(_req: NormalizedRequest): Record<string, unknown> {
    return {};
  }

  /** Modelin şema kademesi — katalogdan gelir, varsayılan en güvensiz. */
  protected tierFor(_modelKey: string): JsonModeTier {
    return "prompt";
  }

  async structured<T>(
    req: NormalizedRequest,
    schema: ZodType<T>,
    schemaName: string
  ): Promise<StructuredResult<T>> {
    const tier = this.tierFor(req.model_key);
    const jsonSchema = zodToJsonSchema(schema, { name: schemaName, target: "openApi3" });
    const started = Date.now();

    const messages: Array<{ role: string; content: unknown }> = [
      { role: "system", content: this.systemFor(req, tier, jsonSchema) },
      { role: "user", content: this.userContent(req) },
    ];

    let repairs = 0;
    let usage: Usage = { input_tokens: 0, output_tokens: 0 };
    let lastText = "";

    // Onarım döngüsü: parse hatasında Zod mesajını geri gönder.
    // 2 turdan fazlası fayda getirmiyor; failover devreye girsin.
    for (let turn = 0; turn <= 2; turn++) {
      const body: Record<string, unknown> = {
        model: req.model_key,
        messages,
        max_tokens: req.max_tokens,
        temperature: req.temperature ?? 0.2,
        ...this.jsonModeBody(tier, schemaName, jsonSchema),
        ...this.extraBody(req),
      };

      const res = await this.post(this.chatUrl(req.model_key), body);
      const text = this.extractText(res, tier);
      lastText = text;
      usage = this.mergeUsage(usage, this.extractUsage(res));

      const parsed = this.tryParse(text, schema);
      if (parsed.ok) {
        return {
          data: parsed.value,
          usage,
          repairs,
          tier,
          latency_ms: Date.now() - started,
          raw_text: text,
        };
      }

      repairs++;
      messages.push({ role: "assistant", content: text });
      messages.push({
        role: "user",
        content:
          "Çıktın şemaya uymadı. Yalnızca düzeltilmiş JSON döndür, açıklama yazma.\n" +
          `Hatalar:\n${parsed.error}`,
      });
    }

    throw new ProviderError(
      `Şema ${repairs} onarım denemesinden sonra tutturulamadı (${schemaName})`,
      "schema",
      false
    );
  }

  protected systemFor(
    req: NormalizedRequest,
    tier: JsonModeTier,
    jsonSchema: unknown
  ): string {
    if (tier === "native") return req.system;
    // prompt kademesinde şemayı sistem promptuna gömüyoruz
    return (
      req.system +
      "\n\nYANIT FORMATI: Yalnızca aşağıdaki JSON Schema'ya uyan tek bir JSON " +
      "nesnesi döndür. Markdown kod bloğu, açıklama veya önsöz ekleme.\n" +
      JSON.stringify(jsonSchema)
    );
  }

  protected userContent(req: NormalizedRequest): unknown {
    if (!req.images?.length) return req.user;
    return [
      { type: "text", text: req.user },
      ...req.images.map((img) => ({
        type: "image_url",
        image_url: { url: `data:${img.media_type};base64,${img.data}` },
      })),
    ];
  }

  protected jsonModeBody(
    tier: JsonModeTier,
    name: string,
    jsonSchema: unknown
  ): Record<string, unknown> {
    if (tier === "native") {
      return {
        response_format: {
          type: "json_schema",
          json_schema: { name, schema: jsonSchema, strict: true },
        },
      };
    }
    return { response_format: { type: "json_object" } };
  }

  protected tryParse<T>(
    text: string,
    schema: ZodType<T>
  ): { ok: true; value: T } | { ok: false; error: string } {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    let json: unknown;
    try {
      json = JSON.parse(cleaned);
    } catch (e) {
      return { ok: false, error: `Geçersiz JSON: ${(e as Error).message}` };
    }
    const result = schema.safeParse(json);
    if (result.success) return { ok: true, value: result.data };
    return {
      ok: false,
      error: result.error.issues
        .map((i) => `- ${i.path.join(".") || "(kök)"}: ${i.message}`)
        .join("\n"),
    };
  }

  protected async post(url: string, body: unknown): Promise<any> {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.headers() },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (e) {
      const msg = (e as Error).message;
      throw new ProviderError(msg, /timeout|abort/i.test(msg) ? "timeout" : "network", true);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new ProviderError(
        `${res.status} ${detail.slice(0, 500)}`,
        res.status === 401 || res.status === 403 ? "auth"
          : res.status === 429 ? "rate_limit"
          : res.status >= 500 ? "server"
          : "bad_request",
        res.status === 429 || res.status >= 500,
        res.status
      );
    }
    return res.json();
  }

  protected extractText(res: any, _tier: JsonModeTier): string {
    return res?.choices?.[0]?.message?.content ?? "";
  }

  protected extractUsage(res: any): Usage {
    const u = res?.usage ?? {};
    return {
      input_tokens: u.prompt_tokens ?? 0,
      output_tokens: u.completion_tokens ?? 0,
      cached_input_tokens: u.prompt_tokens_details?.cached_tokens ?? 0,
      reasoning_tokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
    };
  }

  protected mergeUsage(a: Usage, b: Usage): Usage {
    return {
      input_tokens: a.input_tokens + b.input_tokens,
      output_tokens: a.output_tokens + b.output_tokens,
      cached_input_tokens: (a.cached_input_tokens ?? 0) + (b.cached_input_tokens ?? 0),
      reasoning_tokens: (a.reasoning_tokens ?? 0) + (b.reasoning_tokens ?? 0),
    };
  }

  async listModels(): Promise<ProviderModel[]> {
    const res = await fetch(`${this.baseUrl}/models`, { headers: this.headers() });
    if (!res.ok) throw new ProviderError(`Model listesi alınamadı: ${res.status}`, "server", true);
    const json: any = await res.json();
    return (json.data ?? []).map((m: any) => this.mapModel(m));
  }

  protected mapModel(m: any): ProviderModel {
    const key = m.id ?? m.name;
    return {
      model_key: key,
      display_name: m.name ?? key,
      family: resolveFamily(key, this.kind),
      capabilities: {
        json_schema: this.tierFor(key),
        vision: false,
        tools: false,
        streaming: true,
        context_window: m.context_length ?? 0,
        max_output: m.max_output_tokens ?? 4096,
        reasoning: false,
      },
    };
  }

  async healthCheck(modelKey: string): Promise<HealthResult> {
    const started = Date.now();
    try {
      const res = await this.post(this.chatUrl(modelKey), {
        model: modelKey,
        messages: [{ role: "user", content: 'Yanıt olarak yalnızca {"ok":true} döndür.' }],
        max_tokens: 32,
        response_format: { type: "json_object" },
      });
      const text = this.extractText(res, "prompt");
      let jsonOk = false;
      try { jsonOk = JSON.parse(text.trim())?.ok === true; } catch { /* boş */ }
      return { ok: true, latency_ms: Date.now() - started, json_mode_verified: jsonOk };
    } catch (e) {
      return {
        ok: false,
        latency_ms: Date.now() - started,
        json_mode_verified: false,
        detail: (e as Error).message,
      };
    }
  }

  estimateCost(usage: Usage, pricing?: ModelPricing): number {
    if (!pricing) return 0;
    const cached = usage.cached_input_tokens ?? 0;
    const fresh = Math.max(0, usage.input_tokens - cached);
    return (
      (fresh / 1e6) * pricing.input_per_mtok +
      (cached / 1e6) * (pricing.cached_input_per_mtok ?? pricing.input_per_mtok) +
      (usage.output_tokens / 1e6) * pricing.output_per_mtok
    );
  }
}
