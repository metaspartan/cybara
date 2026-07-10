import { tables, type ProviderModel } from "./database";
import { discoverModelsDev, PROVIDER_TO_MODELS_DEV, type ModelsDevModel } from "./models-dev";
import { discoverOpenAICodexModels } from "./openai-codex-models";
import { providerManager, providers, resolveProviderType, type ProviderType } from "./providers";

const DEFAULT_TIMEOUT_MS = 10_000;
const DISCOVERY_CACHE_TTL_MS = 60_000;
const MAX_MODELS_PER_PROVIDER = 500;

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

export interface ModelDiscoveryOptions {
  request?: typeof globalThis.fetch;
  discoverCatalog?: (providerType: string) => Promise<ModelsDevModel[]>;
  force?: boolean;
}

const discoveryCache = new Map<string, { fetchedAt: number; result: DiscoveryResult }>();
const discoveryInFlight = new Map<string, Promise<DiscoveryResult>>();

function normalizeInputTypes(value: unknown): string[] {
  if (Array.isArray(value))
    return value.filter((entry): entry is string => typeof entry === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function persistModels(
  providerId: string,
  found: ModelsDevModel[]
): { added: number; models: DiscoveredModel[] } {
  const selected = found.slice(0, MAX_MODELS_PER_PROVIDER);
  const existing = tables.providerModels.byProvider(providerId) as ProviderModel[];
  const existingById = new Map(
    existing.map((model) => [model.model_id.trim().toLowerCase(), model] as const)
  );
  let added = 0;
  for (const model of selected) {
    const current = existingById.get(model.id.trim().toLowerCase());
    const currentInputTypes = normalizeInputTypes(current?.input_types);
    tables.providerModels.upsert({
      id: current?.id ?? crypto.randomUUID(),
      provider_id: providerId,
      model_id: model.id,
      model_name: model.name || model.id,
      context_window: model.contextWindow || current?.context_window || 128000,
      max_tokens: model.maxTokens || current?.max_tokens || 8192,
      reasoning: model.reasoning ?? Boolean(current?.reasoning),
      input_types: model.input?.length
        ? model.input
        : currentInputTypes.length
          ? currentInputTypes
          : ["text"],
      cost_input: model.costInput ?? current?.cost_input,
      cost_output: model.costOutput ?? current?.cost_output,
      cost_cache_read: model.costCacheRead ?? current?.cost_cache_read,
      cost_cache_write: model.costCacheWrite ?? current?.cost_cache_write,
    });
    if (!current) added += 1;
  }
  return {
    added,
    models: selected.map((model) => ({
      id: model.id,
      name: model.name || model.id,
      contextWindow: model.contextWindow,
    })),
  };
}

async function discoverViaModelsDev(
  providerId: string,
  providerType: string,
  discoverCatalog: (providerType: string) => Promise<ModelsDevModel[]>
): Promise<DiscoveryResult> {
  if (!PROVIDER_TO_MODELS_DEV[providerType]) {
    return { providerId, discovered: 0, added: 0, models: [], error: "No models.dev mapping" };
  }
  try {
    const persisted = persistModels(providerId, await discoverCatalog(providerType));
    return {
      providerId,
      discovered: persisted.models.length,
      added: persisted.added,
      models: persisted.models,
      source: "models.dev",
    };
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

async function runProviderDiscovery(
  providerId: string,
  options: ModelDiscoveryOptions
): Promise<DiscoveryResult> {
  const provider = providerManager.getWithCredentials(providerId);
  if (!provider) {
    return { providerId, discovered: 0, added: 0, models: [], error: "Provider not found" };
  }
  const providerType = resolveProviderType(provider.provider) ?? provider.provider;
  const request = options.request ?? globalThis.fetch;
  const discoverCatalog = options.discoverCatalog ?? discoverModelsDev;
  const auth = provider.api_key || provider.access_token;
  const providerConfig = providers[providerType as ProviderType];
  const allowsAnonymousDiscovery = providerConfig?.authType === "none";

  if (providerType === "openai-codex" && auth) {
    try {
      const found = await discoverOpenAICodexModels(auth, request);
      if (found.length > 0) {
        const persisted = persistModels(providerId, found);
        providerManager.setAuthoritativeModels(
          providerId,
          persisted.models.map((model) => model.id)
        );
        return {
          providerId,
          discovered: persisted.models.length,
          added: persisted.added,
          models: persisted.models,
          source: "openai-codex",
        };
      }
    } catch {
      return discoverViaModelsDev(providerId, providerType, discoverCatalog);
    }
  }

  const baseUrl = (provider.base_url || "").replace(/\/$/, "");
  if (!baseUrl || !baseUrl.includes("/v1") || (!auth && !allowsAnonymousDiscovery)) {
    return discoverViaModelsDev(providerId, providerType, discoverCatalog);
  }

  try {
    const response = await request(`${baseUrl}/models`, {
      headers: {
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
        "User-Agent": "cybara-model-discovery",
      },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) return discoverViaModelsDev(providerId, providerType, discoverCatalog);
    const data = (await response.json()) as { data?: Array<{ id?: unknown }> };
    const endpointModels = (data.data || [])
      .flatMap((model) =>
        typeof model?.id === "string" && model.id.trim()
          ? [{ id: model.id.trim(), name: model.id.trim() }]
          : []
      )
      .slice(0, MAX_MODELS_PER_PROVIDER);
    if (endpointModels.length === 0) {
      return discoverViaModelsDev(providerId, providerType, discoverCatalog);
    }
    const catalogModels = PROVIDER_TO_MODELS_DEV[providerType]
      ? await discoverCatalog(providerType).catch(() => [])
      : [];
    const catalogById = new Map(
      catalogModels.map((model) => [model.id.trim().toLowerCase(), model] as const)
    );
    const found = endpointModels.map((model) => catalogById.get(model.id.toLowerCase()) ?? model);
    const persisted = persistModels(providerId, found);
    providerManager.setAuthoritativeModels(
      providerId,
      persisted.models.map((model) => model.id)
    );
    return {
      providerId,
      discovered: persisted.models.length,
      added: persisted.added,
      models: persisted.models,
      source: "endpoint",
    };
  } catch {
    return discoverViaModelsDev(providerId, providerType, discoverCatalog);
  }
}

export async function discoverProviderModels(
  providerId: string,
  options: ModelDiscoveryOptions = {}
): Promise<DiscoveryResult> {
  const customDiscovery = Boolean(options.request || options.discoverCatalog);
  if (!customDiscovery && !options.force) {
    const cached = discoveryCache.get(providerId);
    if (cached && Date.now() - cached.fetchedAt < DISCOVERY_CACHE_TTL_MS) return cached.result;
    const pending = discoveryInFlight.get(providerId);
    if (pending) return pending;
  }
  const discovery = runProviderDiscovery(providerId, options);
  if (customDiscovery) return discovery;
  discoveryInFlight.set(providerId, discovery);
  try {
    const result = await discovery;
    discoveryCache.set(providerId, { fetchedAt: Date.now(), result });
    return result;
  } finally {
    discoveryInFlight.delete(providerId);
  }
}
