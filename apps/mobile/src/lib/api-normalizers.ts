import type {
  ActivityLogPage,
  ActivitySummary,
  AgentSummary,
  AgentTransferSummary,
  FeatureAvailability,
  JourneyResponse,
  MemoryEntrySummary,
  MemoryListResponse,
  MemorySearchResult,
  MobileMessageImage,
  MobilePendingChatMessage,
  MobileSessionGoal,
  MobileSessionGoalStatus,
  MobileSessionStatusResponse,
  MobileStatusSessionSnapshot,
  MobileStatusStreamEvent,
  ProviderSummary,
  RemoteItemSummary,
  RouterConfig,
  RouterRouteConfig,
  RouterStatus,
  RouterStrategy,
  SessionContextUsage,
  SessionDetailSummary,
  SessionListPage,
  SessionPlanItemPriority,
  SessionPlanItemStatus,
  SessionPlanItemSummary,
  SessionPlanSnapshot,
  SessionProcessActivitySummary,
  SessionSummary,
  SessionTokenUsage,
  SessionToolCallSummary,
  SessionRoomConfig,
} from "./api-types";
import { createWebSocketAuthProtocol } from "cybara-shared/websocket-auth";
import {
  asRecord,
  normalizeArrayResponse,
  readBoolean,
  readNumber,
  readString,
} from "./apiNormalizeUtils";
import { normalizeProviderPlanRouteConstraint } from "./apiProviderPlans";
import type { GatewayProfile } from "./connection";

const MOBILE_SESSION_LIST_LIMIT = 100;
const MOBILE_LOG_LIST_LIMIT = 150;

const MOBILE_SESSION_GOAL_STATUSES: MobileSessionGoalStatus[] = [
  "active",
  "paused",
  "blocked",
  "complete",
];

export function emptyAvailability(): FeatureAvailability {
  return {
    health: { ok: false },
    sessions: { ok: false },
    agents: { ok: false },
    providers: { ok: false },
    skills: { ok: false },
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
      } catch {}
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

const MOBILE_IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|gif|webp)$/i;

function resolveToolMediaFile(record: Record<string, unknown> | null): {
  filePath?: string;
  contentType?: string;
} {
  const result = readRecord(record, ["result", "output"]);
  const filePath =
    readString(result, ["filePath", "file_path", "path"]) ||
    readString(record, ["filePath", "file_path"]);
  const contentType =
    readString(result, ["contentType", "content_type", "mimeType", "mime_type"]) ||
    readString(record, ["contentType", "content_type"]);
  if (!filePath) return {};
  const isImage = contentType
    ? contentType.startsWith("image/")
    : MOBILE_IMAGE_EXTENSION_PATTERN.test(filePath);
  if (!isImage) return {};
  return { filePath, contentType: contentType || undefined };
}

export function normalizeMessageImages(value: unknown): MobileMessageImage[] | undefined {
  const items = normalizeArrayResponse(value, ["images", "items"]);
  if (items.length === 0) return undefined;
  const images = items
    .slice(0, 8)
    .map((item) => {
      const record = asRecord(item);
      return {
        url: readString(record, ["url"]) || undefined,
        data: readString(record, ["data", "base64"]) || undefined,
        mimeType:
          readString(record, ["mimeType", "mime_type", "contentType", "content_type"]) || undefined,
      };
    })
    .filter((image) => Boolean(image.url || image.data));
  return images.length > 0 ? images : undefined;
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
    const itemConfig = asRecord(record?.config);
    const agentId = readString(itemConfig, ["agent_id", "agentId"]);
    const useModelRouter = readBoolean(itemConfig, ["use_model_router", "useModelRouter"]);
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
      agentId,
      useModelRouter,
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
        {
          label: "file",
          value: typeof file === "string" ? file : `memory-file-${index + 1}`,
        },
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

export function normalizeJourney(value: unknown): JourneyResponse {
  const record = asRecord(value);
  const events = normalizeArrayResponse(record?.events, ["events"]).map((raw, index) => {
    const eventRecord = asRecord(raw);
    const kind = readString(eventRecord, ["kind"]) === "skill" ? "skill" : "memory";
    return {
      id: readString(eventRecord, ["id"]) || `journey-${index}`,
      kind: kind as "skill" | "memory",
      title: readString(eventRecord, ["title"]) || "",
      detail: readString(eventRecord, ["detail"]) || "",
      category: readString(eventRecord, ["category"]) || "",
      createdAt: readString(eventRecord, ["createdAt"]) || "",
      createdAtMs: readNumber(eventRecord, ["createdAtMs"]) || 0,
    };
  });
  const countsRecord = asRecord(record?.counts);
  const skills =
    readNumber(countsRecord, ["skills"]) ?? events.filter((e) => e.kind === "skill").length;
  const memories = readNumber(countsRecord, ["memories"]) ?? events.length - skills;
  return {
    events,
    counts: {
      skills,
      memories,
      total: readNumber(countsRecord, ["total"]) ?? events.length,
    },
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
        normalizeArrayResponse(entries, ["items", "entries"]).map((entry) => ({
          source,
          entry,
        }))
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

export function normalizeRecentActivityLogs(value: unknown): ActivitySummary[] {
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

export function normalizeActivityLogPage(
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
        use_model_router: record?.use_model_router === true || record?.useModelRouter === true,
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
          | SessionSummary["last_message"]
          | null,
        room: normalizeSessionRoomConfig(record?.room),
      };
    })
  );
}

export function normalizeSessionListPage(
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

export function latestSessionSummary(sessions: SessionSummary[]): SessionSummary | undefined {
  return sessions.reduce<SessionSummary | undefined>((latest, session) => {
    if (!latest) return session;
    return sessionSortTimestampMs(session) > sessionSortTimestampMs(latest) ? session : latest;
  }, undefined);
}

export function normalizeSessionDetail(value: unknown, fallbackId: string): SessionDetailSummary {
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
      workedDurationMs: readNumber(messageRecord, ["worked_duration_ms", "workedDurationMs"]),
      thinking: readString(messageRecord, ["thinking"]),
      agentId: readString(messageRecord, ["agent_id", "agentId"]),
      agentName: readString(messageRecord, ["agent_name", "agentName"]),
      model: readString(messageRecord, ["model"]),
      toolCalls: normalizeMessageToolCalls(messageRecord?.tool_calls ?? messageRecord?.toolCalls),
      processActivities: normalizeProcessActivities(
        messageRecord?.process_activities ?? messageRecord?.processActivities
      ),
      agentTransfers: normalizeAgentTransfers(
        messageRecord?.agent_transfers ?? messageRecord?.agentTransfers
      ),
      images: normalizeMessageImages(messageRecord?.images),
    };
  });

  return {
    id: readString(record, ["id", "session_id"]) || fallbackId,
    title: readString(record, ["title", "name"]) || null,
    agentId: readString(record, ["agent_id", "agentId"]),
    useModelRouter: record?.use_model_router === true || record?.useModelRouter === true,
    provider: readString(record, ["provider"]),
    providerId: readString(record, ["provider_id", "providerId"]),
    providerName: readString(record, ["provider_name", "providerName"]),
    model: readString(record, ["model"]),
    workspaceDir: readString(record, ["workspace_dir", "workspaceDir"]) || null,
    createdAt: readString(record, ["created_at", "createdAt"]),
    updatedAt: readString(record, ["updated_at", "updatedAt", "created_at", "createdAt"]),
    pinned: record?.pinned === true,
    contextUsage: normalizeSessionContextUsage(record?.contextUsage ?? record?.context_usage),
    tokenUsage: normalizeSessionTokenUsage(record?.tokenUsage ?? record?.token_usage),
    plan: normalizeSessionPlan(record?.plan),
    room: normalizeSessionRoomConfig(record?.room),
    messages,
  };
}

export function normalizeSessionRoomConfig(value: unknown): SessionRoomConfig | null {
  const record = asRecord(value);
  if (!record) return null;
  const participants = normalizeArrayResponse(
    record.participant_agent_ids ?? record.participantAgentIds,
    []
  ).filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  if (participants.length === 0) return null;
  const mode = readString(record, ["mode"]);
  return {
    participant_agent_ids: participants,
    mode:
      mode === "mention_only" || mode === "parallel" || mode === "moderated" ? mode : "round_robin",
    max_rounds: readNumber(record, ["max_rounds", "maxRounds"]) ?? 1,
    moderator_agent_id: readString(record, ["moderator_agent_id", "moderatorAgentId"]) || null,
    shared_context: readString(record, ["shared_context", "sharedContext"]) || "",
  };
}

export function normalizeMobileSessionGoal(value: unknown): MobileSessionGoal | null {
  const response = asRecord(value);
  const record = asRecord(response?.goal ?? value);
  if (!record) return null;
  const sessionId = readString(record, ["sessionId", "session_id"]);
  const objective = readString(record, ["objective"])?.trim();
  const statusValue = readString(record, ["status"]);
  const createdAt = readString(record, ["createdAt", "created_at"]);
  const updatedAt = readString(record, ["updatedAt", "updated_at"]);
  if (
    !sessionId ||
    !objective ||
    !statusValue ||
    !MOBILE_SESSION_GOAL_STATUSES.includes(statusValue as MobileSessionGoalStatus) ||
    !createdAt ||
    !updatedAt
  ) {
    return null;
  }
  const loopRecord = asRecord(record.loop);
  const iterations = readNumber(loopRecord, ["iterations"]);
  const consecutiveFailures = readNumber(loopRecord, [
    "consecutiveFailures",
    "consecutive_failures",
  ]);
  return {
    sessionId,
    objective,
    status: statusValue as MobileSessionGoalStatus,
    createdAt,
    updatedAt,
    lastStatusNote: readString(record, ["lastStatusNote", "last_status_note"]),
    activeMs: readNumber(record, ["activeMs", "active_ms"]),
    lastResumedAt: readString(record, ["lastResumedAt", "last_resumed_at"]),
    loop:
      loopRecord && iterations !== undefined && consecutiveFailures !== undefined
        ? {
            iterations: Math.max(0, Math.floor(iterations)),
            stoppedReason: readString(loopRecord, ["stoppedReason", "stopped_reason"]) ?? null,
            consecutiveFailures: Math.max(0, Math.floor(consecutiveFailures)),
          }
        : null,
  };
}

function normalizeSessionPlan(value: unknown): SessionPlanSnapshot | null {
  const record = asRecord(value);
  if (!record) return null;
  const items = normalizeArrayResponse(record?.items, ["items"])
    .map((item) => {
      const itemRecord = asRecord(item);
      const content = readString(itemRecord, ["content", "text", "title"])?.trim();
      if (!content) return null;
      const rawStatus = readString(itemRecord, ["status"]);
      const status: SessionPlanItemStatus =
        rawStatus === "completed"
          ? "completed"
          : rawStatus === "cancelled" || rawStatus === "canceled"
            ? "cancelled"
            : rawStatus === "in_progress" || rawStatus === "active"
              ? "in_progress"
              : "pending";
      const rawPriority = readString(itemRecord, ["priority"]);
      const priority: SessionPlanItemPriority =
        rawPriority === "high" || rawPriority === "low" ? rawPriority : "medium";
      return {
        content: content.slice(0, 500),
        status,
        priority,
      };
    })
    .filter((item): item is SessionPlanItemSummary => item !== null)
    .slice(0, 50);
  if (items.length === 0) return null;
  const summaryRecord = asRecord(record?.summary);
  const cancelledCount = items.filter((item) => item.status === "cancelled").length;
  const computedSummary = {
    total: items.length - cancelledCount,
    pending: items.filter((item) => item.status === "pending").length,
    inProgress: items.filter((item) => item.status === "in_progress").length,
    completed: items.filter((item) => item.status === "completed").length,
    cancelled: cancelledCount,
  };
  return {
    sessionId: readString(record, ["sessionId", "session_id"]) || "",
    items,
    summary: {
      total: readNumber(summaryRecord, ["total"]) ?? computedSummary.total,
      pending: readNumber(summaryRecord, ["pending"]) ?? computedSummary.pending,
      inProgress:
        readNumber(summaryRecord, ["inProgress", "in_progress"]) ?? computedSummary.inProgress,
      completed: readNumber(summaryRecord, ["completed"]) ?? computedSummary.completed,
      cancelled: readNumber(summaryRecord, ["cancelled"]) ?? computedSummary.cancelled,
    },
    updatedAt: readString(record, ["updatedAt", "updated_at"]),
    source: readString(record, ["source"]),
  };
}

export function normalizeSessionContextUsage(value: unknown): SessionContextUsage | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const limitTokens = readNumber(record, ["limitTokens", "limit_tokens"]);
  if (!limitTokens || limitTokens <= 0) return undefined;
  const usedTokens = Math.max(0, readNumber(record, ["usedTokens", "used_tokens"]) ?? 0);
  const remainingTokens = Math.max(
    0,
    readNumber(record, ["remainingTokens", "remaining_tokens"]) ?? limitTokens - usedTokens
  );
  const usedPercent =
    readNumber(record, ["usedPercent", "used_percent"]) ??
    Math.min(100, Math.round((usedTokens / limitTokens) * 1000) / 10);
  return {
    usedTokens,
    limitTokens,
    remainingTokens,
    usedPercent,
    messageCount: Math.max(0, readNumber(record, ["messageCount", "message_count"]) ?? 0),
    transcriptTokens: readNumber(record, ["transcriptTokens", "transcript_tokens"]),
    metadataTokens: readNumber(record, ["metadataTokens", "metadata_tokens"]),
    compacted: readBoolean(record, ["compacted"]),
    compactionCount: readNumber(record, ["compactionCount", "compaction_count"]),
    compactedTokens: readNumber(record, ["compactedTokens", "compacted_tokens"]),
    source: readString(record, ["source"]) === "estimated" ? "estimated" : undefined,
  };
}

export function normalizeSessionTokenUsage(value: unknown): SessionTokenUsage | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const totalTokens = Math.max(0, readNumber(record, ["totalTokens", "total_tokens"]) ?? 0);
  const inputTokens = Math.max(0, readNumber(record, ["inputTokens", "input_tokens"]) ?? 0);
  const outputTokens = Math.max(0, readNumber(record, ["outputTokens", "output_tokens"]) ?? 0);
  if (totalTokens <= 0 && inputTokens <= 0 && outputTokens <= 0) return undefined;
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens: Math.max(
      0,
      readNumber(record, ["cachedInputTokens", "cached_input_tokens"]) ?? 0
    ),
    cacheWriteTokens: Math.max(
      0,
      readNumber(record, ["cacheWriteTokens", "cache_write_tokens"]) ?? 0
    ),
    cacheHitRate: readNumber(record, ["cacheHitRate", "cache_hit_rate"]) ?? null,
    totalTokens: Math.max(totalTokens, inputTokens + outputTokens),
    callCount: Math.max(0, readNumber(record, ["callCount", "call_count"]) ?? 0),
    durationMs: Math.max(0, readNumber(record, ["durationMs", "duration_ms"]) ?? 0),
    tokensPerSecond: readNumber(record, ["tokensPerSecond", "tokens_per_second"]) ?? null,
    firstTokenMs: readNumber(record, ["firstTokenMs", "first_token_ms"]) ?? null,
    source: readString(record, ["source"]) === "metrics" ? "metrics" : undefined,
  };
}

export function normalizeMessageToolCalls(value: unknown): SessionToolCallSummary[] | undefined {
  const calls = normalizeArrayResponse(value, ["tool_calls", "toolCalls", "items"]);
  if (calls.length === 0) return undefined;
  return calls.map((call, index) => {
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
    const media = resolveToolMediaFile(record);
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
      filePath: media.filePath,
      contentType: media.contentType,
    };
  });
}

export function normalizeProcessActivities(
  value: unknown
): SessionProcessActivitySummary[] | undefined {
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

export function normalizeAgentTransfers(value: unknown): AgentTransferSummary[] | undefined {
  const transfers = normalizeArrayResponse(value, ["agent_transfers", "agentTransfers", "items"]);
  const normalized = transfers.flatMap((transfer) => {
    const record = asRecord(transfer);
    const fromAgentId = readString(record, ["fromAgentId", "from_agent_id"]);
    const fromAgentName = readString(record, ["fromAgentName", "from_agent_name"]);
    const toAgentId = readString(record, ["toAgentId", "to_agent_id"]);
    const toAgentName = readString(record, ["toAgentName", "to_agent_name"]);
    const reason = readString(record, ["reason"]);
    if (!fromAgentId || !fromAgentName || !toAgentId || !toAgentName || !reason) return [];
    const rawMode = readString(record, ["contextMode", "context_mode"]);
    const contextMode: AgentTransferSummary["contextMode"] =
      rawMode === "recent" || rawMode === "summary" ? rawMode : "full";
    return [
      {
        fromAgentId,
        fromAgentName,
        toAgentId,
        toAgentName,
        reason,
        contextMode,
        contextSummary: readString(record, ["contextSummary", "context_summary"]),
        requestedAt: readString(record, ["requestedAt", "requested_at"]),
      },
    ];
  });
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizePendingChatMessages(value: unknown): MobilePendingChatMessage[] {
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
        clientPendingId: readString(record, ["clientPendingId", "client_pending_id"]),
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
    runId: readString(record, ["runId", "run_id"]),
    sequence: readNumber(record, ["sequence"]),
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
      runId: readString(record, ["runId", "run_id"]),
      sequence: readNumber(record, ["sequence"]),
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

  if (type === "session_message") {
    const sessionId = readString(record, ["sessionId", "session_id"]);
    if (!sessionId) return null;
    const role = readString(record, ["role"]);
    return {
      type,
      sessionId,
      agentId: readString(record, ["agentId", "agent_id"]),
      agentName: readString(record, ["agentName", "agent_name"]),
      role: role === "user" || role === "system" ? role : "assistant",
      timestamp: readNumber(record, ["timestamp"]) ?? Date.now(),
    };
  }

  if (type !== "status") return null;
  return {
    type,
    runId: readString(record, ["runId", "run_id"]),
    sequence: readNumber(record, ["sequence"]),
    status: readString(record, ["status"]) || "thinking",
    timestamp: readNumber(record, ["timestamp"]) ?? Date.now(),
    detail: readString(record, ["detail", "message", "text"]),
    sessionId: readString(record, ["sessionId", "session_id"]),
    agentId: readString(record, ["agentId", "agent_id"]),
    toolName: readString(record, ["toolName", "tool_name"]),
    toolCallId: readString(record, ["toolCallId", "tool_call_id"]),
    toolPhase: readString(record, ["toolPhase", "tool_phase"]) as
      | "start"
      | "result"
      | "error"
      | undefined,
    durationMs: readNumber(record, ["durationMs", "duration_ms"]),
    pendingChatId: readString(record, ["pendingChatId", "pending_chat_id"]),
    clientPendingId: readString(record, ["clientPendingId", "client_pending_id"]),
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

export function buildMobileMediaUrl(profile: GatewayProfile, filePath: string): string {
  const basename = filePath.split(/[\\/]/).pop() || filePath;
  const url = new URL(profile.baseUrl);
  const rootPath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${rootPath}/api/media`;
  url.search = "";
  url.searchParams.set("path", `screenshots/${basename}`);
  url.searchParams.set("token", profile.apiKey);
  url.hash = "";
  return url.toString();
}

export function buildMobileStatusStreamUrl(profile: GatewayProfile): string {
  const url = new URL(profile.baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const rootPath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${rootPath}/api/ws/status`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function buildMobileStatusStreamAuthProtocol(profile: GatewayProfile): string | null {
  return createWebSocketAuthProtocol({
    token: profile.apiKey,
    password: profile.gatewayPassword,
  });
}

function normalizeAgentConfig(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return asRecord(value) ?? {};
  try {
    return asRecord(JSON.parse(value)) ?? {};
  } catch {
    return {};
  }
}

export function normalizeAgent(agent: unknown, index = 0): AgentSummary {
  const record = asRecord(agent) ?? {};
  const id = readString(record, ["id", "name"]) || `agent-${index + 1}`;
  const providerId = readString(record, ["provider_id", "providerId", "provider"]);
  const providerType = readString(record, ["provider_type", "providerType"]);
  const config = normalizeAgentConfig(record.config);
  const modelParams = asRecord(config.model_params ?? config.modelParams) ?? {};
  const reasoningEffort =
    readString(record, ["reasoning_effort", "reasoningEffort"]) ??
    readString(modelParams, ["reasoning_effort", "reasoningEffort"]);
  const reasoningModeValue = readString(record, ["reasoning_mode", "reasoningMode"]);
  const reasoningMode =
    reasoningModeValue === "adaptive" ||
    reasoningModeValue === "binary" ||
    reasoningModeValue === "effort"
      ? reasoningModeValue
      : undefined;
  const imageInputModeValue = readString(record, ["image_input_mode", "imageInputMode"]);
  const imageInputMode =
    imageInputModeValue === "auto" ||
    imageInputModeValue === "enabled" ||
    imageInputModeValue === "disabled"
      ? imageInputModeValue
      : undefined;
  const rawReasoningEfforts = record.reasoning_efforts ?? record.reasoningEfforts;
  const reasoningEfforts = Array.isArray(rawReasoningEfforts)
    ? rawReasoningEfforts.flatMap((value) =>
        typeof value === "string" &&
        ["minimal", "low", "medium", "high", "xhigh", "max"].includes(value)
          ? [value as NonNullable<AgentSummary["reasoning_efforts"]>[number]]
          : []
      )
    : undefined;
  return {
    id,
    name: readString(record, ["name", "label", "id"]) || id,
    type: readString(record, ["type"]),
    status: readString(record, ["status", "state"]),
    model: readString(record, ["model"]),
    provider: providerId,
    provider_id: providerId,
    provider_type: providerType,
    system_prompt: readString(record, ["system_prompt", "systemPrompt"]),
    reasoning_effort: ["minimal", "low", "medium", "high", "xhigh", "max"].includes(
      reasoningEffort ?? ""
    )
      ? (reasoningEffort as AgentSummary["reasoning_effort"])
      : null,
    reasoning_mode: reasoningMode,
    reasoning_efforts: reasoningEfforts,
    image_input_mode: imageInputMode,
    supports_images: readBoolean(record, ["supports_images", "supportsImages"]),
    is_bot: readBoolean(record, ["is_bot", "isBot"]),
    config,
  };
}

export function normalizeAgents(value: unknown): AgentSummary[] {
  return normalizeArrayResponse(value, ["agents", "items"]).map((agent, index) =>
    normalizeAgent(agent, index)
  );
}

export function normalizeProviders(value: unknown): ProviderSummary[] {
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

export function normalizeProviderHealth(value: unknown): Map<string, Partial<ProviderSummary>> {
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
    value === "usage_aware" ||
    value === "weighted"
    ? value
    : "weighted";
}

export function normalizeRouterConfig(value: unknown): RouterConfig {
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

export function normalizeRouterStatus(value: unknown): RouterStatus {
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
        plan: normalizeProviderPlanRouteConstraint(routeRecord?.plan),
      };
    }),
  };
}
