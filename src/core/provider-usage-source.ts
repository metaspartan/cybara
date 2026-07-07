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

function parseCodexWindow(raw: unknown): LiveUsageWindow | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;
  const usedPercent = toNumber(record.used_percent);
  if (usedPercent === undefined) return undefined;
  return {
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    resetsAt: epochToIso(record.reset_at),
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
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  return parseCodexUsageResponse(await res.json(), Date.now());
}

function parseAnthropicWindow(raw: unknown): LiveUsageWindow | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;
  const usedPercent = toNumber(record.used_percent ?? record.utilization);
  if (usedPercent === undefined) return undefined;
  return {
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    resetsAt:
      epochToIso(record.resets_at ?? record.reset_at) ??
      (typeof record.resets_at === "string" ? record.resets_at : undefined),
  };
}

export function parseAnthropicUsageResponse(body: unknown, now: number): LiveProviderUsage | null {
  const json = asRecord(body);
  if (!json) return null;
  const tier =
    (typeof json.subscriptionType === "string" && json.subscriptionType) ||
    (typeof json.rate_limit_tier === "string" && json.rate_limit_tier) ||
    undefined;
  const fiveHour = parseAnthropicWindow(json.five_hour);
  const weekly = parseAnthropicWindow(json.seven_day);
  if (!fiveHour && !weekly && !tier) return null;
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
