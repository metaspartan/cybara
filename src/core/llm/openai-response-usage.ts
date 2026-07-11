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
    { sessionId: context.sessionId }
  );
  return true;
}
