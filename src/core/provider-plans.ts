import { config } from "./config";
import { tables, type Provider } from "./database";
import { providers, resolveProviderType, type ProviderType } from "./providers";

export type ProviderPlanStatus = "ok" | "warning" | "exhausted" | "unconfigured" | "disabled";
export type ProviderPlanConfidence = "exact" | "estimated" | "local";
export type ProviderPlanWindowKind = "rolling_5h" | "rolling_week" | "billing_month";
export type ProviderPlanSourceMode =
  "local" | "provider_api" | "oauth_api" | "browser_cookie" | "cli" | "manual";

export interface ProviderPlanWindowConfig {
  enabled?: boolean;
  tokenLimit?: number;
  spendLimit?: number;
}

export type ProviderPlanPresetConfidence = "exact" | "published" | "dynamic" | "estimated";

export interface ProviderPlanPresetSuggestion {
  id: string;
  providerTypes: string[];
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

export interface ProviderPlanProviderConfig {
  enabled?: boolean;
  presetId?: string;
  planName?: string;
  currency?: string;
  sourceMode?: ProviderPlanSourceMode;
  externalSourceEnabled?: boolean;
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
  appliedPresetId?: string;
  planName?: string;
  source: string;
  sourceMode: ProviderPlanSourceMode;
  sourceLabel: string;
  sourceDescription?: string;
  externalSourceAvailable: boolean;
  externalSourceMode?: ProviderPlanSourceMode;
  externalSourceLabel?: string;
  externalSourceHint?: string;
  status: ProviderPlanStatus;
  reason?: string;
  warningThresholdPct: number;
  hardStopPct: number;
  dataConfidence: ProviderPlanConfidence;
  updatedAt: string;
  localTokens30d: number;
  localSpend30d: number;
  windows: ProviderPlanUsageWindow[];
  presetSuggestions: ProviderPlanPresetSuggestion[];
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

interface ExternalPlanSourceInfo {
  mode: ProviderPlanSourceMode;
  label: string;
  hint: string;
}

const EXTERNAL_PLAN_SOURCE_CATALOG: Record<string, ExternalPlanSourceInfo> = {
  "openai-codex": {
    mode: "oauth_api",
    label: "OpenAI OAuth usage",
    hint: "Prefer OpenAI/Codex OAuth or Admin usage APIs. Use ChatGPT dashboard cookies only as an explicit fallback for plan details unavailable through APIs.",
  },
  github_copilot: {
    mode: "oauth_api",
    label: "GitHub Copilot usage API",
    hint: "Use GitHub device-flow credentials and Copilot usage endpoints instead of scraping the browser by default.",
  },
  "google-gemini-cli": {
    mode: "cli",
    label: "Gemini CLI OAuth quota",
    hint: "Reuse Gemini CLI OAuth credentials and quota APIs when available.",
  },
  "minimax-portal": {
    mode: "provider_api",
    label: "MiniMax billing source",
    hint: "Use MiniMax API tokens first; browser cookies should be opt-in for dashboard-only quota details.",
  },
  "qwen-portal": {
    mode: "browser_cookie",
    label: "Qwen portal billing",
    hint: "Qwen plan details may require an explicitly enabled portal session source.",
  },
  "alibaba-coding-plan": {
    mode: "provider_api",
    label: "Alibaba/Qwen plan API",
    hint: "Use authenticated provider APIs before any portal session fallback.",
  },
  "kimi-code": {
    mode: "provider_api",
    label: "Kimi usage source",
    hint: "Use Kimi coding tokens or usage APIs; cookies should remain opt-in.",
  },
  opencode_zen: {
    mode: "provider_api",
    label: "OpenCode plan source",
    hint: "Use OpenCode account APIs or local credentials before browser storage access.",
  },
  "opencode-go": {
    mode: "provider_api",
    label: "OpenCode Go plan source",
    hint: "Use OpenCode account APIs or local credentials before browser storage access.",
  },
  kilocode: {
    mode: "provider_api",
    label: "Kilo Code usage API",
    hint: "Use Kilo account APIs or gateway credentials for plan usage.",
  },
  openrouter: {
    mode: "provider_api",
    label: "OpenRouter credits API",
    hint: "Use the OpenRouter API key for credits and spend rather than scraping account pages.",
  },
  elevenlabs: {
    mode: "provider_api",
    label: "ElevenLabs subscription API",
    hint: "Use the ElevenLabs API key to read character/credit usage.",
  },
  deepgram: {
    mode: "provider_api",
    label: "Deepgram usage API",
    hint: "Use Deepgram API usage endpoints when an account key is configured.",
  },
};

const PROVIDER_PLAN_PRESETS: ProviderPlanPresetSuggestion[] = [
  {
    id: "openai-codex-plus",
    providerTypes: ["openai-codex"],
    label: "ChatGPT Plus",
    planName: "Codex Plus",
    description: "Best for moderate local coding sessions.",
    confidence: "dynamic",
    sourceMode: "oauth_api",
    sourceUrl: "https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan",
    limitDescription:
      "Codex uses your ChatGPT agentic allowance; exact task count varies by task size.",
    externalSourceEnabled: true,
  },
  {
    id: "openai-codex-pro-5x",
    providerTypes: ["openai-codex"],
    label: "ChatGPT Pro 5x",
    planName: "Codex Pro 5x",
    description: "Higher Codex allowance than Plus for longer coding sessions.",
    confidence: "dynamic",
    sourceMode: "oauth_api",
    sourceUrl: "https://developers.openai.com/codex/pricing",
    limitDescription: "Published as 5x Plus usage; exact compute budget is demand-adjusted.",
    externalSourceEnabled: true,
  },
  {
    id: "openai-codex-pro-20x",
    providerTypes: ["openai-codex"],
    label: "ChatGPT Pro 20x",
    planName: "Codex Pro 20x",
    description: "Highest individual Codex usage tier.",
    confidence: "dynamic",
    sourceMode: "oauth_api",
    sourceUrl: "https://chatgpt.com/codex/pricing/",
    limitDescription: "Published as 20x Plus usage; exact compute budget is demand-adjusted.",
    externalSourceEnabled: true,
  },
  {
    id: "github-copilot-pro",
    providerTypes: ["github_copilot", "copilot-proxy"],
    label: "Copilot Pro",
    planName: "Copilot Pro",
    description: "Everyday Copilot plan with included monthly AI credits.",
    confidence: "published",
    sourceMode: "oauth_api",
    sourceUrl: "https://github.com/features/copilot/plans",
    limitDescription:
      "$15 monthly total GitHub AI Credits; premium requests use model multipliers.",
    monthlySpendLimit: 15,
    externalSourceEnabled: true,
  },
  {
    id: "github-copilot-pro-plus",
    providerTypes: ["github_copilot", "copilot-proxy"],
    label: "Copilot Pro+",
    planName: "Copilot Pro+",
    description: "Higher premium-model allowance for complex coding workflows.",
    confidence: "published",
    sourceMode: "oauth_api",
    sourceUrl: "https://github.com/features/copilot/plans",
    limitDescription: "$70 monthly total GitHub AI Credits.",
    monthlySpendLimit: 70,
    externalSourceEnabled: true,
  },
  {
    id: "github-copilot-max",
    providerTypes: ["github_copilot", "copilot-proxy"],
    label: "Copilot Max",
    planName: "Copilot Max",
    description: "Sustained high-volume Copilot agent workflows.",
    confidence: "published",
    sourceMode: "oauth_api",
    sourceUrl: "https://github.com/features/copilot/plans",
    limitDescription: "$200 monthly total GitHub AI Credits.",
    monthlySpendLimit: 200,
    externalSourceEnabled: true,
  },
  {
    id: "gemini-code-assist-standard",
    providerTypes: ["google-gemini-cli"],
    label: "Gemini Code Assist Standard",
    planName: "Gemini Code Assist Standard",
    description: "Standard business Gemini CLI and agent-mode quota.",
    confidence: "exact",
    sourceMode: "cli",
    sourceUrl: "https://developers.google.com/gemini-code-assist/resources/quotas",
    limitDescription:
      "1,500 model requests per user per day; Cybara applies a 10,500/week request guardrail.",
    routeLimitWeekly: 10_500,
    externalSourceEnabled: true,
  },
  {
    id: "gemini-code-assist-enterprise",
    providerTypes: ["google-gemini-cli"],
    label: "Gemini Code Assist Enterprise",
    planName: "Gemini Code Assist Enterprise",
    description: "Enterprise business Gemini CLI and agent-mode quota.",
    confidence: "exact",
    sourceMode: "cli",
    sourceUrl: "https://developers.google.com/gemini-code-assist/resources/quotas",
    limitDescription:
      "2,000 model requests per user per day; Cybara applies a 14,000/week request guardrail.",
    routeLimitWeekly: 14_000,
    externalSourceEnabled: true,
  },
  {
    id: "antigravity-migration",
    providerTypes: ["antigravity"],
    label: "Antigravity",
    planName: "Antigravity",
    description: "Recommended migration path for Gemini consumer coding accounts.",
    confidence: "published",
    sourceMode: "oauth_api",
    sourceUrl:
      "https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals",
    limitDescription:
      "Google deprecated Gemini Code Assist consumer account access for Gemini CLI on June 18, 2026.",
    externalSourceEnabled: true,
  },
  {
    id: "claude-code-pro",
    providerTypes: ["anthropic"],
    label: "Claude Pro",
    planName: "Claude Code Pro",
    description: "Claude Code access with Pro subscription limits.",
    confidence: "dynamic",
    sourceMode: "manual",
    sourceUrl: "https://www.anthropic.com/news/higher-limits-spacex",
    limitDescription:
      "Claude Code uses rolling five-hour limits; Anthropic doubled Pro, Max, Team, and Enterprise limits in May 2026.",
  },
  {
    id: "claude-code-max-5x",
    providerTypes: ["anthropic"],
    label: "Claude Max 5x",
    planName: "Claude Code Max 5x",
    description: "Claude Max tier with 5x Pro usage capacity.",
    confidence: "dynamic",
    sourceMode: "manual",
    sourceUrl: "https://support.claude.com/en/articles/11049741-what-is-the-max-plan",
    limitDescription:
      "$100/month Max tier with 5x Pro usage capacity; exact task count is dynamic.",
  },
  {
    id: "claude-code-max-20x",
    providerTypes: ["anthropic"],
    label: "Claude Max 20x",
    planName: "Claude Code Max 20x",
    description: "Claude Max tier with 20x Pro usage capacity.",
    confidence: "dynamic",
    sourceMode: "manual",
    sourceUrl: "https://support.claude.com/en/articles/11049741-what-is-the-max-plan",
    limitDescription:
      "$200/month Max tier with 20x Pro usage capacity; exact task count is dynamic.",
  },
];

function normalizeSourceMode(value: unknown): ProviderPlanSourceMode | undefined {
  return value === "local" ||
    value === "provider_api" ||
    value === "oauth_api" ||
    value === "browser_cookie" ||
    value === "cli" ||
    value === "manual"
    ? value
    : undefined;
}

function normalizePresetId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().slice(0, 120);
  return PROVIDER_PLAN_PRESETS.some((preset) => preset.id === normalized) ? normalized : undefined;
}

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
    presetId: normalizePresetId(raw.presetId ?? raw.preset_id),
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
    sourceMode: normalizeSourceMode(raw.sourceMode ?? raw.source_mode),
    externalSourceEnabled:
      raw.externalSourceEnabled === true || raw.external_source_enabled === true,
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
  if (!providerConfig.presetId) delete providerConfig.presetId;
  if (!providerConfig.planName) delete providerConfig.planName;
  if (!providerConfig.sourceMode) delete providerConfig.sourceMode;
  if (!providerConfig.externalSourceEnabled) delete providerConfig.externalSourceEnabled;
  return providerConfig;
}

export function getProviderPlanPresetSuggestions(
  providerType: string
): ProviderPlanPresetSuggestion[] {
  return PROVIDER_PLAN_PRESETS.filter((preset) => preset.providerTypes.includes(providerType));
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
  return (
    authType === "oauth" ||
    CODING_PLAN_PROVIDER_TYPES.has(providerType) ||
    Boolean(EXTERNAL_PLAN_SOURCE_CATALOG[providerType])
  );
}

function sourceDescriptionFor(mode: ProviderPlanSourceMode): string {
  switch (mode) {
    case "provider_api":
      return "Official provider billing or credits endpoint.";
    case "oauth_api":
      return "Provider OAuth session or device-flow usage endpoint.";
    case "browser_cookie":
      return "Explicit browser-session fallback for providers without usable billing APIs.";
    case "cli":
      return "Local provider CLI credentials or quota endpoint.";
    case "manual":
      return "Manually entered plan limits with local usage tracking.";
    case "local":
      return "Cybara local token and spend metrics, not the provider billing ledger.";
  }
}

function sourceLabelFor(mode: ProviderPlanSourceMode, configured: boolean): string {
  if (mode === "local") {
    return configured ? "Local usage with configured limits" : "Local Cybara usage";
  }
  if (mode === "provider_api") return "Provider billing API";
  if (mode === "oauth_api") return "OAuth usage API";
  if (mode === "browser_cookie") return "Browser session source";
  if (mode === "cli") return "Local CLI quota source";
  return "Manual plan limits";
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
  const externalSource = EXTERNAL_PLAN_SOURCE_CATALOG[providerType];
  const presetSuggestions = getProviderPlanPresetSuggestions(providerType);
  const activeSourceMode: ProviderPlanSourceMode = "local";
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
    appliedPresetId: providerConfig?.presetId,
    planName: providerConfig?.planName,
    source: providerConfig ? "local_metrics_configured_limits" : "local_metrics",
    sourceMode: activeSourceMode,
    sourceLabel: sourceLabelFor(activeSourceMode, Boolean(providerConfig)),
    sourceDescription: sourceDescriptionFor(activeSourceMode),
    externalSourceAvailable: Boolean(externalSource),
    externalSourceMode: externalSource?.mode,
    externalSourceLabel: externalSource?.label,
    externalSourceHint: externalSource?.hint,
    status: resolved.status,
    reason: resolved.reason,
    warningThresholdPct: providerConfig?.warningThresholdPct ?? cfg.warningThresholdPct,
    hardStopPct: providerConfig?.hardStopPct ?? 100,
    dataConfidence: "local",
    updatedAt: now.toISOString(),
    localTokens30d: Math.round(localTokens30d),
    localSpend30d: Number(localSpend30d.toFixed(4)),
    windows,
    presetSuggestions,
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
