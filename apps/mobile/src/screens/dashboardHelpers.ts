/** Pure formatting + derivation helpers shared across the dashboard. */
import {
  formatMobileValue,
  isMobileSettingsDetailFieldVisible,
  readMobileAccent,
} from "../lib/dashboard";
import type { AccentKey } from "../theme/liquidGlass";
import type {
  ActivitySummary,
  AgentSummary,
  FeatureEndpointKey,
  FeatureSummary,
  ProviderSummary,
  RemoteItemSummary,
  SessionSummary,
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

export type EndpointState = FeatureSummary["availability"][FeatureEndpointKey] | undefined;

export function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function booleanSetting(record: Record<string, unknown> | null, key: string): boolean {
  return record?.[key] === true;
}

export type MobileSpeechSettings = {
  tts: {
    provider: "auto" | "system" | "elevenlabs" | "openai";
    providerId: string;
    model: string;
    voice: string;
    outputFormat: string;
    speed: number;
    maxTextLength: number;
    fallbackToSystem: boolean;
  };
  stt: {
    provider: "auto" | "openai";
    providerId: string;
    model: string;
    language: string;
  };
};

export function readMobileSpeechSettings(
  configRecord: Record<string, unknown> | null | undefined
): MobileSpeechSettings {
  const speech = objectRecord(configRecord?.speech);
  const tts = objectRecord(speech?.tts);
  const stt = objectRecord(speech?.stt);
  const ttsProvider =
    tts?.provider === "system" || tts?.provider === "elevenlabs" || tts?.provider === "openai"
      ? tts.provider
      : "auto";
  const sttProvider = stt?.provider === "openai" ? "openai" : "auto";
  return {
    tts: {
      provider: ttsProvider,
      providerId: typeof tts?.providerId === "string" ? tts.providerId : "",
      model: typeof tts?.model === "string" ? tts.model : "",
      voice: typeof tts?.voice === "string" ? tts.voice : "",
      outputFormat: typeof tts?.outputFormat === "string" ? tts.outputFormat : "mp3",
      speed: typeof tts?.speed === "number" && Number.isFinite(tts.speed) ? tts.speed : 1,
      maxTextLength:
        typeof tts?.maxTextLength === "number" && Number.isFinite(tts.maxTextLength)
          ? tts.maxTextLength
          : 8000,
      fallbackToSystem: typeof tts?.fallbackToSystem === "boolean" ? tts.fallbackToSystem : true,
    },
    stt: {
      provider: sttProvider,
      providerId: typeof stt?.providerId === "string" ? stt.providerId : "",
      model: typeof stt?.model === "string" ? stt.model : "",
      language: typeof stt?.language === "string" ? stt.language : "",
    },
  };
}

export function mobileSpeechProviderOptions(providers: ProviderSummary[], mode: "tts" | "stt") {
  return [
    { label: "Auto", value: "" },
    ...providers
      .filter((provider) => {
        if (mode === "tts") {
          return (
            provider.provider === "elevenlabs" ||
            provider.provider === "openai" ||
            provider.provider === "openai-codex"
          );
        }
        return provider.provider === "openai" || provider.provider === "openai-codex";
      })
      .map((provider) => ({
        label: provider.name,
        value: provider.id,
      })),
  ];
}

export function arraySettingCount(record: Record<string, unknown> | null, key: string): string {
  const value = record?.[key];
  if (!Array.isArray(value) || value.length === 0) return "None";
  return value.length === 1 ? "1 entry" : `${value.length} entries`;
}

export function endpointErrorDetail(endpoint: EndpointState, fallback: string): string {
  if (!endpoint || endpoint.ok) return fallback;
  if (endpoint.status === 401) {
    return "This mobile pairing is no longer authorized. Disconnect and pair again from the gateway.";
  }
  if (endpoint.status === 403) {
    return "This mobile pairing does not have access to this gateway surface.";
  }
  if (endpoint.status) return `Gateway returned ${endpoint.status}.`;
  return endpoint.error || fallback;
}

export function endpointStatusLabel(endpoint: EndpointState): string {
  if (!endpoint) return "Loading";
  if (endpoint.ok) return "Online";
  return endpoint.status ? `Unavailable (${endpoint.status})` : "Unavailable";
}

export function surfaceCount(
  summary: FeatureSummary | null,
  key: FeatureEndpointKey,
  count: number,
  suffix: string,
  empty: string,
  singularSuffix = suffix
): string {
  if (!summary) return "Loading";
  const endpoint = summary.availability[key];
  if (!endpoint.ok) return endpoint.status ? `Unavailable (${endpoint.status})` : "Unavailable";
  if (count === 0) return empty;
  return `${count} ${count === 1 ? singularSuffix : suffix}`;
}

export function sessionMayBeInProgress(session: SessionSummary): boolean {
  return session.last_message?.role === "user";
}

export function displayFields(
  record: Record<string, unknown>
): Array<{ label: string; value: string }> {
  return Object.entries(record)
    .filter(([key]) => !/secret|token|api[_-]?key|password|credential|mnemonic/i.test(key))
    .map(([label, value]) => ({
      label: label.replace(/_/g, " "),
      value: formatMobileValue(value),
    }));
}

export function displayFieldLabel(label: string): string {
  return label
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function cleanSettingsFields(
  fields: Array<{ label: string; value: string }> = []
): Array<{ label: string; value: string }> {
  return fields
    .filter((field) => isMobileSettingsDetailFieldVisible(field.label))
    .map((field) => ({ ...field, label: displayFieldLabel(field.label) }));
}
