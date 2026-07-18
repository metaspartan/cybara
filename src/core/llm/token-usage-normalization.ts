export type CacheTokenAccounting = "included" | "separate";

export interface ProviderTokenUsageInput {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  cacheTokenAccounting: CacheTokenAccounting;
}

export interface NormalizedProviderTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

function tokenCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

export function normalizeProviderTokenUsage(
  usage: ProviderTokenUsageInput
): NormalizedProviderTokenUsage {
  const reportedInputTokens = tokenCount(usage.inputTokens);
  const outputTokens = tokenCount(usage.outputTokens);
  const cachedInputTokens = tokenCount(usage.cachedInputTokens);
  const cacheWriteTokens = tokenCount(usage.cacheWriteTokens);
  const inputTokens =
    usage.cacheTokenAccounting === "separate"
      ? reportedInputTokens + cachedInputTokens + cacheWriteTokens
      : reportedInputTokens;

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

export function resolveGoogleOutputTokens(usage: {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
}): number {
  const promptTokens = tokenCount(usage.promptTokenCount);
  const totalTokens = tokenCount(usage.totalTokenCount);
  if (totalTokens >= promptTokens && totalTokens > 0) {
    return totalTokens - promptTokens;
  }
  return tokenCount(usage.candidatesTokenCount) + tokenCount(usage.thoughtsTokenCount);
}
