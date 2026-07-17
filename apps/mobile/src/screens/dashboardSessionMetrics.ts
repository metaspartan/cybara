import type {
  AgentSummary,
  ProviderPlanStatusResponse,
  SessionContextUsage,
  SessionDetailSummary,
  SessionSummary,
  SessionTokenUsage,
} from "../lib/api";

export function compactWorkspace(value?: string | null): string {
  if (!value) return "No workspace";
  const parts = value.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return value;
  return `.../${parts.slice(-2).join("/")}`;
}

export function mobileFormatTokenCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.max(0, Math.round(value)));
}

export function mobileContextUsageDetail(usage?: SessionContextUsage): string {
  if (!usage) return "Context usage is available after the session loads from the gateway.";
  const details = [
    `Active context: ${mobileFormatTokenCount(usage.usedTokens)} of ${mobileFormatTokenCount(
      usage.limitTokens
    )} tokens used (${usage.usedPercent}%). ${mobileFormatTokenCount(
      usage.remainingTokens
    )} tokens remaining.`,
  ];
  if (usage.compacted && (usage.compactionCount || 0) > 0) {
    details.push(
      `Compacted ${usage.compactionCount} time${usage.compactionCount === 1 ? "" : "s"}.`
    );
  }
  if ((usage.metadataTokens || 0) > 0) {
    details.push(
      `${mobileFormatTokenCount(usage.metadataTokens || 0)} tool timeline tokens are not replayed.`
    );
  }
  return details.join(" ");
}

export function mobileSessionTokenUsageDetail(usage?: SessionTokenUsage): string | null {
  if (!usage || usage.totalTokens <= 0) return null;
  const speed =
    usage.tokensPerSecond !== null && Number.isFinite(usage.tokensPerSecond)
      ? ` · ${usage.tokensPerSecond} tok/s`
      : "";
  const firstToken =
    usage.firstTokenMs !== null && Number.isFinite(usage.firstTokenMs)
      ? ` · first token ${usage.firstTokenMs < 1000 ? `${Math.round(usage.firstTokenMs)}ms` : `${(usage.firstTokenMs / 1000).toFixed(1)}s`}`
      : "";
  const cache =
    usage.cachedInputTokens > 0 || usage.cacheWriteTokens > 0
      ? ` · cache ${mobileFormatTokenCount(usage.cachedInputTokens)} read / ${mobileFormatTokenCount(usage.cacheWriteTokens)} write`
      : "";
  return `Tokens: ${mobileFormatTokenCount(usage.inputTokens)} input / ${mobileFormatTokenCount(
    usage.outputTokens
  )} output · ${usage.callCount} calls${speed}${firstToken}${cache}`;
}

export function mobileProviderPlanFor(
  status: ProviderPlanStatusResponse | null | undefined,
  source: {
    agent?: AgentSummary | null;
    detail?: SessionDetailSummary | null;
    sessionSummary?: SessionSummary | null;
  }
): ProviderPlanStatusResponse["providers"][number] | null {
  if (!status) return null;
  const keys = new Set(
    [
      source.agent?.provider_id,
      source.agent?.provider,
      source.detail?.providerId,
      source.detail?.provider,
      source.sessionSummary?.provider_id,
      source.sessionSummary?.provider,
    ].filter((value): value is string => typeof value === "string" && value.length > 0)
  );
  if (keys.size === 0) return null;
  return (
    status.providers.find((plan) =>
      [plan.configuredProviderId, plan.providerId, plan.providerType].some(
        (key) => typeof key === "string" && keys.has(key)
      )
    ) ?? null
  );
}
