import { config } from "./config";
import { tables, type Provider } from "./database";
import { providers, resolveProviderType, type ProviderType } from "./providers";

export type ProviderPlanStatus = "ok" | "warning" | "exhausted" | "unconfigured" | "disabled";
export type ProviderPlanConfidence = "exact" | "estimated" | "local";
export type ProviderPlanWindowKind = "rolling_5h" | "rolling_week" | "billing_month";

export interface ProviderPlanWindowConfig {
  enabled?: boolean;
  tokenLimit?: number;
  spendLimit?: number;
}

export interface ProviderPlanProviderConfig {
  enabled?: boolean;
  planName?: string;
  currency?: string;
  warningThresholdPct?: number;
  hardStopPct?: number;
  billingCycleAnchorDay?: number;
  fiveHour?: ProviderPlanWindowConfig;
  weekly?: ProviderPlanWindowConfig;
  monthly?: ProviderPlanWindowConfig;
}

export interface ProviderPlanMonitoringConfig {
  enabled: boolean;
  routerEnforcement: boolean;
  warningThresholdPct: number;
  staleAfterMinutes: number;
  providers: Record<string, ProviderPlanProviderConfig>;
}

export interface ProviderPlanUsageWindow {
  id: string;
  title: string;
  kind: ProviderPlanWindowKind;
  usedTokens: number;
  tokenLimit?: number;
  usedSpend: number;
  spendLimit?: number;
  usedPercent?: number;
  remainingPercent?: number;
  resetsAt?: string;
  resetDescription: string;
  usageKnown: boolean;
}

export interface ProviderPlanSnapshot {
  providerId: string;
  configuredProviderId?: string;
  providerType: string;
  providerName: string;
  authType: string;
  monitored: boolean;
  planName?: string;
  source: string;
  status: ProviderPlanStatus;
  reason?: string;
  warningThresholdPct: number;
  hardStopPct: number;
  dataConfidence: ProviderPlanConfidence;
  updatedAt: string;
  localTokens30d: number;
  localSpend30d: number;
  windows: ProviderPlanUsageWindow[];
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

export interface ProviderPlanRouteConstraint {
  monitored: boolean;
  configured: boolean;
  enforced: boolean;
  status: ProviderPlanStatus;
  reason?: string;
  primaryRemainingPercent?: number;
}

const CONFIG_KEY = "provider_plan_monitoring";

const CODING_PLAN_PROVIDER_TYPES = new Set<string>([
  "openai-codex",
  "github_copilot",
  "google-gemini-cli",
  "minimax-portal",
  "qwen-portal",
  "copilot-proxy",
  "z.ai-coding",
  "alibaba-coding-plan",
  "kimi-code",
  "opencode_zen",
  "opencode-go",
  "kilocode",
]);

const DEFAULT_CONFIG: ProviderPlanMonitoringConfig = {
  enabled: true,
  routerEnforcement: true,
  warningThresholdPct: 80,
  staleAfterMinutes: 120,
  providers: {},
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finiteNumber(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = finiteNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function boundedPercent(value: unknown, fallback: number): number {
  const parsed = finiteNumber(value);
  if (parsed === undefined) return fallback;
  return Math.min(100, Math.max(1, parsed));
}

function normalizeWindowConfig(value: unknown): ProviderPlanWindowConfig | undefined {
  const raw = asRecord(value);
  const tokenLimit = positiveNumber(raw.tokenLimit ?? raw.token_limit);
  const spendLimit = positiveNumber(raw.spendLimit ?? raw.spend_limit);
  const enabled = raw.enabled !== false;
  if (!enabled || tokenLimit !== undefined || spendLimit !== undefined) {
    return { enabled, tokenLimit, spendLimit };
  }
  return undefined;
}

export function normalizeProviderPlanProviderConfig(value: unknown): ProviderPlanProviderConfig {
  const raw = asRecord(value);
  const providerConfig: ProviderPlanProviderConfig = {
    enabled: raw.enabled !== false,
    planName:
      typeof raw.planName === "string"
        ? raw.planName.trim().slice(0, 120)
        : typeof raw.plan_name === "string"
          ? raw.plan_name.trim().slice(0, 120)
          : undefined,
    currency:
      typeof raw.currency === "string" && raw.currency.trim()
        ? raw.currency.trim().slice(0, 12).toUpperCase()
        : "USD",
    warningThresholdPct: boundedPercent(raw.warningThresholdPct ?? raw.warning_threshold_pct, 80),
    hardStopPct: boundedPercent(raw.hardStopPct ?? raw.hard_stop_pct, 100),
    billingCycleAnchorDay: Math.min(
      28,
      Math.max(1, Math.floor(positiveNumber(raw.billingCycleAnchorDay) ?? 1))
    ),
    fiveHour: normalizeWindowConfig(raw.fiveHour ?? raw.five_hour),
    weekly: normalizeWindowConfig(raw.weekly),
    monthly: normalizeWindowConfig(raw.monthly),
  };
  if (!providerConfig.planName) delete providerConfig.planName;
  return providerConfig;
}

export function normalizeProviderPlanMonitoringConfig(
  value: unknown
): ProviderPlanMonitoringConfig {
  const raw = asRecord(value);
  const providersRaw = asRecord(raw.providers);
  const providerConfigs: Record<string, ProviderPlanProviderConfig> = {};
  for (const [key, providerValue] of Object.entries(providersRaw)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) continue;
    providerConfigs[normalizedKey] = normalizeProviderPlanProviderConfig(providerValue);
  }
  return {
    enabled: raw.enabled !== false,
    routerEnforcement: raw.routerEnforcement !== false && raw.router_enforcement !== false,
    warningThresholdPct: boundedPercent(
      raw.warningThresholdPct ?? raw.warning_threshold_pct,
      DEFAULT_CONFIG.warningThresholdPct
    ),
    staleAfterMinutes: Math.max(
      5,
      Math.floor(positiveNumber(raw.staleAfterMinutes ?? raw.stale_after_minutes) ?? 120)
    ),
    providers: providerConfigs,
  };
}

export function getProviderPlanMonitoringConfig(): ProviderPlanMonitoringConfig {
  return normalizeProviderPlanMonitoringConfig(config.get<unknown>(CONFIG_KEY) ?? DEFAULT_CONFIG);
}

export function setProviderPlanMonitoringConfig(value: unknown): ProviderPlanMonitoringConfig {
  const normalized = normalizeProviderPlanMonitoringConfig(value);
  config.set(CONFIG_KEY, normalized);
  return normalized;
}

function providerTypeOf(row: Partial<Provider> & { provider?: string; id?: string }): string {
  return resolveProviderType(row.provider) ?? row.provider ?? row.id ?? "unknown";
}

function isPlanCapableProvider(providerType: string, authType?: string): boolean {
  return authType === "oauth" || CODING_PLAN_PROVIDER_TYPES.has(providerType);
}

function configuredProviderForRoute(routeKey: string): Provider | undefined {
  const direct = tables.providers.get(routeKey) as Provider | undefined;
  if (direct) return direct;
  const resolvedType = resolveProviderType(routeKey) ?? routeKey;
  return (tables.providers.all() as Provider[]).find(
    (provider) => provider.provider === resolvedType
  );
}

function planConfigFor(
  cfg: ProviderPlanMonitoringConfig,
  providerId: string,
  providerType: string
): ProviderPlanProviderConfig | undefined {
  const byId = cfg.providers[providerId];
  const byType = cfg.providers[providerType];
  if (byId && byType && byId !== byType) {
    return {
      ...byType,
      ...byId,
      fiveHour: byId.fiveHour ?? byType.fiveHour,
      weekly: byId.weekly ?? byType.weekly,
      monthly: byId.monthly ?? byType.monthly,
    };
  }
  return byId ?? byType;
}

function sqlTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function createdAtMs(value: unknown): number {
  if (typeof value !== "string" || !value.trim()) return 0;
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function metricValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function matchesProviderMetric(row: Record<string, unknown>, keys: Set<string>): boolean {
  const key = typeof row.key === "string" ? row.key : "";
  if (keys.has(key)) return true;
  if (typeof row.metadata !== "string") return false;
  try {
    const metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    const provider = typeof metadata.provider === "string" ? metadata.provider : "";
    const providerId = typeof metadata.providerId === "string" ? metadata.providerId : "";
    return keys.has(provider) || keys.has(providerId);
  } catch {
    return false;
  }
}

function sumMetricWindow(type: string, keys: Set<string>, startMs: number): number {
  const rows = tables.metrics.getByTypeSince(type, sqlTimestamp(new Date(startMs))) as Array<
    Record<string, unknown>
  >;
  let sum = 0;
  for (const row of rows) {
    if (createdAtMs(row.created_at) < startMs) continue;
    if (matchesProviderMetric(row, keys)) sum += metricValue(row.value);
  }
  return sum;
}

function monthWindow(now: Date, anchorDay: number): { startMs: number; endMs: number } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  const startMonth = day >= anchorDay ? month : month - 1;
  const start = new Date(Date.UTC(year, startMonth, anchorDay, 0, 0, 0, 0));
  const end = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, anchorDay, 0, 0, 0, 0)
  );
  return { startMs: start.getTime(), endMs: end.getTime() };
}

function percent(used: number, limit?: number): number | undefined {
  if (!limit || limit <= 0) return undefined;
  return Math.max(0, Math.min(999, Number(((used / limit) * 100).toFixed(2))));
}

function buildWindow(params: {
  id: string;
  title: string;
  kind: ProviderPlanWindowKind;
  windowConfig?: ProviderPlanWindowConfig;
  usedTokens: number;
  usedSpend: number;
  resetsAt?: string;
  resetDescription: string;
}): ProviderPlanUsageWindow | null {
  const windowConfig = params.windowConfig;
  if (!windowConfig || windowConfig.enabled === false) return null;
  const usedPercent =
    percent(params.usedTokens, windowConfig.tokenLimit) ??
    percent(params.usedSpend, windowConfig.spendLimit);
  return {
    id: params.id,
    title: params.title,
    kind: params.kind,
    usedTokens: Math.round(params.usedTokens),
    tokenLimit: windowConfig.tokenLimit,
    usedSpend: Number(params.usedSpend.toFixed(4)),
    spendLimit: windowConfig.spendLimit,
    usedPercent,
    remainingPercent: usedPercent === undefined ? undefined : Math.max(0, 100 - usedPercent),
    resetsAt: params.resetsAt,
    resetDescription: params.resetDescription,
    usageKnown: true,
  };
}

function resolveStatus(
  windows: ProviderPlanUsageWindow[],
  providerConfig: ProviderPlanProviderConfig | undefined,
  globalWarning: number
): { status: ProviderPlanStatus; reason?: string } {
  if (!providerConfig || providerConfig.enabled === false || windows.length === 0) {
    return { status: "unconfigured", reason: "No plan limits configured" };
  }
  const hardStop = providerConfig.hardStopPct ?? 100;
  const warning = providerConfig.warningThresholdPct ?? globalWarning;
  const worst = windows.reduce((max, window) => Math.max(max, window.usedPercent ?? 0), 0);
  if (worst >= hardStop) {
    return { status: "exhausted", reason: `Plan usage reached ${Math.round(worst)}%` };
  }
  if (worst >= warning) {
    return { status: "warning", reason: `Plan usage is ${Math.round(worst)}%` };
  }
  return { status: "ok" };
}

export function getProviderPlanSnapshot(routeKey: string): ProviderPlanSnapshot {
  const cfg = getProviderPlanMonitoringConfig();
  const configured = configuredProviderForRoute(routeKey);
  const providerType = configured
    ? providerTypeOf(configured)
    : (resolveProviderType(routeKey) ?? routeKey);
  const staticInfo = providers[providerType as ProviderType];
  const authType = staticInfo?.authType ?? "unknown";
  const providerId = configured?.id ?? routeKey;
  const providerName = configured?.name || staticInfo?.name || routeKey;
  const providerConfig = planConfigFor(cfg, providerId, providerType);
  const monitored = cfg.enabled && isPlanCapableProvider(providerType, authType);
  const explicitProviderIdConfig = Boolean(cfg.providers[providerId]);
  const explicitProviderTypeConfig = Boolean(cfg.providers[providerType]);
  const keyCandidates =
    explicitProviderIdConfig && !explicitProviderTypeConfig
      ? [routeKey, providerId, providerName]
      : [routeKey, providerId, providerType, configured?.provider, providerName];
  const keys = new Set(keyCandidates.filter(Boolean) as string[]);
  const now = new Date();
  const nowMs = now.getTime();
  const fiveHourStart = nowMs - 5 * 60 * 60 * 1000;
  const weeklyStart = nowMs - 7 * 24 * 60 * 60 * 1000;
  const month = monthWindow(now, providerConfig?.billingCycleAnchorDay ?? 1);
  const localTokens30d = sumMetricWindow(
    "token_usage_by_provider",
    keys,
    nowMs - 30 * 24 * 60 * 60 * 1000
  );
  const localSpend30d = sumMetricWindow("router_usage", keys, nowMs - 30 * 24 * 60 * 60 * 1000);
  const windows = [
    buildWindow({
      id: "5h",
      title: "5h window",
      kind: "rolling_5h",
      windowConfig: providerConfig?.fiveHour,
      usedTokens: sumMetricWindow("token_usage_by_provider", keys, fiveHourStart),
      usedSpend: sumMetricWindow("router_usage", keys, fiveHourStart),
      resetDescription: "Rolling 5h",
    }),
    buildWindow({
      id: "weekly",
      title: "Weekly window",
      kind: "rolling_week",
      windowConfig: providerConfig?.weekly,
      usedTokens: sumMetricWindow("token_usage_by_provider", keys, weeklyStart),
      usedSpend: sumMetricWindow("router_usage", keys, weeklyStart),
      resetDescription: "Rolling 7d",
    }),
    buildWindow({
      id: "monthly",
      title: "Billing month",
      kind: "billing_month",
      windowConfig: providerConfig?.monthly,
      usedTokens: sumMetricWindow("token_usage_by_provider", keys, month.startMs),
      usedSpend: sumMetricWindow("router_usage", keys, month.startMs),
      resetsAt: new Date(month.endMs).toISOString(),
      resetDescription: `Resets ${new Date(month.endMs).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })}`,
    }),
  ].filter((window): window is ProviderPlanUsageWindow => Boolean(window));

  const resolved = monitored
    ? resolveStatus(windows, providerConfig, cfg.warningThresholdPct)
    : { status: "disabled" as const, reason: "Provider is not monitored" };

  return {
    providerId: routeKey,
    configuredProviderId: configured?.id,
    providerType,
    providerName,
    authType,
    monitored,
    planName: providerConfig?.planName,
    source: providerConfig ? "local_metrics_configured_limits" : "local_metrics",
    status: resolved.status,
    reason: resolved.reason,
    warningThresholdPct: providerConfig?.warningThresholdPct ?? cfg.warningThresholdPct,
    hardStopPct: providerConfig?.hardStopPct ?? 100,
    dataConfidence: "local",
    updatedAt: now.toISOString(),
    localTokens30d: Math.round(localTokens30d),
    localSpend30d: Number(localSpend30d.toFixed(4)),
    windows,
  };
}

export function getProviderPlanRouteConstraint(routeKey: string): ProviderPlanRouteConstraint {
  const cfg = getProviderPlanMonitoringConfig();
  const snapshot = getProviderPlanSnapshot(routeKey);
  const configured = snapshot.windows.length > 0 && snapshot.status !== "unconfigured";
  const enforced =
    cfg.enabled &&
    cfg.routerEnforcement &&
    snapshot.monitored &&
    configured &&
    snapshot.status === "exhausted";
  const primaryRemainingPercent = snapshot.windows
    .map((window) => window.remainingPercent)
    .filter((value): value is number => typeof value === "number")
    .sort((a, b) => a - b)[0];
  return {
    monitored: snapshot.monitored,
    configured,
    enforced,
    status: snapshot.status,
    reason: enforced ? snapshot.reason || "Provider plan exhausted" : snapshot.reason,
    primaryRemainingPercent,
  };
}

export function getProviderPlanStatus(): ProviderPlanStatusResponse {
  const cfg = getProviderPlanMonitoringConfig();
  const rows = tables.providers.all() as Provider[];
  const snapshots = rows.map((provider) => getProviderPlanSnapshot(provider.id));
  const configured = snapshots.filter((snapshot) => snapshot.windows.length > 0);
  return {
    enabled: cfg.enabled,
    routerEnforcement: cfg.routerEnforcement,
    warningThresholdPct: cfg.warningThresholdPct,
    providers: snapshots,
    summary: {
      total: snapshots.length,
      monitored: snapshots.filter((snapshot) => snapshot.monitored).length,
      configured: configured.length,
      warnings: snapshots.filter((snapshot) => snapshot.status === "warning").length,
      exhausted: snapshots.filter((snapshot) => snapshot.status === "exhausted").length,
    },
  };
}
