import { providerManager, providers as providerCatalog, type ProviderType } from "./providers";
import {
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
} from "./agent-internals";

function normalizePositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.max(1, Math.floor(value));
}

function modelIdsMatch(entry: { model_id?: string | null; model_name?: string | null }) {
  const candidateIds = [entry.model_id, entry.model_name].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );
  return (normalizedModelId: string) =>
    candidateIds.some((value) => value.trim().toLowerCase() === normalizedModelId);
}

export function shouldPreferMaxCompletionTokens(providerConfig?: string): boolean {
  const provider = (providerConfig || "").trim().toLowerCase();
  return provider === "z.ai" || provider === "zai" || provider === "z.ai-coding";
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
    if (providerMatch) {
      const outputLimit = normalizePositiveInt(providerMatch.max_tokens);
      const contextLimit = normalizePositiveInt(providerMatch.context_window);
      const resolved = clampToContextWindow(outputLimit, contextLimit);
      if (resolved) return resolved;
    }
  }

  const staticProvider = providerCatalog[providerConfig as ProviderType];
  const staticModel = staticProvider?.models?.find(
    (entry: { id?: string }) =>
      typeof entry.id === "string" && entry.id.trim().toLowerCase() === normalizedModelId
  ) as { maxTokens?: number; context?: number } | undefined;
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
    }>;
    const providerMatch = providerModels.find((entry) => modelIdsMatch(entry)(normalizedModelId));
    const contextLimit = normalizePositiveInt(providerMatch?.context_window);
    if (contextLimit) return contextLimit;
  }

  const staticProvider = providerCatalog[providerConfig as ProviderType];
  const staticModel = staticProvider?.models?.find(
    (entry: { id?: string }) =>
      typeof entry.id === "string" && entry.id.trim().toLowerCase() === normalizedModelId
  ) as { context?: number } | undefined;
  const staticContextLimit = normalizePositiveInt(staticModel?.context);
  if (staticContextLimit) {
    return staticContextLimit;
  }

  return DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS;
}
