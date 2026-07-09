import type { AgentMessage } from "../agent";
import { tables } from "../database";
import type { ToolContext } from "../tools/index";
import type { AgentToolCallResult } from "../agent-internals";
import { CONTEXT_CHARS_PER_TOKEN_ESTIMATE } from "../agent-internals";
import { trackTokenUsage } from "./token-usage-tracking";

export interface SessionTokenUsageSnapshot {
  totalTokens: number;
}

export interface LlmUsageFallbackInput {
  before: SessionTokenUsageSnapshot;
  durationMs: number;
  messages: AgentMessage[];
  model?: string;
  providerName?: string;
  providerUrl?: string;
  result: { content: string; thinking?: string; tool_calls?: AgentToolCallResult[] };
  toolContext?: ToolContext;
}

export function getSessionTokenUsageSnapshot(sessionId?: string): SessionTokenUsageSnapshot {
  const key = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!key) return { totalTokens: 0 };
  try {
    return { totalTokens: Math.max(0, tables.metrics.getTotal("token_usage_by_session", key)) };
  } catch {
    return { totalTokens: 0 };
  }
}

export function estimateFallbackTokensForText(text: string | undefined): number {
  const content = typeof text === "string" ? text.trim() : "";
  if (!content) return 0;
  return Math.max(1, Math.ceil(content.length / CONTEXT_CHARS_PER_TOKEN_ESTIMATE));
}

export function estimateFallbackInputTokens(messages: AgentMessage[]): number {
  return messages.reduce((total, message) => {
    const textTokens = estimateFallbackTokensForText(message.content);
    const imageTokens = Array.isArray(message.images) ? message.images.length * 250 : 0;
    return total + textTokens + imageTokens + 4;
  }, 0);
}

function addSessionTokenUsageRow(input: {
  sessionId: string;
  model: string;
  provider: string;
  providerUrl: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}): void {
  const totalTokens = input.inputTokens + input.outputTokens;
  tables.metrics.add({
    id: crypto.randomUUID(),
    type: "token_usage_by_session",
    key: input.sessionId,
    value: totalTokens,
    metadata: JSON.stringify({
      callId: crypto.randomUUID(),
      model: input.model,
      provider: input.provider,
      providerUrl: input.providerUrl,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      totalTokens,
      durationMs: input.durationMs,
      sessionId: input.sessionId,
      estimated: true,
      timestamp: Date.now(),
    }),
  });
}

export function trackEstimatedSessionTokenUsage(input: LlmUsageFallbackInput): boolean {
  const sessionId =
    typeof input.toolContext?.sessionId === "string" ? input.toolContext.sessionId.trim() : "";
  if (!sessionId || input.toolContext?.suppressStreaming) return false;
  const after = getSessionTokenUsageSnapshot(sessionId);
  if (after.totalTokens > input.before.totalTokens) return false;
  const inputTokens = estimateFallbackInputTokens(input.messages);
  const outputTokens =
    estimateFallbackTokensForText(input.result.content) +
    estimateFallbackTokensForText(input.result.thinking) +
    Math.max(0, input.result.tool_calls?.length ?? 0) * 12;
  if (inputTokens <= 0 && outputTokens <= 0) return false;
  const model = input.model || "unknown";
  const provider = input.providerName || "unknown";
  const providerUrl = input.providerUrl || "";
  trackTokenUsage(model, provider, providerUrl, inputTokens, outputTokens, input.durationMs, {
    sessionId,
  });
  if (getSessionTokenUsageSnapshot(sessionId).totalTokens <= input.before.totalTokens) {
    addSessionTokenUsageRow({
      sessionId,
      model,
      provider,
      providerUrl,
      inputTokens,
      outputTokens,
      durationMs: input.durationMs,
    });
  }
  return true;
}
