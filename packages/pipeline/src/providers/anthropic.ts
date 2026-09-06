import type { ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  ProviderError, type HealthResult, type LLMProvider, type ModelPricing,
  type NormalizedRequest, type ProviderKind, type ProviderModel,
  type StructuredResult, type Usage,
} from "./types";

/**
 * Anthropic Messages API.
 *
 * Şema dayatması zorunlu tool call ile yapılır ('tool' kademesi) —
 * pratikte native strict JSON kadar güvenilir.
 *
 * Prompt caching burada ciddi kazanç: GEN_SPEC adımında her motion için
 * gönderilen registry kataloğu + style contract neredeyse aynı. 20 motionluk
 * bir videoda input maliyetinin büyük kısmı cache'e düşer.
 */
export class AnthropicProvider implements LLMProvider {
  readonly kind: ProviderKind = "anthropic";

  constructor(
    readonly providerId: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly config: Record<string, unknown> = {}
  ) {}

  private headers() {
    return {
      "x-api-key": this.apiKey,
      "anthropic-version": String(this.config.anthropic_version ?? "2023-06-01"),
      "content-type": "application/json",
    };
  }

  async structured<T>(
    req: NormalizedRequest,
    schema: ZodType<T>,
    schemaName: string
  ): Promise<StructuredResult<T>> {
    const jsonSchema = zodToJsonSchema(schema, { name: schemaName, target: "openApi3" });
    const started = Date.now();

    const content: unknown[] = [{ type: "text", text: req.user }];
    for (const img of req.images ?? []) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: img.media_type, data: img.data },
      });
    }

    const messages: Array<{ role: string; content: unknown }> = [
      { role: "user", content },
    ];

    let repairs = 0;
    let usage: Usage = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 };
    let lastText = "";

    for (let turn = 0; turn <= 2; turn++) {
      const body = {
        model: req.model_key,
        max_tokens: req.max_tokens,
        temperature: req.temperature ?? 0.2,
        system: this.systemBlocks(req),
        messages,
        tools: [
          {
            name: schemaName,
            description: `${schemaName} sözleşmesine uyan yapılandırılmış çıktı üret.`,
            input_schema: jsonSchema,
          },
        ],
        // Modelin serbest metne kaçmasını engelliyor.
        tool_choice: { type: "tool", name: schemaName },
      };

      const res = await this.post(`${this.baseUrl}/messages`, body);
      usage = this.mergeUsage(usage, this.extractUsage(res));

      const toolUse = (res.content ?? []).find((b: any) => b.type === "tool_use");
      lastText = toolUse ? JSON.stringify(toolUse.input) : this.textOf(res);

      if (toolUse) {
        const parsed = schema.safeParse(toolUse.input);
        if (parsed.success) {
          return {
            data: parsed.data,
            usage,
            repairs,
            tier: "tool",
            latency_ms: Date.now() - started,
            raw_text: lastText,
          };
        }
        repairs++;
        messages.push({ role: "assistant", content: res.content });
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolUse.id,
              is_error: true,
              content:
                "Şema doğrulaması başarısız:\n" +
                parsed.error.issues
                  .map((i) => `- ${i.path.join(".") || "(kök)"}: ${i.message}`)
                  .join("\n"),
            },
          ],
        });
        continue;
      }

      repairs++;
      messages.push({ role: "assistant", content: lastText });
      messages.push({ role: "user", content: `${schemaName} aracını kullanarak yanıt ver.` });
    }

    throw new ProviderError(
      `Şema ${repairs} onarım denemesinden sonra tutturulamadı (${schemaName})`,
      "schema",
      false
    );
  }

  /**
   * Sistem promptu iki bloğa ayrılır: cache_prefix_len'e kadar olan kısım
   * (registry kataloğu, style contract, kurallar) cache'lenir; geri kalan
   * motiona özgü kısım cache'lenmez.
   */
  private systemBlocks(req: NormalizedRequest) {
    const cacheLen = req.cache_prefix_len ?? 0;
    if (cacheLen <= 0 || cacheLen >= req.system.length) {
      return [{ type: "text", text: req.system }];
    }
    return [
      {
        type: "text",
        text: req.system.slice(0, cacheLen),
        cache_control: { type: "ephemeral" },
      },
      { type: "text", text: req.system.slice(cacheLen) },
    ];
  }

  private textOf(res: any): string {
    return (res.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
  }

  private extractUsage(res: any): Usage {
    const u = res?.usage ?? {};
    return {
      input_tokens: u.input_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      cached_input_tokens: (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    };
  }

  private mergeUsage(a: Usage, b: Usage): Usage {
    return {
      input_tokens: a.input_tokens + b.input_tokens,
      output_tokens: a.output_tokens + b.output_tokens,
      cached_input_tokens: (a.cached_input_tokens ?? 0) + (b.cached_input_tokens ?? 0),
    };
  }

  private async post(url: string, body: unknown): Promise<any> {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: this.headers(),
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
        res.status === 401 ? "auth"
          : res.status === 429 ? "rate_limit"
          : res.status >= 500 ? "server"
          : "bad_request",
        res.status === 429 || res.status >= 500,
        res.status
      );
    }
    return res.json();
  }

  async listModels(): Promise<ProviderModel[]> {
    const res = await fetch(`${this.baseUrl}/models`, { headers: this.headers() });
    if (!res.ok) throw new ProviderError(`Model listesi alınamadı: ${res.status}`, "server", true);
    const json: any = await res.json();
    return (json.data ?? []).map((m: any) => ({
      model_key: m.id,
      display_name: m.display_name ?? m.id,
      family: "claude" as const,
      capabilities: {
        json_schema: "tool" as const,
        vision: true,
        tools: true,
        streaming: true,
        context_window: 200_000,
        max_output: 8192,
        reasoning: true,
        prompt_caching: true,
      },
    }));
  }

  async healthCheck(modelKey: string): Promise<HealthResult> {
    const started = Date.now();
    try {
      await this.post(`${this.baseUrl}/messages`, {
        model: modelKey,
        max_tokens: 16,
        messages: [{ role: "user", content: "ping" }],
      });
      return { ok: true, latency_ms: Date.now() - started, json_mode_verified: true };
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
      (cached / 1e6) * (pricing.cached_input_per_mtok ?? pricing.input_per_mtok * 0.1) +
      (usage.output_tokens / 1e6) * pricing.output_per_mtok
    );
  }
}
