import { tables } from "./database";
import { redactSecrets } from "./redaction";
import { recordExternalMetric } from "./external-telemetry";

function serializeMetricMetadata(metadata?: Record<string, unknown>): string | undefined {
  return metadata ? JSON.stringify(redactSecrets(metadata)) : undefined;
}

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
      metadata: serializeMetricMetadata(metadata),
    });
    recordExternalMetric(type, key, value, metadata);
  } catch {
    void 0;
  }
}

function trackAggregateMetric(
  type: string,
  key: string,
  value: number,
  metadata: Record<string, unknown>,
  daily: boolean
): void {
  try {
    tables.metrics.addAggregate({
      type,
      key,
      value,
      metadata: serializeMetricMetadata(metadata),
      date: daily ? new Date().toISOString().slice(0, 10) : undefined,
    });
    recordExternalMetric(type, key, value, metadata);
  } catch {
    void 0;
  }
}

export function trackToolCall(toolName: string, duration: number, success: boolean): void {
  trackMetric("tool_call", toolName, 1, { success });
  trackMetric("tool_call", "all", 1, { tool: toolName, success });
  if (duration > 0) trackMetric("tool_duration", toolName, duration, { success });
  if (!success) trackMetric("tool_error", toolName, 1);
}

export function trackTokenUsage(
  model: string,
  provider: string,
  inputTokens: number,
  outputTokens: number
): void {
  const totalTokens = inputTokens + outputTokens;
  const metadata = { model, provider };
  trackMetric("token_usage", "all", totalTokens, metadata);
  trackMetric("token_usage", "input", inputTokens, metadata);
  trackMetric("token_usage", "output", outputTokens, metadata);
  trackMetric("token_usage", model, totalTokens, { provider });
  trackMetric("token_usage", provider, totalTokens, { model });
}

export function trackApiCall(
  endpoint: string,
  method: string,
  status: number,
  durationMs: number
): void {
  const success = status >= 200 && status < 400;
  const metadata = { endpoint, method, status };
  trackAggregateMetric("api_call", success ? "success" : "error", 1, metadata, true);
  trackAggregateMetric(
    "api_endpoint",
    `${method} ${endpoint}`,
    durationMs,
    { status, success },
    false
  );
}

const GATEWAY_TELEMETRY_COMPACTION_BATCH = 2_000;
const GATEWAY_TELEMETRY_COMPACTION_INTERVAL_MS = 1_000;
let gatewayTelemetryMaintenanceStarted = false;

export function startGatewayTelemetryMaintenance(): void {
  if (gatewayTelemetryMaintenanceStarted || process.env.NODE_ENV === "test") return;
  gatewayTelemetryMaintenanceStarted = true;
  const compact = (): void => {
    const deleted = tables.metrics.compactGatewayTelemetry(GATEWAY_TELEMETRY_COMPACTION_BATCH);
    if (deleted <= 0) return;
    setTimeout(compact, GATEWAY_TELEMETRY_COMPACTION_INTERVAL_MS);
  };
  setTimeout(compact, 5_000);
}

export function trackFileOperation(
  operation: "read" | "write" | "edit" | "search",
  path: string,
  metadata?: Record<string, unknown>
): void {
  trackMetric("file_operation", operation, 1, { path, ...metadata });
  trackMetric(`file_${operation}`, path, 1);
}

export function trackSessionTokens(
  sessionId: string,
  totalTokens: number,
  contextWindow: number,
  model?: string,
  metadata?: { messageCount?: number; wasCompacted?: boolean }
): void {
  try {
    trackMetric("session_tokens", sessionId, totalTokens, {
      contextWindow,
      model,
      utilization: Math.round((totalTokens / contextWindow) * 100),
      ...metadata,
    });

    const utilization = Math.min(100, Math.round((totalTokens / contextWindow) * 100));
    trackMetric("context_utilization", sessionId, utilization, { model });

    if (utilization > 80) {
      trackMetric("context_warning", sessionId, utilization, {
        level: utilization > 95 ? "critical" : "high",
        model,
      });
    }
  } catch {
    void 0;
  }
}

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
    void 0;
  }
}

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

    trackMetric("compaction_reduction", "count", 1);
    trackMetric("compaction_reduction", "tokens", reduction);
    trackMetric(
      "compaction_reduction",
      "messages",
      metadata.messagesBefore - metadata.messagesAfter
    );
  } catch {
    void 0;
  }
}

export function trackSessionEvent(
  sessionId: string,
  event: "created" | "resumed" | "ended" | "compacted" | "memory_flushed",
  metadata?: Record<string, unknown>
): void {
  try {
    trackMetric("session_event", event, 1, { sessionId, ...metadata });
    trackMetric(`session_${event}`, sessionId, 1, metadata);
  } catch {
    void 0;
  }
}

export function trackSessionMessage(
  sessionId: string,
  role: "user" | "assistant" | "system" | "tool",
  tokens: number,
  metadata?: { hasToolCalls?: boolean; model?: string }
): void {
  try {
    trackMetric("session_message", role, tokens, { sessionId, ...metadata });

    trackMetric("message_count", role, 1, { sessionId });

    if (metadata?.hasToolCalls) {
      trackMetric("assistant_tool_calls", sessionId, 1);
    }
  } catch {
    void 0;
  }
}

export function getMetricsSummary(): {
  totalTokens: number;
  totalToolCalls: number;
  totalApiCalls: number;
  totalSessions: number;
  memoryFlushes: number;
  compactions: number;
} {
  try {
    const summary = {
      totalTokens: tables.metrics.getTotal("token_usage", "all"),
      totalToolCalls: tables.metrics.getTotal("tool_call", "all"),
      totalApiCalls:
        tables.metrics.getTotal("api_call", "success") +
        tables.metrics.getTotal("api_call", "error"),
      totalSessions: tables.metrics.getTotal("session_event", "created"),
      memoryFlushes: tables.metrics.getTotal("memory_flush", "success"),
      compactions: tables.metrics.getTotal("compaction_reduction", "count"),
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
