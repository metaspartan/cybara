import { tables } from "../database";
import { recordUsage } from "../router";
import { broadcastStatus } from "../status";

export function trackTokenUsage(
  model: string,
  provider: string,
  providerUrl: string,
  inputTokens: number,
  outputTokens: number,
  durationMs?: number
) {
  try {
    // ── Feed the model router's usage tracking + circuit breaker ──
    recordUsage(provider, inputTokens, outputTokens, true, model);
  } catch {
    /* router tracking is best-effort */
  }
  try {
    const totalTokens = inputTokens + outputTokens;
    const callId = crypto.randomUUID();
    const timestamp = Date.now();
    const tokenMetadata = {
      callId,
      model,
      provider,
      providerUrl,
      inputTokens,
      outputTokens,
      totalTokens,
      durationMs: durationMs ?? null,
      timestamp,
    };

    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "token_usage_by_model",
      key: model,
      value: totalTokens,
      metadata: JSON.stringify(tokenMetadata),
    });

    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "token_usage_by_provider",
      key: provider,
      value: totalTokens,
      metadata: JSON.stringify({ ...tokenMetadata, url: providerUrl }),
    });

    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "token_usage",
      key: "input",
      value: inputTokens,
      metadata: JSON.stringify({ ...tokenMetadata, direction: "input" }),
    });
    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "token_usage",
      key: "output",
      value: outputTokens,
      metadata: JSON.stringify({ ...tokenMetadata, direction: "output" }),
    });
    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "token_usage",
      key: "all",
      value: totalTokens,
      metadata: JSON.stringify(tokenMetadata),
    });

    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "api_call",
      key: "all",
      value: 1,
      metadata: JSON.stringify({ url: providerUrl }),
    });
    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "api_call",
      key: "success",
      value: 1,
      metadata: JSON.stringify({ url: providerUrl }),
    });

    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "api_call",
      key: provider,
      value: 1,
      metadata: JSON.stringify({ url: providerUrl }),
    });

    tables.metrics.add({ id: crypto.randomUUID(), type: "agent_execution", key: "all", value: 1 });
    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "agent_execution",
      key: "message",
      value: 1,
      metadata: JSON.stringify({ timestamp }),
    });

    tables.metrics.add({
      id: crypto.randomUUID(),
      type: "system_status",
      key: "last_activity",
      value: timestamp,
    });

    if (durationMs && durationMs > 0) {
      const tps = Math.round((outputTokens / durationMs) * 1000); // output tokens per second

      tables.metrics.add({
        id: crypto.randomUUID(),
        type: "model_tps",
        key: model,
        value: tps,
        metadata: JSON.stringify(tokenMetadata),
      });

      tables.metrics.add({
        id: crypto.randomUUID(),
        type: "model_latency",
        key: model,
        value: durationMs,
        metadata: JSON.stringify({ ...tokenMetadata, provider }),
      });

      console.log(
        `[Metrics] TPS: ${tps} tok/s (${outputTokens} tokens in ${durationMs}ms) for ${model}`
      );
    }

    broadcastStatus({ status: "thinking", timestamp: Date.now() });

    console.log(
      `[Metrics] Tracked tokens: input=${inputTokens}, output=${outputTokens}, model=${model}, provider=${provider}`
    );
  } catch (e) {
    console.error("[Metrics] Token tracking failed:", e);
  }
}
