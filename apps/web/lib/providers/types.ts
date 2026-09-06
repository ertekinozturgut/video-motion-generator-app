export type ProviderKind =
  | "openai" | "azure_foundry" | "anthropic" | "openrouter" | "omniroute";

export type JsonModeTier = "native" | "tool" | "prompt";

export type ModelFamily =
  | "gpt" | "claude" | "gemini" | "llama" | "qwen"
  | "deepseek" | "mistral" | "glm" | "kimi" | "other" | "unknown";

export interface ModelCapabilities {
  json_schema: JsonModeTier;
  vision: boolean;
  tools: boolean;
  context_window: number;
  max_output: number;
  reasoning: boolean;
}

export interface ModelPricing {
  input_per_mtok: number;
  output_per_mtok: number;
  cached_input_per_mtok?: number;
  source: "synced" | "manual";
}

export interface ProviderModel {
  model_key: string;
  display_name: string;
  family: ModelFamily;
  capabilities: ModelCapabilities;
  pricing?: ModelPricing;
}

export interface HealthResult {
  ok: boolean;
  latency_ms: number;
  json_mode_verified: boolean;
  detail?: string;
}

export const PROVIDER_LABEL: Record<ProviderKind, string> = {
  openai: "OpenAI",
  azure_foundry: "Azure AI Foundry",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
  omniroute: "OmniRoute",
};

export const DEFAULT_BASE_URL: Record<ProviderKind, string | null> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  azure_foundry: null,
  omniroute: null,
};
