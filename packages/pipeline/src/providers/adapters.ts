import { OpenAICompatibleProvider } from "./openai-compatible";
import { resolveFamily } from "./family";
import type {
  JsonModeTier, NormalizedRequest, ProviderKind, ProviderModel,
} from "./types";

/* ------------------------------------------------------------------ */
/* OpenAI                                                              */
/* ------------------------------------------------------------------ */

export class OpenAIProvider extends OpenAICompatibleProvider {
  readonly kind: ProviderKind = "openai";

  protected headers() {
    const h: Record<string, string> = { authorization: `Bearer ${this.apiKey}` };
    if (this.config.organization_id) h["openai-organization"] = String(this.config.organization_id);
    if (this.config.project_id) h["openai-project"] = String(this.config.project_id);
    return h;
  }

  protected chatUrl() {
    return `${this.baseUrl}/chat/completions`;
  }

  // OpenAI strict json_schema'yı native destekliyor.
  protected tierFor(): JsonModeTier {
    return "native";
  }
}

/* ------------------------------------------------------------------ */
/* Azure AI Foundry                                                    */
/* ------------------------------------------------------------------ */

/**
 * Azure'da model adı değil DEPLOYMENT adı kullanılır ve deployment listesi
 * yönetim API'sindedir — çoğu kurumsal kurulumda o yetki verilmez.
 * Bu yüzden listModels() boş döner: modeller panelden manuel girilir.
 */
export class AzureFoundryProvider extends OpenAICompatibleProvider {
  readonly kind: ProviderKind = "azure_foundry";

  private get apiVersion(): string {
    return String(this.config.api_version ?? "2024-10-21");
  }

  /** 'openai' = OpenAI deployment'ları, 'inference' = Llama/Mistral/DeepSeek vb. */
  private get flavor(): "openai" | "inference" {
    return (this.config.flavor as "openai" | "inference") ?? "openai";
  }

  protected headers() {
    // Entra ID modunda çağıran taraf bearer token'ı config.access_token'a koyar.
    if (this.config.auth_mode === "entra" && this.config.access_token) {
      return { authorization: `Bearer ${this.config.access_token}` };
    }
    return { "api-key": this.apiKey };
  }

  protected chatUrl(modelKey: string) {
    if (this.flavor === "inference") {
      return `${this.baseUrl}/models/chat/completions?api-version=${this.apiVersion}`;
    }
    return `${this.baseUrl}/openai/deployments/${encodeURIComponent(modelKey)}` +
           `/chat/completions?api-version=${this.apiVersion}`;
  }

  protected tierFor(): JsonModeTier {
    // OpenAI deployment'ları native; diğer modeller prompt kademesine düşer.
    return this.flavor === "openai" ? "native" : "prompt";
  }

  async listModels(): Promise<ProviderModel[]> {
    return []; // manuel giriş — panel formu bunu doldurur
  }
}

/* ------------------------------------------------------------------ */
/* OpenRouter                                                          */
/* ------------------------------------------------------------------ */

export class OpenRouterProvider extends OpenAICompatibleProvider {
  readonly kind: ProviderKind = "openrouter";

  protected headers() {
    return {
      authorization: `Bearer ${this.apiKey}`,
      "http-referer": String(this.config.app_url ?? "https://localhost"),
      "x-title": String(this.config.app_title ?? "Video Panel"),
    };
  }

  protected chatUrl() {
    return `${this.baseUrl}/chat/completions`;
  }

  protected extraBody() {
    return {
      provider: {
        // Yayınlanmamış senaryolar için varsayılan: eğitim verisi olarak kullanma.
        data_collection: this.config.data_collection ?? "deny",
        allow_fallbacks: this.config.allow_fallbacks ?? false,
      },
    };
  }

  /**
   * OpenRouter kataloğu fiyat, context uzunluğu ve desteklenen parametreleri
   * döndürüyor — beş provider içinde tek otomatik senkron kaynağı bu.
   */
  protected mapModel(m: any): ProviderModel {
    const params: string[] = m.supported_parameters ?? [];
    const modality = String(m.architecture?.input_modalities ?? "");
    return {
      model_key: m.id,
      display_name: m.name ?? m.id,
      family: resolveFamily(m.id, this.kind),
      capabilities: {
        json_schema: params.includes("structured_outputs") ? "native"
                   : params.includes("response_format") ? "prompt"
                   : "prompt",
        vision: modality.includes("image") ||
                (m.architecture?.input_modalities ?? []).includes?.("image") === true,
        tools: params.includes("tools"),
        streaming: true,
        context_window: m.context_length ?? 0,
        max_output: m.top_provider?.max_completion_tokens ?? 4096,
        reasoning: params.includes("reasoning") || params.includes("include_reasoning"),
      },
      pricing: m.pricing
        ? {
            input_per_mtok: Number(m.pricing.prompt) * 1e6,
            output_per_mtok: Number(m.pricing.completion) * 1e6,
            currency: "USD",
            source: "synced",
          }
        : undefined,
    };
  }

  protected tierFor(): JsonModeTier {
    return "prompt"; // katalogdan gelen değer bunu ezer
  }
}

/* ------------------------------------------------------------------ */
/* OmniRoute                                                           */
/* ------------------------------------------------------------------ */

/**
 * Kendin barındırdığın, OpenAI uyumlu AI gateway.
 *
 * Üç kısıt burada koda gömülü:
 *  1. auto/* alias'ları hangi modelin cevapladığını gizler → family 'unknown'
 *     → routing doğrulaması judge adımlarında reddeder.
 *  2. Context sıkıştırma claim sadakatini bozar → şema-kritik adımlarda
 *     disable_compression ile kapatılır.
 *  3. base_url private ise SSRF guard provider'ı local_worker_only işaretler.
 */
export class OmniRouteProvider extends OpenAICompatibleProvider {
  readonly kind: ProviderKind = "omniroute";

  protected headers() {
    return this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {};
  }

  protected chatUrl() {
    return `${this.baseUrl}/chat/completions`;
  }

  protected extraBody(req: NormalizedRequest) {
    return req.disable_compression
      ? { compression: false, omniroute: { compression: "off" } }
      : {};
  }

  protected mapModel(m: any): ProviderModel {
    const key = m.id ?? m.name;
    const isAlias = /^auto\//i.test(key) || /\b(best|cheapest|fastest)-/i.test(key);
    return {
      model_key: key,
      display_name: isAlias ? `${key} (yönlendirme alias'ı)` : key,
      family: resolveFamily(key, this.kind), // alias → 'unknown'
      capabilities: {
        json_schema: "prompt",
        vision: false,
        tools: false,
        streaming: true,
        context_window: m.context_length ?? 0,
        max_output: 4096,
        reasoning: false,
      },
    };
  }
}
