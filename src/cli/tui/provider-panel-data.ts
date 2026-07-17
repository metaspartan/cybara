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

export type TUIProviderPanelDetails = Omit<TUIProviderPanelData, "providers">;

export interface TUIProviderRequest {
  <T>(endpoint: string): Promise<T>;
}

export async function loadTUIProviders(
  request: TUIProviderRequest = requestCliAPI
): Promise<ProviderInfo[]> {
  const providers = await request<ProviderInfo[]>("/api/providers");
  if (!Array.isArray(providers)) {
    throw new Error("/api/providers returned an invalid response");
  }
  return providers;
}

export async function loadTUIProviderPanelDetails(
  request: TUIProviderRequest = requestCliAPI
): Promise<TUIProviderPanelDetails> {
  const [plansResult, poolsResult] = await Promise.allSettled([
    request<TUIProviderPlanStatus>("/api/provider-plans/status"),
    request<ProviderAccountPoolInfo[]>("/api/provider-account-pools"),
  ]);
  const warnings: string[] = [];
  if (plansResult.status === "rejected") {
    warnings.push(`Usage unavailable: ${formatCliApiError(plansResult.reason)}`);
  }
  if (poolsResult.status === "rejected") {
    warnings.push(`Pools unavailable: ${formatCliApiError(poolsResult.reason)}`);
  }
  return {
    plans: plansResult.status === "fulfilled" ? plansResult.value : null,
    pools:
      poolsResult.status === "fulfilled" && Array.isArray(poolsResult.value)
        ? poolsResult.value
        : [],
    warnings,
  };
}

export async function loadTUIProviderPanel(
  request: TUIProviderRequest = requestCliAPI
): Promise<TUIProviderPanelData> {
  const [providers, details] = await Promise.all([
    loadTUIProviders(request),
    loadTUIProviderPanelDetails(request),
  ]);
  return {
    providers,
    ...details,
  };
}
