import { providerManager, providers as providerCatalog, type ProviderType } from "./providers";
import {
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
} from "./agent-internals";

function normalizePositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.max(1, Math.floor(value));
}

function isGenericFallbackRow(entry: {
  model_id?: string | null;
  model_name?: string | null;
  context_window?: number | null;
  max_tokens?: number | null;
}): boolean {
  const modelId = entry.model_id?.trim().toLowerCase() ?? "";
  const modelName = entry.model_name?.trim().toLowerCase() ?? "";
  return (
    modelId.length > 0 &&
    modelName === modelId &&
    entry.context_window === 128000 &&
    entry.max_tokens === 8192
  );
}

function modelIdsMatch(entry: { model_id?: string | null; model_name?: string | null }) {
  const candidateIds = [entry.model_id, entry.model_name].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );
  return (normalizedModelId: string) =>
    candidateIds.some((value) => value.trim().toLowerCase() === normalizedModelId);
}

interface CatalogModelLimits {
  id?: string;
  context?: number;
  maxTokens?: number;
}

const CUSTOM_COMPATIBLE_MAX_OUTPUT_TOKENS = 32_768;

function mostCommonLimit(values: Array<number | undefined>): number | undefined {
  const counts = new Map<number, number>();
  for (const value of values) {
    if (value === undefined) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort(
    ([leftValue, leftCount], [rightValue, rightCount]) =>
      rightCount - leftCount || rightValue - leftValue
  )[0]?.[0];
}

function catalogModelLimits(
  providerConfig: string,
  modelId: string
): CatalogModelLimits | undefined {
  const normalizedModelId = modelId.trim().toLowerCase();
  const configuredProvider = providerCatalog[providerConfig as ProviderType];
  const configuredMatch = configuredProvider?.models?.find(
    (entry: { id?: string }) =>
      typeof entry.id === "string" && entry.id.trim().toLowerCase() === normalizedModelId
  ) as CatalogModelLimits | undefined;
  if (configuredMatch || providerConfig !== "custom") return configuredMatch;

  const matches = Object.values(providerCatalog).flatMap((provider) =>
    (provider.models || []).filter((entry) => entry.id.trim().toLowerCase() === normalizedModelId)
  );
  if (matches.length === 0) return undefined;
  const catalogMaxTokens = mostCommonLimit(
    matches.map((entry) => normalizePositiveInt(entry.maxTokens))
  );
  return {
    id: modelId,
    context: mostCommonLimit(matches.map((entry) => normalizePositiveInt(entry.context))),
    maxTokens:
      catalogMaxTokens === undefined
        ? undefined
        : Math.min(catalogMaxTokens, CUSTOM_COMPATIBLE_MAX_OUTPUT_TOKENS),
  };
}

export function shouldPreferMaxCompletionTokens(providerConfig?: string): boolean {
  const provider = (providerConfig || "").trim().toLowerCase();
  return (
    provider === "z.ai" ||
    provider === "zai" ||
    provider === "z.ai-coding" ||
    provider === "kimi-code" ||
    provider === "kimi-code-oauth" ||
    provider === "kimi-coding" ||
    provider === "kimi-oauth" ||
    provider === "kimi-code-subscription"
  );
}

export function resolveModelMaxOutputTokens(
  providerConfig: string,
  providerId: string | undefined,
  modelId: string
): number {
  const clampToContextWindow = (
    maxTokens: number | undefined,
    contextWindow: number | undefined
  ) =>
    contextWindow
      ? Math.min(maxTokens ?? DEFAULT_MODEL_MAX_OUTPUT_TOKENS, contextWindow)
      : maxTokens;

  const normalizedModelId = modelId.trim().toLowerCase();
  if (providerId) {
    const providerModels = providerManager.getModels(providerId) as Array<{
      model_id?: string | null;
      model_name?: string | null;
      context_window?: number | null;
      max_tokens?: number | null;
    }>;
    const providerMatch = providerModels.find((entry) => modelIdsMatch(entry)(normalizedModelId));
    if (providerMatch && !isGenericFallbackRow(providerMatch)) {
      const outputLimit = normalizePositiveInt(providerMatch.max_tokens);
      const contextLimit = normalizePositiveInt(providerMatch.context_window);
      const resolved = clampToContextWindow(outputLimit, contextLimit);
      if (resolved) return resolved;
    }
  }

  const staticModel = catalogModelLimits(providerConfig, normalizedModelId);
  if (staticModel) {
    const outputLimit = normalizePositiveInt(staticModel.maxTokens);
    const contextLimit = normalizePositiveInt(staticModel.context);
    const resolved = clampToContextWindow(outputLimit, contextLimit);
    if (resolved) return resolved;
  }

  return DEFAULT_MODEL_MAX_OUTPUT_TOKENS;
}

export function resolveModelContextWindowTokens(
  providerConfig: string,
  providerId: string | undefined,
  modelId: string
): number {
  const normalizedModelId = modelId.trim().toLowerCase();
  if (providerId) {
    const providerModels = providerManager.getModels(providerId) as Array<{
      model_id?: string | null;
      model_name?: string | null;
      context_window?: number | null;
      max_tokens?: number | null;
    }>;
    const providerMatch = providerModels.find(
      (entry) => !isGenericFallbackRow(entry) && modelIdsMatch(entry)(normalizedModelId)
    );
    const contextLimit = normalizePositiveInt(providerMatch?.context_window);
    if (contextLimit) return contextLimit;
  }

  const staticModel = catalogModelLimits(providerConfig, normalizedModelId);
  const staticContextLimit = normalizePositiveInt(staticModel?.context);
  if (staticContextLimit) {
    return staticContextLimit;
  }

  return DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS;
}
