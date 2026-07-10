import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { createHash } from "node:crypto";
import { createInterface } from "readline";
import { createLogger } from "./logger";

const log = createLogger("ProviderUsage");

export interface LiveUsageWindow {
  usedPercent: number;
  resetsAt?: string;
  windowSeconds?: number;
  unlimited?: boolean;
}

export interface LiveProviderUsage {
  planLabel?: string;
  fiveHour?: LiveUsageWindow;
  weekly?: LiveUsageWindow;
  monthly?: LiveUsageWindow;
  source: "oauth_api" | "provider_api" | "browser_cookie" | "cli";
  fetchedAt: number;
}

export interface LiveUsageProviderInput {
  id: string;
  providerType: string;
  apiKey?: string;
  accessToken?: string;
  baseUrl?: string;
}

const CACHE_TTL_MS = 60_000;
const NULL_CACHE_TTL_MS = 5_000;
const cache = new Map<string, { value: LiveProviderUsage | null; at: number }>();
const inFlight = new Map<string, Promise<LiveProviderUsage | null>>();

function providerUsageCacheKey(provider: LiveUsageProviderInput, credential: string): string {
  const credentialHash = createHash("sha256").update(credential).digest("hex").slice(0, 16);
  return `${provider.id}:${credentialHash}:${provider.baseUrl ?? ""}`;
}

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

function relativeResetToIso(value: unknown, now: number): string | undefined {
  const seconds = toNumber(value);
  if (seconds === undefined || seconds < 0) return undefined;
  return new Date(now + seconds * 1000).toISOString();
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

function remainingWindow(params: {
  remainingPercent?: unknown;
  remainingCount?: unknown;
  totalCount?: unknown;
  resetsAt?: unknown;
}): LiveUsageWindow | undefined {
  const remainingPercent = clampPercent(params.remainingPercent);
  if (remainingPercent !== undefined) {
    return {
      usedPercent: Math.max(0, 100 - remainingPercent),
      resetsAt: resetToIso(params.resetsAt),
    };
  }
  const total = toNumber(params.totalCount);
  const remaining = toNumber(params.remainingCount);
  if (!total || total <= 0 || remaining === undefined) return undefined;
  return {
    usedPercent: Math.max(0, Math.min(100, ((total - remaining) / total) * 100)),
    resetsAt: resetToIso(params.resetsAt),
  };
}

function remainingFractionWindow(
  remainingFraction: unknown,
  resetsAt?: unknown
): LiveUsageWindow | undefined {
  const fraction = toNumber(remainingFraction);
  if (fraction === undefined) return undefined;
  const remainingPercent = fraction <= 1 ? fraction * 100 : fraction;
  return {
    usedPercent: Math.max(0, Math.min(100, 100 - Math.max(0, Math.min(100, remainingPercent)))),
    resetsAt: resetToIso(resetsAt),
  };
}

function remainingFractionValue(raw: unknown): unknown {
  const record = asRecord(raw);
  if (!record) return undefined;
  const direct = record.remainingFraction ?? record.remaining_fraction;
  if (direct !== undefined) return direct;
  const remaining = asRecord(record.remaining);
  if (!remaining) return undefined;
  if (remaining.remainingFraction !== undefined) return remaining.remainingFraction;
  if (remaining.remaining_fraction !== undefined) return remaining.remaining_fraction;
  if (remaining.case === "remainingFraction" || remaining.oneofCase === "remainingFraction") {
    return remaining.value;
  }
  return undefined;
}

function chooseMoreUsed(
  current: LiveUsageWindow | undefined,
  candidate: LiveUsageWindow | undefined
): LiveUsageWindow | undefined {
  if (!candidate) return current;
  if (!current || candidate.usedPercent > current.usedPercent) return candidate;
  return current;
}

function antigravityBucketKind(raw: Record<string, unknown>): "fiveHour" | "weekly" | undefined {
  const label = String(
    raw.bucketId ?? raw.bucket_id ?? raw.displayName ?? raw.display_name ?? raw.description ?? ""
  ).toLowerCase();
  if (label.includes("weekly") || label.includes("week")) return "weekly";
  if (
    label.includes("5h") ||
    label.includes("5-hour") ||
    label.includes("5 hour") ||
    label.includes("session")
  ) {
    return "fiveHour";
  }
  return undefined;
}

function antigravityQuotaGroups(body: Record<string, unknown>): unknown[] {
  const response = asRecord(body.response);
  const summary = asRecord(body.summary);
  const payload = response ?? summary ?? body;
  return Array.isArray(payload.groups) ? payload.groups : [];
}

function parseAntigravityQuotaSummary(
  body: Record<string, unknown>,
  now: number
): LiveProviderUsage | null {
  let fiveHour: LiveUsageWindow | undefined;
  let weekly: LiveUsageWindow | undefined;

  for (const group of antigravityQuotaGroups(body)) {
    const record = asRecord(group);
    const buckets = Array.isArray(record?.buckets) ? record.buckets : [];
    for (const bucket of buckets) {
      const bucketRecord = asRecord(bucket);
      if (!bucketRecord || bucketRecord.disabled === true) continue;
      const window = remainingFractionWindow(
        remainingFractionValue(bucketRecord),
        bucketRecord.resetTime ?? bucketRecord.reset_time
      );
      const kind = antigravityBucketKind(bucketRecord);
      if (kind === "fiveHour") fiveHour = chooseMoreUsed(fiveHour, window);
      if (kind === "weekly") weekly = chooseMoreUsed(weekly, window);
    }
  }

  if (!fiveHour && !weekly) return null;
  return {
    planLabel: "Antigravity",
    fiveHour,
    weekly,
    source: "oauth_api",
    fetchedAt: now,
  };
}

function antigravityModelWindow(
  body: Record<string, unknown>,
  now: number
): LiveProviderUsage | null {
  let fiveHour: LiveUsageWindow | undefined;
  const models = asRecord(body.models);
  if (models) {
    for (const [modelId, model] of Object.entries(models)) {
      const record = asRecord(model);
      const quota = asRecord(record?.quotaInfo ?? record?.quota_info);
      const source = quota ?? record;
      const name = String(record?.displayName ?? record?.label ?? modelId).toLowerCase();
      if (!name.includes("gemini") && !name.includes("claude") && !name.includes("gpt")) continue;
      fiveHour = chooseMoreUsed(
        fiveHour,
        remainingFractionWindow(
          remainingFractionValue(source),
          source?.resetTime ?? source?.reset_time
        )
      );
    }
  }

  const buckets = Array.isArray(body.buckets) ? body.buckets : [];
  for (const bucket of buckets) {
    const record = asRecord(bucket);
    if (!record) continue;
    const modelId = String(record.modelId ?? record.model_id ?? "").toLowerCase();
    if (!modelId.includes("gemini") && !modelId.includes("claude") && !modelId.includes("gpt")) {
      continue;
    }
    fiveHour = chooseMoreUsed(
      fiveHour,
      remainingFractionWindow(remainingFractionValue(record), record.resetTime ?? record.reset_time)
    );
  }

  if (!fiveHour) return null;
  return {
    planLabel: "Antigravity",
    fiveHour,
    source: "oauth_api",
    fetchedAt: now,
  };
}

function antigravityPlanLabel(body: unknown): string | undefined {
  const record = asRecord(body);
  const planInfo = asRecord(record?.planInfo ?? record?.plan_info);
  const tier = asRecord(record?.currentTier ?? record?.current_tier);
  const raw =
    (typeof planInfo?.planType === "string" && planInfo.planType) ||
    (typeof planInfo?.plan_type === "string" && planInfo.plan_type) ||
    (typeof tier?.name === "string" && tier.name) ||
    (typeof tier?.id === "string" && tier.id) ||
    undefined;
  return raw ? `Antigravity ${raw}` : undefined;
}

function antigravityProjectId(body: unknown): string | undefined {
  const record = asRecord(body);
  const project =
    record?.cloudaicompanionProject ??
    record?.cloudAiCompanionProject ??
    record?.project ??
    record?.projectId ??
    record?.project_id;
  if (typeof project === "string" && project.trim()) return project.trim();
  const projectRecord = asRecord(project);
  const value = projectRecord?.id ?? projectRecord?.projectId ?? projectRecord?.project_id;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function parseAntigravityUsageResponse(
  body: unknown,
  now: number
): LiveProviderUsage | null {
  const root = asRecord(body);
  if (!root) return null;
  return parseAntigravityQuotaSummary(root, now) ?? antigravityModelWindow(root, now);
}

async function postAntigravity<T = unknown>(
  path: string,
  token: string,
  body: Record<string, unknown>
): Promise<T | null> {
  const res = await fetch(`https://cloudcode-pa.googleapis.com/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "antigravity",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

function antigravityQuotaBody(projectId?: string): Record<string, unknown> {
  return projectId
    ? { project: projectId }
    : {
        metadata: {
          ideName: "antigravity",
          extensionName: "antigravity",
          locale: "en",
          ideVersion: "unknown",
        },
      };
}

async function fetchAntigravityUsage(token: string): Promise<LiveProviderUsage | null> {
  const codeAssist = await postAntigravity("v1internal:loadCodeAssist", token, {
    metadata: {
      ideType: "ANTIGRAVITY",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
    },
  });
  const planLabel = antigravityPlanLabel(codeAssist);
  const projectId = antigravityProjectId(codeAssist);
  const bodies = [antigravityQuotaBody(projectId)];

  for (const body of bodies) {
    const summary = await postAntigravity("v1internal:retrieveUserQuotaSummary", token, body);
    const parsed = parseAntigravityUsageResponse(summary, Date.now());
    if (parsed) return { ...parsed, planLabel: planLabel ?? parsed.planLabel };
  }

  const quota = await postAntigravity(
    "v1internal:retrieveUserQuota",
    token,
    antigravityQuotaBody(projectId)
  );
  const parsedQuota = parseAntigravityUsageResponse(quota, Date.now());
  if (parsedQuota) return { ...parsedQuota, planLabel: planLabel ?? parsedQuota.planLabel };

  const models = await postAntigravity(
    "v1internal:fetchAvailableModels",
    token,
    projectId ? { project: projectId } : {}
  );
  const parsedModels = parseAntigravityUsageResponse(models, Date.now());
  return parsedModels ? { ...parsedModels, planLabel: planLabel ?? parsedModels.planLabel } : null;
}

export function parseMiniMaxUsageResponse(body: unknown, now: number): LiveProviderUsage | null {
  const json = asRecord(body);
  const models = Array.isArray(json?.model_remains) ? json.model_remains : [];
  const model =
    models.find((entry) => {
      const name = String(asRecord(entry)?.model_name ?? "").toLowerCase();
      return name.includes("minimax-m");
    }) ?? models[0];
  const record = asRecord(model);
  if (!record) return null;

  const fiveHour = remainingWindow({
    remainingPercent: record.current_interval_remaining_percent,
    remainingCount: record.current_interval_usage_count,
    totalCount: record.current_interval_total_count,
    resetsAt: record.end_time,
  });
  const weekly =
    record.current_weekly_status === 3
      ? {
          usedPercent: 0,
          resetsAt: resetToIso(record.weekly_end_time),
          unlimited: true,
        }
      : remainingWindow({
          remainingPercent: record.current_weekly_remaining_percent,
          remainingCount: record.current_weekly_usage_count,
          totalCount: record.current_weekly_total_count,
          resetsAt: record.weekly_end_time,
        });
  if (!fiveHour && !weekly) return null;
  return {
    planLabel: "MiniMax Token Plan",
    fiveHour,
    weekly,
    source: "provider_api",
    fetchedAt: now,
  };
}

function providerOrigin(baseUrl: string | undefined, allowedHosts: string[]): string | null {
  try {
    const parsed = new URL(baseUrl || "");
    return allowedHosts.includes(parsed.hostname) ? parsed.origin : null;
  } catch {
    return null;
  }
}

async function fetchMiniMaxUsage(
  token: string,
  baseUrl?: string
): Promise<LiveProviderUsage | null> {
  const origin =
    providerOrigin(baseUrl, ["api.minimax.io", "api.minimaxi.com"]) ?? "https://api.minimax.io";
  const res = await fetch(`${origin}/v1/token_plan/remains`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "Cybara",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  return parseMiniMaxUsageResponse(await res.json(), Date.now());
}

export function parseZaiUsageResponse(body: unknown, now: number): LiveProviderUsage | null {
  const root = asRecord(body);
  const data = asRecord(root?.data) ?? root;
  const limits = Array.isArray(data?.limits) ? data.limits : [];
  const tokenLimit = limits.find((entry) => {
    const type = String(asRecord(entry)?.type ?? "").toLowerCase();
    return type.includes("token");
  });
  const timeLimit = limits.find((entry) => {
    const type = String(asRecord(entry)?.type ?? "").toLowerCase();
    return type.includes("time");
  });
  const record = asRecord(tokenLimit);
  if (!record) return null;
  const usedPercent = clampPercent(
    record.percentage ?? record.percent ?? record.used_percent ?? record.usedPercent
  );
  if (usedPercent === undefined) return null;
  const weeklyRecord = asRecord(timeLimit);
  const weeklyPercent = clampPercent(
    weeklyRecord?.percentage ??
      weeklyRecord?.percent ??
      weeklyRecord?.used_percent ??
      weeklyRecord?.usedPercent
  );
  return {
    planLabel: "GLM Coding Plan",
    fiveHour: {
      usedPercent,
      resetsAt: resetToIso(
        record.nextResetTime,
        record.next_reset_time,
        record.resetsAt,
        record.resets_at,
        record.resetTime,
        record.reset_time
      ),
    },
    weekly:
      weeklyPercent === undefined
        ? undefined
        : {
            usedPercent: weeklyPercent,
            resetsAt: resetToIso(
              weeklyRecord?.nextResetTime,
              weeklyRecord?.next_reset_time,
              weeklyRecord?.resetsAt,
              weeklyRecord?.resets_at,
              weeklyRecord?.resetTime,
              weeklyRecord?.reset_time
            ),
          },
    source: "provider_api",
    fetchedAt: now,
  };
}

function zaiAuthorizationHeaders(token: string): [string, string][] {
  const trimmed = token.trim();
  return trimmed.toLowerCase().startsWith("bearer ")
    ? [[trimmed, "as-is"]]
    : [
        [trimmed, "raw"],
        [`Bearer ${trimmed}`, "bearer"],
      ];
}

async function fetchZaiUsage(token: string, baseUrl?: string): Promise<LiveProviderUsage | null> {
  const origin = providerOrigin(baseUrl, ["api.z.ai", "open.bigmodel.cn", "dev.bigmodel.cn"]);
  if (!origin) return null;
  const url = `${origin}/api/monitor/usage/quota/limit`;
  for (const [authorization] of zaiAuthorizationHeaders(token)) {
    const res = await fetch(url, {
      headers: {
        Authorization: authorization,
        "Accept-Language": "en-US,en",
        "Content-Type": "application/json",
        "User-Agent": "Cybara",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return parseZaiUsageResponse(await res.json(), Date.now());
    if (res.status !== 401 && res.status !== 403) return null;
  }
  return null;
}

function kimiBaseUrl(baseUrl?: string): string {
  const fallback = "https://api.kimi.com/coding/v1";
  try {
    const parsed = new URL(baseUrl || fallback);
    if (parsed.hostname !== "api.kimi.com") return fallback;
    return parsed.href.replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}

function kimiUsageWindow(entry: Record<string, unknown>, now: number): LiveUsageWindow | undefined {
  const directPercent = clampPercent(
    entry.percent ?? entry.percentage ?? entry.used_percent ?? entry.usedPercent
  );
  if (directPercent !== undefined) {
    return {
      usedPercent: directPercent,
      resetsAt:
        resetToIso(
          entry.resetTime,
          entry.reset_at,
          entry.reset_time,
          entry.resetsAt,
          entry.resets_at
        ) ?? relativeResetToIso(entry.reset_in, now),
    };
  }
  const limit = toNumber(entry.limit ?? entry.limit_amount);
  const used =
    toNumber(entry.used ?? entry.used_amount) ??
    (limit !== undefined && toNumber(entry.remaining) !== undefined
      ? limit - Number(entry.remaining)
      : undefined);
  if (!limit || limit <= 0 || used === undefined) return undefined;
  return {
    usedPercent: Math.max(0, Math.min(100, (used / limit) * 100)),
    resetsAt:
      resetToIso(
        entry.resetTime,
        entry.reset_at,
        entry.reset_time,
        entry.resetsAt,
        entry.resets_at
      ) ?? relativeResetToIso(entry.reset_in, now),
  };
}

function kimiWindowKind(
  entry: Record<string, unknown>,
  window?: Record<string, unknown>
): "fiveHour" | "weekly" | "monthly" | undefined {
  const label = String(
    entry.name ?? entry.title ?? entry.model_name ?? entry.label ?? entry.kind ?? ""
  ).toLowerCase();
  const duration = toNumber(window?.duration ?? entry.duration);
  const unit = String(
    window?.timeUnit ?? window?.time_unit ?? entry.timeUnit ?? entry.time_unit ?? ""
  ).toLowerCase();
  if (label === "all" || label.includes("weekly") || label.includes("week")) return "weekly";
  if (label.includes("monthly") || label.includes("month")) return "monthly";
  if (label.includes("5h") || label.includes("5-hour") || label.includes("5 hour"))
    return "fiveHour";
  if (duration === 5 && unit.includes("hour")) return "fiveHour";
  if (duration === 7 && unit.includes("day")) return "weekly";
  if (duration === 1 && unit.includes("month")) return "monthly";
  return undefined;
}

export function parseKimiUsageResponse(body: unknown, now: number): LiveProviderUsage | null {
  const root = asRecord(body);
  if (!root) return null;
  const windows: {
    fiveHour?: LiveUsageWindow;
    weekly?: LiveUsageWindow;
    monthly?: LiveUsageWindow;
  } = {};
  const assignWindow = (
    kind: "fiveHour" | "weekly" | "monthly" | undefined,
    entry: Record<string, unknown>
  ) => {
    if (!kind || windows[kind]) return;
    const window = kimiUsageWindow(entry, now);
    if (window) windows[kind] = window;
  };

  const data = Array.isArray(root.data) ? root.data : [];
  for (const item of data) {
    const record = asRecord(item);
    if (!record) continue;
    const kind = kimiWindowKind(record) ?? (record.model_name === "all" ? "weekly" : undefined);
    assignWindow(kind, record);
  }

  const usage = asRecord(root.usage);
  if (usage) assignWindow(kimiWindowKind(usage) ?? "weekly", usage);

  const limits = Array.isArray(root.limits) ? root.limits : [];
  for (const item of limits) {
    const record = asRecord(item);
    if (!record) continue;
    const detail = asRecord(record.detail) ?? record;
    const window = asRecord(record.window) ?? {};
    assignWindow(kimiWindowKind(detail, window), { ...window, ...detail });
  }

  if (!windows.fiveHour && !windows.weekly && !windows.monthly) return null;
  return {
    planLabel: "Kimi Coding Plan",
    fiveHour: windows.fiveHour,
    weekly: windows.weekly,
    monthly: windows.monthly,
    source: "provider_api",
    fetchedAt: now,
  };
}

function moneyValue(raw: unknown): number | undefined {
  const record = asRecord(raw);
  return record ? toNumber(record.val ?? record.value ?? record.amount) : toNumber(raw);
}

export function parseGrokUsageResponse(body: unknown, now: number): LiveProviderUsage | null {
  const root = asRecord(body);
  const result = asRecord(root?.result) ?? root;
  if (!result) return null;
  const usage = asRecord(result.usage);
  const used =
    moneyValue(usage?.totalUsed ?? usage?.total_used) ??
    moneyValue(usage?.includedUsed ?? usage?.included_used);
  const limit = moneyValue(result.monthlyLimit ?? result.monthly_limit);
  if (used === undefined || !limit || limit <= 0) return null;
  const usedPercent = Math.max(0, Math.min(100, (used / limit) * 100));
  const billingCycle = asRecord(result.billingCycle ?? result.billing_cycle);
  return {
    planLabel: "Grok Build",
    fiveHour: {
      usedPercent: 0,
      unlimited: true,
    },
    weekly: {
      usedPercent,
      resetsAt: resetToIso(
        billingCycle?.billingPeriodEnd,
        billingCycle?.billing_period_end,
        result.resetsAt,
        result.resets_at
      ),
    },
    source: "cli",
    fetchedAt: now,
  };
}

interface GrokRpcClient {
  request(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown>;
  close(): void;
}

function resolveGrokExecutable(): string | null {
  const explicit = process.env.GROK_CLI_PATH?.trim();
  if (explicit) return explicit;
  try {
    return Bun.which("grok") ?? null;
  } catch {
    return null;
  }
}

function createGrokRpcClient(): GrokRpcClient | null {
  const executable = resolveGrokExecutable();
  if (!executable) return null;

  const lowered = executable.toLowerCase();
  const needsShell =
    process.platform === "win32" && (lowered.endsWith(".cmd") || lowered.endsWith(".bat"));
  const [spawnCommand, spawnArgs] = needsShell
    ? ["cmd.exe", ["/d", "/s", "/c", executable, "agent", "stdio"]]
    : [executable, ["agent", "stdio"]];
  const child = spawn(spawnCommand as string, spawnArgs as string[], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: process.env,
  }) as ChildProcessWithoutNullStreams;
  const lines = createInterface({ input: child.stdout });
  let nextId = 1;
  let stderr = "";
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  child.stderr.on("data", (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString("utf8")}`.slice(-1200);
  });
  child.once("error", (error) => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  });
  child.once("close", () => {
    const error = new Error(stderr.trim() || "grok agent stdio exited");
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  });
  lines.on("line", (line) => {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    const rawId = message.id;
    const id = typeof rawId === "number" ? rawId : Number(rawId);
    if (!Number.isInteger(id)) return;
    const item = pending.get(id);
    if (!item) return;
    pending.delete(id);
    clearTimeout(item.timer);
    const error = asRecord(message.error);
    if (error) {
      const messageText = typeof error.message === "string" ? error.message : "grok RPC failed";
      item.reject(new Error(messageText));
      return;
    }
    item.resolve(message.result ?? null);
  });

  return {
    request(method, params, timeoutMs) {
      const id = nextId++;
      const payload = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      });
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          if (!child.killed) child.kill();
          reject(new Error(`grok RPC timed out on ${method}`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(`${payload}\n`, "utf8", (error) => {
          if (!error) return;
          pending.delete(id);
          clearTimeout(timer);
          reject(error);
        });
      });
    },
    close() {
      lines.close();
      child.stdin.destroy();
      if (!child.killed) child.kill();
    },
  };
}

async function fetchGrokCliUsage(): Promise<LiveProviderUsage | null> {
  const rpc = createGrokRpcClient();
  if (!rpc) return null;
  try {
    await rpc.request(
      "initialize",
      {
        protocolVersion: "1",
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
      },
      8000
    );
    const result = await rpc.request("x.ai/billing", {}, 12000);
    return parseGrokUsageResponse(result, Date.now());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("Method not found") ||
      message.includes("Authentication required") ||
      message.includes("grok RPC timed out")
    ) {
      return null;
    }
    log.debug(`grok CLI usage failed: ${message}`);
    return null;
  } finally {
    rpc.close();
  }
}

function grpcWebDataFrames(data: Uint8Array): Uint8Array[] {
  const frames: Uint8Array[] = [];
  let index = 0;
  while (index < data.length) {
    if (index + 5 > data.length) return [];
    const flags = data[index] ?? 0;
    const length =
      ((data[index + 1] ?? 0) << 24) |
      ((data[index + 2] ?? 0) << 16) |
      ((data[index + 3] ?? 0) << 8) |
      (data[index + 4] ?? 0);
    const start = index + 5;
    const end = start + length;
    if (length < 0 || end > data.length) return [];
    if ((flags & 0x80) === 0) frames.push(data.slice(start, end));
    index = end;
  }
  return frames;
}

function looksLikeProtobufPayload(data: Uint8Array): boolean {
  const first = data[0];
  if (first === undefined) return false;
  const fieldNumber = first >> 3;
  const wireType = first & 0x07;
  return fieldNumber > 0 && [0, 1, 2, 5].includes(wireType);
}

function readVarint(data: Uint8Array, start: number): { value: number; next: number } | null {
  let result = 0;
  let shift = 0;
  for (let index = start; index < data.length && shift <= 63; index++) {
    const byte = data[index] ?? 0;
    result += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value: result, next: index + 1 };
    shift += 7;
  }
  return null;
}

interface GrokProtobufField {
  path: number[];
  value: number;
  order: number;
}

interface GrokProtobufScan {
  fixed32Fields: GrokProtobufField[];
  varintFields: GrokProtobufField[];
  order: number;
}

function scanGrokProtobuf(
  data: Uint8Array,
  depth = 0,
  path: number[] = [],
  scan: GrokProtobufScan = { fixed32Fields: [], varintFields: [], order: 0 }
): GrokProtobufScan {
  if (depth > 8) return scan;
  let index = 0;
  while (index < data.length) {
    const tag = readVarint(data, index);
    if (!tag) break;
    index = tag.next;
    const fieldNumber = Math.floor(tag.value / 8);
    const wireType = tag.value & 0x07;
    if (fieldNumber <= 0) break;
    const nextPath = [...path, fieldNumber];

    if (wireType === 0) {
      const value = readVarint(data, index);
      if (!value) break;
      index = value.next;
      scan.varintFields.push({ path: nextPath, value: value.value, order: scan.order++ });
      continue;
    }

    if (wireType === 1) {
      if (index + 8 > data.length) break;
      index += 8;
      continue;
    }

    if (wireType === 2) {
      const length = readVarint(data, index);
      if (!length) break;
      index = length.next;
      const end = index + length.value;
      if (length.value < 0 || end > data.length) break;
      const chunk = data.slice(index, end);
      if (chunk.length > 0 && looksLikeProtobufPayload(chunk)) {
        scanGrokProtobuf(chunk, depth + 1, nextPath, scan);
      }
      index = end;
      continue;
    }

    if (wireType === 5) {
      if (index + 4 > data.length) break;
      const view = new DataView(data.buffer, data.byteOffset + index, 4);
      scan.fixed32Fields.push({
        path: nextPath,
        value: view.getFloat32(0, true),
        order: scan.order++,
      });
      index += 4;
      continue;
    }

    break;
  }
  return scan;
}

function pathStartsWith(path: number[], prefix: number[]): boolean {
  return prefix.every((value, index) => path[index] === value);
}

export function parseGrokWebBillingResponse(
  raw: ArrayBuffer | Uint8Array,
  now: number
): LiveProviderUsage | null {
  const data = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  let payloads = grpcWebDataFrames(data);
  if (payloads.length === 0 && looksLikeProtobufPayload(data)) payloads = [data];
  if (payloads.length === 0) return null;

  const scan: GrokProtobufScan = { fixed32Fields: [], varintFields: [], order: 0 };
  for (const payload of payloads) scanGrokProtobuf(payload, 0, [], scan);

  const percent = scan.fixed32Fields
    .filter(
      (field) =>
        field.path[field.path.length - 1] === 1 &&
        Number.isFinite(field.value) &&
        field.value >= 0 &&
        field.value <= 100
    )
    .sort((a, b) =>
      a.path.length === b.path.length ? a.order - b.order : a.path.length - b.path.length
    )[0]?.value;

  const resetCandidates = scan.varintFields
    .filter((field) => field.value >= 1_700_000_000 && field.value <= 2_100_000_000)
    .map((field) => ({ path: field.path, date: new Date(field.value * 1000) }));
  const future = resetCandidates.filter((entry) => entry.date.getTime() > now);
  const preferredReset =
    future
      .filter((entry) => entry.path.join(".") === "1.5.1")
      .map((entry) => entry.date.getTime())
      .sort((a, b) => a - b)[0] ??
    future.map((entry) => entry.date.getTime()).sort((a, b) => a - b)[0];
  const hasUsagePeriod = scan.varintFields.some(
    (field) =>
      pathStartsWith(field.path, [1, 6]) ||
      (field.path.join(".") === "1.8.1" && (field.value === 1 || field.value === 2))
  );
  const usedPercent =
    percent ??
    (preferredReset !== undefined && hasUsagePeriod && scan.fixed32Fields.length === 0
      ? 0
      : undefined);
  if (usedPercent === undefined) return null;

  return {
    planLabel: "Grok Build",
    fiveHour: {
      usedPercent: 0,
      unlimited: true,
    },
    weekly: {
      usedPercent: Math.max(0, Math.min(100, usedPercent)),
      resetsAt: preferredReset ? new Date(preferredReset).toISOString() : undefined,
    },
    source: "oauth_api",
    fetchedAt: now,
  };
}

async function fetchGrokWebBillingUsage(token: string): Promise<LiveProviderUsage | null> {
  const res = await fetch("https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: "https://grok.com",
      Referer: "https://grok.com/?_s=usage",
      Accept: "*/*",
      "Content-Type": "application/grpc-web+proto",
      "x-grpc-web": "1",
      "x-user-agent": "connect-es/2.1.1",
      "User-Agent": "Cybara",
    },
    body: new Uint8Array([0, 0, 0, 0, 0]),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  return parseGrokWebBillingResponse(await res.arrayBuffer(), Date.now());
}

function parsePercentWindow(
  raw: unknown,
  now: number,
  fallbackReset?: unknown
): LiveUsageWindow | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;
  const percent = clampPercent(
    record.usagePercent ??
      record.usedPercent ??
      record.percentUsed ??
      record.percent ??
      record.usage_percent ??
      record.used_percent ??
      record.utilization ??
      record.utilizationPercent ??
      record.utilization_percent
  );
  if (percent !== undefined) {
    return {
      usedPercent: percent,
      resetsAt:
        resetToIso(record.resetAt, record.resetsAt, record.reset_at, record.resets_at) ??
        relativeResetToIso(
          record.resetInSec ??
            record.resetInSeconds ??
            record.reset_sec ??
            record.reset_in_sec ??
            record.resetsInSeconds ??
            record.resetIn,
          now
        ) ??
        resetToIso(record.nextReset, record.next_reset, fallbackReset),
    };
  }
  const used = toNumber(record.used ?? record.usage ?? record.consumed ?? record.usedTokens);
  const limit = toNumber(record.limit ?? record.total ?? record.quota ?? record.max ?? record.cap);
  if (used === undefined || !limit || limit <= 0) return undefined;
  return {
    usedPercent: Math.max(0, Math.min(100, (used / limit) * 100)),
    resetsAt: resetToIso(record.resetAt, record.resetsAt, record.reset_at, fallbackReset),
  };
}

function firstNestedWindow(
  body: Record<string, unknown>,
  keys: string[],
  now: number,
  fallbackReset?: unknown
): LiveUsageWindow | undefined {
  for (const key of keys) {
    const direct = parsePercentWindow(body[key], now, fallbackReset);
    if (direct) return direct;
  }
  for (const value of Object.values(body)) {
    const nested = asRecord(value);
    if (!nested) continue;
    const window = firstNestedWindow(nested, keys, now, fallbackReset);
    if (window) return window;
  }
  return undefined;
}

export function parseOpenCodeUsageResponse(body: unknown, now: number): LiveProviderUsage | null {
  const root = asRecord(body);
  if (!root) return null;
  const payload =
    asRecord(root.data) ??
    asRecord(root.result) ??
    asRecord(root.usage) ??
    asRecord(root.billing) ??
    root;
  const fallbackReset =
    payload.renewAt ?? payload.renew_at ?? payload.renewsAt ?? payload.renews_at;
  const fiveHour = firstNestedWindow(
    payload,
    ["rollingUsage", "rolling", "rolling_usage", "rollingWindow", "rolling_window"],
    now,
    fallbackReset
  );
  const weekly = firstNestedWindow(
    payload,
    ["weeklyUsage", "weekly", "weekly_usage", "weeklyWindow", "weekly_window"],
    now,
    fallbackReset
  );
  const monthly = firstNestedWindow(
    payload,
    ["monthlyUsage", "monthly", "monthly_usage", "monthlyWindow", "monthly_window"],
    now,
    fallbackReset
  );
  if (!fiveHour && !weekly && !monthly) return null;
  return {
    planLabel: "OpenCode Go",
    fiveHour,
    weekly,
    monthly,
    source: "browser_cookie",
    fetchedAt: now,
  };
}

async function fetchKimiUsage(token: string, baseUrl?: string): Promise<LiveProviderUsage | null> {
  const base = kimiBaseUrl(baseUrl);
  for (const suffix of ["usages", "usage"]) {
    const res = await fetch(`${base}/${suffix}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": "KimiCLI/1.6",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return parseKimiUsageResponse(await res.json(), Date.now());
    if (res.status !== 404) return null;
  }
  return null;
}

function looksLikeOAuthToken(token?: string): token is string {
  return typeof token === "string" && token.trim().length >= 40;
}

function looksLikeCredential(token?: string): token is string {
  return typeof token === "string" && token.trim().length >= 8;
}

export async function fetchLiveProviderUsage(
  provider: LiveUsageProviderInput
): Promise<LiveProviderUsage | null> {
  const credential = provider.apiKey || provider.accessToken;
  if (!looksLikeCredential(credential)) return null;
  const cacheKey = providerUsageCacheKey(provider, credential);
  const cached = cache.get(cacheKey);
  const cacheTtl = cached?.value ? CACHE_TTL_MS : NULL_CACHE_TTL_MS;
  if (cached && Date.now() - cached.at < cacheTtl) return cached.value;
  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const task = (async () => {
    let value: LiveProviderUsage | null = null;
    try {
      if (provider.providerType === "openai-codex") {
        value = looksLikeOAuthToken(provider.accessToken)
          ? await fetchCodexUsage(provider.accessToken)
          : null;
      } else if (provider.providerType === "anthropic") {
        value = looksLikeOAuthToken(provider.accessToken)
          ? await fetchAnthropicUsage(provider.accessToken)
          : null;
      } else if (
        provider.providerType === "antigravity" ||
        provider.providerType === "google-gemini-cli"
      ) {
        value = looksLikeOAuthToken(provider.accessToken)
          ? await fetchAntigravityUsage(provider.accessToken)
          : null;
      } else if (
        provider.providerType === "minimax" ||
        provider.providerType === "minimax-portal"
      ) {
        value = await fetchMiniMaxUsage(credential, provider.baseUrl);
      } else if (provider.providerType === "z.ai" || provider.providerType === "z.ai-coding") {
        value = await fetchZaiUsage(credential, provider.baseUrl);
      } else if (provider.providerType === "kimi-code") {
        value = await fetchKimiUsage(credential, provider.baseUrl);
      } else if (provider.providerType === "xai-oauth") {
        value = looksLikeOAuthToken(provider.accessToken)
          ? ((await fetchGrokWebBillingUsage(provider.accessToken)) ?? (await fetchGrokCliUsage()))
          : await fetchGrokCliUsage();
      } else if (provider.providerType === "xai") {
        value = await fetchGrokCliUsage();
      }
    } catch (error) {
      log.debug(`live usage fetch failed for ${provider.providerType}: ${error}`);
      value = null;
    }

    cache.set(cacheKey, { value, at: Date.now() });
    return value;
  })();
  inFlight.set(cacheKey, task);
  try {
    return await task;
  } finally {
    inFlight.delete(cacheKey);
  }
}
