import type { GatewayProfile } from "./connection";
import { emptyMetricsAvailability, type MetricsEndpointKey, type MetricsSnapshot } from "./metrics";

const MOBILE_SESSION_LIST_LIMIT = 100;
const MOBILE_LOG_LIST_LIMIT = 150;

export interface HealthResponse {
  status: string;
  version?: string;
  uptime: number;
  timestamp: string;
  checks?: Record<string, { status: string; total?: number; running?: number; stopped?: number }>;
}

export interface SystemMonitorSnapshot {
  status: string;
  timestamp: string;
  sampleIntervalMs: number;
  platform: {
    type: string;
    arch: string;
    release: string;
  };
  cpu: {
    usagePct: number;
    loadPct: number | null;
    loadAverage: number[];
    cores: number;
    model: string;
  };
  memory: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedPct: number;
    swap?: {
      totalBytes: number;
      freeBytes: number;
      usedBytes: number;
      usedPct: number;
    } | null;
  };
  process: {
    pid: number;
    uptimeSeconds: number;
    cpuUsagePct: number;
    memory: {
      rssBytes: number;
      heapUsedBytes: number;
      heapTotalBytes: number;
      externalBytes: number;
      arrayBuffersBytes: number;
    };
  };
  disk: {
    path: string;
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedPct: number;
  } | null;
}

export interface SessionSummary {
  id: string;
  title: string | null;
  agent_id?: string;
  provider?: string;
  provider_id?: string;
  provider_name?: string;
  model?: string;
  message_count: number;
  created_at?: string;
  updated_at: string;
  workspace_dir?: string | null;
  pinned?: boolean;
  last_message?: { role: string; content: string } | null;
}

export interface SessionListPage {
  sessions: SessionSummary[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface AgentSummary {
  id: string;
  name: string;
  type?: string;
  status?: string;
  model?: string;
  provider?: string;
  provider_id?: string;
  system_prompt?: string;
}

export interface ProviderSummary {
  id: string;
  name: string;
  provider: string;
  base_url?: string;
  is_default?: boolean;
  configured?: boolean;
  requiresCredentials?: boolean;
  hasCredentials?: boolean;
  authType?: string;
  models?: string[];
}

export interface AgentUpdatePayload {
  name?: string;
  type?: string;
  model?: string;
  provider_id?: string;
  system_prompt?: string;
}

export interface ProviderUpdatePayload {
  name?: string;
  base_url?: string;
  api_key?: string;
  access_token?: string;
  is_default?: boolean;
}

export interface ProviderTestResult {
  success: boolean;
  provider?: string;
  message?: string;
  error?: string;
}

export type WalletAgentPolicyUpdate = Partial<{
  allowNativeSend: boolean;
  allowTokenSend: boolean;
  allowEthContractWrite: boolean;
  allowSolProgramInstruction: boolean;
  allowEthSwaps: boolean;
  allowDappInteraction: boolean;
  allowX402Payments: boolean;
  allowedEthContracts: string[];
  allowedSolPrograms: string[];
  allowedDappHosts: string[];
  allowedX402Networks: string[];
  x402MaxAmountAtomic: string;
}>;

export type SystemPromptFeatureKey =
  "memoryEnabled" | "skillsEnabled" | "messagingEnabled" | "replyTagsEnabled";

export interface SystemPromptConfig {
  template: string;
  customPrompt: string;
  defaultBasePrompt: string;
  identity: {
    name: string;
    emoji: string;
    creature: string;
    vibe: string;
    theme: string;
  };
  features: Record<SystemPromptFeatureKey, boolean>;
}

export type ToolApprovalDecision = "approve_once" | "approve_session" | "approve_always" | "deny";

export type RouterStrategy =
  | "weighted"
  | "round_robin"
  | "lowest_cost"
  | "priority"
  | "mixture_of_agents";

export interface RouterRouteConfig {
  weight: number;
  priority?: number;
  limit5h?: number;
  limitWeekly?: number;
  spendLimitDaily?: number;
  spendLimitWeekly?: number;
  priceInputPerM?: number;
  priceOutputPerM?: number;
  enabled?: boolean;
  model?: string;
}

export interface RouterConfig {
  enabled: boolean;
  strategy: RouterStrategy;
  globalSpendLimitDaily?: number;
  fallbackToAny: boolean;
  routes: Record<string, RouterRouteConfig>;
  moaMaxAgents?: number;
  moaAggregatorAgentId?: string;
}

export interface RouterRouteStatus {
  providerId: string;
  weight: number;
  priority?: number;
  enabled: boolean;
  available: boolean;
  reason?: string;
  requestsIn5hWindow: number;
  requestsInWeekWindow: number;
  spendToday: number;
  spendThisWeek: number;
  inputPerM?: number;
  outputPerM?: number;
  circuitOpen?: boolean;
  inCooldown?: boolean;
}

export interface RouterStatus {
  enabled: boolean;
  strategy: RouterStrategy | string;
  globalSpendToday?: number;
  globalSpendLimitDaily?: number;
  routes: RouterRouteStatus[];
}

export type FeatureEndpointKey =
  | "health"
  | "sessions"
  | "agents"
  | "providers"
  | "channels"
  | "tasks"
  | "tools"
  | "approvals"
  | "walletStatus"
  | "walletPolicy"
  | "memory"
  | "logs"
  | "systemMonitor"
  | "systemPrompt"
  | "config";

export interface FeatureEndpointState {
  ok: boolean;
  status?: number;
  error?: string;
}

export type FeatureAvailability = Record<FeatureEndpointKey, FeatureEndpointState>;

export interface RemoteItemSummary {
  id: string;
  title: string;
  detail: string;
  status?: string;
  type?: string;
  enabled?: boolean;
  fields?: Array<{ label: string; value: string }>;
}

export interface ActivitySummary {
  id: string;
  title: string;
  detail: string;
  source: string;
  createdAt?: string;
  fields?: Array<{ label: string; value: string }>;
}

export interface ActivityLogPage {
  logs: ActivitySummary[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface SessionToolCallSummary {
  id: string;
  name: string;
  status: string;
  detail?: string;
  args?: Record<string, unknown>;
  command?: string;
  resultSummary?: string;
  exitCode?: string;
  duration?: string;
  durationMs?: number;
  startedAt?: number;
}

export interface SessionProcessActivitySummary {
  id: string;
  phase: string;
  text: string;
  timestamp?: number;
  toolName?: string;
}

export interface SessionMessageSummary {
  id: string;
  role: string;
  content: string;
  timestamp?: string;
  thinking?: string;
  toolCalls?: SessionToolCallSummary[];
  processActivities?: SessionProcessActivitySummary[];
}

export interface SessionDetailSummary {
  id: string;
  title: string | null;
  agentId?: string;
  provider?: string;
  providerId?: string;
  providerName?: string;
  model?: string;
  workspaceDir?: string | null;
  createdAt?: string;
  updatedAt?: string;
  pinned?: boolean;
  messages: SessionMessageSummary[];
}

export interface FeatureSummary {
  health: HealthResponse | null;
  sessions: SessionSummary[];
  sessionTotal?: number;
  agents: AgentSummary[];
  providers: ProviderSummary[];
  channels: RemoteItemSummary[];
  tasks: RemoteItemSummary[];
  tools: RemoteItemSummary[];
  approvals: RemoteItemSummary[];
  walletStatus: unknown | null;
  walletPolicy: unknown | null;
  memory: RemoteItemSummary[];
  logs: ActivitySummary[];
  logsTotal?: number;
  logsLimit?: number;
  logsOffset?: number;
  logsHasMore?: boolean;
  systemMonitor: SystemMonitorSnapshot | null;
  systemPrompt: SystemPromptConfig | null;
  config: Record<string, unknown>;
  availability: FeatureAvailability;
}

export class CybaraApiError extends Error {
  status: number;
  path: string;

  constructor(status: number, path: string) {
    super(`Cybara API ${status} for ${path}`);
    this.name = "CybaraApiError";
    this.status = status;
    this.path = path;
  }
}

function emptyAvailability(): FeatureAvailability {
  return {
    health: { ok: false },
    sessions: { ok: false },
    agents: { ok: false },
    providers: { ok: false },
    channels: { ok: false },
    tasks: { ok: false },
    tools: { ok: false },
    approvals: { ok: false },
    walletStatus: { ok: false },
    walletPolicy: { ok: false },
    memory: { ok: false },
    logs: { ok: false },
    systemMonitor: { ok: false },
    systemPrompt: { ok: false },
    config: { ok: false },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(record: Record<string, unknown> | null, keys: string[]): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return undefined;
}

function readNumber(record: Record<string, unknown> | null, keys: string[]): number | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function readRecord(
  record: Record<string, unknown> | null,
  keys: string[]
): Record<string, unknown> | null {
  if (!record) return null;
  for (const key of keys) {
    const value = asRecord(record[key]);
    if (value) return value;
    if (typeof record[key] === "string") {
      try {
        const parsed = JSON.parse(record[key] as string);
        const parsedRecord = asRecord(parsed);
        if (parsedRecord) return parsedRecord;
      } catch {
        // Non-JSON strings are handled by readString/summarizeToolValue.
      }
    }
  }
  return null;
}

function describeValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "none";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.length === 1 ? "1 item" : `${value.length} items`;
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return keys.length === 1 ? "1 setting" : `${keys.length} settings`;
  }
  return "value";
}

function compactToolText(value: string, limit = 420): string {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit).trimEnd()}...`;
}

function summarizeToolValue(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "string") return compactToolText(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return compactToolText(JSON.stringify(value.slice(0, 8), null, 2));
  const record = asRecord(value);
  if (!record) return undefined;
  const preferred =
    readString(record, ["summary", "message", "stdout", "stderr", "output", "text", "error"]) ||
    undefined;
  if (preferred) return compactToolText(preferred);
  return compactToolText(JSON.stringify(record, null, 2));
}

function resolveToolCommand(record: Record<string, unknown> | null): string | undefined {
  const args = readRecord(record, ["args", "arguments", "input"]);
  return (
    readString(args, ["cmd", "command", "script", "query", "path", "file_path", "filePath"]) ||
    readString(record, ["command", "cmd"])
  );
}

function resolveToolExitCode(record: Record<string, unknown> | null): string | undefined {
  const result = readRecord(record, ["result"]);
  return readString(result, ["exitCode", "exit_code", "code", "statusCode", "status_code"]);
}

function parseDurationMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return Math.max(0, numeric);
  const match = trimmed.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return undefined;
  const unit = match[2].toLowerCase();
  if (unit === "ms") return amount;
  if (unit === "s") return amount * 1000;
  if (unit === "m") return amount * 60000;
  return amount * 3600000;
}

function detailFields(
  record: Record<string, unknown> | null
): Array<{ label: string; value: string }> {
  if (!record) return [];
  return Object.entries(record)
    .filter(([key]) => !/secret|token|api[_-]?key|password|credential|mnemonic/i.test(key))
    .slice(0, 12)
    .map(([key, value]) => ({
      label: key.replace(/_/g, " "),
      value: describeValue(value),
    }));
}

export function normalizeArrayResponse(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  for (const key of keys) {
    const nested = record[key];
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

export function normalizeRemoteItems(
  value: unknown,
  keys: string[],
  fallbackPrefix: string
): RemoteItemSummary[] {
  return normalizeArrayResponse(value, keys).map((item, index) => {
    const record = asRecord(item);
    const id = readString(record, ["id", "name", "key"]) || `${fallbackPrefix}-${index + 1}`;
    const type = readString(record, ["type", "provider", "platform", "kind"]);
    const enabled = typeof record?.enabled === "boolean" ? record.enabled : undefined;
    const status =
      readString(record, ["status", "state"]) ||
      (enabled !== undefined ? (enabled ? "enabled" : "disabled") : undefined);
    const description = readString(record, ["description", "summary", "schedule"]);
    const title =
      readString(record, ["title", "name", "label", "id", "tool"]) ||
      `${fallbackPrefix} ${index + 1}`;
    const detailParts = [type, status, description].filter(Boolean);
    return {
      id,
      title,
      detail: detailParts.length > 0 ? detailParts.join(" - ") : "Available",
      status,
      type,
      enabled,
      fields: detailFields(record),
    };
  });
}

export function normalizeMemoryItems(value: unknown): RemoteItemSummary[] {
  const record = asRecord(value);
  if (!record) return normalizeRemoteItems(value, ["memory", "items", "entries"], "memory");
  const memories = normalizeArrayResponse(record.memories, ["memories"]);
  if (memories.length === 0) {
    return normalizeArrayResponse(record.files, ["files"]).map((file, index) => ({
      id: typeof file === "string" ? file : `memory-file-${index + 1}`,
      title: typeof file === "string" ? file : `Memory file ${index + 1}`,
      detail: "Memory file",
      type: "file",
      fields: [
        { label: "file", value: typeof file === "string" ? file : `memory-file-${index + 1}` },
      ],
    }));
  }
  return memories.map((memory, index) => {
    const memoryRecord = asRecord(memory);
    const file = readString(memoryRecord, ["file", "name"]) || `memory-${index + 1}`;
    const entries = normalizeArrayResponse(memoryRecord?.entries, ["entries"]);
    return {
      id: file,
      title: file,
      detail: entries.length === 1 ? "1 entry" : `${entries.length} entries`,
      type: "memory",
      fields: [
        { label: "file", value: file },
        { label: "entries", value: String(entries.length) },
      ],
    };
  });
}

export function normalizeActivityLogs(value: unknown): ActivitySummary[] {
  const record = asRecord(value);
  const sourceArrays = record
    ? Object.entries(record).flatMap(([source, entries]) =>
        normalizeArrayResponse(entries, ["items", "entries"]).map((entry) => ({ source, entry }))
      )
    : normalizeArrayResponse(value, ["logs", "activity", "items"]).map((entry) => ({
        source: readString(asRecord(entry), ["source", "logType", "log_type"]) || "log",
        entry,
      }));

  return sourceArrays
    .map(({ source, entry }, index) => {
      const item = asRecord(entry);
      const itemSource = readString(item, ["source", "logType", "log_type"]) || source;
      const createdAt = readString(item, ["created_at", "createdAt", "timestamp", "time"]);
      const message =
        readString(item, ["message", "content", "event", "action", "details", "level"]) ||
        `${itemSource} event ${index + 1}`;
      const actor = readString(item, [
        "agent_id",
        "agentId",
        "session_id",
        "sessionId",
        "channel_id",
        "channelId",
      ]);
      return {
        id: readString(item, ["id"]) || `${itemSource}-${index + 1}`,
        title: message,
        detail: actor || itemSource,
        source: itemSource,
        createdAt,
        fields: detailFields(item),
      };
    })
    .sort((left, right) => {
      const leftTime = Date.parse(left.createdAt || "");
      const rightTime = Date.parse(right.createdAt || "");
      if (!Number.isFinite(leftTime) && !Number.isFinite(rightTime)) return 0;
      if (!Number.isFinite(leftTime)) return 1;
      if (!Number.isFinite(rightTime)) return -1;
      return rightTime - leftTime;
    });
}

function normalizeRecentActivityLogs(value: unknown): ActivitySummary[] {
  const record = asRecord(value);
  if (!record) return normalizeActivityLogs(value);
  const activityRows = Object.entries(record).flatMap(([source, entries]) =>
    normalizeArrayResponse(entries, ["items", "entries"]).map((entry, index) => {
      const item = asRecord(entry);
      const createdAt = readString(item, ["created_at", "createdAt", "timestamp", "time"]);
      const message =
        readString(item, ["message", "content", "event", "action", "details", "level"]) ||
        `${source} event ${index + 1}`;
      const actor = readString(item, [
        "agent_id",
        "agentId",
        "session_id",
        "sessionId",
        "channel_id",
        "channelId",
        "source",
      ]);
      return {
        id: readString(item, ["id"]) || `${source}-${index + 1}`,
        title: message,
        detail: actor || source,
        source,
        createdAt,
        fields: detailFields(item),
      };
    })
  );
  return activityRows.sort((left, right) => {
    const leftTime = Date.parse(left.createdAt || "");
    const rightTime = Date.parse(right.createdAt || "");
    if (!Number.isFinite(leftTime) && !Number.isFinite(rightTime)) return 0;
    if (!Number.isFinite(leftTime)) return 1;
    if (!Number.isFinite(rightTime)) return -1;
    return rightTime - leftTime;
  });
}

function normalizeActivityLogPage(
  value: unknown,
  fallbackLimit = MOBILE_LOG_LIST_LIMIT,
  fallbackOffset = 0
): ActivityLogPage {
  const record = asRecord(value);
  const logs = normalizeActivityLogs(record?.logs ?? value);
  const total = readNumber(record, ["total", "totalCount", "total_count", "count"]) ?? logs.length;
  const limit = readNumber(record, ["limit"]) ?? fallbackLimit;
  const offset = readNumber(record, ["offset"]) ?? fallbackOffset;
  const hasMore =
    record?.hasMore === true ||
    record?.has_more === true ||
    offset + logs.length < Math.max(total, logs.length);
  return {
    logs,
    total: Math.max(logs.length, total),
    limit,
    offset,
    hasMore,
  };
}

function normalizeSessions(value: unknown): SessionSummary[] {
  return sortSessionSummaries(
    normalizeArrayResponse(value, ["sessions", "items"]).map((session, index) => {
      const record = asRecord(session);
      const id = readString(record, ["id", "session_id"]) || `session-${index + 1}`;
      const createdAt = readString(record, ["created_at", "createdAt"]);
      const updatedAt =
        readString(record, ["updated_at", "updatedAt", "created_at", "createdAt"]) ||
        new Date(0).toISOString();
      return {
        id,
        title: readString(record, ["title", "name"]) || null,
        agent_id: readString(record, ["agent_id", "agentId"]),
        provider: readString(record, ["provider"]),
        provider_id: readString(record, ["provider_id", "providerId"]),
        provider_name: readString(record, ["provider_name", "providerName"]),
        model: readString(record, ["model"]),
        message_count: readNumber(record, ["message_count", "messageCount"]) ?? 0,
        created_at: createdAt,
        updated_at: updatedAt,
        workspace_dir: readString(record, ["workspace_dir", "workspaceDir"]) || null,
        pinned: record?.pinned === true,
        last_message: asRecord(record?.last_message || record?.lastMessage) as
          SessionSummary["last_message"] | null,
      };
    })
  );
}

function normalizeSessionListPage(
  value: unknown,
  fallbackLimit = MOBILE_SESSION_LIST_LIMIT,
  fallbackOffset = 0
): SessionListPage {
  const record = asRecord(value);
  const sessions = normalizeSessions(value);
  const total =
    readNumber(record, ["total", "totalCount", "total_count", "count"]) ?? sessions.length;
  const limit = readNumber(record, ["limit"]) ?? fallbackLimit;
  const offset = readNumber(record, ["offset"]) ?? fallbackOffset;
  const hasMore =
    record?.hasMore === true ||
    record?.has_more === true ||
    offset + sessions.length < Math.max(total, sessions.length);
  return {
    sessions,
    total: Math.max(sessions.length, total),
    limit,
    offset,
    hasMore,
  };
}

export function sessionSortTimestampMs(session: SessionSummary): number {
  const updated = Date.parse(session.updated_at || "");
  if (Number.isFinite(updated)) return updated;
  const created = Date.parse(session.created_at || "");
  return Number.isFinite(created) ? created : 0;
}

export function sortSessionSummaries(sessions: SessionSummary[]): SessionSummary[] {
  return [...sessions].sort(
    (a, b) =>
      (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) ||
      sessionSortTimestampMs(b) - sessionSortTimestampMs(a)
  );
}

function normalizeSessionDetail(value: unknown, fallbackId: string): SessionDetailSummary {
  const record = asRecord(value);
  const rawMessages = normalizeArrayResponse(record?.messagesList, ["messagesList", "items"]);
  const messages = (
    rawMessages.length > 0
      ? rawMessages
      : normalizeArrayResponse(record?.messages, ["messages", "items"])
  ).map((message, index) => {
    const messageRecord = asRecord(message);
    const content = readString(messageRecord, ["content", "message", "text"]) || "";
    return {
      id: readString(messageRecord, ["id"]) || `${fallbackId}-message-${index + 1}`,
      role: readString(messageRecord, ["role", "type", "author"]) || "message",
      content,
      timestamp: readString(messageRecord, ["timestamp", "created_at", "createdAt"]),
      thinking: readString(messageRecord, ["thinking"]),
      toolCalls: normalizeMessageToolCalls(messageRecord?.tool_calls ?? messageRecord?.toolCalls),
      processActivities: normalizeProcessActivities(
        messageRecord?.process_activities ?? messageRecord?.processActivities
      ),
    };
  });

  return {
    id: readString(record, ["id", "session_id"]) || fallbackId,
    title: readString(record, ["title", "name"]) || null,
    agentId: readString(record, ["agent_id", "agentId"]),
    provider: readString(record, ["provider"]),
    providerId: readString(record, ["provider_id", "providerId"]),
    providerName: readString(record, ["provider_name", "providerName"]),
    model: readString(record, ["model"]),
    workspaceDir: readString(record, ["workspace_dir", "workspaceDir"]) || null,
    createdAt: readString(record, ["created_at", "createdAt"]),
    updatedAt: readString(record, ["updated_at", "updatedAt", "created_at", "createdAt"]),
    pinned: record?.pinned === true,
    messages,
  };
}

function normalizeMessageToolCalls(value: unknown): SessionToolCallSummary[] | undefined {
  const calls = normalizeArrayResponse(value, ["tool_calls", "toolCalls", "items"]);
  if (calls.length === 0) return undefined;
  return calls.slice(0, 20).map((call, index) => {
    const record = asRecord(call);
    const name = readString(record, ["name", "toolName"]) || `tool ${index + 1}`;
    const status = readString(record, ["status", "state"]) || "completed";
    const args = readRecord(record, ["args", "arguments", "input"]) || undefined;
    const errorSummary = summarizeToolValue(record?.error);
    const resultSummary = errorSummary || summarizeToolValue(record?.result);
    const command = resolveToolCommand(record);
    const exitCode = resolveToolExitCode(record);
    const duration = readString(record, ["duration", "durationMs", "duration_ms", "elapsed"]);
    const durationMs =
      readNumber(record, ["durationMs", "duration_ms"]) ?? parseDurationMs(record?.duration);
    return {
      id: readString(record, ["id", "toolCallId"]) || `${name}-${index + 1}`,
      name,
      status,
      detail: command || resultSummary || describeValue(record?.args ?? record?.arguments),
      args,
      command,
      resultSummary,
      exitCode,
      duration,
      durationMs,
      startedAt: readNumber(record, ["started_at", "startedAt", "timestamp"]),
    };
  });
}

function normalizeProcessActivities(value: unknown): SessionProcessActivitySummary[] | undefined {
  const activities = normalizeArrayResponse(value, [
    "process_activities",
    "processActivities",
    "activities",
    "items",
  ]);
  if (activities.length === 0) return undefined;
  return activities.slice(-12).map((activity, index) => {
    const record = asRecord(activity);
    return {
      id: readString(record, ["id"]) || `activity-${index + 1}`,
      phase: readString(record, ["phase", "status"]) || "activity",
      text: readString(record, ["text", "message", "detail"]) || "Working",
      timestamp: readNumber(record, ["timestamp"]),
      toolName: readString(record, ["toolName", "tool_name"]),
    };
  });
}

function normalizeAgent(agent: unknown, index = 0): AgentSummary {
  const record = asRecord(agent);
  const id = readString(record, ["id", "name"]) || `agent-${index + 1}`;
  const providerId = readString(record, ["provider_id", "providerId", "provider"]);
  return {
    id,
    name: readString(record, ["name", "label", "id"]) || id,
    type: readString(record, ["type"]),
    status: readString(record, ["status", "state"]),
    model: readString(record, ["model"]),
    provider: providerId,
    provider_id: providerId,
    system_prompt: readString(record, ["system_prompt", "systemPrompt"]),
  };
}

function normalizeAgents(value: unknown): AgentSummary[] {
  return normalizeArrayResponse(value, ["agents", "items"]).map((agent, index) =>
    normalizeAgent(agent, index)
  );
}

function normalizeProviders(value: unknown): ProviderSummary[] {
  return normalizeArrayResponse(value, ["providers", "items"]).map((provider, index) => {
    const record = asRecord(provider);
    const info = asRecord(record?.info);
    const id = readString(record, ["id", "provider", "name"]) || `provider-${index + 1}`;
    const hasCredentials = Boolean(
      record?.hasCredentials ||
      record?.has_credentials ||
      record?.api_key ||
      record?.apiKey ||
      record?.access_token ||
      record?.accessToken ||
      record?.refresh_token ||
      record?.refreshToken
    );
    const rawModels = (Array.isArray(record?.models)
      ? record.models
      : Array.isArray(info?.models)
        ? info.models
        : []) as unknown[];
    const models = rawModels
      .map((entry) =>
        typeof entry === "string"
          ? entry
          : typeof (entry as Record<string, unknown>)?.id === "string"
            ? ((entry as Record<string, unknown>).id as string)
            : ""
      )
      .filter((entry): entry is string => entry.length > 0);
    return {
      id,
      name: readString(record, ["name", "label", "provider"]) || id,
      provider: readString(record, ["provider", "type"]) || "provider",
      base_url: readString(record, ["base_url", "baseUrl"]),
      is_default: Boolean(record?.is_default || record?.isDefault),
      models,
      configured:
        typeof record?.configured === "boolean" ? record.configured : hasCredentials || undefined,
      requiresCredentials:
        typeof record?.requiresCredentials === "boolean"
          ? record.requiresCredentials
          : typeof record?.requires_credentials === "boolean"
            ? record.requires_credentials
            : undefined,
      hasCredentials,
      authType: readString(record, ["authType", "auth_type"]) || readString(info, ["authType"]),
    };
  });
}

function normalizeProviderHealth(value: unknown): Map<string, Partial<ProviderSummary>> {
  const health = new Map<string, Partial<ProviderSummary>>();
  for (const item of normalizeArrayResponse(value, ["providers", "items"])) {
    const record = asRecord(item);
    const id = readString(record, ["id"]);
    if (!id) continue;
    const configured = typeof record?.configured === "boolean" ? record.configured : undefined;
    const requiresCredentials =
      typeof record?.requiresCredentials === "boolean"
        ? record.requiresCredentials
        : typeof record?.requires_credentials === "boolean"
          ? record.requires_credentials
          : undefined;
    health.set(id, {
      configured,
      requiresCredentials,
      hasCredentials:
        configured !== undefined && requiresCredentials !== undefined
          ? configured && requiresCredentials
          : undefined,
    });
  }
  return health;
}

function normalizeRouterStrategy(value: unknown): RouterStrategy {
  return value === "round_robin" ||
    value === "lowest_cost" ||
    value === "priority" ||
    value === "mixture_of_agents" ||
    value === "weighted"
    ? value
    : "weighted";
}

function normalizeRouterConfig(value: unknown): RouterConfig {
  const record = asRecord(value);
  const moaMaxAgents = readNumber(record, ["moaMaxAgents", "moa_max_agents"]);
  const moaAggregatorAgentId = readString(record, ["moaAggregatorAgentId", "moa_aggregator_agent_id"]);
  return {
    enabled: record?.enabled === true,
    strategy: normalizeRouterStrategy(record?.strategy),
    globalSpendLimitDaily: readNumber(record, [
      "globalSpendLimitDaily",
      "global_spend_limit_daily",
    ]),
    fallbackToAny: record?.fallbackToAny !== false && record?.fallback_to_any !== false,
    routes: (asRecord(record?.routes) as Record<string, RouterRouteConfig> | null) ?? {},
    moaMaxAgents: moaMaxAgents && moaMaxAgents > 0 ? moaMaxAgents : undefined,
    moaAggregatorAgentId: moaAggregatorAgentId || undefined,
  };
}

function normalizeRouterStatus(value: unknown): RouterStatus {
  const record = asRecord(value);
  return {
    enabled: record?.enabled === true,
    strategy: normalizeRouterStrategy(record?.strategy),
    globalSpendToday: readNumber(record, ["globalSpendToday", "global_spend_today"]),
    globalSpendLimitDaily: readNumber(record, [
      "globalSpendLimitDaily",
      "global_spend_limit_daily",
    ]),
    routes: normalizeArrayResponse(record?.routes, ["routes", "items"]).map((route, index) => {
      const routeRecord = asRecord(route);
      const providerId =
        readString(routeRecord, ["providerId", "provider_id", "id"]) || `route-${index + 1}`;
      return {
        providerId,
        weight: readNumber(routeRecord, ["weight"]) ?? 0,
        priority: readNumber(routeRecord, ["priority"]),
        enabled: routeRecord?.enabled !== false,
        available: routeRecord?.available === true,
        reason: readString(routeRecord, ["reason"]),
        requestsIn5hWindow: readNumber(routeRecord, ["requestsIn5hWindow"]) ?? 0,
        requestsInWeekWindow: readNumber(routeRecord, ["requestsInWeekWindow"]) ?? 0,
        spendToday: readNumber(routeRecord, ["spendToday"]) ?? 0,
        spendThisWeek: readNumber(routeRecord, ["spendThisWeek"]) ?? 0,
        inputPerM: readNumber(routeRecord, ["inputPerM", "priceInputPerM"]),
        outputPerM: readNumber(routeRecord, ["outputPerM", "priceOutputPerM"]),
        circuitOpen: routeRecord?.circuitOpen === true,
        inCooldown: routeRecord?.inCooldown === true,
      };
    }),
  };
}

export class CybaraMobileApi {
  private profile: GatewayProfile;

  constructor(profile: GatewayProfile) {
    this.profile = profile;
  }

  private headers(): Headers {
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    headers.set("Authorization", `Bearer ${this.profile.apiKey}`);
    return headers;
  }

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.profile.baseUrl}${path}`, {
      ...init,
      headers: this.headers(),
    });
    if (!response.ok) {
      throw new CybaraApiError(response.status, path);
    }
    return (await response.json()) as T;
  }

  health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/api/health");
  }

  async sessionList(): Promise<SessionListPage> {
    return normalizeSessionListPage(
      await this.request<unknown>(`/api/sessions?limit=${MOBILE_SESSION_LIST_LIMIT}&includeTotal=1`)
    );
  }

  async sessions(): Promise<SessionSummary[]> {
    return (await this.sessionList()).sessions;
  }

  async session(id: string): Promise<SessionDetailSummary> {
    return normalizeSessionDetail(
      await this.request<unknown>(`/api/sessions/${encodeURIComponent(id)}?includeFullToolCalls=1`),
      id
    );
  }

  async sendChat(input: {
    message: string;
    sessionId?: string;
    agentId?: string;
    workspaceDir?: string | null;
  }): Promise<{ sessionId: string; message: SessionMessageSummary; workspaceDir?: string | null }> {
    const response = await this.request<unknown>("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        message: input.message,
        sessionId: input.sessionId,
        agentId: input.agentId,
        workspaceDir: input.workspaceDir,
      }),
    });
    const record = asRecord(response);
    const messageRecord = asRecord(record?.message);
    const thinking = readString(messageRecord, ["thinking"]) || readString(record, ["thinking"]);
    return {
      sessionId: readString(record, ["sessionId"]) || input.sessionId || "",
      workspaceDir: readString(record, ["workspaceDir"]) || input.workspaceDir,
      message: {
        id: readString(messageRecord, ["id"]) || `assistant-${Date.now()}`,
        role: readString(messageRecord, ["role"]) || "assistant",
        content: readString(messageRecord, ["content"]) || "",
        timestamp: readString(messageRecord, ["timestamp"]) || new Date().toISOString(),
        thinking,
        toolCalls: normalizeMessageToolCalls(
          messageRecord?.tool_calls ?? messageRecord?.toolCalls ?? record?.tool_calls
        ),
        processActivities: normalizeProcessActivities(
          messageRecord?.process_activities ?? messageRecord?.processActivities
        ),
      },
    };
  }

  updateSessionTitle(id: string, title: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/sessions/${encodeURIComponent(id)}/title`, {
      method: "PUT",
      body: JSON.stringify({ title }),
    });
  }

  pinSession(id: string, pinned: boolean): Promise<{ success: boolean; pinned?: boolean }> {
    return this.request<{ success: boolean; pinned?: boolean }>(
      `/api/sessions/${encodeURIComponent(id)}/pin`,
      {
        method: "PUT",
        body: JSON.stringify({ pinned }),
      }
    );
  }

  deleteSession(id: string): Promise<{ success?: boolean }> {
    return this.request<{ success?: boolean }>(`/api/chat/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  async agents(): Promise<AgentSummary[]> {
    return normalizeAgents(await this.request<unknown>("/api/agents"));
  }

  async updateAgent(id: string, data: AgentUpdatePayload): Promise<AgentSummary> {
    const response = await this.request<unknown>(`/api/agents/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return normalizeAgent(response);
  }

  startAgent(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/agents/${encodeURIComponent(id)}/start`, {
      method: "POST",
    });
  }

  stopAgent(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/agents/${encodeURIComponent(id)}/stop`, {
      method: "POST",
    });
  }

  deleteAgent(id: string): Promise<{ success?: boolean }> {
    return this.request<{ success?: boolean }>(`/api/agents/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  async providers(): Promise<ProviderSummary[]> {
    const providerRows = normalizeProviders(await this.request<unknown>("/api/providers"));
    let health = new Map<string, Partial<ProviderSummary>>();
    try {
      health = normalizeProviderHealth(await this.request<unknown>("/api/providers/health"));
    } catch {
      health = new Map<string, Partial<ProviderSummary>>();
    }
    return providerRows.map((provider) => ({ ...provider, ...health.get(provider.id) }));
  }

  updateProvider(id: string, data: ProviderUpdatePayload): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/providers/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  testProvider(id: string): Promise<ProviderTestResult> {
    return this.request<ProviderTestResult>(`/api/providers/${encodeURIComponent(id)}/test`, {
      method: "POST",
    });
  }

  deleteProvider(id: string): Promise<{ success?: boolean }> {
    return this.request<{ success?: boolean }>(`/api/providers/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  updateChannel(
    id: string,
    data: { name?: string; enabled?: boolean; config?: Record<string, unknown> }
  ): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/channels/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  testChannel(id: string): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.request<{ success: boolean; message?: string; error?: string }>(
      `/api/channels/${encodeURIComponent(id)}/test`,
      { method: "POST" }
    );
  }

  deleteChannel(id: string): Promise<{ success?: boolean }> {
    return this.request<{ success?: boolean }>(`/api/channels/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  createTask(payload: {
    name: string;
    description?: string;
    action: string;
    agent_id?: string;
    schedule?: string;
    enabled?: boolean;
  }): Promise<{ id?: string; success?: boolean }> {
    return this.request<{ id?: string; success?: boolean }>(`/api/tasks`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  startTask(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/tasks/${encodeURIComponent(id)}/start`, {
      method: "POST",
    });
  }

  stopTask(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/tasks/${encodeURIComponent(id)}/stop`, {
      method: "POST",
    });
  }

  runTask(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/tasks/${encodeURIComponent(id)}/run`, {
      method: "POST",
    });
  }

  deleteTask(id: string): Promise<{ success?: boolean }> {
    return this.request<{ success?: boolean }>(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  resolveToolApproval(
    requestId: string,
    decision: ToolApprovalDecision
  ): Promise<{ success: boolean; error?: string }> {
    return this.request<{ success: boolean; error?: string }>("/api/tools/approvals/resolve", {
      method: "POST",
      body: JSON.stringify({ requestId, decision }),
    });
  }

  config(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/config");
  }

  async logsPage(limit = MOBILE_LOG_LIST_LIMIT, offset = 0): Promise<ActivityLogPage> {
    try {
      const boundedLimit = Number.isFinite(limit)
        ? Math.max(1, Math.min(1000, Math.floor(limit)))
        : MOBILE_LOG_LIST_LIMIT;
      const boundedOffset = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
      return normalizeActivityLogPage(
        await this.request<unknown>(
          `/api/logs/system?limit=${boundedLimit}&offset=${boundedOffset}&includeTotal=1`
        ),
        boundedLimit,
        boundedOffset
      );
    } catch (error) {
      if (error instanceof CybaraApiError && error.status === 404) {
        const logs = normalizeRecentActivityLogs(
          await this.request<unknown>("/api/logs/activity?minutes=1440")
        );
        return {
          logs,
          total: logs.length,
          limit: logs.length,
          offset: 0,
          hasMore: false,
        };
      }
      throw error;
    }
  }

  async logs(limit = MOBILE_LOG_LIST_LIMIT): Promise<ActivitySummary[]> {
    return (await this.logsPage(limit, 0)).logs;
  }

  updateConfig(data: Record<string, unknown>): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>("/api/config", {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async routerConfig(): Promise<RouterConfig> {
    return normalizeRouterConfig(await this.request<unknown>("/api/router/config"));
  }

  updateRouterConfig(data: RouterConfig): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>("/api/router/config", {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async routerStatus(): Promise<RouterStatus> {
    return normalizeRouterStatus(await this.request<unknown>("/api/router/status"));
  }

  systemPrompt(): Promise<SystemPromptConfig> {
    return this.request<SystemPromptConfig>("/api/system-prompt");
  }

  updateSystemPrompt(data: Partial<SystemPromptConfig>): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>("/api/system-prompt", {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  updateWalletAgentPolicy(
    data: WalletAgentPolicyUpdate
  ): Promise<{ success: boolean; policy?: unknown }> {
    return this.request<{ success: boolean; policy?: unknown }>("/api/wallet/agent-policy", {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  setWalletAgentAccess(enabled: boolean): Promise<{ success: boolean; enabled?: boolean }> {
    return this.request<{ success: boolean; enabled?: boolean }>("/api/wallet/agent-access", {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    });
  }

  async featureSummary(): Promise<FeatureSummary> {
    const availability = emptyAvailability();
    const safe = async <T>(
      key: FeatureEndpointKey,
      fallback: T,
      task: () => Promise<T>
    ): Promise<T> => {
      try {
        const result = await task();
        availability[key] = { ok: true };
        return result;
      } catch (error) {
        availability[key] = {
          ok: false,
          status: error instanceof CybaraApiError ? error.status : undefined,
          error: error instanceof Error ? error.message : String(error),
        };
        return fallback;
      }
    };

    const [
      health,
      sessionList,
      agents,
      providers,
      channels,
      tasks,
      tools,
      approvals,
      walletStatus,
      walletPolicy,
      memory,
      logPage,
      systemMonitor,
      systemPrompt,
      config,
    ] = await Promise.all([
      safe<HealthResponse | null>("health", null, () => this.health()),
      safe<SessionListPage>(
        "sessions",
        {
          sessions: [],
          total: 0,
          limit: MOBILE_SESSION_LIST_LIMIT,
          offset: 0,
          hasMore: false,
        },
        () => this.sessionList()
      ),
      safe<AgentSummary[]>("agents", [], () => this.agents()),
      safe<ProviderSummary[]>("providers", [], () => this.providers()),
      safe<RemoteItemSummary[]>("channels", [], async () =>
        normalizeRemoteItems(
          await this.request<unknown>("/api/channels"),
          ["channels", "items"],
          "channel"
        )
      ),
      safe<RemoteItemSummary[]>("tasks", [], async () =>
        normalizeRemoteItems(await this.request<unknown>("/api/tasks"), ["tasks", "items"], "task")
      ),
      safe<RemoteItemSummary[]>("tools", [], async () =>
        normalizeRemoteItems(await this.request<unknown>("/api/tools"), ["tools", "items"], "tool")
      ),
      safe<RemoteItemSummary[]>("approvals", [], async () =>
        normalizeRemoteItems(
          await this.request<unknown>("/api/tools/approvals"),
          ["pending", "approvals", "items"],
          "approval"
        )
      ),
      safe<unknown | null>("walletStatus", null, () => this.request<unknown>("/api/wallet/status")),
      safe<unknown | null>("walletPolicy", null, () =>
        this.request<unknown>("/api/wallet/agent-policy")
      ),
      safe<RemoteItemSummary[]>("memory", [], async () =>
        normalizeMemoryItems(await this.request<unknown>("/api/memory"))
      ),
      safe<ActivityLogPage>(
        "logs",
        {
          logs: [],
          total: 0,
          limit: MOBILE_LOG_LIST_LIMIT,
          offset: 0,
          hasMore: false,
        },
        () => this.logsPage()
      ),
      safe<SystemMonitorSnapshot | null>("systemMonitor", null, () =>
        this.request<SystemMonitorSnapshot>("/api/system/monitor")
      ),
      safe<SystemPromptConfig | null>("systemPrompt", null, () => this.systemPrompt()),
      safe<Record<string, unknown>>("config", {}, () => this.config()),
    ]);

    return {
      health,
      sessions: sessionList.sessions,
      sessionTotal: sessionList.total,
      agents,
      providers,
      channels,
      tasks,
      tools,
      approvals,
      walletStatus,
      walletPolicy,
      memory,
      logs: logPage.logs,
      logsTotal: logPage.total,
      logsLimit: logPage.limit,
      logsOffset: logPage.offset,
      logsHasMore: logPage.hasMore,
      systemMonitor,
      systemPrompt,
      config,
      availability,
    };
  }

  async metricsSnapshot(): Promise<MetricsSnapshot> {
    const availability = emptyMetricsAvailability();
    const safe = async <T>(
      key: MetricsEndpointKey,
      fallback: T,
      task: () => Promise<T>
    ): Promise<T> => {
      try {
        const result = await task();
        availability[key] = { ok: true };
        return result;
      } catch (error) {
        availability[key] = {
          ok: false,
          status: error instanceof CybaraApiError ? error.status : undefined,
          error: error instanceof Error ? error.message : String(error),
        };
        return fallback;
      }
    };

    const [
      overview,
      tokens,
      files,
      tools,
      providers,
      timeSeries,
      models,
      insights,
      tokenAnalysis,
      storage,
    ] = await Promise.all([
      safe("overview", null, () =>
        this.request<MetricsSnapshot["overview"]>("/api/metrics/overview")
      ),
      safe("tokens", null, () => this.request<MetricsSnapshot["tokens"]>("/api/metrics/tokens")),
      safe("files", null, () => this.request<MetricsSnapshot["files"]>("/api/metrics/files")),
      safe("tools", null, () => this.request<MetricsSnapshot["tools"]>("/api/metrics/tools")),
      safe("providers", null, () =>
        this.request<MetricsSnapshot["providers"]>("/api/metrics/providers")
      ),
      safe("timeSeries", null, () =>
        this.request<MetricsSnapshot["timeSeries"]>("/api/metrics/time-series")
      ),
      safe("models", null, () => this.request<MetricsSnapshot["models"]>("/api/metrics/models")),
      safe("insights", null, () =>
        this.request<MetricsSnapshot["insights"]>("/api/metrics/insights")
      ),
      safe("tokenAnalysis", null, () =>
        this.request<MetricsSnapshot["tokenAnalysis"]>("/api/metrics/token-analysis")
      ),
      safe("storage", null, () => this.request<MetricsSnapshot["storage"]>("/api/metrics/storage")),
    ]);

    return {
      overview,
      tokens,
      files,
      tools,
      providers,
      timeSeries,
      models,
      insights,
      tokenAnalysis,
      storage,
      availability,
    };
  }
}
