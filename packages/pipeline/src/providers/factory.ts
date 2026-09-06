import { AnthropicProvider } from "./anthropic";
import {
  AzureFoundryProvider, OmniRouteProvider, OpenAIProvider, OpenRouterProvider,
} from "./adapters";
import type { LLMProvider, ProviderKind } from "./types";

const DEFAULT_BASE_URLS: Record<ProviderKind, string | null> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  azure_foundry: null,   // zorunlu, kullanıcı girer
  omniroute: null,       // zorunlu, kullanıcı girer
};

export interface ProviderRow {
  provider_id: string;
  kind: ProviderKind;
  base_url: string | null;
  config_json: Record<string, unknown>;
}

/** Anahtar bu noktada çözülmüş olarak gelir; hiçbir yerde loglanmaz. */
export function buildProvider(row: ProviderRow, apiKey: string): LLMProvider {
  const baseUrl = (row.base_url ?? DEFAULT_BASE_URLS[row.kind])?.replace(/\/+$/, "");
  if (!baseUrl) throw new Error(`${row.kind} için base_url zorunlu`);

  switch (row.kind) {
    case "openai":
      return new OpenAIProvider(row.provider_id, baseUrl, apiKey, row.config_json);
    case "anthropic":
      return new AnthropicProvider(row.provider_id, baseUrl, apiKey, row.config_json);
    case "openrouter":
      return new OpenRouterProvider(row.provider_id, baseUrl, apiKey, row.config_json);
    case "azure_foundry":
      return new AzureFoundryProvider(row.provider_id, baseUrl, apiKey, row.config_json);
    case "omniroute":
      return new OmniRouteProvider(row.provider_id, baseUrl, apiKey, row.config_json);
  }
}
