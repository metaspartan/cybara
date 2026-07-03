/** Pure formatting + derivation helpers shared across the dashboard. */
import { readMobileAccent } from "../lib/dashboard";
import type { AccentKey } from "../theme/liquidGlass";
import type {
  ActivitySummary,
  AgentSummary,
  FeatureSummary,
  RemoteItemSummary,
  SystemMonitorSnapshot,
} from "../lib/api";

export function relativeTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "recent";
  const minutes = Math.max(0, Math.round((Date.now() - parsed) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function absoluteTimestampLabel(value?: string): string {
  if (!value) return "Unknown";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

export function monitorPercent(value: number | null | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Number(value))) : 0;
}

export function monitorPercentLabel(value: number | null | undefined): string {
  return Number.isFinite(value) ? `${Number(value).toFixed(1)}%` : "n/a";
}

export function monitorOverviewLabel(snapshot: SystemMonitorSnapshot | null | undefined): string {
  if (!snapshot) return "CPU loading - RAM loading - Disk loading";
  const disk = snapshot.disk ? monitorPercentLabel(snapshot.disk.usedPct) : "n/a";
  return `CPU ${monitorPercentLabel(snapshot.cpu.usagePct)} - RAM ${monitorPercentLabel(snapshot.memory.usedPct)} - Disk ${disk}`;
}

export function monitorPlatformLabel(snapshot: SystemMonitorSnapshot | null | undefined): string {
  if (!snapshot) return "Telemetry unavailable";
  return `${snapshot.platform.type} ${snapshot.platform.arch} - ${snapshot.cpu.cores} cores`;
}

export function agentProviderId(agent: AgentSummary | null | undefined): string {
  return agent?.provider_id || agent?.provider || "";
}

export function agentIsRunning(agent: AgentSummary | null | undefined): boolean {
  return agent?.status === "running" || agent?.status === "active";
}

export function remoteItemEnabled(item: RemoteItemSummary | ActivitySummary): boolean {
  if ("enabled" in item && typeof item.enabled === "boolean") return item.enabled;
  if (!("status" in item) || !item.status) return true;
  return !["disabled", "paused", "stopped", "inactive"].includes(item.status.toLowerCase());
}

export function remoteTaskRunning(item: RemoteItemSummary | ActivitySummary): boolean {
  if (!("status" in item) || !item.status) return false;
  return ["running", "pending", "active", "enabled"].includes(item.status.toLowerCase());
}

export function resolveAccentKey(summary: FeatureSummary | null): AccentKey {
  return readMobileAccent(summary?.config) as AccentKey;
}
