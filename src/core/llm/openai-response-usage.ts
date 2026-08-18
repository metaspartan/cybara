import { CONTEXT_CHARS_PER_TOKEN_ESTIMATE, type OpenAIResponse } from "../agent-internals";
import { normalizeProviderTokenUsage } from "./token-usage-normalization";
import { trackTokenUsage } from "./token-usage-tracking";

export interface OpenAIResponseUsageContext {
  model: string;
  provider: string;
  providerUrl: string;
  durationMs: number;
  sessionId?: string;
  routerRouteId?: string;
  inputTokens?: number;
}

function estimateResponseOutputTokens(response: OpenAIResponse): number {
  let chars = 0;
  for (const choice of response.choices ?? []) {
    const content = typeof choice.message?.content === "string" ? choice.message.content : "";
    chars += content.length;
    for (const toolCall of choice.message?.tool_calls ?? []) {
      chars += String(toolCall.function?.arguments ?? "").length;
    }
  }
  return Math.max(0, Math.ceil(chars / CONTEXT_CHARS_PER_TOKEN_ESTIMATE));
}

export function trackOpenAIResponseUsage(
  response: OpenAIResponse,
  context: OpenAIResponseUsageContext
): boolean {
  const firstTokenMs = response.first_token_ms;
  const generationDurationMs = response.generation_duration_ms;

  if (response.usage) {
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
        firstTokenMs,
        generationDurationMs,
        routerRouteId: context.routerRouteId,
      }
    );
    return true;
  }

  const outputTokens = estimateResponseOutputTokens(response);
  const inputTokens =
    typeof context.inputTokens === "number" && Number.isFinite(context.inputTokens)
      ? Math.max(0, Math.floor(context.inputTokens))
      : 0;
  const hasTiming = firstTokenMs !== undefined || generationDurationMs !== undefined;
  if (outputTokens <= 0 && inputTokens <= 0 && !hasTiming) return false;

  trackTokenUsage(
    context.model,
    context.provider,
    context.providerUrl,
    inputTokens,
    outputTokens,
    context.durationMs,
    {
      sessionId: context.sessionId,
      estimated: true,
      firstTokenMs,
      generationDurationMs,
      routerRouteId: context.routerRouteId,
    }
  );
  return true;
}
