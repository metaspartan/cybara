import { tables } from "../database";
import { recordUsage } from "../router";
import { broadcastStatus } from "../status";
import { redactSecrets } from "../redaction";

function serializeMetricMetadata(metadata: Record<string, unknown>): string {
  return JSON.stringify(redactSecrets(metadata));
}

function metricCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

export function trackTokenUsage(
  model: string,
  provider: string,
  providerUrl: string,
  inputTokens: number,
  outputTokens: number,
  durationMs?: number,
  options?: {
    sessionId?: string;
    cachedInputTokens?: number;
    cacheWriteTokens?: number;
    estimated?: boolean;
    firstTokenMs?: number;
    routerRouteId?: string;
  }
): void {
  const normalizedInputTokens = metricCount(inputTokens);
  const normalizedOutputTokens = metricCount(outputTokens);
  const normalizedDurationMs =
    typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0
      ? Math.round(durationMs)
      : undefined;
  try {
    recordUsage(
      options?.routerRouteId ?? provider,
      normalizedInputTokens,
      normalizedOutputTokens,
      true,
      model,
      provider,
      {
        readTokens: metricCount(options?.cachedInputTokens),
        writeTokens: metricCount(options?.cacheWriteTokens),
      }
    );
  } catch {}
  try {
    const totalTokens = normalizedInputTokens + normalizedOutputTokens;
    const cachedInputTokens = metricCount(options?.cachedInputTokens);
    const cacheWriteTokens = metricCount(options?.cacheWriteTokens);
    const firstTokenMs =
      typeof options?.firstTokenMs === "number" && Number.isFinite(options.firstTokenMs)
        ? Math.max(0, Math.round(options.firstTokenMs))
        : undefined;
    const generationDurationMs =
      normalizedDurationMs !== undefined &&
      firstTokenMs !== undefined &&
      firstTokenMs <= normalizedDurationMs &&
      normalizedDurationMs - firstTokenMs > 0
        ? normalizedDurationMs - firstTokenMs
        : undefined;
    const callId = crypto.randomUUID();
    const timestamp = Date.now();
    const tokenMetadata = {
      callId,
      model,
      provider,
      providerUrl,
      inputTokens: normalizedInputTokens,
      outputTokens: normalizedOutputTokens,
      totalTokens,
      durationMs: normalizedDurationMs ?? null,
      cachedInputTokens,
      cacheWriteTokens,
      estimated: options?.estimated === true,
      ...(generationDurationMs !== undefined ? { generationDurationMs } : {}),
      ...(firstTokenMs !== undefined ? { firstTokenMs } : {}),
      routerRouteId: options?.routerRouteId,
      sessionId:
        typeof options?.sessionId === "string" && options.sessionId.trim()
          ? options.sessionId.trim()
          : undefined,
      timestamp,
    };

    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "token_usage_by_model",
      key: model,
      value: totalTokens,
      metadata: serializeMetricMetadata(tokenMetadata),
    });

    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "token_usage_by_provider",
      key: provider,
      value: totalTokens,
      metadata: serializeMetricMetadata({ ...tokenMetadata, url: providerUrl }),
    });

    if (options?.routerRouteId && options.routerRouteId !== provider) {
      tables.metrics.add({
        id: crypto.randomUUID(),
        type: "token_usage_by_provider",
        key: options.routerRouteId,
        value: totalTokens,
        metadata: serializeMetricMetadata({ ...tokenMetadata, url: providerUrl }),
      });
    }

    if (typeof tokenMetadata.sessionId === "string") {
      tables.metrics.add({
        id: crypto.randomUUID(),
        type: "token_usage_by_session",
        key: tokenMetadata.sessionId,
        value: totalTokens,
        metadata: serializeMetricMetadata(tokenMetadata),
      });
    }

    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "token_usage",
      key: "input",
      value: normalizedInputTokens,
      metadata: serializeMetricMetadata({ ...tokenMetadata, direction: "input" }),
    });
    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "token_usage",
      key: "output",
      value: normalizedOutputTokens,
      metadata: serializeMetricMetadata({ ...tokenMetadata, direction: "output" }),
    });
    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "token_usage",
      key: "all",
      value: totalTokens,
      metadata: serializeMetricMetadata(tokenMetadata),
    });

    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "api_call",
      key: "all",
      value: 1,
      metadata: serializeMetricMetadata({ url: providerUrl }),
    });
    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "api_call",
      key: "success",
      value: 1,
      metadata: serializeMetricMetadata({ url: providerUrl }),
    });

    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "api_call",
      key: provider,
      value: 1,
      metadata: serializeMetricMetadata({ url: providerUrl }),
    });

    tables.metrics.add({ id: crypto.randomUUID(), type: "agent_execution", key: "all", value: 1 });
    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "agent_execution",
      key: "message",
      value: 1,
      metadata: serializeMetricMetadata({ timestamp }),
    });

    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "system_status",
      key: "last_activity",
      value: timestamp,
    });

    if (generationDurationMs !== undefined) {
      const tps = Number(((normalizedOutputTokens / generationDurationMs) * 1000).toFixed(2));

      tables.metrics.add({
        id: crypto.randomUUID(),
        type: "model_tps",
        key: model,
        value: tps,
        metadata: serializeMetricMetadata(tokenMetadata),
      });

      console.log(
        `[Metrics] TPS: ${tps} tok/s (${normalizedOutputTokens} tokens in ${generationDurationMs}ms) for ${model}`
      );
    }

    if (normalizedDurationMs !== undefined) {
      tables.metrics.add({
        id: crypto.randomUUID(),
        type: "model_latency",
        key: model,
        value: normalizedDurationMs,
        metadata: serializeMetricMetadata({ ...tokenMetadata, provider }),
      });
    }

    broadcastStatus({ status: "thinking", timestamp: Date.now() });

    console.log(
      `[Metrics] Tracked tokens: input=${normalizedInputTokens}, output=${normalizedOutputTokens}, model=${model}, provider=${provider}`
    );
  } catch (e) {
    console.error("[Metrics] Token tracking failed:", e);
  }
}
