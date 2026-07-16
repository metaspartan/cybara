import type { GatewayProfile } from "./connection";
import { emptyMetricsAvailability, type MetricsEndpointKey, type MetricsSnapshot } from "./metrics";
import { asRecord, normalizeArrayResponse, readString } from "./apiNormalizeUtils";
import {
  normalizeProviderPlanMonitoringConfig,
  normalizeProviderPlanStatus,
  type ProviderPlanMonitoringConfig,
  type ProviderPlanStatusResponse,
} from "./apiProviderPlans";
import {
  buildMobileMediaUrl,
  buildMobileStatusStreamUrl,
  emptyAvailability,
  normalizeActivityLogPage,
  normalizeAgent,
  normalizeAgentTransfers,
  normalizeAgents,
  normalizeJourney,
  normalizeMemoryItems,
  normalizeMemoryList,
  normalizeMemorySearchResults,
  normalizeMessageImages,
  normalizeMessageToolCalls,
  normalizeMobileSessionStatusResponse,
  normalizeMobileStatusStreamEvent,
  normalizePendingChatMessages,
  normalizeProcessActivities,
  normalizeProviderHealth,
  normalizeProviders,
  normalizeRecentActivityLogs,
  normalizeRemoteItems,
  normalizeRouterConfig,
  normalizeRouterStatus,
  normalizeSessionContextUsage,
  normalizeSessionDetail,
  normalizeSessionListPage,
  normalizeSessionTokenUsage,
} from "./api-normalizers";
import type {
  HealthResponse,
  SystemMonitorSnapshot,
  ComputerUseStatus,
  SessionSummary,
  SessionListPage,
  MobileEvalGolden,
  MobileEvalRun,
  MobileResearchStats,
  GitBranchSummary,
  GitBranchListResponse,
  GitBranchCheckoutResponse,
  AgentSummary,
  ProviderSummary,
  AgentUpdatePayload,
  ProviderUpdatePayload,
  ProviderOAuthStartResponse,
  ProviderOAuthDeviceCodeResponse,
  ProviderOAuthPollResponse,
  ProviderTestResult,
  MemoryListResponse,
  MemorySearchResult,
  MemoryCreateResponse,
  GatewaySuccessResponse,
  GatewayAuthSettings,
  GatewayRemoteAccessSettings,
  ExternalTelemetrySettings,
  ExternalTelemetryStatus,
  ToolCapabilityPolicy,
  MobileNearbySettings,
  MobileNearbyStatus,
  GatewayAuthKeyResponse,
  GatewayRestartResponse,
  MigrationSourceCandidate,
  SourceMigrationRequest,
  SourceMigrationReport,
  CurrentMobileDeviceResponse,
  MobileMcpServer,
  MobilePlugin,
  MobileAccountConnectorId,
  MobileAccountConnector,
  MobilePushRegistrationResponse,
  WalletAgentPolicyUpdate,
  WalletSendPayload,
  WalletSendTokenPayload,
  WalletSendResult,
  SystemPromptConfig,
  ToolApprovalDecision,
  PendingToolApproval,
  RouterConfig,
  RouterStatus,
  FeatureEndpointKey,
  RemoteItemSummary,
  ActivitySummary,
  ActivityLogPage,
  MobileMessageImage,
  MobileSteerPendingMessageOptions,
  MobilePendingChatMessage,
  SessionMessageSummary,
  SessionContextUsage,
  SessionTokenUsage,
  SessionDetailSummary,
  MobileSubagentSummary,
  MobileSubagentSpawnRequest,
  MobileSubagentSpawnResponse,
  MobileSessionStatusResponse,
  MobileStatusStreamHandlers,
  MobileStatusStreamOptions,
  FeatureSummary,
  JourneyResponse,
} from "./api-types";

export { normalizeArrayResponse } from "./apiNormalizeUtils";
export type {
  ProviderPlanMonitoringConfig,
  ProviderPlanProviderConfig,
  ProviderPlanPresetConfidence,
  ProviderPlanPresetSuggestion,
  ProviderPlanRouteConstraint,
  ProviderPlanSnapshot,
  ProviderPlanSourceMode,
  ProviderPlanStatusResponse,
  ProviderPlanStatusState,
  ProviderPlanWindow,
  ProviderPlanWindowConfig,
} from "./apiProviderPlans";
export {
  buildMobileMediaUrl,
  buildMobileStatusStreamUrl,
  normalizeActivityLogs,
  normalizeJourney,
  normalizeMemoryEntry,
  normalizeMemoryItems,
  normalizeMemoryList,
  normalizeMemorySearchResults,
  normalizeMobileSessionStatusResponse,
  normalizeMobileStatusStreamEvent,
  normalizeRemoteItems,
  sessionSortTimestampMs,
  sortSessionSummaries,
} from "./api-normalizers";
export * from "./api-types";

const MOBILE_SESSION_LIST_LIMIT = 100;
const MOBILE_LOG_LIST_LIMIT = 150;

type MobileWebSocketConstructor = NonNullable<MobileStatusStreamOptions["WebSocketImpl"]>;
type MobileWebSocket = InstanceType<MobileWebSocketConstructor>;

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

export class CybaraMobileApi {
  private profile: GatewayProfile;

  constructor(profile: GatewayProfile) {
    this.profile = profile;
  }

  setApiKey(apiKey: string): void {
    this.profile = { ...this.profile, apiKey };
  }

  setGatewayPassword(gatewayPassword?: string): void {
    this.profile = gatewayPassword?.trim()
      ? { ...this.profile, gatewayPassword: gatewayPassword.trim() }
      : { ...this.profile, gatewayPassword: undefined };
  }

  private headers(): Headers {
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    headers.set("Authorization", `Bearer ${this.profile.apiKey}`);
    if (this.profile.gatewayPassword?.trim()) {
      headers.set("X-Cybara-Gateway-Password", this.profile.gatewayPassword.trim());
    }
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

  mediaUrl(filePath: string): string {
    return buildMobileMediaUrl(this.profile, filePath);
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

  listMcpServers(): Promise<MobileMcpServer[]> {
    return this.request<MobileMcpServer[]>("/api/mcp");
  }

  async listPlugins(): Promise<MobilePlugin[]> {
    const response = await this.request<{ plugins: MobilePlugin[] }>("/api/plugins");
    return response.plugins;
  }

  async setPluginEnabled(id: string, enabled: boolean): Promise<MobilePlugin> {
    const response = await this.request<{
      success: boolean;
      plugin: MobilePlugin;
    }>(`/api/plugins/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    });
    return response.plugin;
  }

  createMcpServer(input: {
    name: string;
    url: string;
    authorization?: string;
  }): Promise<MobileMcpServer> {
    return this.request<MobileMcpServer>("/api/mcp", {
      method: "POST",
      body: JSON.stringify({ ...input, enabled: true }),
    });
  }

  startMcpServer(id: string): Promise<{ success: boolean; error?: string }> {
    return this.request<{ success: boolean; error?: string }>(
      `/api/mcp/${encodeURIComponent(id)}/start`,
      { method: "POST" }
    );
  }

  stopMcpServer(id: string): Promise<{ success: boolean; error?: string }> {
    return this.request<{ success: boolean; error?: string }>(
      `/api/mcp/${encodeURIComponent(id)}/stop`,
      { method: "POST" }
    );
  }

  deleteMcpServer(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/mcp/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  listAccountConnectors(): Promise<MobileAccountConnector[]> {
    return this.request<MobileAccountConnector[]>("/api/connectors");
  }

  updateAccountConnector(
    id: MobileAccountConnectorId,
    input: {
      clientId?: string;
      clientSecret?: string;
      access: "read" | "read_write";
    }
  ): Promise<MobileAccountConnector> {
    return this.request<MobileAccountConnector>(`/api/connectors/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  disconnectAccountConnector(id: MobileAccountConnectorId): Promise<MobileAccountConnector> {
    return this.request<MobileAccountConnector>(`/api/connectors/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  startAccountConnectorOAuth(id: MobileAccountConnectorId): Promise<{
    state: string;
    authUrl: string;
    expiresAt: number;
  }> {
    return this.request(`/api/connectors/${encodeURIComponent(id)}/oauth/start`, {
      method: "POST",
    });
  }

  accountConnectorOAuthStatus(state: string): Promise<{
    status: "pending" | "connected" | "error" | "not_found";
    error?: string;
  }> {
    return this.request(`/api/connectors/oauth/status?state=${encodeURIComponent(state)}`);
  }

  registerPushToken(input: {
    token: string;
    provider?: "expo";
    platform?: string;
    enabled?: boolean;
    preferences?: {
      chatCompletions?: boolean;
      taskCompletions?: boolean;
    };
  }): Promise<MobilePushRegistrationResponse> {
    return this.request<MobilePushRegistrationResponse>("/api/mobile/push-token", {
      method: "POST",
      body: JSON.stringify({
        token: input.token,
        provider: input.provider ?? "expo",
        platform: input.platform,
        enabled: input.enabled ?? true,
        preferences: input.preferences,
      }),
    });
  }

  currentMobileDevice(): Promise<CurrentMobileDeviceResponse> {
    return this.request<CurrentMobileDeviceResponse>("/api/mobile/device");
  }

  updatePushPreferences(input: {
    chatCompletions?: boolean;
    taskCompletions?: boolean;
  }): Promise<MobilePushRegistrationResponse> {
    return this.request<MobilePushRegistrationResponse>("/api/mobile/push-preferences", {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  clearPushToken(): Promise<MobilePushRegistrationResponse> {
    return this.request<MobilePushRegistrationResponse>("/api/mobile/push-token", {
      method: "POST",
      body: JSON.stringify({ enabled: false }),
    });
  }

  sendTestPush(): Promise<MobilePushRegistrationResponse> {
    return this.request<MobilePushRegistrationResponse>("/api/mobile/push/test", {
      method: "POST",
    });
  }

  async sessionList(): Promise<SessionListPage> {
    return normalizeSessionListPage(
      await this.request<unknown>(`/api/sessions?limit=${MOBILE_SESSION_LIST_LIMIT}&includeTotal=1`)
    );
  }

  async sessions(): Promise<SessionSummary[]> {
    return (await this.sessionList()).sessions;
  }

  subagents(sessionId: string): Promise<MobileSubagentSummary[]> {
    return this.request<MobileSubagentSummary[]>(
      `/api/subagents?sessionId=${encodeURIComponent(sessionId)}`
    );
  }

  subagent(id: string): Promise<MobileSubagentSummary> {
    return this.request<MobileSubagentSummary>(`/api/subagents/${encodeURIComponent(id)}`);
  }

  spawnSubagent(payload: MobileSubagentSpawnRequest): Promise<MobileSubagentSpawnResponse> {
    return this.request<MobileSubagentSpawnResponse>("/api/subagents/spawn", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  stopSubagent(id: string): Promise<{ success: boolean; message?: string }> {
    return this.request<{ success: boolean; message?: string }>(
      `/api/subagents/${encodeURIComponent(id)}/kill`,
      { method: "POST" }
    );
  }

  clearSubagent(id: string): Promise<{ success: boolean; error?: string }> {
    return this.request<{ success: boolean; error?: string }>(
      `/api/subagents/${encodeURIComponent(id)}`,
      { method: "DELETE" }
    );
  }

  clearSubagentHistory(sessionId: string): Promise<{ success: boolean; cleared: number }> {
    return this.request<{ success: boolean; cleared: number }>(
      `/api/subagents?sessionId=${encodeURIComponent(sessionId)}`,
      { method: "DELETE" }
    );
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

  async gitBranch(path: string): Promise<string | null> {
    const trimmed = path.trim();
    if (!trimmed) return null;
    const response = await this.request<unknown>(
      `/api/git/branch?path=${encodeURIComponent(trimmed)}`
    );
    return readString(asRecord(response), ["branch"]) || null;
  }

  async gitBranches(path: string): Promise<GitBranchListResponse> {
    const trimmed = path.trim();
    if (!trimmed)
      return {
        success: false,
        current: null,
        branches: [],
        error: "Missing path",
      };
    const response = asRecord(
      await this.request<unknown>(`/api/git/branches?path=${encodeURIComponent(trimmed)}`)
    );
    const branches = normalizeArrayResponse(response?.branches, ["branches"])
      .map((item) => {
        const record = asRecord(item);
        const name = readString(record, ["name"]);
        if (!name) return null;
        return { name, current: record?.current === true };
      })
      .filter((item): item is GitBranchSummary => item !== null);
    return {
      success: response?.success !== false,
      current:
        readString(response, ["current"]) ||
        branches.find((branch) => branch.current)?.name ||
        null,
      branches,
      error: readString(response, ["error"]),
    };
  }

  async checkoutGitBranch(
    path: string,
    branch: string,
    create = false
  ): Promise<GitBranchCheckoutResponse> {
    return this.request<GitBranchCheckoutResponse>("/api/git/branch", {
      method: "POST",
      body: JSON.stringify({ path, branch, create }),
    });
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
    clientPendingId?: string;
    images?: MobileMessageImage[];
    useModelRouter?: boolean;
  }): Promise<{
    sessionId: string;
    message: SessionMessageSummary;
    workspaceDir?: string | null;
    contextUsage?: SessionContextUsage;
    tokenUsage?: SessionTokenUsage;
    queued?: boolean;
    interrupted?: boolean;
    pendingMessage?: MobilePendingChatMessage;
    pendingMessages?: MobilePendingChatMessage[];
  }> {
    const body: Record<string, unknown> = {
      message: input.message,
      sessionId: input.sessionId,
      agentId: input.agentId,
      workspaceDir: input.workspaceDir,
      queueMode: input.queueMode,
      clientPendingId: input.clientPendingId,
      images: input.images,
    };
    if (input.useModelRouter === true) {
      body.useModelRouter = true;
    }

    const response = await this.request<unknown>("/api/chat", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const record = asRecord(response);
    const messageRecord = asRecord(record?.message);
    const thinking = readString(messageRecord, ["thinking"]) || readString(record, ["thinking"]);
    return {
      sessionId: readString(record, ["sessionId"]) || input.sessionId || "",
      workspaceDir: readString(record, ["workspaceDir"]) || input.workspaceDir,
      contextUsage: normalizeSessionContextUsage(record?.contextUsage ?? record?.context_usage),
      tokenUsage: normalizeSessionTokenUsage(record?.tokenUsage ?? record?.token_usage),
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
        agentTransfers: normalizeAgentTransfers(
          messageRecord?.agent_transfers ?? messageRecord?.agentTransfers
        ),
        images: normalizeMessageImages(messageRecord?.images),
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

  async updatePendingMessage(
    sessionId: string,
    pendingMessageId: string,
    content: string
  ): Promise<{
    success: boolean;
    pendingMessage?: MobilePendingChatMessage;
    pendingMessages?: MobilePendingChatMessage[];
    error?: string;
  }> {
    const response = await this.request<unknown>(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/pending/${encodeURIComponent(
        pendingMessageId
      )}`,
      {
        method: "PATCH",
        body: JSON.stringify({ content }),
      }
    );
    const record = asRecord(response);
    return {
      success: record?.success === true,
      pendingMessage: normalizePendingChatMessages(record?.pendingMessage)[0],
      pendingMessages: normalizePendingChatMessages(record?.pendingMessages),
      error: readString(record, ["error"]),
    };
  }

  async deletePendingMessage(
    sessionId: string,
    pendingMessageId: string
  ): Promise<{
    success: boolean;
    pendingMessages?: MobilePendingChatMessage[];
    error?: string;
  }> {
    const response = await this.request<unknown>(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/pending/${encodeURIComponent(
        pendingMessageId
      )}`,
      { method: "DELETE" }
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
    pendingMessageId: string,
    options?: MobileSteerPendingMessageOptions
  ): Promise<{
    success: boolean;
    pendingMessage?: MobilePendingChatMessage;
    pendingMessages?: MobilePendingChatMessage[];
    interruptedMessage?: SessionMessageSummary;
    error?: string;
  }> {
    const processActivities = options?.processActivities?.length
      ? options.processActivities
      : undefined;
    const response = await this.request<unknown>(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/pending/${encodeURIComponent(
        pendingMessageId
      )}/steer`,
      {
        method: "POST",
        body: processActivities ? JSON.stringify({ processActivities }) : undefined,
      }
    );
    const record = asRecord(response);
    const interruptedRecord = asRecord(record?.interruptedMessage);
    return {
      success: record?.success === true,
      pendingMessage: normalizePendingChatMessages(record?.pendingMessage)[0],
      pendingMessages: normalizePendingChatMessages(record?.pendingMessages),
      interruptedMessage: interruptedRecord
        ? normalizeSessionDetail(
            {
              id: sessionId,
              messages: [interruptedRecord],
            },
            sessionId
          ).messages[0]
        : undefined,
      error: readString(record, ["error"]),
    };
  }

  async stopChatSession(sessionId: string): Promise<{
    success: boolean;
    stopped: boolean;
    error?: string;
  }> {
    const response = await this.request<unknown>(
      `/api/chat/sessions/${encodeURIComponent(sessionId)}/stop`,
      { method: "POST" }
    );
    const record = asRecord(response);
    return {
      success: record?.success === true,
      stopped: record?.stopped === true,
      error: readString(record, ["error"]),
    };
  }

  updateSessionTitle(id: string, title: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/sessions/${encodeURIComponent(id)}/title`, {
      method: "PUT",
      body: JSON.stringify({ title }),
    });
  }

  async updateSessionAgent(
    id: string,
    agentId: string
  ): Promise<{
    success: boolean;
    sessionId?: string;
    agentId?: string;
    agentName?: string;
    provider?: string;
    providerId?: string;
    providerName?: string;
    model?: string;
    contextUsage?: SessionContextUsage;
    tokenUsage?: SessionTokenUsage;
    error?: string;
  }> {
    const response = await this.request<unknown>(`/api/sessions/${encodeURIComponent(id)}/agent`, {
      method: "PUT",
      body: JSON.stringify({ agentId }),
    });
    const record = asRecord(response);
    return {
      success: record?.success === true,
      sessionId: readString(record, ["sessionId", "session_id"]),
      agentId: readString(record, ["agentId", "agent_id"]),
      agentName: readString(record, ["agentName", "agent_name"]),
      provider: readString(record, ["provider"]),
      providerId: readString(record, ["providerId", "provider_id"]),
      providerName: readString(record, ["providerName", "provider_name"]),
      model: readString(record, ["model"]),
      contextUsage: normalizeSessionContextUsage(record?.contextUsage ?? record?.context_usage),
      tokenUsage: normalizeSessionTokenUsage(record?.tokenUsage ?? record?.token_usage),
      error: readString(record, ["error"]),
    };
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
  ): Promise<{
    success: boolean;
    keptCount?: number;
    removedCount?: number;
    error?: string;
  }> {
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

  forkSession(
    id: string,
    payload: {
      throughMessageIndex?: number;
      agentId?: string;
      title?: string;
    } = {}
  ): Promise<{
    success: boolean;
    fork?: {
      sessionId: string;
      sourceSessionId: string;
      agentId: string;
      messageCount: number;
      workspaceDir: string | null;
      title: string | null;
    };
    error?: string;
  }> {
    return this.request(`/api/sessions/${encodeURIComponent(id)}/fork`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  saveSessionGolden(
    id: string,
    payload: { messageIndex?: number; name?: string } = {}
  ): Promise<{ success: boolean; error?: string }> {
    return this.request(`/api/sessions/${encodeURIComponent(id)}/golden`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  evals(): Promise<{ goldens: MobileEvalGolden[]; runs: MobileEvalRun[] }> {
    return this.request("/api/evals");
  }

  researchTraces(): Promise<{ stats: MobileResearchStats; total: number }> {
    return this.request("/api/evals/research/traces?limit=200&offset=0");
  }

  exportResearch(
    format:
      | "cybara_trace"
      | "trl_sft"
      | "distillation_sft"
      | "hf_session_trace"
      | "prompt_completion"
      | "long_context"
  ): Promise<{
    filename: string;
    mimeType: string;
    content: string;
    count: number;
  }> {
    return this.request(`/api/evals/research/export?format=${format}&sanitize=1`);
  }

  replayEval(id: string): Promise<{ success: boolean; run?: MobileEvalRun; error?: string }> {
    return this.request(`/api/evals/goldens/${encodeURIComponent(id)}/replay`, {
      method: "POST",
      body: "{}",
    });
  }

  deleteEval(id: string): Promise<{ success: boolean }> {
    return this.request(`/api/evals/goldens/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  exportEvals(
    format: "bundle" | "jsonl",
    sanitize: boolean
  ): Promise<{
    filename: string;
    mimeType: string;
    content: string;
    count: number;
  }> {
    return this.request(`/api/evals/export?format=${format}&sanitize=${sanitize ? "1" : "0"}`);
  }

  importEvals(bundle: unknown): Promise<{ success: boolean; count: number; error?: string }> {
    return this.request("/api/evals/import", {
      method: "POST",
      body: JSON.stringify({ bundle }),
    });
  }

  async agents(): Promise<AgentSummary[]> {
    return normalizeAgents(await this.request<unknown>("/api/agents/summary"));
  }

  async agent(id: string): Promise<AgentSummary> {
    return normalizeAgent(await this.request<unknown>(`/api/agents/${encodeURIComponent(id)}`));
  }

  async updateAgent(id: string, data: AgentUpdatePayload): Promise<AgentSummary> {
    const response = await this.request<unknown>(`/api/agents/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return normalizeAgent(response);
  }

  async updateAgentReasoning(
    id: string,
    effort: AgentSummary["reasoning_effort"]
  ): Promise<{
    success: boolean;
    reasoning_effort?: AgentSummary["reasoning_effort"];
    error?: string;
  }> {
    return this.request(`/api/agents/${encodeURIComponent(id)}/reasoning`, {
      method: "PUT",
      body: JSON.stringify({ reasoning_effort: effort }),
    });
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
    return providerRows.map((provider) => ({
      ...provider,
      ...health.get(provider.id),
    }));
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
    data: {
      name?: string;
      enabled?: boolean;
      config?: Record<string, unknown>;
    }
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
    session_id?: string;
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

  async toolApprovals(): Promise<PendingToolApproval[]> {
    const record = asRecord(await this.request<unknown>("/api/tools/approvals"));
    return normalizeArrayResponse(record?.pending, ["pending", "approvals", "items"]).map(
      (raw, index) => {
        const item = asRecord(raw);
        return {
          id: readString(item, ["id", "requestId"]) || `approval-${index}`,
          toolName: readString(item, ["toolName", "tool", "name"]) || "tool",
          argsSummary: readString(item, ["argsSummary", "summary", "args"]) || "",
        };
      }
    );
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

  gatewayAuthSettings(): Promise<GatewayAuthSettings> {
    return this.request<GatewayAuthSettings>("/api/auth/settings");
  }

  externalTelemetrySettings(): Promise<ExternalTelemetrySettings> {
    return this.request<ExternalTelemetrySettings>("/api/telemetry/settings");
  }

  externalTelemetryStatus(): Promise<ExternalTelemetryStatus> {
    return this.request<ExternalTelemetryStatus>("/api/telemetry/status");
  }

  updateExternalTelemetrySettings(
    settings: ExternalTelemetrySettings
  ): Promise<{ success: boolean; settings: ExternalTelemetrySettings }> {
    return this.request<{
      success: boolean;
      settings: ExternalTelemetrySettings;
    }>("/api/telemetry/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    });
  }

  testExternalTelemetry(): Promise<{
    success: boolean;
    status: ExternalTelemetryStatus;
  }> {
    return this.request<{ success: boolean; status: ExternalTelemetryStatus }>(
      "/api/telemetry/test",
      { method: "POST" }
    );
  }

  toolCapabilityPolicy(): Promise<{ policy: ToolCapabilityPolicy }> {
    return this.request<{ policy: ToolCapabilityPolicy }>("/api/settings/tool-capabilities");
  }

  updateToolCapabilityPolicy(
    policy: ToolCapabilityPolicy
  ): Promise<{ success: boolean; policy: ToolCapabilityPolicy }> {
    return this.request<{ success: boolean; policy: ToolCapabilityPolicy }>(
      "/api/settings/tool-capabilities",
      { method: "PUT", body: JSON.stringify(policy) }
    );
  }

  nearbyStatus(): Promise<MobileNearbyStatus> {
    return this.request<MobileNearbyStatus>("/api/nearby");
  }

  async updateNearbySettings(settings: MobileNearbySettings): Promise<MobileNearbyStatus> {
    const response = await this.request<{
      success: boolean;
      settings: MobileNearbySettings;
      status: MobileNearbyStatus;
    }>("/api/nearby/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    });
    return response.status;
  }

  async makeNearbyDiscoverable(): Promise<void> {
    await this.request<unknown>("/api/nearby/discoverable", { method: "POST" });
  }

  async stopNearbyDiscovery(): Promise<void> {
    await this.request<unknown>("/api/nearby/discoverable", {
      method: "DELETE",
    });
  }

  async refreshNearbyDiscovery(): Promise<void> {
    await this.request<unknown>("/api/nearby/refresh", { method: "POST" });
  }

  async pairNearby(peerId: string, baseUrl: string): Promise<void> {
    await this.request<unknown>("/api/nearby/pair", {
      method: "POST",
      body: JSON.stringify({ peerId, baseUrl }),
    });
  }

  async pairNearbyByAddress(baseUrl: string): Promise<void> {
    await this.request<unknown>("/api/nearby/pair-address", {
      method: "POST",
      body: JSON.stringify({ baseUrl }),
    });
  }

  async confirmNearbyPairing(pairingId: string): Promise<void> {
    await this.request<unknown>(`/api/nearby/pairings/${encodeURIComponent(pairingId)}/confirm`, {
      method: "POST",
    });
  }

  async removeNearbyPeer(peerId: string): Promise<void> {
    await this.request<unknown>(`/api/nearby/peers/${encodeURIComponent(peerId)}`, {
      method: "DELETE",
    });
  }

  async updateNearbyPeer(peerId: string, syncEnabled: boolean): Promise<void> {
    await this.request<unknown>(`/api/nearby/peers/${encodeURIComponent(peerId)}`, {
      method: "PUT",
      body: JSON.stringify({ syncEnabled }),
    });
  }

  acceptNearbyTransfer(transferId: string): Promise<{ sessionId: string }> {
    return this.request<{ sessionId: string }>(
      `/api/nearby/transfers/${encodeURIComponent(transferId)}/accept`,
      { method: "POST", body: JSON.stringify({ workspaceDir: null }) }
    );
  }

  sendNearbySession(peerId: string, sessionId: string): Promise<{ transferId: string }> {
    return this.request<{ transferId: string }>(
      `/api/nearby/peers/${encodeURIComponent(peerId)}/sessions`,
      { method: "POST", body: JSON.stringify({ sessionId }) }
    );
  }

  updateGatewayAuthSettings(payload: {
    requireAuthForLocalhost?: boolean;
    host?: string;
    applyHostNow?: boolean;
    basePath?: string;
    port?: number;
    gatewayPassword?: string;
    clearGatewayPassword?: true;
    remoteAccess?: Partial<GatewayRemoteAccessSettings>;
  }): Promise<GatewayAuthSettings> {
    return this.request<GatewayAuthSettings>("/api/auth/settings", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  revealGatewayApiKey(): Promise<GatewayAuthKeyResponse> {
    return this.request<GatewayAuthKeyResponse>("/api/auth/key");
  }

  rotateGatewayApiKey(): Promise<GatewayAuthKeyResponse> {
    return this.request<GatewayAuthKeyResponse>("/api/auth/rotate-key", {
      method: "POST",
    });
  }

  restartGateway(): Promise<GatewayRestartResponse> {
    return this.request<GatewayRestartResponse>("/api/system/restart", {
      method: "POST",
    });
  }

  migrationSources(): Promise<{ sources: MigrationSourceCandidate[] }> {
    return this.request<{ sources: MigrationSourceCandidate[] }>("/api/migrations/sources");
  }

  previewMigration(payload: SourceMigrationRequest): Promise<SourceMigrationReport> {
    return this.request<SourceMigrationReport>("/api/migrations/preview", {
      method: "POST",
      body: JSON.stringify({ ...payload, dryRun: true }),
    });
  }

  runMigration(payload: SourceMigrationRequest): Promise<SourceMigrationReport> {
    return this.request<SourceMigrationReport>("/api/migrations/run", {
      method: "POST",
      body: JSON.stringify({ ...payload, dryRun: false }),
    });
  }

  updateConfig(
    data: Record<string, unknown>
  ): Promise<{ success: boolean; restartRequired?: boolean } & Record<string, unknown>> {
    return this.request<{ success: boolean; restartRequired?: boolean } & Record<string, unknown>>(
      "/api/config",
      {
        method: "PUT",
        body: JSON.stringify(data),
      }
    );
  }

  computerUseStatus(): Promise<ComputerUseStatus> {
    return this.request<ComputerUseStatus>("/api/computer-use/status");
  }

  grantComputerUsePermissions(): Promise<{ ok: boolean; message: string }> {
    return this.request<{ ok: boolean; message: string }>("/api/computer-use/permissions/grant", {
      method: "POST",
    });
  }

  testMemoryProvider(
    provider: string,
    settings?: Record<string, unknown>
  ): Promise<{
    success: boolean;
    provider: string;
    ok: boolean;
    detail: string;
  }> {
    return this.request<{
      success: boolean;
      provider: string;
      ok: boolean;
      detail: string;
    }>("/api/memory/providers/test", {
      method: "POST",
      body: JSON.stringify({ provider, settings }),
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

  async providerPlanConfig(): Promise<ProviderPlanMonitoringConfig> {
    return normalizeProviderPlanMonitoringConfig(
      await this.request<unknown>("/api/provider-plans/config")
    );
  }

  updateProviderPlanConfig(
    data: ProviderPlanMonitoringConfig
  ): Promise<ProviderPlanMonitoringConfig> {
    return this.request<ProviderPlanMonitoringConfig>("/api/provider-plans/config", {
      method: "PUT",
      body: JSON.stringify(data),
    }).then(normalizeProviderPlanMonitoringConfig);
  }

  async providerPlanStatus(): Promise<ProviderPlanStatusResponse> {
    return normalizeProviderPlanStatus(await this.request<unknown>("/api/provider-plans/status"));
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

  async journey(): Promise<JourneyResponse> {
    return normalizeJourney(await this.request<unknown>("/api/journey"));
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
      skills,
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
      safe<RemoteItemSummary[]>("skills", [], async () =>
        normalizeRemoteItems(
          await this.request<unknown>("/api/skills"),
          ["skills", "items"],
          "skill"
        )
      ),
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
      skills,
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
    try {
      const snapshot = await this.request<MetricsSnapshot>("/api/metrics/snapshot");
      return {
        ...snapshot,
        availability: {
          ...emptyMetricsAvailability(),
          ...(snapshot.availability ?? {}),
        },
      };
    } catch {}

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
      providerPlans,
      sessions,
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
      safe("providerPlans", null, () => this.providerPlanStatus()),
      safe("sessions", null, () =>
        this.request<MetricsSnapshot["sessions"]>("/api/metrics/sessions")
      ),
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
      providerPlans,
      sessions,
      availability,
    };
  }

  async metricsSessions(
    page = 1,
    pageSize = 10
  ): Promise<NonNullable<MetricsSnapshot["sessions"]>> {
    return this.request(
      `/api/metrics/sessions?page=${encodeURIComponent(String(page))}&pageSize=${encodeURIComponent(String(pageSize))}`
    );
  }
}
