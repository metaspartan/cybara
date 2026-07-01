/**
 * Dynamic model discovery — fetch live model lists from OpenAI-compatible
 * providers and merge them into the DB-backed providerModels table.
 *
 * Cybara ships a static models array per provider (providers.ts), but with 50
 * providers this drifts. This module queries the provider's /v1/models endpoint
 * (where supported) and merges new models, keeping the catalog current without
 * code changes via a model-catalog runtime refresh.
 */
import { providerManager } from "./providers";
import { tables, type ProviderModel } from "./database";
import { discoverModelsDev, PROVIDER_TO_MODELS_DEV } from "./models-dev";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_MODELS_PER_PROVIDER = 200;

async function discoverViaModelsDev(providerId: string): Promise<DiscoveryResult> {
  if (!PROVIDER_TO_MODELS_DEV[providerId]) {
    return { providerId, discovered: 0, added: 0, models: [], error: "No models.dev mapping" };
  }
  try {
    const found = await discoverModelsDev(providerId);
    const existing = tables.providerModels.byProvider(providerId) as ProviderModel[];
    const existingIds = new Set(existing.map((m) => m.model_id));
    const models: DiscoveredModel[] = [];
    let added = 0;
    for (const m of found.slice(0, MAX_MODELS_PER_PROVIDER)) {
      models.push({ id: m.id, name: m.name || m.id, contextWindow: m.contextWindow });
      if (existingIds.has(m.id)) continue;
      try {
        tables.providerModels.upsert({
          id: crypto.randomUUID(),
          provider_id: providerId,
          model_id: m.id,
          model_name: m.name || m.id,
          context_window: m.contextWindow || 128000,
          max_tokens: m.maxTokens || 8192,
          reasoning: m.reasoning || false,
          input_types: m.input && m.input.length > 0 ? m.input : ["text"],
        });
        added += 1;
      } catch {
        /* skip duplicates */
      }
    }
    return { providerId, discovered: models.length, added, models, source: "models.dev" };
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
  source?: string;
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
  // Only attempt the live /v1/models endpoint for OpenAI-compatible providers;
  // otherwise fall back to the models.dev catalog.
  if (!baseUrl || !baseUrl.includes("/v1")) {
    return discoverViaModelsDev(providerId);
  }

  const auth = provider.api_key || provider.access_token;
  if (!auth) {
    return discoverViaModelsDev(providerId);
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
      return discoverViaModelsDev(providerId);
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

    if (models.length === 0) return discoverViaModelsDev(providerId);
    return { providerId, discovered: models.length, added, models, source: "endpoint" };
  } catch {
    return discoverViaModelsDev(providerId);
  }
}
