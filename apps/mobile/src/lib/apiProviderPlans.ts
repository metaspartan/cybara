import { asRecord, normalizeArrayResponse, readNumber, readString } from "./apiNormalizeUtils";

export type ProviderPlanStatusState = "ok" | "warning" | "exhausted" | "unconfigured" | "disabled";
export type ProviderPlanSourceMode =
  | "local"
  | "provider_api"
  | "oauth_api"
  | "browser_cookie"
  | "cli"
  | "manual";
export type ProviderPlanPresetConfidence = "exact" | "published" | "dynamic" | "estimated";

export interface ProviderPlanPresetSuggestion {
  id: string;
  label: string;
  planName: string;
  description: string;
  confidence: ProviderPlanPresetConfidence;
  sourceMode: ProviderPlanSourceMode;
  sourceUrl?: string;
  limitDescription: string;
  monthlyTokenLimit?: number;
  monthlySpendLimit?: number;
  weeklyTokenLimit?: number;
  fiveHourTokenLimit?: number;
  routeLimit5h?: number;
  routeLimitWeekly?: number;
  externalSourceEnabled?: boolean;
}

export interface ProviderPlanRouteConstraint {
  monitored: boolean;
  configured: boolean;
  enforced: boolean;
  status: ProviderPlanStatusState;
  reason?: string;
  primaryRemainingPercent?: number;
}

export interface ProviderPlanWindow {
  id: string;
  title: string;
  kind: "rolling_5h" | "rolling_week" | "billing_month";
  usedTokens: number;
  tokenLimit?: number;
  usedSpend: number;
  spendLimit?: number;
  usedPercent?: number;
  remainingPercent?: number;
  resetsAt?: string;
  resetDescription: string;
  usageKnown: boolean;
  unlimited?: boolean;
}

export interface ProviderPlanSnapshot {
  providerId: string;
  configuredProviderId?: string;
  providerType: string;
  providerName: string;
  authType: string;
  monitored: boolean;
  managedAutomatically: boolean;
  manualPlanEditable: boolean;
  automaticTrackingLabel?: string;
  appliedPresetId?: string;
  planName?: string;
  source?: string;
  sourceMode: ProviderPlanSourceMode;
  sourceLabel: string;
  sourceDescription?: string;
  externalSourceAvailable: boolean;
  externalSourceMode?: ProviderPlanSourceMode;
  externalSourceLabel?: string;
  externalSourceHint?: string;
  status: ProviderPlanStatusState;
  reason?: string;
  localTokens30d: number;
  localSpend30d: number;
  windows: ProviderPlanWindow[];
  presetSuggestions: ProviderPlanPresetSuggestion[];
}

export interface ProviderPlanWindowConfig {
  enabled?: boolean;
  tokenLimit?: number;
  spendLimit?: number;
}

export interface ProviderPlanProviderConfig {
  enabled?: boolean;
  presetId?: string;
  planName?: string;
  sourceMode?: ProviderPlanSourceMode;
  externalSourceEnabled?: boolean;
  monthly?: ProviderPlanWindowConfig;
  weekly?: ProviderPlanWindowConfig;
  fiveHour?: ProviderPlanWindowConfig;
}

export interface ProviderPlanMonitoringConfig {
  enabled: boolean;
  routerEnforcement: boolean;
  warningThresholdPct: number;
  staleAfterMinutes: number;
  providers: Record<string, ProviderPlanProviderConfig>;
}

export interface ProviderPlanStatusResponse {
  enabled: boolean;
  routerEnforcement: boolean;
  warningThresholdPct: number;
  providers: ProviderPlanSnapshot[];
  summary: {
    total: number;
    monitored: number;
    configured: number;
    warnings: number;
    exhausted: number;
  };
}

function normalizeProviderPlanStatusState(value: unknown): ProviderPlanStatusState {
  return value === "ok" ||
    value === "warning" ||
    value === "exhausted" ||
    value === "unconfigured" ||
    value === "disabled"
    ? value
    : "unconfigured";
}

function normalizeProviderPlanSourceMode(value: unknown): ProviderPlanSourceMode {
  return value === "local" ||
    value === "provider_api" ||
    value === "oauth_api" ||
    value === "browser_cookie" ||
    value === "cli" ||
    value === "manual"
    ? value
    : "local";
}

function normalizeProviderPlanPresetConfidence(value: unknown): ProviderPlanPresetConfidence {
  return value === "exact" || value === "published" || value === "dynamic" || value === "estimated"
    ? value
    : "estimated";
}

function normalizeProviderPlanPresetSuggestion(
  value: unknown,
  index = 0
): ProviderPlanPresetSuggestion {
  const record = asRecord(value);
  return {
    id: readString(record, ["id"]) || `preset-${index + 1}`,
    label: readString(record, ["label"]) || "Provider plan",
    planName: readString(record, ["planName", "plan_name"]) || "Provider plan",
    description: readString(record, ["description"]) || "",
    confidence: normalizeProviderPlanPresetConfidence(record?.confidence),
    sourceMode: normalizeProviderPlanSourceMode(record?.sourceMode ?? record?.source_mode),
    sourceUrl: readString(record, ["sourceUrl", "source_url"]),
    limitDescription: readString(record, ["limitDescription", "limit_description"]) || "",
    monthlyTokenLimit: readNumber(record, ["monthlyTokenLimit", "monthly_token_limit"]),
    monthlySpendLimit: readNumber(record, ["monthlySpendLimit", "monthly_spend_limit"]),
    weeklyTokenLimit: readNumber(record, ["weeklyTokenLimit", "weekly_token_limit"]),
    fiveHourTokenLimit: readNumber(record, ["fiveHourTokenLimit", "five_hour_token_limit"]),
    routeLimit5h: readNumber(record, ["routeLimit5h", "route_limit_5h"]),
    routeLimitWeekly: readNumber(record, ["routeLimitWeekly", "route_limit_weekly"]),
    externalSourceEnabled:
      record?.externalSourceEnabled === true || record?.external_source_enabled === true,
  };
}

export function normalizeProviderPlanRouteConstraint(
  value: unknown
): ProviderPlanRouteConstraint | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return {
    monitored: record.monitored === true,
    configured: record.configured === true,
    enforced: record.enforced === true,
    status: normalizeProviderPlanStatusState(record.status),
    reason: readString(record, ["reason"]),
    primaryRemainingPercent: readNumber(record, [
      "primaryRemainingPercent",
      "primary_remaining_percent",
    ]),
  };
}

function normalizeProviderPlanWindowConfig(value: unknown): ProviderPlanWindowConfig | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return {
    enabled: record.enabled !== false,
    tokenLimit: readNumber(record, ["tokenLimit", "token_limit"]),
    spendLimit: readNumber(record, ["spendLimit", "spend_limit"]),
  };
}

function normalizeProviderPlanProviderConfig(value: unknown): ProviderPlanProviderConfig {
  const record = asRecord(value);
  return {
    enabled: record?.enabled !== false,
    presetId: readString(record, ["presetId", "preset_id"]),
    planName: readString(record, ["planName", "plan_name"]),
    sourceMode: normalizeProviderPlanSourceMode(record?.sourceMode ?? record?.source_mode),
    externalSourceEnabled:
      record?.externalSourceEnabled === true || record?.external_source_enabled === true,
    monthly: normalizeProviderPlanWindowConfig(record?.monthly),
    weekly: normalizeProviderPlanWindowConfig(record?.weekly),
    fiveHour: normalizeProviderPlanWindowConfig(record?.fiveHour ?? record?.five_hour),
  };
}

export function normalizeProviderPlanMonitoringConfig(
  value: unknown
): ProviderPlanMonitoringConfig {
  const record = asRecord(value);
  const providersRecord = asRecord(record?.providers);
  const providerConfigs: Record<string, ProviderPlanProviderConfig> = {};
  if (providersRecord) {
    for (const [key, providerConfig] of Object.entries(providersRecord)) {
      providerConfigs[key] = normalizeProviderPlanProviderConfig(providerConfig);
    }
  }
  return {
    enabled: record?.enabled !== false,
    routerEnforcement: record?.routerEnforcement !== false && record?.router_enforcement !== false,
    warningThresholdPct: readNumber(record, ["warningThresholdPct", "warning_threshold_pct"]) ?? 80,
    staleAfterMinutes: readNumber(record, ["staleAfterMinutes", "stale_after_minutes"]) ?? 120,
    providers: providerConfigs,
  };
}

function normalizeProviderPlanSnapshot(value: unknown, index = 0): ProviderPlanSnapshot {
  const record = asRecord(value);
  const providerId =
    readString(record, ["providerId", "provider_id", "id"]) || `provider-${index + 1}`;
  return {
    providerId,
    configuredProviderId: readString(record, ["configuredProviderId", "configured_provider_id"]),
    providerType: readString(record, ["providerType", "provider_type"]) || providerId,
    providerName: readString(record, ["providerName", "provider_name", "name"]) || providerId,
    authType: readString(record, ["authType", "auth_type"]) || "unknown",
    monitored: record?.monitored === true,
    managedAutomatically:
      record?.managedAutomatically === true || record?.managed_automatically === true,
    manualPlanEditable:
      record?.manualPlanEditable === false || record?.manual_plan_editable === false ? false : true,
    automaticTrackingLabel: readString(record, [
      "automaticTrackingLabel",
      "automatic_tracking_label",
    ]),
    appliedPresetId: readString(record, ["appliedPresetId", "applied_preset_id"]),
    planName: readString(record, ["planName", "plan_name"]),
    source: readString(record, ["source"]),
    sourceMode: normalizeProviderPlanSourceMode(record?.sourceMode ?? record?.source_mode),
    sourceLabel:
      readString(record, ["sourceLabel", "source_label"]) ||
      (readString(record, ["source"]) || "local_metrics").replace(/_/g, " "),
    sourceDescription: readString(record, ["sourceDescription", "source_description"]),
    externalSourceAvailable:
      record?.externalSourceAvailable === true || record?.external_source_available === true,
    externalSourceMode:
      record?.externalSourceMode || record?.external_source_mode
        ? normalizeProviderPlanSourceMode(record.externalSourceMode ?? record.external_source_mode)
        : undefined,
    externalSourceLabel: readString(record, ["externalSourceLabel", "external_source_label"]),
    externalSourceHint: readString(record, ["externalSourceHint", "external_source_hint"]),
    status: normalizeProviderPlanStatusState(record?.status),
    reason: readString(record, ["reason"]),
    localTokens30d: readNumber(record, ["localTokens30d", "local_tokens_30d"]) ?? 0,
    localSpend30d: readNumber(record, ["localSpend30d", "local_spend_30d"]) ?? 0,
    windows: normalizeArrayResponse(record?.windows, ["windows"]).map((window, windowIndex) => {
      const windowRecord = asRecord(window);
      return {
        id: readString(windowRecord, ["id"]) || `window-${windowIndex + 1}`,
        title: readString(windowRecord, ["title"]) || "Plan window",
        kind:
          windowRecord?.kind === "rolling_5h" ||
          windowRecord?.kind === "rolling_week" ||
          windowRecord?.kind === "billing_month"
            ? windowRecord.kind
            : "billing_month",
        usedTokens: readNumber(windowRecord, ["usedTokens", "used_tokens"]) ?? 0,
        tokenLimit: readNumber(windowRecord, ["tokenLimit", "token_limit"]),
        usedSpend: readNumber(windowRecord, ["usedSpend", "used_spend"]) ?? 0,
        spendLimit: readNumber(windowRecord, ["spendLimit", "spend_limit"]),
        usedPercent: readNumber(windowRecord, ["usedPercent", "used_percent"]),
        remainingPercent: readNumber(windowRecord, ["remainingPercent", "remaining_percent"]),
        resetsAt: readString(windowRecord, ["resetsAt", "resets_at"]),
        resetDescription: readString(windowRecord, ["resetDescription", "reset_description"]) || "",
        usageKnown: windowRecord?.usageKnown !== false && windowRecord?.usage_known !== false,
        unlimited: windowRecord?.unlimited === true || windowRecord?.unlimited === 1,
      };
    }),
    presetSuggestions: normalizeArrayResponse(record?.presetSuggestions, [
      "presetSuggestions",
      "preset_suggestions",
      "presets",
    ]).map(normalizeProviderPlanPresetSuggestion),
  };
}

export function normalizeProviderPlanStatus(value: unknown): ProviderPlanStatusResponse {
  const record = asRecord(value);
  const summary = asRecord(record?.summary);
  return {
    enabled: record?.enabled !== false,
    routerEnforcement: record?.routerEnforcement !== false && record?.router_enforcement !== false,
    warningThresholdPct: readNumber(record, ["warningThresholdPct", "warning_threshold_pct"]) ?? 80,
    providers: normalizeArrayResponse(record?.providers, ["providers", "items"]).map(
      normalizeProviderPlanSnapshot
    ),
    summary: {
      total: readNumber(summary, ["total"]) ?? 0,
      monitored: readNumber(summary, ["monitored"]) ?? 0,
      configured: readNumber(summary, ["configured"]) ?? 0,
      warnings: readNumber(summary, ["warnings"]) ?? 0,
      exhausted: readNumber(summary, ["exhausted"]) ?? 0,
    },
  };
}
