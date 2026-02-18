// Centralized metrics tracking for the Cybara Agent Platform
// Consolidates all metric tracking functions

import { tables } from "./database";

/**
 * Track a generic metric
 */
export function trackMetric(
  type: string,
  key: string,
  value: number,
  metadata?: Record<string, unknown>
): void {
  try {
    const id = crypto.randomUUID();
    tables.metrics.add({
      id,
      type,
      key,
      value,
      metadata: metadata ? JSON.stringify(metadata) : undefined,
    });
  } catch {
    // Silent fail - metrics shouldn't break execution
  }
}

/**
 * Track a tool call
 */
export function trackToolCall(toolName: string, duration: number, success: boolean): void {
  try {
    const id = crypto.randomUUID();

    // Track by tool name
    tables.metrics.add({ id, type: "tool_call", key: toolName, value: 1 });

    // Also track with 'all' for easier aggregation
    const allId = crypto.randomUUID();
    tables.metrics.add({ id: allId, type: "tool_call", key: "all", value: 1 });

    // Track duration
    if (duration > 0) {
      const durationId = crypto.randomUUID();
      tables.metrics.add({
        id: durationId,
        type: "tool_duration",
        key: toolName,
        value: duration,
      });
    }

    // Track errors
    if (!success) {
      const errId = crypto.randomUUID();
      tables.metrics.add({ id: errId, type: "tool_error", key: toolName, value: 1 });
    }
  } catch {
    // Silent fail - metrics shouldn't break execution
  }
}

/**
 * Track token usage for LLM calls
 */
export function trackTokenUsage(
  model: string,
  provider: string,
  inputTokens: number,
  outputTokens: number
): void {
  try {
    const totalTokens = inputTokens + outputTokens;

    // Track total
    const totalId = crypto.randomUUID();
    tables.metrics.add({
      id: totalId,
      type: "token_usage",
      key: "all",
      value: totalTokens,
    });

    // Track input/output separately
    const inputId = crypto.randomUUID();
    tables.metrics.add({
      id: inputId,
      type: "token_usage",
      key: "input",
      value: inputTokens,
    });

    const outputId = crypto.randomUUID();
    tables.metrics.add({
      id: outputId,
      type: "token_usage",
      key: "output",
      value: outputTokens,
    });

    // Track by model
    const modelId = crypto.randomUUID();
    tables.metrics.add({
      id: modelId,
      type: "token_usage",
      key: model,
      value: totalTokens,
    });

    // Track by provider
    const providerId = crypto.randomUUID();
    tables.metrics.add({
      id: providerId,
      type: "token_usage",
      key: provider,
      value: totalTokens,
    });
  } catch {
    // Silent fail
  }
}

/**
 * Track API call metrics
 */
export function trackApiCall(
  endpoint: string,
  method: string,
  status: number,
  durationMs: number
): void {
  try {
    const id = crypto.randomUUID();
    const success = status >= 200 && status < 400;

    tables.metrics.add({
      id,
      type: "api_call",
      key: success ? "success" : "error",
      value: 1,
    });

    // Track by endpoint
    const endpointId = crypto.randomUUID();
    tables.metrics.add({
      id: endpointId,
      type: "api_endpoint",
      key: `${method} ${endpoint}`,
      value: durationMs,
    });
  } catch {
    // Silent fail
  }
}

/**
 * Track file operations
 */
export function trackFileOperation(
  operation: "read" | "write" | "edit" | "search",
  path: string,
  metadata?: Record<string, unknown>
): void {
  trackMetric("file_operation", operation, 1, { path, ...metadata });
  trackMetric(`file_${operation}`, path, 1);
}

// =========================================
// Cybara-compatible session token tracking
// =========================================

/**
 * Track session token usage (for context window monitoring)
 */
export function trackSessionTokens(
  sessionId: string,
  totalTokens: number,
  contextWindow: number,
  model?: string,
  metadata?: { messageCount?: number; wasCompacted?: boolean }
): void {
  try {
    // Track current session tokens
    trackMetric("session_tokens", sessionId, totalTokens, {
      contextWindow,
      model,
      utilization: Math.round((totalTokens / contextWindow) * 100),
      ...metadata,
    });

    // Track utilization percentage
    const utilization = Math.min(100, Math.round((totalTokens / contextWindow) * 100));
    trackMetric("context_utilization", sessionId, utilization, { model });

    // Track if near capacity (>80%)
    if (utilization > 80) {
      trackMetric("context_warning", sessionId, utilization, {
        level: utilization > 95 ? "critical" : "high",
        model,
      });
    }
  } catch {
    // Silent fail
  }
}

/**
 * Track memory flush events
 */
export function trackMemoryFlush(
  sessionId: string,
  success: boolean,
  metadata?: {
    tokensBeforeFlush?: number;
    compactionCount?: number;
    durationMs?: number;
  }
): void {
  try {
    trackMetric("memory_flush", success ? "success" : "failure", 1, {
      sessionId,
      ...metadata,
    });

    if (success) {
      trackMetric("memory_flush_session", sessionId, 1, metadata);
    }
  } catch {
    // Silent fail
  }
}

/**
 * Track context compaction events
 */
export function trackContextCompaction(
  sessionId: string,
  metadata: {
    messagesBefore: number;
    messagesAfter: number;
    tokensBefore: number;
    tokensAfter: number;
    model?: string;
    durationMs?: number;
  }
): void {
  try {
    const reduction = metadata.tokensBefore - metadata.tokensAfter;
    const reductionPercent = Math.round((reduction / metadata.tokensBefore) * 100);

    trackMetric("context_compaction", sessionId, reduction, {
      ...metadata,
      reductionPercent,
    });

    trackMetric("compaction_reduction", "tokens", reduction);
    trackMetric(
      "compaction_reduction",
      "messages",
      metadata.messagesBefore - metadata.messagesAfter
    );
  } catch {
    // Silent fail
  }
}

/**
 * Track session lifecycle events
 */
export function trackSessionEvent(
  sessionId: string,
  event: "created" | "resumed" | "ended" | "compacted" | "memory_flushed",
  metadata?: Record<string, unknown>
): void {
  try {
    trackMetric("session_event", event, 1, { sessionId, ...metadata });
    trackMetric(`session_${event}`, sessionId, 1, metadata);
  } catch {
    // Silent fail
  }
}

/**
 * Track message metrics per session
 */
export function trackSessionMessage(
  sessionId: string,
  role: "user" | "assistant" | "system" | "tool",
  tokens: number,
  metadata?: { hasToolCalls?: boolean; model?: string }
): void {
  try {
    trackMetric("session_message", role, tokens, { sessionId, ...metadata });

    // Track message count by role
    trackMetric("message_count", role, 1, { sessionId });

    // Track tool calls specifically
    if (metadata?.hasToolCalls) {
      trackMetric("assistant_tool_calls", sessionId, 1);
    }
  } catch {
    // Silent fail
  }
}

/**
 * Get aggregated metrics summary
 */
export function getMetricsSummary(): {
  totalTokens: number;
  totalToolCalls: number;
  totalApiCalls: number;
  totalSessions: number;
  memoryFlushes: number;
  compactions: number;
} {
  try {
    // Use existing getTotal method instead of iterating all metrics
    const summary = {
      totalTokens: tables.metrics.getTotal("token_usage", "all"),
      totalToolCalls: tables.metrics.getTotal("tool_call", "all"),
      totalApiCalls:
        tables.metrics.getTotal("api_call", "success") +
        tables.metrics.getTotal("api_call", "error"),
      totalSessions: tables.metrics.getTotal("session_event", "created"),
      memoryFlushes: tables.metrics.getTotal("memory_flush", "success"),
      compactions: tables.metrics.getTotal("context_compaction", "tokens"),
    };

    return summary;
  } catch {
    return {
      totalTokens: 0,
      totalToolCalls: 0,
      totalApiCalls: 0,
      totalSessions: 0,
      memoryFlushes: 0,
      compactions: 0,
    };
  }
}
