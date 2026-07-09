import { config } from "./config";
import { tables, type Provider } from "./database";
import { providerManager, providers, resolveProviderType, type ProviderType } from "./providers";
import { fetchLiveProviderUsage, type LiveProviderUsage } from "./provider-usage-source";

export type ProviderPlanStatus = "ok" | "warning" | "exhausted" | "unconfigured" | "disabled";
export type ProviderPlanConfidence = "exact" | "estimated" | "local";
export type ProviderPlanWindowKind = "rolling_5h" | "rolling_week" | "billing_month";
export type ProviderPlanSourceMode =
  | "local"
  | "provider_api"
  | "oauth_api"
  | "browser_cookie"
  | "cli"
  | "manual";

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

export interface ProviderPlanAvailabilityResponse {
  available: boolean;
  summary: {
    total: number;
    configured: number;
    monitored: number;
    automatic: number;
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
  "anthropic",
  "openai-codex",
  "minimax",
  "github_copilot",
  "google-gemini-cli",
  "antigravity",
  "minimax-portal",
  "qwen-portal",
  "copilot-proxy",
  "z.ai-coding",
  "alibaba-coding-plan",
  "kimi-code",
  "opencode_zen",
  "opencode-go",
  "kilocode",
  "xai",
  "xai-oauth",
]);

const AUTOMATIC_PLAN_PROVIDER_TYPES = new Set<string>([
  "anthropic",
  "openai-codex",
  "antigravity",
  "google-gemini-cli",
  "minimax",
  "minimax-portal",
  "z.ai",
  "z.ai-coding",
  "kimi-code",
  "xai-oauth",
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

interface MetricIndexRow {
  createdAtMs: number;
  value: number;
  keys: Set<string>;
}

interface ProviderPlanMetricIndex {
  byType: Map<string, MetricIndexRow[]>;
}

export interface ProviderPlanEvaluationContext {
  cfg: ProviderPlanMonitoringConfig;
  providerById: Map<string, Provider>;
  firstProviderByType: Map<string, Provider>;
  metricIndex: ProviderPlanMetricIndex;
  now: Date;
  nowMs: number;
  fiveHourStart: number;
  weeklyStart: number;
  thirtyDayStart: number;
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
    mode: "oauth_api",
    label: "Google coding quota",
    hint: "Shows Google coding-plan usage from OAuth quota endpoints when the provider is connected.",
  },
  antigravity: {
    mode: "oauth_api",
    label: "Antigravity quota",
    hint: "Shows Antigravity five-hour and weekly model quota from Google OAuth quota endpoints.",
  },
  "minimax-portal": {
    mode: "provider_api",
    label: "MiniMax token-plan quota",
    hint: "Uses the MiniMax token-plan quota endpoint when credentials are configured; otherwise Cybara falls back to local token and spend telemetry.",
  },
  minimax: {
    mode: "provider_api",
    label: "MiniMax token-plan quota",
    hint: "Uses the MiniMax token-plan quota endpoint when credentials are configured; otherwise Cybara falls back to local token and spend telemetry.",
  },
  "z.ai": {
    mode: "provider_api",
    label: "Z.ai quota monitor",
    hint: "Uses Z.ai's quota monitor endpoint when credentials are configured; otherwise Cybara falls back to local token and spend telemetry.",
  },
  "z.ai-coding": {
    mode: "provider_api",
    label: "Z.ai quota monitor",
    hint: "Uses Z.ai's quota monitor endpoint when credentials are configured; otherwise Cybara falls back to local token and spend telemetry.",
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
    mode: "browser_cookie",
    label: "OpenCode plan source",
    hint: "OpenCode Zen is metered; plan usage requires an explicitly connected OpenCode account session.",
  },
  "opencode-go": {
    mode: "browser_cookie",
    label: "OpenCode Go plan source",
    hint: "OpenCode Go subscription usage requires an explicitly connected OpenCode account session.",
  },
  xai: {
    mode: "cli",
    label: "Grok Build usage",
    hint: "xAI API-key usage is metered separately; Grok Build plan usage comes from the shared weekly SuperGrok/X plan pool when available.",
  },
  "xai-oauth": {
    mode: "oauth_api",
    label: "Grok Build usage",
    hint: "Uses the connected xAI OAuth account for shared weekly Grok Build usage, with local Grok CLI billing as a fallback.",
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
    providerTypes: ["google-gemini-cli", "antigravity"],
    label: "Gemini Code Assist Standard",
    planName: "Gemini Code Assist Standard",
    description: "Standard business Gemini CLI and agent-mode quota.",
    confidence: "exact",
    sourceMode: "oauth_api",
    sourceUrl: "https://developers.google.com/gemini-code-assist/resources/quotas",
    limitDescription:
      "1,500 model requests per user per day; Cybara applies a 10,500/week request guardrail.",
    routeLimitWeekly: 10_500,
    externalSourceEnabled: true,
  },
  {
    id: "gemini-code-assist-enterprise",
    providerTypes: ["google-gemini-cli", "antigravity"],
    label: "Gemini Code Assist Enterprise",
    planName: "Gemini Code Assist Enterprise",
    description: "Enterprise business Gemini CLI and agent-mode quota.",
    confidence: "exact",
    sourceMode: "oauth_api",
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
    id: "grok-build",
    providerTypes: ["xai", "xai-oauth"],
    label: "Grok Build",
    planName: "Grok Build",
    description: "Grok coding-plan access through xAI OAuth, with API-key metering kept separate.",
    confidence: "dynamic",
    sourceMode: "oauth_api",
    sourceUrl: "https://docs.x.ai/build/overview",
    limitDescription:
      "SuperGrok and X paid plans use a shared weekly usage pool; no separate five-hour Grok Build cap is published.",
    externalSourceEnabled: true,
  },
  {
    id: "claude-code-pro",
    providerTypes: ["anthropic"],
    label: "Claude Pro",
    planName: "Claude Code Pro",
    description: "Claude Code access with Pro subscription limits.",
    confidence: "dynamic",
    sourceMode: "oauth_api",
    sourceUrl: "https://www.anthropic.com/news/higher-limits-spacex",
    limitDescription:
      "Claude Code uses rolling five-hour limits; Anthropic doubled Pro, Max, Team, and Enterprise limits in May 2026.",
    externalSourceEnabled: true,
  },
  {
    id: "claude-code-max-5x",
    providerTypes: ["anthropic"],
    label: "Claude Max 5x",
    planName: "Claude Code Max 5x",
    description: "Claude Max tier with 5x Pro usage capacity.",
    confidence: "dynamic",
    sourceMode: "oauth_api",
    sourceUrl: "https://support.claude.com/en/articles/11049741-what-is-the-max-plan",
    limitDescription:
      "$100/month Max tier with 5x Pro usage capacity; exact task count is dynamic.",
    externalSourceEnabled: true,
  },
  {
    id: "claude-code-max-20x",
    providerTypes: ["anthropic"],
    label: "Claude Max 20x",
    planName: "Claude Code Max 20x",
    description: "Claude Max tier with 20x Pro usage capacity.",
    confidence: "dynamic",
    sourceMode: "oauth_api",
    sourceUrl: "https://support.claude.com/en/articles/11049741-what-is-the-max-plan",
    limitDescription:
      "$200/month Max tier with 20x Pro usage capacity; exact task count is dynamic.",
    externalSourceEnabled: true,
  },
  {
    id: "minimax-token-plan",
    providerTypes: ["minimax", "minimax-portal"],
    label: "MiniMax Token Plan",
    planName: "MiniMax Token Plan",
    description: "Provider-managed MiniMax quota from the token-plan quota endpoint.",
    confidence: "dynamic",
    sourceMode: "provider_api",
    sourceUrl: "https://platform.minimax.io/docs/token-plan/intro",
    limitDescription:
      "Cybara reads MiniMax rolling and weekly quota usage from the provider; no manual plan caps are needed.",
    externalSourceEnabled: true,
  },
  {
    id: "zai-coding-plan",
    providerTypes: ["z.ai", "z.ai-coding"],
    label: "GLM Coding Plan",
    planName: "GLM Coding Plan",
    description: "Provider-managed GLM Coding Plan quota from Z.ai monitor usage.",
    confidence: "dynamic",
    sourceMode: "provider_api",
    sourceUrl: "https://github.com/zai-org/zai-coding-plugins",
    limitDescription:
      "Cybara reads Z.ai quota monitor usage when credentials are available; no manual plan caps are needed.",
    externalSourceEnabled: true,
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

function automaticTrackingLabel(
  providerType: string,
  externalSource?: ExternalPlanSourceInfo
): string | undefined {
  if (!AUTOMATIC_PLAN_PROVIDER_TYPES.has(providerType)) return undefined;
  return externalSource?.label ?? "Automatic Cybara usage tracking";
}

function configuredProviderForRoute(
  routeKey: string,
  context?: ProviderPlanEvaluationContext
): Provider | undefined {
  const direct =
    context?.providerById.get(routeKey) ??
    (!context ? (tables.providers.get(routeKey) as Provider | undefined) : undefined);
  if (direct) return direct;
  const resolvedType = resolveProviderType(routeKey) ?? routeKey;
  if (context) return context.firstProviderByType.get(resolvedType);
  return (tables.providers.all() as Provider[]).find(
    (provider) => provider.provider === resolvedType || providerTypeOf(provider) === resolvedType
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

function hasWindowLimit(windowConfig?: ProviderPlanWindowConfig): boolean {
  return Boolean(
    windowConfig &&
      windowConfig.enabled !== false &&
      (windowConfig.tokenLimit !== undefined || windowConfig.spendLimit !== undefined)
  );
}

function hasProviderPlanLimits(providerConfig?: ProviderPlanProviderConfig): boolean {
  return Boolean(
    providerConfig &&
      providerConfig.enabled !== false &&
      (hasWindowLimit(providerConfig.fiveHour) ||
        hasWindowLimit(providerConfig.weekly) ||
        hasWindowLimit(providerConfig.monthly))
  );
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

function metricKeysForRow(row: Record<string, unknown>): Set<string> {
  const keys = new Set<string>();
  const key = typeof row.key === "string" ? row.key : "";
  if (key) keys.add(key);
  if (typeof row.metadata !== "string") return keys;
  try {
    const metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    const provider = typeof metadata.provider === "string" ? metadata.provider : "";
    const providerId = typeof metadata.providerId === "string" ? metadata.providerId : "";
    if (provider) keys.add(provider);
    if (providerId) keys.add(providerId);
  } catch {
    void 0;
  }
  return keys;
}

function matchesProviderMetric(row: Record<string, unknown>, keys: Set<string>): boolean {
  for (const key of metricKeysForRow(row)) {
    if (keys.has(key)) return true;
  }
  return false;
}

function buildMetricIndex(types: string[], startMs: number): ProviderPlanMetricIndex {
  const byType = new Map<string, MetricIndexRow[]>();
  const sinceSql = sqlTimestamp(new Date(startMs));
  for (const type of types) {
    const rows = tables.metrics.getByTypeSince(type, sinceSql) as Array<Record<string, unknown>>;
    byType.set(
      type,
      rows
        .map((row) => ({
          createdAtMs: createdAtMs(row.created_at),
          value: metricValue(row.value),
          keys: metricKeysForRow(row),
        }))
        .filter((row) => row.createdAtMs >= startMs && row.keys.size > 0)
    );
  }
  return { byType };
}

function sumMetricWindow(
  type: string,
  keys: Set<string>,
  startMs: number,
  metricIndex?: ProviderPlanMetricIndex
): number {
  const indexed = metricIndex?.byType.get(type);
  if (indexed) {
    let sum = 0;
    for (const row of indexed) {
      if (row.createdAtMs < startMs) continue;
      for (const key of keys) {
        if (row.keys.has(key)) {
          sum += row.value;
          break;
        }
      }
    }
    return sum;
  }
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

function buildMeasuredWindow(params: {
  id: string;
  title: string;
  kind: ProviderPlanWindowKind;
  windowConfig?: ProviderPlanWindowConfig;
  keys: Set<string>;
  startMs: number;
  metricIndex?: ProviderPlanMetricIndex;
  resetsAt?: string;
  resetDescription: string;
}): ProviderPlanUsageWindow | null {
  if (!params.windowConfig || params.windowConfig.enabled === false) return null;
  return buildWindow({
    id: params.id,
    title: params.title,
    kind: params.kind,
    windowConfig: params.windowConfig,
    usedTokens: sumMetricWindow(
      "token_usage_by_provider",
      params.keys,
      params.startMs,
      params.metricIndex
    ),
    usedSpend: sumMetricWindow("router_usage", params.keys, params.startMs, params.metricIndex),
    resetsAt: params.resetsAt,
    resetDescription: params.resetDescription,
  });
}

function buildProviderPlanWindows(params: {
  providerConfig?: ProviderPlanProviderConfig;
  keys: Set<string>;
  now: Date;
  fiveHourStart: number;
  weeklyStart: number;
  metricIndex?: ProviderPlanMetricIndex;
}): ProviderPlanUsageWindow[] {
  const month = monthWindow(params.now, params.providerConfig?.billingCycleAnchorDay ?? 1);
  return [
    buildMeasuredWindow({
      id: "5h",
      title: "5h window",
      kind: "rolling_5h",
      windowConfig: params.providerConfig?.fiveHour,
      keys: params.keys,
      startMs: params.fiveHourStart,
      metricIndex: params.metricIndex,
      resetDescription: "Rolling 5h",
    }),
    buildMeasuredWindow({
      id: "weekly",
      title: "Weekly window",
      kind: "rolling_week",
      windowConfig: params.providerConfig?.weekly,
      keys: params.keys,
      startMs: params.weeklyStart,
      metricIndex: params.metricIndex,
      resetDescription: "Rolling 7d",
    }),
    buildMeasuredWindow({
      id: "monthly",
      title: "Billing month",
      kind: "billing_month",
      windowConfig: params.providerConfig?.monthly,
      keys: params.keys,
      startMs: month.startMs,
      metricIndex: params.metricIndex,
      resetsAt: new Date(month.endMs).toISOString(),
      resetDescription: `Resets ${new Date(month.endMs).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })}`,
    }),
  ].filter((window): window is ProviderPlanUsageWindow => Boolean(window));
}

function buildAutomaticUsageWindow(params: {
  usedTokens: number;
  usedSpend: number;
}): ProviderPlanUsageWindow {
  return {
    id: "local_30d",
    title: "Last 30 days",
    kind: "billing_month",
    usedTokens: Math.round(params.usedTokens),
    usedSpend: Number(params.usedSpend.toFixed(4)),
    resetDescription: "Rolling 30d",
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

function buildProviderPlanEvaluationContext(
  cfg: ProviderPlanMonitoringConfig,
  rows: Provider[],
  now: Date
): ProviderPlanEvaluationContext {
  const providerById = new Map<string, Provider>();
  const firstProviderByType = new Map<string, Provider>();
  for (const provider of rows) {
    providerById.set(provider.id, provider);
    const providerType = providerTypeOf(provider);
    if (!firstProviderByType.has(providerType)) firstProviderByType.set(providerType, provider);
  }
  const nowMs = now.getTime();
  const fiveHourStart = nowMs - 5 * 60 * 60 * 1000;
  const weeklyStart = nowMs - 7 * 24 * 60 * 60 * 1000;
  const thirtyDayStart = nowMs - 30 * 24 * 60 * 60 * 1000;
  let earliestStart = Math.min(fiveHourStart, weeklyStart, thirtyDayStart);
  for (const provider of rows) {
    const providerType = providerTypeOf(provider);
    const providerConfig = planConfigFor(cfg, provider.id, providerType);
    const month = monthWindow(now, providerConfig?.billingCycleAnchorDay ?? 1);
    earliestStart = Math.min(earliestStart, month.startMs);
  }
  return {
    cfg,
    providerById,
    firstProviderByType,
    metricIndex: buildMetricIndex(["token_usage_by_provider", "router_usage"], earliestStart),
    now,
    nowMs,
    fiveHourStart,
    weeklyStart,
    thirtyDayStart,
  };
}

export function createProviderPlanEvaluationContext(): ProviderPlanEvaluationContext {
  const cfg = getProviderPlanMonitoringConfig();
  return buildProviderPlanEvaluationContext(cfg, tables.providers.all() as Provider[], new Date());
}

function providerMetricKeys(params: {
  cfg: ProviderPlanMonitoringConfig;
  routeKey: string;
  providerId: string;
  providerType: string;
  providerName: string;
  configuredProviderType?: string;
}): Set<string> {
  const explicitProviderIdConfig = Boolean(params.cfg.providers[params.providerId]);
  const explicitProviderTypeConfig = Boolean(params.cfg.providers[params.providerType]);
  const keyCandidates =
    explicitProviderIdConfig && !explicitProviderTypeConfig
      ? [params.routeKey, params.providerId, params.providerName]
      : [
          params.routeKey,
          params.providerId,
          params.providerType,
          params.configuredProviderType,
          params.providerName,
        ];
  return new Set(keyCandidates.filter(Boolean) as string[]);
}

export function hasProviderPlanRouteConstraints(routeKeys: string[]): boolean {
  const cfg = getProviderPlanMonitoringConfig();
  if (!cfg.enabled) return false;
  for (const routeKey of routeKeys) {
    const configured = configuredProviderForRoute(routeKey);
    const providerType = configured
      ? providerTypeOf(configured)
      : (resolveProviderType(routeKey) ?? routeKey);
    const staticInfo = providers[providerType as ProviderType];
    const authType = staticInfo?.authType ?? "unknown";
    if (!isPlanCapableProvider(providerType, authType)) continue;
    const providerId = configured?.id ?? routeKey;
    if (hasProviderPlanLimits(planConfigFor(cfg, providerId, providerType))) return true;
  }
  return false;
}

export function getProviderPlanAvailability(): ProviderPlanAvailabilityResponse {
  const cfg = getProviderPlanMonitoringConfig();
  const rows = tables.providers.all() as Provider[];
  let configured = 0;
  let monitored = 0;
  let automatic = 0;

  for (const provider of rows) {
    const providerType = providerTypeOf(provider);
    const staticInfo = providers[providerType as ProviderType];
    const authType = staticInfo?.authType ?? "unknown";
    const isMonitored = cfg.enabled && isPlanCapableProvider(providerType, authType);
    const isAutomatic = AUTOMATIC_PLAN_PROVIDER_TYPES.has(providerType);
    const providerConfig = planConfigFor(cfg, provider.id, providerType);

    if (isMonitored) monitored += 1;
    if (isAutomatic) automatic += 1;
    if (hasProviderPlanLimits(providerConfig) || isAutomatic) configured += 1;
  }

  return {
    available: cfg.enabled && automatic > 0,
    summary: {
      total: rows.length,
      configured,
      monitored,
      automatic,
    },
  };
}

export function getProviderPlanSnapshot(
  routeKey: string,
  context?: ProviderPlanEvaluationContext
): ProviderPlanSnapshot {
  const cfg = context?.cfg ?? getProviderPlanMonitoringConfig();
  const configured = configuredProviderForRoute(routeKey, context);
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
  const managedAutomatically = AUTOMATIC_PLAN_PROVIDER_TYPES.has(providerType);
  const manualPlanEditable = !managedAutomatically;
  const presetSuggestions = getProviderPlanPresetSuggestions(providerType);
  const activeSourceMode: ProviderPlanSourceMode = "local";
  const keys = providerMetricKeys({
    cfg,
    routeKey,
    providerId,
    providerType,
    providerName,
    configuredProviderType: configured?.provider,
  });
  const now = context?.now ?? new Date();
  const nowMs = context?.nowMs ?? now.getTime();
  const fiveHourStart = context?.fiveHourStart ?? nowMs - 5 * 60 * 60 * 1000;
  const weeklyStart = context?.weeklyStart ?? nowMs - 7 * 24 * 60 * 60 * 1000;
  const thirtyDayStart = context?.thirtyDayStart ?? nowMs - 30 * 24 * 60 * 60 * 1000;
  const localTokens30d = sumMetricWindow(
    "token_usage_by_provider",
    keys,
    thirtyDayStart,
    context?.metricIndex
  );
  const localSpend30d = sumMetricWindow("router_usage", keys, thirtyDayStart, context?.metricIndex);
  const configuredWindows = buildProviderPlanWindows({
    providerConfig,
    keys,
    now,
    fiveHourStart,
    weeklyStart,
    metricIndex: context?.metricIndex,
  });
  const windows =
    configuredWindows.length > 0 || !managedAutomatically
      ? configuredWindows
      : [buildAutomaticUsageWindow({ usedTokens: localTokens30d, usedSpend: localSpend30d })];

  const resolved = !monitored
    ? { status: "disabled" as const, reason: "Provider is not monitored" }
    : managedAutomatically && !providerConfig
      ? { status: "ok" as const, reason: "Automatic provider-plan tracking active" }
      : resolveStatus(windows, providerConfig, cfg.warningThresholdPct);

  return {
    providerId: routeKey,
    configuredProviderId: configured?.id,
    providerType,
    providerName,
    authType,
    monitored,
    managedAutomatically,
    manualPlanEditable,
    automaticTrackingLabel: automaticTrackingLabel(providerType, externalSource),
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

export function getProviderPlanRouteConstraint(
  routeKey: string,
  context?: ProviderPlanEvaluationContext
): ProviderPlanRouteConstraint {
  const cfg = context?.cfg ?? getProviderPlanMonitoringConfig();
  const configuredProvider = configuredProviderForRoute(routeKey, context);
  const providerType = configuredProvider
    ? providerTypeOf(configuredProvider)
    : (resolveProviderType(routeKey) ?? routeKey);
  const staticInfo = providers[providerType as ProviderType];
  const authType = staticInfo?.authType ?? "unknown";
  const providerId = configuredProvider?.id ?? routeKey;
  const providerName = configuredProvider?.name || staticInfo?.name || routeKey;
  const providerConfig = planConfigFor(cfg, providerId, providerType);
  const monitored = cfg.enabled && isPlanCapableProvider(providerType, authType);

  if (!monitored) {
    return {
      monitored,
      configured: false,
      enforced: false,
      status: "disabled",
      reason: "Provider is not monitored",
    };
  }

  if (!hasProviderPlanLimits(providerConfig)) {
    return {
      monitored,
      configured: false,
      enforced: false,
      status: "unconfigured",
      reason: "No plan limits configured",
    };
  }

  const now = context?.now ?? new Date();
  const nowMs = context?.nowMs ?? now.getTime();
  const fiveHourStart = context?.fiveHourStart ?? nowMs - 5 * 60 * 60 * 1000;
  const weeklyStart = context?.weeklyStart ?? nowMs - 7 * 24 * 60 * 60 * 1000;
  const windows = buildProviderPlanWindows({
    providerConfig,
    keys: providerMetricKeys({
      cfg,
      routeKey,
      providerId,
      providerType,
      providerName,
      configuredProviderType: configuredProvider?.provider,
    }),
    now,
    fiveHourStart,
    weeklyStart,
    metricIndex: context?.metricIndex,
  });
  const resolved = resolveStatus(windows, providerConfig, cfg.warningThresholdPct);
  const configured = windows.length > 0 && resolved.status !== "unconfigured";
  const enforced =
    cfg.enabled &&
    cfg.routerEnforcement &&
    monitored &&
    configured &&
    resolved.status === "exhausted";
  const primaryRemainingPercent = windows
    .map((window) => window.remainingPercent)
    .filter((value): value is number => typeof value === "number")
    .sort((a, b) => a - b)[0];
  return {
    monitored,
    configured,
    enforced,
    status: resolved.status,
    reason: enforced ? resolved.reason || "Provider plan exhausted" : resolved.reason,
    primaryRemainingPercent,
  };
}

export function getProviderPlanStatus(): ProviderPlanStatusResponse {
  const cfg = getProviderPlanMonitoringConfig();
  const rows = tables.providers.all() as Provider[];
  const context = buildProviderPlanEvaluationContext(cfg, rows, new Date());
  const snapshots = rows.map((provider) => getProviderPlanSnapshot(provider.id, context));
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

function liveUsageWindow(
  base: ProviderPlanUsageWindow | undefined,
  id: string,
  title: string,
  kind: ProviderPlanWindowKind,
  live: { usedPercent: number; resetsAt?: string; unlimited?: boolean } | undefined,
  resetDescription: string
): ProviderPlanUsageWindow | null {
  if (!live) return base ?? null;
  return {
    id,
    title,
    kind,
    usedTokens: base?.usedTokens ?? 0,
    tokenLimit: base?.tokenLimit,
    usedSpend: base?.usedSpend ?? 0,
    spendLimit: base?.spendLimit,
    usedPercent: live.usedPercent,
    remainingPercent: Math.max(0, 100 - live.usedPercent),
    resetsAt: live.resetsAt ?? base?.resetsAt,
    resetDescription: base?.resetDescription ?? resetDescription,
    usageKnown: true,
    unlimited: live.unlimited,
  };
}

function applyLiveUsageToSnapshot(
  snapshot: ProviderPlanSnapshot,
  live: LiveProviderUsage
): ProviderPlanSnapshot {
  const byId = new Map(snapshot.windows.map((window) => [window.id, window]));
  const fiveHour = liveUsageWindow(
    byId.get("5h"),
    "5h",
    "5h window",
    "rolling_5h",
    live.fiveHour,
    "Rolling 5h"
  );
  const weekly = liveUsageWindow(
    byId.get("weekly"),
    "weekly",
    "Weekly window",
    "rolling_week",
    live.weekly,
    "Rolling 7d"
  );
  const monthly = liveUsageWindow(
    byId.get("billing_month"),
    "billing_month",
    "Billing month",
    "billing_month",
    live.monthly,
    "Billing month"
  );
  const others = snapshot.windows.filter(
    (window) => !["5h", "weekly", "billing_month"].includes(window.id)
  );
  const windows = [fiveHour, weekly, monthly, ...others].filter(
    (window): window is ProviderPlanUsageWindow => Boolean(window)
  );
  const worst = windows.reduce((max, window) => Math.max(max, window.usedPercent ?? 0), 0);
  const warning = snapshot.warningThresholdPct;
  const hardStop = snapshot.hardStopPct;
  const status: ProviderPlanStatus =
    worst >= hardStop ? "exhausted" : worst >= warning ? "warning" : "ok";
  return {
    ...snapshot,
    windows,
    planName: snapshot.planName || live.planLabel,
    status,
    reason:
      status === "ok"
        ? `Live usage ${Math.round(worst)}%`
        : `Live usage reached ${Math.round(worst)}%`,
    source: "provider_oauth_api",
    sourceMode: live.source,
    sourceLabel: snapshot.externalSourceLabel ?? "Live provider usage",
    sourceDescription: sourceDescriptionFor(live.source),
    dataConfidence: "exact",
    monitored: true,
    updatedAt: new Date(live.fetchedAt).toISOString(),
  };
}

export async function enrichProviderPlanStatusWithLiveUsage(
  status: ProviderPlanStatusResponse
): Promise<ProviderPlanStatusResponse> {
  const rows = tables.providers.all() as Provider[];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const enriched = await Promise.all(
    status.providers.map(async (snapshot) => {
      const row = byId.get(snapshot.configuredProviderId ?? snapshot.providerId);
      if (!row) return snapshot;
      const withCreds = providerManager.getWithCredentials(row.id);
      const live = await fetchLiveProviderUsage({
        id: row.id,
        providerType: providerTypeOf(row),
        apiKey: withCreds?.api_key,
        accessToken: withCreds?.access_token,
        baseUrl: withCreds?.base_url,
      });
      return live ? applyLiveUsageToSnapshot(snapshot, live) : snapshot;
    })
  );
  return {
    ...status,
    providers: enriched,
    summary: {
      ...status.summary,
      monitored: enriched.filter((snapshot) => snapshot.monitored).length,
      configured: enriched.filter((snapshot) => snapshot.windows.length > 0).length,
      warnings: enriched.filter((snapshot) => snapshot.status === "warning").length,
      exhausted: enriched.filter((snapshot) => snapshot.status === "exhausted").length,
    },
  };
}
