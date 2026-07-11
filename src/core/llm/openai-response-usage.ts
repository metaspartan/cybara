import type { OpenAIResponse } from "../agent-internals";
import { trackTokenUsage } from "./token-usage-tracking";

export interface OpenAIResponseUsageContext {
  model: string;
  provider: string;
  providerUrl: string;
  durationMs: number;
  sessionId?: string;
}

export function trackOpenAIResponseUsage(
  response: OpenAIResponse,
  context: OpenAIResponseUsageContext
): boolean {
  if (!response.usage) return false;

  trackTokenUsage(
    context.model,
    context.provider,
    context.providerUrl,
    response.usage.prompt_tokens || 0,
    response.usage.completion_tokens || 0,
    context.durationMs,
    {
      sessionId: context.sessionId,
      cachedInputTokens:
        response.usage.prompt_tokens_details?.cached_tokens ||
        response.usage.cache_read_input_tokens ||
        0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens || 0,
      firstTokenMs: response.first_token_ms ?? context.durationMs,
    }
  );
  return true;
}
