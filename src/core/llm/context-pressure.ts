import { trackContextCompaction } from "../metrics";
import { broadcastStatus } from "../status";
import type { ToolContext } from "../tools";

const CHARS_PER_TOKEN = 4;

export interface ContextCompactionMeasurement {
  beforeTokens: number;
  afterTokens: number;
  reducedTokens: number;
  reducedPercent: number;
}

export function measureContextCompaction(
  beforeChars: number,
  afterChars: number
): ContextCompactionMeasurement | null {
  const normalizedBefore = Math.max(0, Math.round(beforeChars));
  const normalizedAfter = Math.max(0, Math.round(afterChars));
  if (normalizedBefore === 0 || normalizedAfter >= normalizedBefore) return null;

  const beforeTokens = Math.max(1, Math.ceil(normalizedBefore / CHARS_PER_TOKEN));
  const afterTokens = Math.max(0, Math.ceil(normalizedAfter / CHARS_PER_TOKEN));
  const reducedTokens = Math.max(1, beforeTokens - afterTokens);
  return {
    beforeTokens,
    afterTokens,
    reducedTokens,
    reducedPercent: Math.min(100, Math.round((reducedTokens / beforeTokens) * 100)),
  };
}

export function recordMidLoopContextCompaction(input: {
  beforeChars: number;
  afterChars: number;
  messageCount: number;
  model?: string;
  toolContext?: ToolContext;
}): ContextCompactionMeasurement | null {
  const measurement = measureContextCompaction(input.beforeChars, input.afterChars);
  if (!measurement) return null;

  const sessionId = input.toolContext?.sessionId?.trim();
  if (sessionId) {
    trackContextCompaction(sessionId, {
      messagesBefore: input.messageCount,
      messagesAfter: input.messageCount,
      tokensBefore: measurement.beforeTokens,
      tokensAfter: measurement.afterTokens,
      model: input.model,
    });
  }

  if (!input.toolContext?.suppressStreaming) {
    broadcastStatus({
      status: "thinking",
      timestamp: Date.now(),
      detail: `Reduced earlier tool output by ${measurement.reducedTokens.toLocaleString()} tokens to preserve context.`,
      sessionId,
      agentId: input.toolContext?.agentId,
    });
  }

  return measurement;
}
