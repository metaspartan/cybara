/**
 * Dynamic model discovery — fetch live model lists from OpenAI-compatible
 * providers and merge them into the DB-backed providerModels table.
 *
 * Cybara ships a static models array per provider (providers.ts), but with 50
 * providers this drifts. This module queries the provider's /v1/models endpoint
 * (where supported) and merges new models, keeping the catalog current without
 * code changes. Ports the core idea of openclaw's model-catalog runtime refresh.
 */
import { providerManager } from "./providers";
import { tables, type ProviderModel } from "./database";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_MODELS_PER_PROVIDER = 200;

export interface DiscoveredModel {
  id: string;
  name?: string;
  contextWindow?: number;
}

export interface DiscoveryResult {
  providerId: string;
  discovered: number;
  added: number;
  models: DiscoveredModel[];
  error?: string;
}

/**
 * Fetch models from a provider's /v1/models endpoint. Only works for
 * OpenAI-compatible providers that expose the standard /models list.
 */
export async function discoverProviderModels(providerId: string): Promise<DiscoveryResult> {
  const provider = providerManager.getWithCredentials(providerId);
  if (!provider) {
    return { providerId, discovered: 0, added: 0, models: [], error: "Provider not found" };
  }

  const baseUrl = (provider.base_url || "").replace(/\/$/, "");
  // Only attempt discovery for OpenAI-compatible base URLs.
  if (!baseUrl || !baseUrl.includes("/v1")) {
    return {
      providerId,
      discovered: 0,
      added: 0,
      models: [],
      error: "Provider does not expose a /v1/models endpoint",
    };
  }

  const auth = provider.api_key || provider.access_token;
  if (!auth) {
    return { providerId, discovered: 0, added: 0, models: [], error: "No credentials" };
  }

  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${auth}`,
        "User-Agent": "cybara-model-discovery",
      },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        providerId,
        discovered: 0,
        added: 0,
        models: [],
        error: `HTTP ${response.status}`,
      };
    }
    const data = (await response.json()) as { data?: Array<{ id: string; owned_by?: string }> };
    const models: DiscoveredModel[] = (data.data || [])
      .filter((m) => m && typeof m.id === "string")
      .slice(0, MAX_MODELS_PER_PROVIDER)
      .map((m) => ({ id: m.id, name: m.id }));

    // Merge into the DB-backed providerModels table (skip already-known models).
    const existing = tables.providerModels.byProvider(providerId) as ProviderModel[];
    const existingIds = new Set(existing.map((m) => m.model_id));
    let added = 0;
    for (const model of models) {
      if (existingIds.has(model.id)) continue;
      try {
        tables.providerModels.upsert({
          id: crypto.randomUUID(),
          provider_id: providerId,
          model_id: model.id,
          model_name: model.name || model.id,
          context_window: 128000,
          max_tokens: 8192,
          reasoning: false,
          input_types: ["text"],
        });
        added += 1;
      } catch {
        /* skip duplicates */
      }
    }

    return { providerId, discovered: models.length, added, models };
  } catch (error) {
    return {
      providerId,
      discovered: 0,
      added: 0,
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
