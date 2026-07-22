import type { OpenAIResponse } from "../agent-internals";
import { normalizeProviderTokenUsage } from "./token-usage-normalization";
import { trackTokenUsage } from "./token-usage-tracking";

export interface OpenAIResponseUsageContext {
  model: string;
  provider: string;
  providerUrl: string;
  durationMs: number;
  sessionId?: string;
  routerRouteId?: string;
}

export function trackOpenAIResponseUsage(
  response: OpenAIResponse,
  context: OpenAIResponseUsageContext
): boolean {
  if (!response.usage) return false;
  const hasIncludedCacheCount = response.usage.prompt_tokens_details?.cached_tokens !== undefined;
  const usage = normalizeProviderTokenUsage({
    inputTokens: response.usage.prompt_tokens,
    outputTokens: response.usage.completion_tokens,
    cachedInputTokens: hasIncludedCacheCount
      ? response.usage.prompt_tokens_details?.cached_tokens
      : response.usage.cache_read_input_tokens,
    cacheWriteTokens: response.usage.cache_creation_input_tokens,
    cacheTokenAccounting: hasIncludedCacheCount ? "included" : "separate",
  });

  trackTokenUsage(
    context.model,
    context.provider,
    context.providerUrl,
    usage.inputTokens,
    usage.outputTokens,
    context.durationMs,
    {
      sessionId: context.sessionId,
      cachedInputTokens: usage.cachedInputTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      firstTokenMs: response.first_token_ms,
      generationDurationMs: response.generation_duration_ms,
      routerRouteId: context.routerRouteId,
    }
  );
  return true;
}
