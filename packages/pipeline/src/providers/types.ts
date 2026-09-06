import type { ZodType } from "zod";

export type ProviderKind =
  | "openai"
  | "azure_foundry"
  | "anthropic"
  | "openrouter"
  | "omniroute";

/** Şema dayatma kademesi — adapter kendi kademesini bildirir. */
export type JsonModeTier = "native" | "tool" | "prompt";

export type ModelFamily =
  | "gpt" | "claude" | "gemini" | "llama" | "qwen"
  | "deepseek" | "mistral" | "glm" | "kimi" | "other" | "unknown";

export interface ModelCapabilities {
  json_schema: JsonModeTier;
  vision: boolean;
  tools: boolean;
  streaming: boolean;
  context_window: number;
  max_output: number;
  reasoning: boolean;
  prompt_caching?: boolean;
}

export interface ModelPricing {
  input_per_mtok: number;
  output_per_mtok: number;
  cached_input_per_mtok?: number;
  currency: "USD";
  source: "synced" | "manual";
}

export interface ProviderModel {
  model_key: string;
  display_name: string;
  family: ModelFamily;
  capabilities: ModelCapabilities;
  pricing?: ModelPricing;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens?: number;
  reasoning_tokens?: number;
}

export interface ImageRef {
  media_type: "image/png" | "image/jpeg" | "image/webp";
  /** base64, data URL değil. */
  data: string;
}

export interface NormalizedRequest {
  system: string;
  user: string;
  images?: ImageRef[];
  model_key: string;
  max_tokens: number;
  temperature?: number;
  /** OmniRoute gibi gateway'lerde context sıkıştırmayı kapatmak için. */
  disable_compression?: boolean;
  /** Anthropic prompt caching: sistem promptunun cache'lenecek kısmı. */
  cache_prefix_len?: number;
}

export interface StructuredResult<T> {
  data: T;
  usage: Usage;
  repairs: number;
  tier: JsonModeTier;
  latency_ms: number;
  raw_text: string;
}

export interface HealthResult {
  ok: boolean;
  latency_ms: number;
  json_mode_verified: boolean;
  vision_verified?: boolean;
  detail?: string;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | "auth" | "rate_limit" | "server" | "timeout"
      | "bad_request" | "schema" | "network" | "blocked",
    readonly retryable: boolean,
    readonly status?: number
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface LLMProvider {
  readonly kind: ProviderKind;
  readonly providerId: string;

  structured<T>(
    req: NormalizedRequest,
    schema: ZodType<T>,
    schemaName: string
  ): Promise<StructuredResult<T>>;

  listModels(): Promise<ProviderModel[]>;
  healthCheck(modelKey: string): Promise<HealthResult>;
  estimateCost(usage: Usage, pricing?: ModelPricing): number;
}
