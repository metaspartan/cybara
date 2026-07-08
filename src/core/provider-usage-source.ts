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
    monthly: {
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
  const cached = cache.get(provider.id);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

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
    } else if (provider.providerType === "minimax" || provider.providerType === "minimax-portal") {
      value = await fetchMiniMaxUsage(credential, provider.baseUrl);
    } else if (provider.providerType === "z.ai" || provider.providerType === "z.ai-coding") {
      value = await fetchZaiUsage(credential, provider.baseUrl);
    } else if (provider.providerType === "kimi-code") {
      value = await fetchKimiUsage(credential, provider.baseUrl);
    }
  } catch (error) {
    log.debug(`live usage fetch failed for ${provider.providerType}: ${error}`);
    value = null;
  }

  cache.set(provider.id, { value, at: Date.now() });
  return value;
}
