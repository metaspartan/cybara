import type { SystemResourceStatus } from "../core/system-monitor";

export type DatabaseHealthStatus = "healthy" | "unhealthy";
export type GatewayHealthStatus = SystemResourceStatus | "unhealthy";
export type ProviderConfigurationStatus = "empty" | "configured" | "incomplete";

export function resolveGatewayHealthStatus(
  databaseStatus: DatabaseHealthStatus,
  systemStatus: SystemResourceStatus
): GatewayHealthStatus {
  return databaseStatus === "healthy" ? systemStatus : "unhealthy";
}

export function isGatewayReady(databaseStatus: DatabaseHealthStatus): boolean {
  return databaseStatus === "healthy";
}

export function resolveProviderConfigurationStatus(
  total: number,
  configured: number
): ProviderConfigurationStatus {
  if (total <= 0) return "empty";
  return configured >= total ? "configured" : "incomplete";
}
