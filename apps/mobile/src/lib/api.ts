import type { GatewayProfile } from "./connection";
import { emptyMetricsAvailability, type MetricsEndpointKey, type MetricsSnapshot } from "./metrics";

export interface HealthResponse {
  status: string;
  version?: string;
  uptime: number;
  timestamp: string;
  checks?: Record<string, { status: string; total?: number; running?: number; stopped?: number }>;
}

export interface SessionSummary {
  id: string;
  title: string | null;
  agent_id?: string;
  message_count: number;
  created_at?: string;
  updated_at: string;
  workspace_dir?: string | null;
  pinned?: boolean;
  last_message?: { role: string; content: string } | null;
}

export interface AgentSummary {
  id: string;
  name: string;
  type?: string;
  status?: string;
  model?: string;
}

export interface ProviderSummary {
  id: string;
  name: string;
  provider: string;
  is_default?: boolean;
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

export interface SessionToolCallSummary {
  id: string;
  name: string;
  status: string;
  detail?: string;
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
  workspaceDir?: string | null;
  createdAt?: string;
  updatedAt?: string;
  pinned?: boolean;
  messages: SessionMessageSummary[];
}

export interface FeatureSummary {
  health: HealthResponse | null;
  sessions: SessionSummary[];
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
    const status = readString(record, ["status", "state"]) || undefined;
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
        source: "activity",
        entry,
      }));

  return sourceArrays.map(({ source, entry }, index) => {
    const item = asRecord(entry);
    const createdAt = readString(item, ["created_at", "createdAt", "timestamp", "time"]);
    const message =
      readString(item, ["message", "content", "event", "action", "level"]) ||
      `${source} event ${index + 1}`;
    const actor = readString(item, ["agent_id", "session_id", "channel_id", "source"]);
    return {
      id: readString(item, ["id"]) || `${source}-${index + 1}`,
      title: message,
      detail: actor || source,
      source,
      createdAt,
      fields: detailFields(item),
    };
  });
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
  return calls.slice(0, 12).map((call, index) => {
    const record = asRecord(call);
    const name = readString(record, ["name", "toolName"]) || `tool ${index + 1}`;
    const status = readString(record, ["status", "state"]) || "completed";
    return {
      id: readString(record, ["id", "toolCallId"]) || `${name}-${index + 1}`,
      name,
      status,
      detail: describeValue(record?.result ?? record?.error ?? record?.args),
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

function normalizeAgents(value: unknown): AgentSummary[] {
  return normalizeArrayResponse(value, ["agents", "items"]).map((agent, index) => {
    const record = asRecord(agent);
    const id = readString(record, ["id", "name"]) || `agent-${index + 1}`;
    return {
      id,
      name: readString(record, ["name", "label", "id"]) || id,
      type: readString(record, ["type"]),
      status: readString(record, ["status", "state"]),
      model: readString(record, ["model"]),
    };
  });
}

function normalizeProviders(value: unknown): ProviderSummary[] {
  return normalizeArrayResponse(value, ["providers", "items"]).map((provider, index) => {
    const record = asRecord(provider);
    const id = readString(record, ["id", "provider", "name"]) || `provider-${index + 1}`;
    return {
      id,
      name: readString(record, ["name", "label", "provider"]) || id,
      provider: readString(record, ["provider", "type"]) || "provider",
      is_default: Boolean(record?.is_default || record?.isDefault),
    };
  });
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

  async sessions(): Promise<SessionSummary[]> {
    return normalizeSessions(await this.request<unknown>("/api/chat/sessions"));
  }

  async session(id: string): Promise<SessionDetailSummary> {
    return normalizeSessionDetail(
      await this.request<unknown>(`/api/chat/sessions/${encodeURIComponent(id)}`),
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

  async providers(): Promise<ProviderSummary[]> {
    return normalizeProviders(await this.request<unknown>("/api/providers"));
  }

  config(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/config");
  }

  updateConfig(data: Record<string, unknown>): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>("/api/config", {
      method: "PUT",
      body: JSON.stringify(data),
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
      sessions,
      agents,
      providers,
      channels,
      tasks,
      tools,
      approvals,
      walletStatus,
      walletPolicy,
      memory,
      logs,
      config,
    ] = await Promise.all([
      safe<HealthResponse | null>("health", null, () => this.health()),
      safe<SessionSummary[]>("sessions", [], () => this.sessions()),
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
      safe<ActivitySummary[]>("logs", [], async () =>
        normalizeActivityLogs(await this.request<unknown>("/api/logs/activity"))
      ),
      safe<Record<string, unknown>>("config", {}, () => this.config()),
    ]);

    return {
      health,
      sessions,
      agents,
      providers,
      channels,
      tasks,
      tools,
      approvals,
      walletStatus,
      walletPolicy,
      memory,
      logs,
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
