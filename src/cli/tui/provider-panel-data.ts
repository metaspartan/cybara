import type { ProviderAccountPoolInfo, ProviderInfo } from "../commands/provider-commands";
import { formatCliApiError, requestCliAPI } from "../client";

export interface TUIProviderPlanWindow {
  id: string;
  kind: string;
  title: string;
  usedPercent?: number;
  usageKnown?: boolean;
  unlimited?: boolean;
  resetsAt?: string;
}

export interface TUIProviderPlanSnapshot {
  providerId: string;
  configuredProviderId?: string;
  providerType: string;
  providerName: string;
  managedAutomatically?: boolean;
  status: string;
  sourceLabel?: string;
  windows?: TUIProviderPlanWindow[];
}

export interface TUIProviderPlanStatus {
  providers: TUIProviderPlanSnapshot[];
}

export interface TUIProviderPanelData {
  providers: ProviderInfo[];
  pools: ProviderAccountPoolInfo[];
  plans: TUIProviderPlanStatus | null;
  warnings: string[];
}

export interface TUIProviderRequest {
  <T>(endpoint: string): Promise<T>;
}

export async function loadTUIProviderPanel(
  request: TUIProviderRequest = requestCliAPI
): Promise<TUIProviderPanelData> {
  const [providersResult, plansResult, poolsResult] = await Promise.allSettled([
    request<ProviderInfo[]>("/api/providers"),
    request<TUIProviderPlanStatus>("/api/provider-plans/status"),
    request<ProviderAccountPoolInfo[]>("/api/provider-account-pools"),
  ]);
  if (providersResult.status === "rejected") throw providersResult.reason;
  if (!Array.isArray(providersResult.value)) {
    throw new Error("/api/providers returned an invalid response");
  }
  const warnings: string[] = [];
  if (plansResult.status === "rejected") {
    warnings.push(`Usage unavailable: ${formatCliApiError(plansResult.reason)}`);
  }
  if (poolsResult.status === "rejected") {
    warnings.push(`Pools unavailable: ${formatCliApiError(poolsResult.reason)}`);
  }
  return {
    providers: providersResult.value,
    plans: plansResult.status === "fulfilled" ? plansResult.value : null,
    pools:
      poolsResult.status === "fulfilled" && Array.isArray(poolsResult.value)
        ? poolsResult.value
        : [],
    warnings,
  };
}
