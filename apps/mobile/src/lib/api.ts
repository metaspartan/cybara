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
  oauthFlow?: string | null;
  hasOAuthConfig?: boolean;
  oauthLoginUrl?: string | null;
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

export interface ProviderOAuthStartResponse {
  auth_url: string;
  state: string;
  callback_port?: number;
}

export interface ProviderOAuthDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface ProviderOAuthPollResponse {
  status?: string;
  access_token?: string;
  error?: string;
}

export interface ProviderTestResult {
  success: boolean;
  provider?: string;
  message?: string;
  error?: string;
}

export interface MemoryEntrySummary {
  timestamp?: string;
  type?: string;
  content: string;
}

export interface MemoryFileSummary {
  file: string;
  entries: MemoryEntrySummary[];
}

export interface MemoryListResponse {
  files: string[];
  memories: MemoryFileSummary[];
}

export interface MemorySearchResult {
  file: string;
  entry: MemoryEntrySummary;
}

export interface MemoryCreateResponse {
  success: boolean;
  file: string;
  appended?: boolean;
}

export interface GatewaySuccessResponse {
  success: boolean;
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

export type WalletChain = "eth" | "btc" | "sol";
export type WalletTokenChain = "eth" | "sol";

export interface WalletSendPayload {
  chain: WalletChain;
  to: string;
  amount: string;
  index?: number;
  memo?: string;
}

export interface WalletSendTokenPayload {
  chain: WalletTokenChain;
  tokenAddress: string;
  to: string;
  amount: string;
  index?: number;
  decimals?: number;
  memo?: string;
}

export interface WalletSendResult {
  chain: WalletChain | WalletTokenChain;
  txid: string;
  explorerUrl?: string;
  tokenAddress?: string;
}

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
  "weighted" | "round_robin" | "lowest_cost" | "priority" | "mixture_of_agents";

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
  toolCallId?: string;
}

export interface MobilePendingChatMessage {
  id: string;
  sessionId: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  mode: "queued" | "steering";
  sequence: number;
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

export type MobileAgentStatus =
  "idle" | "thinking" | "tool_executing" | "tool_completed" | "generating" | "compacting" | "error";

export interface MobileStatusSessionSnapshot {
  sessionId: string;
  status: MobileAgentStatus | string;
  timestamp: number;
  detail?: string;
  agentId?: string;
  activities: SessionProcessActivitySummary[];
  pendingMessages?: MobilePendingChatMessage[];
}

export interface MobileStatusStreamStatusEvent {
  type: "status";
  status: MobileAgentStatus | string;
  timestamp: number;
  detail?: string;
  sessionId?: string;
  agentId?: string;
  toolName?: string;
  toolCallId?: string;
  toolPhase?: "start" | "result" | "error";
  durationMs?: number;
}

export interface MobileStatusStreamSnapshotEvent {
  type: "snapshot";
  timestamp: number;
  activeSessions: MobileStatusSessionSnapshot[];
  activeSessionIds: string[];
  count: number;
}

export interface MobileStatusStreamTokenEvent {
  type: "assistant_token";
  sessionId: string;
  agentId?: string;
  delta: string;
  timestamp: number;
}

export interface MobileStatusStreamTaskEvent {
  type: "task_completed";
  taskId: string;
  taskName: string;
  status: "completed" | "failed";
  sessionId?: string;
  resultPreview?: string;
  error?: string;
  timestamp?: number;
}

export type MobileStatusStreamEvent =
  | MobileStatusStreamStatusEvent
  | MobileStatusStreamSnapshotEvent
  | MobileStatusStreamTokenEvent
  | MobileStatusStreamTaskEvent;

export interface MobileSessionStatusResponse {
  activeSessions: MobileStatusSessionSnapshot[];
  activeSessionIds: string[];
  count: number;
  session?: MobileStatusSessionSnapshot | null;
  active?: boolean;
  sessionId?: string;
}

export interface MobileStatusStreamHandlers {
  onEvent: (event: MobileStatusStreamEvent) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: () => void;
}

type MobileWebSocket = WebSocket & {
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
};

type MobileWebSocketConstructor = new (url: string) => MobileWebSocket;

export interface MobileStatusStreamOptions {
  reconnectDelayMs?: number;
  WebSocketImpl?: MobileWebSocketConstructor;
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
  const list = normalizeMemoryList(value);
  if (list.memories.length === 0) {
    return list.files.map((file, index) => ({
      id: typeof file === "string" ? file : `memory-file-${index + 1}`,
      title: typeof file === "string" ? file : `Memory file ${index + 1}`,
      detail: "Memory file",
      type: "file",
      fields: [
        { label: "file", value: typeof file === "string" ? file : `memory-file-${index + 1}` },
      ],
    }));
  }
  return list.memories.map((memory, index) => {
    const file = memory.file || `memory-${index + 1}`;
    const entries = memory.entries;
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

export function normalizeMemoryEntry(value: unknown): MemoryEntrySummary {
  if (typeof value === "string") {
    return { content: value };
  }
  const record = asRecord(value);
  return {
    timestamp: readString(record, ["timestamp", "created_at", "createdAt", "time"]),
    type: readString(record, ["type", "kind"]),
    content: readString(record, ["content", "text", "body", "message"]) || "",
  };
}

export function normalizeMemoryList(value: unknown): MemoryListResponse {
  const record = asRecord(value);
  if (!record) {
    const entries = normalizeRemoteItems(value, ["memory", "items", "entries"], "memory");
    return {
      files: entries.map((entry) => entry.id),
      memories: entries.map((entry) => ({ file: entry.id, entries: [] })),
    };
  }

  const memories = normalizeArrayResponse(record.memories, ["memories"]).map((memory, index) => {
    const memoryRecord = asRecord(memory);
    const file = readString(memoryRecord, ["file", "name"]) || `memory-${index + 1}`;
    return {
      file,
      entries: normalizeArrayResponse(memoryRecord?.entries, ["entries"]).map(normalizeMemoryEntry),
    };
  });
  const files = normalizeArrayResponse(record.files, ["files"])
    .map((file, index) =>
      typeof file === "string"
        ? file
        : readString(asRecord(file), ["file", "name"]) || `memory-file-${index + 1}`
    )
    .filter((file) => file.length > 0);

  return {
    files: Array.from(new Set([...files, ...memories.map((memory) => memory.file)])),
    memories,
  };
}

export function normalizeMemorySearchResults(value: unknown): MemorySearchResult[] {
  return normalizeArrayResponse(value, ["results"]).map((result, index) => {
    const record = asRecord(result);
    const file = readString(record, ["file", "name"]) || `memory-${index + 1}`;
    return {
      file,
      entry: normalizeMemoryEntry(record?.entry ?? result),
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
      toolCallId: readString(record, ["toolCallId", "tool_call_id"]),
    };
  });
}

function normalizePendingChatMessages(value: unknown): MobilePendingChatMessage[] {
  const valueRecord = asRecord(value);
  const entries =
    valueRecord && (readString(valueRecord, ["id"]) || readString(valueRecord, ["content"]))
      ? [value]
      : normalizeArrayResponse(value, ["pendingMessages", "pending_messages", "items"]);
  return entries
    .map((entry, index) => {
      const record = asRecord(entry);
      const mode = readString(record, ["mode"]);
      const normalizedMode: MobilePendingChatMessage["mode"] =
        mode === "steering" ? "steering" : "queued";
      return {
        id: readString(record, ["id"]) || `pending-${index + 1}`,
        sessionId: readString(record, ["sessionId", "session_id"]) || "",
        content: readString(record, ["content", "message", "text"]) || "",
        createdAt: readNumber(record, ["createdAt", "created_at"]) ?? Date.now(),
        updatedAt: readNumber(record, ["updatedAt", "updated_at"]) ?? Date.now(),
        mode: normalizedMode,
        sequence: readNumber(record, ["sequence"]) ?? index + 1,
      };
    })
    .filter((entry) => entry.id.length > 0 && entry.content.trim().length > 0)
    .sort((a, b) => a.sequence - b.sequence || a.createdAt - b.createdAt);
}

function normalizeStatusSnapshot(
  value: unknown,
  fallbackIndex: number
): MobileStatusSessionSnapshot {
  const record = asRecord(value);
  const sessionId =
    readString(record, ["sessionId", "session_id"]) || `session-${fallbackIndex + 1}`;
  return {
    sessionId,
    status: readString(record, ["status"]) || "thinking",
    timestamp: readNumber(record, ["timestamp"]) ?? Date.now(),
    detail: readString(record, ["detail", "message", "text"]),
    agentId: readString(record, ["agentId", "agent_id"]),
    activities: normalizeProcessActivities(record?.activities) || [],
    pendingMessages: normalizePendingChatMessages(
      record?.pendingMessages ?? record?.pending_messages
    ),
  };
}

export function normalizeMobileStatusStreamEvent(value: unknown): MobileStatusStreamEvent | null {
  const record = asRecord(value);
  const type = readString(record, ["type"]);
  if (!record || !type) return null;

  if (type === "snapshot") {
    const activeSessions = normalizeArrayResponse(record.activeSessions, [
      "activeSessions",
      "active_sessions",
      "sessions",
    ]).map(normalizeStatusSnapshot);
    return {
      type,
      timestamp: readNumber(record, ["timestamp"]) ?? Date.now(),
      activeSessions,
      activeSessionIds: normalizeArrayResponse(record.activeSessionIds, [
        "activeSessionIds",
        "active_session_ids",
      ])
        .map((entry) => (typeof entry === "string" ? entry : ""))
        .filter(Boolean),
      count: readNumber(record, ["count"]) ?? activeSessions.length,
    };
  }

  if (type === "assistant_token") {
    const sessionId = readString(record, ["sessionId", "session_id"]);
    const delta = readString(record, ["delta", "text", "content"]);
    if (!sessionId || !delta) return null;
    return {
      type,
      sessionId,
      agentId: readString(record, ["agentId", "agent_id"]),
      delta,
      timestamp: readNumber(record, ["timestamp"]) ?? Date.now(),
    };
  }

  if (type === "task_completed") {
    return {
      type,
      taskId: readString(record, ["taskId", "task_id"]) || "task",
      taskName: readString(record, ["taskName", "task_name", "name"]) || "Task",
      status: readString(record, ["status"]) === "failed" ? "failed" : "completed",
      sessionId: readString(record, ["sessionId", "session_id"]),
      resultPreview: readString(record, ["resultPreview", "result_preview"]),
      error: readString(record, ["error"]),
      timestamp: readNumber(record, ["timestamp"]),
    };
  }

  if (type !== "status") return null;
  return {
    type,
    status: readString(record, ["status"]) || "thinking",
    timestamp: readNumber(record, ["timestamp"]) ?? Date.now(),
    detail: readString(record, ["detail", "message", "text"]),
    sessionId: readString(record, ["sessionId", "session_id"]),
    agentId: readString(record, ["agentId", "agent_id"]),
    toolName: readString(record, ["toolName", "tool_name"]),
    toolCallId: readString(record, ["toolCallId", "tool_call_id"]),
    toolPhase: readString(record, ["toolPhase", "tool_phase"]) as
      "start" | "result" | "error" | undefined,
    durationMs: readNumber(record, ["durationMs", "duration_ms"]),
  };
}

export function normalizeMobileSessionStatusResponse(value: unknown): MobileSessionStatusResponse {
  const record = asRecord(value);
  const activeSessions = normalizeArrayResponse(record?.activeSessions, [
    "activeSessions",
    "active_sessions",
    "sessions",
  ]).map(normalizeStatusSnapshot);
  const sessionRecord = record?.session;
  return {
    activeSessions,
    activeSessionIds: normalizeArrayResponse(record?.activeSessionIds, [
      "activeSessionIds",
      "active_session_ids",
    ])
      .map((entry) => (typeof entry === "string" ? entry : ""))
      .filter(Boolean),
    count: readNumber(record, ["count"]) ?? activeSessions.length,
    session: sessionRecord ? normalizeStatusSnapshot(sessionRecord, 0) : null,
    active: record?.active === true ? true : record?.active === false ? false : undefined,
    sessionId: readString(record, ["sessionId", "session_id"]),
  };
}

export function buildMobileStatusStreamUrl(profile: GatewayProfile): string {
  const url = new URL(profile.baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const rootPath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${rootPath}/api/ws/status`;
  url.search = "";
  url.searchParams.set("token", profile.apiKey);
  url.hash = "";
  return url.toString();
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
    const rawModels = (
      Array.isArray(record?.models) ? record.models : Array.isArray(info?.models) ? info.models : []
    ) as unknown[];
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
      oauthFlow:
        readString(record, ["oauthFlow", "oauth_flow"]) || readString(info, ["oauthFlow"]) || null,
      hasOAuthConfig:
        typeof record?.hasOAuthConfig === "boolean"
          ? record.hasOAuthConfig
          : typeof record?.has_oauth_config === "boolean"
            ? record.has_oauth_config
            : Boolean(info?.oauthConfig),
      oauthLoginUrl:
        readString(record, ["oauthLoginUrl", "oauth_login_url"]) ||
        readString(info, ["oauthLoginUrl"]) ||
        null,
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
  const moaAggregatorAgentId = readString(record, [
    "moaAggregatorAgentId",
    "moa_aggregator_agent_id",
  ]);
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

  statusStreamUrl(): string {
    return buildMobileStatusStreamUrl(this.profile);
  }

  connectStatusStream(
    handlers: MobileStatusStreamHandlers,
    options?: MobileStatusStreamOptions
  ): () => void {
    let socket: MobileWebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closedByUser = false;
    const reconnectDelayMs = Math.max(250, options?.reconnectDelayMs ?? 2000);
    const WebSocketImpl =
      options?.WebSocketImpl ??
      (globalThis as { WebSocket?: MobileWebSocketConstructor }).WebSocket;

    if (!WebSocketImpl) {
      handlers.onError?.();
      return () => {};
    }

    const clearReconnect = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const connect = () => {
      clearReconnect();
      try {
        socket = new WebSocketImpl(this.statusStreamUrl());
      } catch {
        handlers.onError?.();
        if (!closedByUser) {
          reconnectTimer = setTimeout(connect, reconnectDelayMs);
        }
        return;
      }

      socket.onopen = () => {
        handlers.onOpen?.();
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data));
          const normalized = normalizeMobileStatusStreamEvent(payload);
          if (normalized) handlers.onEvent(normalized);
        } catch {}
      };

      socket.onclose = () => {
        handlers.onClose?.();
        if (!closedByUser) {
          reconnectTimer = setTimeout(connect, reconnectDelayMs);
        }
      };

      socket.onerror = () => {
        handlers.onError?.();
        try {
          socket?.close();
        } catch {}
      };
    };

    connect();

    return () => {
      closedByUser = true;
      clearReconnect();
      try {
        socket?.close();
      } catch {}
      socket = null;
    };
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

  async sessionStatus(id?: string): Promise<MobileSessionStatusResponse> {
    const query = id ? `?sessionId=${encodeURIComponent(id)}` : "";
    return normalizeMobileSessionStatusResponse(
      await this.request<unknown>(`/api/status/sessions${query}`)
    );
  }

  async pendingChatMessages(sessionId: string): Promise<{
    sessionId: string;
    pendingMessages: MobilePendingChatMessage[];
  }> {
    const response = await this.request<unknown>(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/pending`
    );
    const record = asRecord(response);
    return {
      sessionId: readString(record, ["sessionId", "session_id"]) || sessionId,
      pendingMessages: normalizePendingChatMessages(
        record?.pendingMessages ?? record?.pending_messages
      ),
    };
  }

  async sendChat(input: {
    message: string;
    sessionId?: string;
    agentId?: string;
    workspaceDir?: string | null;
    queueMode?: "queue" | "steer";
  }): Promise<{
    sessionId: string;
    message: SessionMessageSummary;
    workspaceDir?: string | null;
    queued?: boolean;
    interrupted?: boolean;
    pendingMessage?: MobilePendingChatMessage;
    pendingMessages?: MobilePendingChatMessage[];
  }> {
    const response = await this.request<unknown>("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        message: input.message,
        sessionId: input.sessionId,
        agentId: input.agentId,
        workspaceDir: input.workspaceDir,
        queueMode: input.queueMode,
      }),
    });
    const record = asRecord(response);
    const messageRecord = asRecord(record?.message);
    const thinking = readString(messageRecord, ["thinking"]) || readString(record, ["thinking"]);
    return {
      sessionId: readString(record, ["sessionId"]) || input.sessionId || "",
      workspaceDir: readString(record, ["workspaceDir"]) || input.workspaceDir,
      queued: record?.queued === true,
      interrupted: record?.interrupted === true,
      pendingMessage: normalizePendingChatMessages(record?.pendingMessage)[0],
      pendingMessages: normalizePendingChatMessages(record?.pendingMessages),
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

  async reorderPendingMessages(
    sessionId: string,
    pendingMessageIds: string[]
  ): Promise<{
    success: boolean;
    pendingMessages?: MobilePendingChatMessage[];
    error?: string;
  }> {
    const response = await this.request<unknown>(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/pending/reorder`,
      {
        method: "POST",
        body: JSON.stringify({ pendingMessageIds }),
      }
    );
    const record = asRecord(response);
    return {
      success: record?.success === true,
      pendingMessages: normalizePendingChatMessages(record?.pendingMessages),
      error: readString(record, ["error"]),
    };
  }

  async steerPendingMessage(
    sessionId: string,
    pendingMessageId: string
  ): Promise<{
    success: boolean;
    pendingMessage?: MobilePendingChatMessage;
    pendingMessages?: MobilePendingChatMessage[];
    error?: string;
  }> {
    const response = await this.request<unknown>(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/pending/${encodeURIComponent(
        pendingMessageId
      )}/steer`,
      { method: "POST" }
    );
    const record = asRecord(response);
    return {
      success: record?.success === true,
      pendingMessage: normalizePendingChatMessages(record?.pendingMessage)[0],
      pendingMessages: normalizePendingChatMessages(record?.pendingMessages),
      error: readString(record, ["error"]),
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
    return this.request<{ success?: boolean }>(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  revertSession(
    id: string,
    payload: {
      messageIndex?: number;
      messageRole?: string;
      messageContent?: string;
      messageTimestamp?: string;
    }
  ): Promise<{ success: boolean; keptCount?: number; removedCount?: number; error?: string }> {
    return this.request<{
      success: boolean;
      keptCount?: number;
      removedCount?: number;
      error?: string;
    }>(`/api/sessions/${encodeURIComponent(id)}/revert`, {
      method: "POST",
      body: JSON.stringify(payload),
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

  startProviderOAuth(providerType: string): Promise<ProviderOAuthStartResponse> {
    return this.request<ProviderOAuthStartResponse>("/api/providers/oauth/start", {
      method: "POST",
      body: JSON.stringify({ providerType }),
    });
  }

  providerOAuthCallbackStatus(state: string): Promise<ProviderOAuthPollResponse> {
    return this.request<ProviderOAuthPollResponse>("/api/providers/oauth/callback-status", {
      method: "POST",
      body: JSON.stringify({ state }),
    });
  }

  startProviderDeviceCodeOAuth(providerType: string): Promise<ProviderOAuthDeviceCodeResponse> {
    return this.request<ProviderOAuthDeviceCodeResponse>("/api/providers/oauth/device-code", {
      method: "POST",
      body: JSON.stringify({ providerType }),
    });
  }

  pollProviderDeviceCodeOAuth(
    providerType: string,
    deviceCode: string
  ): Promise<ProviderOAuthPollResponse> {
    return this.request<ProviderOAuthPollResponse>("/api/providers/oauth/poll", {
      method: "POST",
      body: JSON.stringify({ providerType, deviceCode }),
    });
  }

  openUrlOnGateway(url: string): Promise<{ ok?: boolean }> {
    return this.request<{ ok?: boolean }>("/api/open-url", {
      method: "POST",
      body: JSON.stringify({ url }),
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

  testMemoryProvider(
    provider: string,
    settings?: Record<string, unknown>
  ): Promise<{ success: boolean; provider: string; ok: boolean; detail: string }> {
    return this.request<{ success: boolean; provider: string; ok: boolean; detail: string }>(
      "/api/memory/providers/test",
      { method: "POST", body: JSON.stringify({ provider, settings }) }
    );
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

  async memoryList(): Promise<MemoryListResponse> {
    return normalizeMemoryList(await this.request<unknown>("/api/memory"));
  }

  async searchMemory(query: string): Promise<MemorySearchResult[]> {
    return normalizeMemorySearchResults(
      await this.request<unknown>(`/api/memory/search?query=${encodeURIComponent(query)}`)
    );
  }

  createMemory(file: string, content: string): Promise<MemoryCreateResponse> {
    return this.request<MemoryCreateResponse>("/api/memory", {
      method: "POST",
      body: JSON.stringify({ file, content }),
    });
  }

  updateMemory(file: string, index: number, content: string): Promise<GatewaySuccessResponse> {
    return this.request<GatewaySuccessResponse>(`/api/memory/${encodeURIComponent(file)}`, {
      method: "PUT",
      body: JSON.stringify({ index, content }),
    });
  }

  deleteMemory(file: string, index?: number): Promise<GatewaySuccessResponse> {
    return this.request<GatewaySuccessResponse>(`/api/memory/${encodeURIComponent(file)}`, {
      method: "DELETE",
      body: index === undefined ? undefined : JSON.stringify({ index }),
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

  sendWallet(payload: WalletSendPayload): Promise<WalletSendResult> {
    return this.request<WalletSendResult>("/api/wallet/send", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  sendWalletToken(payload: WalletSendTokenPayload): Promise<WalletSendResult> {
    return this.request<WalletSendResult>("/api/wallet/send-token", {
      method: "POST",
      body: JSON.stringify(payload),
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
