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

export type MobileMemoryBehaviorSettings = {
  backgroundReviewEnabled: boolean;
  backgroundReviewMinIntervalMs: number;
  backgroundReviewTimeoutSeconds: number;
  memoryFlushEnabled: boolean;
  memoryFlushSoftThresholdTokens: number;
};

export type MobileMemoryProviderChoice =
  "local" | "supermemory" | "mem0" | "honcho" | "openviking" | "hindsight";

export const MOBILE_MEMORY_PROVIDER_CHOICES: MobileMemoryProviderChoice[] = [
  "local",
  "supermemory",
  "mem0",
  "honcho",
  "openviking",
  "hindsight",
];

export type MobileMemoryProviderSettings = {
  provider: MobileMemoryProviderChoice;
  autoRecall: boolean;
  autoCapture: boolean;
  supermemory: Record<string, string>;
  mem0: Record<string, string>;
  honcho: Record<string, string>;
  openviking: Record<string, string>;
  hindsight: Record<string, string>;
};

export type MobileIndexingSettings = {
  enabled: boolean;
  semanticEnabled: boolean;
  includeHidden: boolean;
  autoReindexOnWorkspaceSet: boolean;
  embeddingProvider: "auto" | "local" | "transformers_js" | "openai" | "voyage" | "gemini" | "ollama";
  embeddingModel: string;
};

const MOBILE_MEMORY_PROVIDER_FIELD_DEFAULTS: Record<
  Exclude<MobileMemoryProviderChoice, "local">,
  Record<string, string>
> = {
  supermemory: { apiKey: "", baseUrl: "https://api.supermemory.ai", containerTag: "cybara" },
  mem0: { apiKey: "", baseUrl: "https://api.mem0.ai", userId: "cybara-user", agentId: "cybara" },
  honcho: { apiKey: "", baseUrl: "https://api.honcho.dev", workspace: "cybara", peer: "user" },
  openviking: { apiKey: "", baseUrl: "http://127.0.0.1:1933" },
  hindsight: {
    apiKey: "",
    baseUrl: "https://api.hindsight.vectorize.io",
    tenant: "default",
    bankId: "cybara",
  },
};

function stringSetting(record: Record<string, unknown> | null, key: string, fallback: string) {
  const value = record?.[key];
  return typeof value === "string" ? value : fallback;
}

function boolSetting(record: Record<string, unknown> | null, key: string, fallback: boolean) {
  const value = record?.[key];
  return typeof value === "boolean" ? value : fallback;
}

function numberSetting(record: Record<string, unknown> | null, key: string, fallback: number) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function readMobileMemoryBehaviorSettings(
  configRecord: Record<string, unknown> | null | undefined
): MobileMemoryBehaviorSettings {
  const memory = objectRecord(configRecord?.memory);
  return {
    backgroundReviewEnabled: boolSetting(memory, "backgroundReviewEnabled", true),
    backgroundReviewMinIntervalMs: numberSetting(memory, "backgroundReviewMinIntervalMs", 300000),
    backgroundReviewTimeoutSeconds: numberSetting(memory, "backgroundReviewTimeoutSeconds", 90),
    memoryFlushEnabled: boolSetting(memory, "memoryFlushEnabled", true),
    memoryFlushSoftThresholdTokens: numberSetting(memory, "memoryFlushSoftThresholdTokens", 4000),
  };
}

export function readMobileMemoryProviderSettings(
  configRecord: Record<string, unknown> | null | undefined
): MobileMemoryProviderSettings {
  const record = objectRecord(configRecord?.memory_provider);
  const rawProvider = typeof record?.provider === "string" ? record.provider : "local";
  const provider = MOBILE_MEMORY_PROVIDER_CHOICES.includes(
    rawProvider as MobileMemoryProviderChoice
  )
    ? (rawProvider as MobileMemoryProviderChoice)
    : "local";
  const readFields = (key: Exclude<MobileMemoryProviderChoice, "local">) => {
    const fields = objectRecord(record?.[key]);
    const defaults = MOBILE_MEMORY_PROVIDER_FIELD_DEFAULTS[key];
    const out: Record<string, string> = {};
    for (const [fieldKey, fallback] of Object.entries(defaults)) {
      out[fieldKey] = stringSetting(fields, fieldKey, fallback);
    }
    return out;
  };
  return {
    provider,
    autoRecall: boolSetting(record, "autoRecall", true),
    autoCapture: boolSetting(record, "autoCapture", true),
    supermemory: readFields("supermemory"),
    mem0: readFields("mem0"),
    honcho: readFields("honcho"),
    openviking: readFields("openviking"),
    hindsight: readFields("hindsight"),
  };
}

export function readMobileIndexingSettings(
  configRecord: Record<string, unknown> | null | undefined
): MobileIndexingSettings {
  const indexer = objectRecord(configRecord?.workspace_indexer);
  const rawProvider =
    typeof indexer?.embeddingProvider === "string" ? indexer.embeddingProvider : "auto";
  const embeddingProvider = ["auto", "local", "transformers_js", "openai", "voyage", "gemini", "ollama"].includes(
    rawProvider
  )
    ? (rawProvider as MobileIndexingSettings["embeddingProvider"])
    : "auto";
  return {
    enabled: boolSetting(indexer, "enabled", true),
    semanticEnabled: boolSetting(indexer, "semanticEnabled", true),
    includeHidden: boolSetting(indexer, "includeHidden", false),
    autoReindexOnWorkspaceSet: boolSetting(indexer, "autoReindexOnWorkspaceSet", true),
    embeddingProvider,
    embeddingModel: stringSetting(indexer, "embeddingModel", ""),
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
