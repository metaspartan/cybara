import { createLogger } from "./logger";

const log = createLogger("ProviderUsage");

export interface LiveUsageWindow {
  usedPercent: number;
  resetsAt?: string;
  windowSeconds?: number;
}

export interface LiveProviderUsage {
  planLabel?: string;
  fiveHour?: LiveUsageWindow;
  weekly?: LiveUsageWindow;
  source: "oauth_api";
  fetchedAt: number;
}

export interface LiveUsageProviderInput {
  id: string;
  providerType: string;
  accessToken?: string;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: LiveProviderUsage | null; at: number }>();

function toNumber(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function epochToIso(value: unknown): string | undefined {
  const seconds = toNumber(value);
  if (seconds === undefined || seconds <= 0) return undefined;
  const ms = seconds > 1e12 ? seconds : seconds * 1000;
  return new Date(ms).toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function clampPercent(value: unknown): number | undefined {
  const parsed = toNumber(value);
  if (parsed === undefined) return undefined;
  return Math.max(0, Math.min(100, parsed));
}

function resetToIso(...values: unknown[]): string | undefined {
  for (const value of values) {
    const epoch = epochToIso(value);
    if (epoch) return epoch;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function parseCodexWindow(raw: unknown): LiveUsageWindow | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;
  const usedPercent = clampPercent(record.used_percent);
  if (usedPercent === undefined) return undefined;
  return {
    usedPercent,
    resetsAt: resetToIso(record.reset_at),
    windowSeconds: toNumber(record.limit_window_seconds),
  };
}

export function parseCodexUsageResponse(body: unknown, now: number): LiveProviderUsage | null {
  const json = asRecord(body);
  const rateLimit = asRecord(json?.rate_limit);
  if (!rateLimit) return null;
  const planType = typeof json?.plan_type === "string" ? json.plan_type : undefined;
  const planLabel = planType
    ? `Codex ${planType.charAt(0).toUpperCase()}${planType.slice(1)}`
    : undefined;
  return {
    planLabel,
    fiveHour: parseCodexWindow(rateLimit.primary_window),
    weekly: parseCodexWindow(rateLimit.secondary_window),
    source: "oauth_api",
    fetchedAt: now,
  };
}

async function fetchCodexUsage(token: string): Promise<LiveProviderUsage | null> {
  const res = await fetch("https://chatgpt.com/backend-api/wham/usage", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "Cybara",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  return parseCodexUsageResponse(await res.json(), Date.now());
}

function parseAnthropicWindow(raw: unknown): LiveUsageWindow | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;
  const usedPercent = clampPercent(record.used_percent ?? record.usedPercent ?? record.utilization);
  if (usedPercent === undefined) return undefined;
  return {
    usedPercent,
    resetsAt: resetToIso(record.resets_at, record.resetsAt, record.reset_at),
  };
}

function parseAnthropicLimitWindow(raw: unknown): LiveUsageWindow | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;
  if (record.is_active === false || record.isActive === false) return undefined;
  const group = String(record.group ?? "").toLowerCase();
  const kind = String(record.kind ?? "").toLowerCase();
  if (!group.includes("week") && !kind.includes("week")) return undefined;
  const usedPercent = clampPercent(record.percent ?? record.used_percent ?? record.utilization);
  if (usedPercent === undefined) return undefined;
  return {
    usedPercent,
    resetsAt: resetToIso(record.resets_at, record.resetsAt, record.reset_at),
  };
}

function firstAnthropicWindow(
  json: Record<string, unknown>,
  keys: string[]
): LiveUsageWindow | undefined {
  for (const key of keys) {
    const window = parseAnthropicWindow(json[key]);
    if (window) return window;
  }
  return undefined;
}

function firstAnthropicLimitWindow(json: Record<string, unknown>): LiveUsageWindow | undefined {
  const limits = Array.isArray(json.limits) ? json.limits : [];
  for (const limit of limits) {
    const window = parseAnthropicLimitWindow(limit);
    if (window) return window;
  }
  return undefined;
}

export function parseAnthropicUsageResponse(body: unknown, now: number): LiveProviderUsage | null {
  const json = asRecord(body);
  if (!json) return null;
  const tier =
    (typeof json.subscriptionType === "string" && json.subscriptionType) ||
    (typeof json.subscription_type === "string" && json.subscription_type) ||
    (typeof json.rate_limit_tier === "string" && json.rate_limit_tier) ||
    undefined;
  const fiveHour = firstAnthropicWindow(json, ["five_hour"]);
  const weekly =
    firstAnthropicWindow(json, [
      "seven_day",
      "seven_day_oauth_apps",
      "seven_day_sonnet",
      "seven_day_opus",
    ]) ?? firstAnthropicLimitWindow(json);
  if (!fiveHour && !weekly) return null;
  return {
    planLabel: tier ? `Claude ${tier}` : undefined,
    fiveHour,
    weekly,
    source: "oauth_api",
    fetchedAt: now,
  };
}

async function fetchAnthropicUsage(token: string): Promise<LiveProviderUsage | null> {
  const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "claude-code/2.1.0",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  return parseAnthropicUsageResponse(await res.json(), Date.now());
}

function looksLikeOAuthToken(token?: string): token is string {
  return typeof token === "string" && token.trim().length >= 40;
}

export async function fetchLiveProviderUsage(
  provider: LiveUsageProviderInput
): Promise<LiveProviderUsage | null> {
  if (!looksLikeOAuthToken(provider.accessToken)) return null;
  const cached = cache.get(provider.id);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  let value: LiveProviderUsage | null = null;
  try {
    if (provider.providerType === "openai-codex") {
      value = await fetchCodexUsage(provider.accessToken);
    } else if (provider.providerType === "anthropic") {
      value = await fetchAnthropicUsage(provider.accessToken);
    }
  } catch (error) {
    log.debug(`live usage fetch failed for ${provider.providerType}: ${error}`);
    value = null;
  }

  cache.set(provider.id, { value, at: Date.now() });
  return value;
}
