import { fetchApi } from "@/lib/api-client";
import type { PendingChatMessage, StatusSessionSnapshot } from "@/lib/status-stream";
import type {
  Agent,
  AgentSummary,
  BotRosterItem,
  ApiResponse,
  Channel,
  ChatImageAttachment,
  ChatMessage,
  ChatSession,
  DashboardStats,
  Memory,
  MobileConnectInfo,
  MobileDevice,
  MobileDevicePairing,
  MobilePairing,
  Provider,
  ProviderPlanMonitoringConfig,
  ProviderPlanStatusResponse,
  SessionContextUsage,
  SessionGoal,
  SessionPlanSnapshot,
  SessionTokenUsage,
  Skill,
  Task,
} from "@/types";
import type { AgentGolden } from "@/lib/api/lab";

export { extractApiError } from "@/lib/api-client";

type ChatProcessActivityPayload = Array<{
  id?: string;
  phase?: "start" | "result" | "error" | "blocked";
  text?: string;
  timestamp?: number | string;
  toolName?: string;
  toolCallId?: string;
  sandboxProvider?: string;
}>;

export interface WorkspaceOpenTarget {
  id: string;
  label: string;
  kind: "internal" | "file-manager" | "terminal" | "ide";
  icon: string;
  iconUrl?: string;
  available: boolean;
  detail?: string;
}

export interface NearbySettings {
  enabled: boolean;
  displayName: string;
  port: number;
  discoveryMinutes: number;
  autoAdvertise: boolean;
}

export interface NearbyPairing {
  id: string;
  direction: "incoming" | "outgoing";
  peerId: string;
  peerName: string;
  peerBaseUrl: string;
  verificationCode: string;
  localConfirmed: boolean;
  remoteConfirmed: boolean;
  expiresAt: string;
}

export interface NearbyStatus {
  settings: NearbySettings;
  identity: { id: string; fingerprint: string };
  running: boolean;
  advertising: boolean;
  discoverableUntil: string | null;
  discovery?: {
    udp: {
      running: boolean;
      boundPort: number | null;
      fallback: boolean;
      error: string | null;
    };
    mdns: {
      running: boolean;
      interfaceCount: number;
      error: string | null;
    };
    lastRefreshAt: string | null;
  };
  localAddresses: string[];
  discoveredPeers: Array<{
    id: string;
    name: string;
    baseUrl: string;
    fingerprint: string;
    lastSeenAt: string;
  }>;
  pairedPeers: Array<{
    id: string;
    name: string;
    baseUrl: string;
    fingerprint: string;
    pairedAt: string;
    lastSeenAt?: string;
    syncEnabled: boolean;
  }>;
  pairings: NearbyPairing[];
  incomingTransfers: Array<{
    id: string;
    peerId: string;
    peerName: string;
    receivedAt: string;
    title: string | null;
    messageCount: number;
    workspace: { name: string; branch?: string; commit?: string; dirty?: boolean } | null;
  }>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readNumber(record: Record<string, unknown>, key: string, fallback = 0): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeProviderPlanConfigResponse(value: unknown): ProviderPlanMonitoringConfig {
  const record = asRecord(value);
  const providersRecord = asRecord(record.providers);
  return {
    enabled: record.enabled !== false,
    routerEnforcement: record.routerEnforcement !== false && record.router_enforcement !== false,
    warningThresholdPct: readNumber(
      record,
      "warningThresholdPct",
      readNumber(record, "warning_threshold_pct", 80)
    ),
    staleAfterMinutes: readNumber(
      record,
      "staleAfterMinutes",
      readNumber(record, "stale_after_minutes", 120)
    ),
    providers: Object.fromEntries(
      Object.entries(providersRecord)
    ) as ProviderPlanMonitoringConfig["providers"],
  };
}

function normalizeProviderPlanStatusResponse(value: unknown): ProviderPlanStatusResponse {
  const record = asRecord(value);
  const summary = asRecord(record.summary);
  return {
    enabled: record.enabled !== false,
    routerEnforcement: record.routerEnforcement !== false && record.router_enforcement !== false,
    warningThresholdPct: readNumber(record, "warningThresholdPct", 80),
    providers: Array.isArray(record.providers)
      ? (record.providers as ProviderPlanStatusResponse["providers"])
      : [],
    summary: {
      total: readNumber(summary, "total"),
      monitored: readNumber(summary, "monitored"),
      configured: readNumber(summary, "configured"),
      warnings: readNumber(summary, "warnings"),
      exhausted: readNumber(summary, "exhausted"),
    },
  };
}

export const agentsApi = {
  list: () => fetchApi<Agent[]>("/agents"),
  summaries: () => fetchApi<AgentSummary[]>("/agents/summary"),
  get: (id: string) => fetchApi<Agent>(`/agents/${id}`),
  create: (agent: Omit<Agent, "id" | "createdAt" | "updatedAt">) =>
    fetchApi<Agent>("/agents", { method: "POST", body: JSON.stringify(agent) }),
  update: (id: string, agent: Partial<Agent>) =>
    fetchApi<Agent>(`/agents/${id}`, {
      method: "PUT",
      body: JSON.stringify(agent),
    }),
  delete: (id: string) => fetchApi<void>(`/agents/${id}`, { method: "DELETE" }),
  chat: (
    id: string,
    message: string,
    sessionId?: string,
    workspaceDir?: string | null,
    signal?: AbortSignal,
    queueMode?: "queue" | "steer",
    clientPendingId?: string,
    images?: ChatImageAttachment[],
    useModelRouter?: boolean
  ) =>
    fetchApi<{
      message: ChatMessage;
      sessionId: string;
      workspaceDir?: string | null;
      contextUsage?: SessionContextUsage;
      tokenUsage?: SessionTokenUsage;
      plan?: SessionPlanSnapshot | null;
      queued?: boolean;
      interrupted?: boolean;
      pendingMessage?: PendingChatMessage;
      pendingMessages?: PendingChatMessage[];
    }>(`/agents/${id}/chat`, {
      method: "POST",
      body: JSON.stringify({
        message,
        sessionId,
        workspaceDir,
        queueMode,
        clientPendingId,
        useModelRouter,
        ...(images && images.length ? { images } : {}),
      }),
      signal,
    }),
};

export const botsApi = {
  list: () => fetchApi<{ bots: BotRosterItem[] }>("/bots"),
  create: (input: { name: string; title?: string; description?: string; base_agent_id?: string }) =>
    fetchApi<{ bot: BotRosterItem; session_id: string }>("/bots", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  update: (
    id: string,
    input: {
      name?: string;
      title?: string;
      description?: string;
      hidden?: boolean;
      pinned?: boolean;
    }
  ) =>
    fetchApi<{ bot: BotRosterItem }>(`/bots/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  duplicate: (id: string, name?: string) =>
    fetchApi<{ bot: BotRosterItem; session_id: string }>(`/bots/${id}/duplicate`, {
      method: "POST",
      body: JSON.stringify(name ? { name } : {}),
    }),
  delete: (id: string) =>
    fetchApi<{ success: boolean; bot_id: string }>(`/bots/${id}`, { method: "DELETE" }),
  ensureSession: (id: string) =>
    fetchApi<{ bot_id: string; session_id: string }>(`/bots/${id}/session`, {
      method: "POST",
    }),
};

export const providersApi = {
  list: () => fetchApi<Provider[]>("/providers"),
  get: (id: string) => fetchApi<Provider>(`/providers/${id}`),
  create: (provider: Omit<Provider, "id" | "createdAt">) =>
    fetchApi<Provider>("/providers", {
      method: "POST",
      body: JSON.stringify(provider),
    }),
  update: (id: string, provider: Partial<Provider>) =>
    fetchApi<Provider>(`/providers/${id}`, {
      method: "PUT",
      body: JSON.stringify(provider),
    }),
  delete: (id: string) => fetchApi<void>(`/providers/${id}`, { method: "DELETE" }),
  test: (id: string) =>
    fetchApi<{ success: boolean; latency: number }>(`/providers/${id}/test`, {
      method: "POST",
    }),
};

export const providerPlansApi = {
  config: async (): Promise<ApiResponse<ProviderPlanMonitoringConfig>> => {
    const response = await fetchApi<unknown>("/provider-plans/config");
    if (!response.success) return { success: false, error: response.error };
    return {
      ...response,
      data: normalizeProviderPlanConfigResponse(response.data),
    };
  },
  status: async (): Promise<ApiResponse<ProviderPlanStatusResponse>> => {
    const response = await fetchApi<unknown>("/provider-plans/status");
    if (!response.success) return { success: false, error: response.error };
    return {
      ...response,
      data: normalizeProviderPlanStatusResponse(response.data),
    };
  },
  availability: () =>
    fetchApi<{
      available: boolean;
      summary: ProviderPlanStatusResponse["summary"];
    }>("/provider-plans/availability"),
  updateConfig: async (
    payload: ProviderPlanMonitoringConfig
  ): Promise<ApiResponse<ProviderPlanMonitoringConfig>> => {
    const response = await fetchApi<unknown>("/provider-plans/config", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (!response.success) return { success: false, error: response.error };
    return {
      ...response,
      data: normalizeProviderPlanConfigResponse(response.data),
    };
  },
};

export const routerApi = {
  config: () => fetchApi<{ enabled?: boolean }>("/router/config"),
};

export const channelsApi = {
  list: () => fetchApi<Channel[]>("/channels"),
  get: (id: string) => fetchApi<Channel>(`/channels/${id}`),
  create: (channel: Omit<Channel, "id" | "createdAt">) =>
    fetchApi<Channel>("/channels", {
      method: "POST",
      body: JSON.stringify(channel),
    }),
  update: (id: string, channel: Partial<Channel>) =>
    fetchApi<Channel>(`/channels/${id}`, {
      method: "PUT",
      body: JSON.stringify(channel),
    }),
  delete: (id: string) => fetchApi<void>(`/channels/${id}`, { method: "DELETE" }),
  test: (id: string) =>
    fetchApi<{
      success: boolean;
      running?: boolean;
      error?: string;
      message?: string;
    }>(`/channels/${id}/test`, {
      method: "POST",
    }),
  getWhatsAppState: (id: string) =>
    fetchApi<{
      success: boolean;
      channelId: string;
      enabled: boolean;
      running: boolean;
      ready: boolean;
      authenticated: boolean;
      awaitingQr: boolean;
      qr: string | null;
      qrDataUrl: string | null;
      lastEventAt: string;
      lastError: string | null;
    }>(`/channels/${id}/whatsapp/state`),
  getPairings: (id: string) =>
    fetchApi<{
      pairings: Array<{
        id: string;
        senderId: string;
        code: string;
        platform: string;
        displayName?: string;
        status: string;
        createdAt: string;
        expiresAt: string;
      }>;
      pendingCount: number;
      config?: Record<string, unknown>;
    }>(`/channels/${id}/pairings`),
  verifyPairing: (id: string, code: string) =>
    fetchApi<{ success: boolean; senderId?: string; error?: string }>(
      `/channels/${id}/pairings/verify`,
      {
        method: "POST",
        body: JSON.stringify({ code }),
      }
    ),
  rejectPairing: (id: string, pairingId: string) =>
    fetchApi<{ success: boolean }>(`/channels/${id}/pairings/${pairingId}/reject`, {
      method: "POST",
    }),
  setupTelegram: (botToken: string, webhookUrl: string) =>
    fetchApi<Channel>("/channels/telegram/setup", {
      method: "POST",
      body: JSON.stringify({ botToken, webhookUrl }),
    }),
};

export const mobileApi = {
  connectInfo: () => fetchApi<MobileConnectInfo>("/mobile/connect-info"),
  listDevices: () => fetchApi<{ devices: MobileDevice[] }>("/mobile/devices"),
  createDevice: (payload: { deviceName?: string; gatewayName?: string; baseUrl: string }) =>
    fetchApi<MobileDevicePairing>("/mobile/devices", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  createPairingCode: (payload: {
    deviceName?: string;
    gatewayName?: string;
    baseUrl: string;
    role?: "standard" | "readonly" | "full";
  }) =>
    fetchApi<MobilePairing>("/mobile/devices/pair-code", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  revokeDevice: (id: string) =>
    fetchApi<{ success: boolean; device: MobileDevice }>(`/mobile/devices/${id}/revoke`, {
      method: "POST",
    }),
  deleteDevice: (id: string) =>
    fetchApi<{ success: boolean }>(`/mobile/devices/${id}`, {
      method: "DELETE",
    }),
};

export interface MCPServer {
  id: string;
  name: string;
  command: string;
  args?: string;
  env?: string;
  url?: string;
  enabled: boolean;
  status: string;
  toolCount: number;
  hasCredentials?: boolean;
  transport?: "stdio" | "http";
}

export interface MCPRegistryServer {
  id: string;
  name: string;
  description: string;
  registry: string;
  package: string;
  command: string;
  args?: string;
  url?: string;
  envVars?: string[];
  envDefaults?: Record<string, string>;
  categories?: string[];
  homepage?: string;
  installType?: string;
}

export interface InstalledPluginSummary {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  source: "bundled" | "local" | "workspace";
  rootDir: string;
  skillDirs: string[];
  skillNames: string[];
  skillCount: number;
  enabled: boolean;
  builtIn: boolean;
}

export interface PluginCatalogSummary {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  tags: string[];
  skillNames: string[];
  installedByDefault: boolean;
  enabledByDefault: boolean;
  installed: boolean;
  enabled: boolean;
}

export interface MarketplacePluginSummary {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  category: string;
  marketplaceId: string;
  marketplace: string;
  capabilities: string[];
  installed: boolean;
  enabled: boolean;
}

export interface MarketplacePluginPage {
  plugins: MarketplacePluginSummary[];
  total: number;
  page: number;
  page_size: number;
  page_count: number;
}

export interface PluginManifestSummary {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
}

export interface PluginValidationSummary {
  valid: boolean;
  errors: string[];
  warnings: string[];
  manifest?: PluginManifestSummary;
}

export interface PluginInstallPayload {
  path?: string;
  archive?: { name: string; dataBase64: string };
  files?: Array<{ path: string; dataBase64: string }>;
}

export const pluginsApi = {
  list: () => fetchApi<{ plugins: InstalledPluginSummary[] }>("/plugins"),
  catalog: () => fetchApi<{ plugins: PluginCatalogSummary[] }>("/plugins/catalog"),
  marketplace: (
    query = "",
    page = 1,
    pageSize = 24,
    filter: "all" | "installed" | "available" = "all"
  ) =>
    fetchApi<MarketplacePluginPage>(
      `/plugins/marketplace?q=${encodeURIComponent(query)}&page=${page}&page_size=${pageSize}&filter=${filter}`
    ),
  installMarketplace: (payload: { id: string; marketplace: string }) =>
    fetchApi<{
      success: boolean;
      pluginId?: string;
      error?: string;
    }>("/plugins/marketplace/install", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  setEnabled: (id: string, enabled: boolean) =>
    fetchApi<{ success: boolean; plugin: InstalledPluginSummary }>(
      `/plugins/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      }
    ),
  validate: (payload: PluginInstallPayload) =>
    fetchApi<PluginValidationSummary>("/plugins/validate", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  install: (payload: PluginInstallPayload) =>
    fetchApi<{ success: boolean; plugin?: InstalledPluginSummary }>("/plugins/install", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  remove: (id: string) =>
    fetchApi<{ success: boolean }>(`/plugins/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
};

export const mcpApi = {
  list: () => fetchApi<MCPServer[]>("/mcp"),
  popular: () => fetchApi<MCPRegistryServer[]>("/mcp/registry/popular"),
  search: (query: string) =>
    fetchApi<MCPRegistryServer[]>(`/mcp/registry/search?q=${encodeURIComponent(query)}`),
  install: (payload: { id?: string; package?: string; trustedAction: true }) =>
    fetchApi<{ success: boolean; id?: string; error?: string }>("/mcp/registry/install", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  create: (server: {
    name: string;
    command?: string;
    args?: string;
    env?: string;
    url?: string;
    authorization?: string;
    enabled?: boolean;
  }) =>
    fetchApi<{
      id: string;
      name: string;
      command: string;
      args?: string;
      url?: string;
      enabled: boolean;
    }>("/mcp", {
      method: "POST",
      body: JSON.stringify(server),
    }),
  start: (id: string) =>
    fetchApi<{ success: boolean; error?: string }>(`/mcp/${id}/start`, {
      method: "POST",
    }),
  startOAuth: (id: string) =>
    fetchApi<{
      success: boolean;
      authUrl?: string;
      state?: string;
      error?: string;
    }>(`/mcp/${id}/oauth/start`, { method: "POST" }),
  oauthStatus: (state: string) =>
    fetchApi<{
      status: "pending" | "connected" | "error" | "not_found";
      serverId?: string;
      error?: string;
    }>(`/mcp/oauth/status?state=${encodeURIComponent(state)}`),
  stop: (id: string) =>
    fetchApi<{ success: boolean; error?: string }>(`/mcp/${id}/stop`, {
      method: "POST",
    }),
  delete: (id: string) => fetchApi<{ success: boolean }>(`/mcp/${id}`, { method: "DELETE" }),
};

export interface GatewayAuthSettings {
  success: boolean;
  apiKeyConfigured: boolean;
  apiKeyPreview: string | null;
  apiKeySource: "env" | "file" | "none";
  apiKeyPath: string;
  gatewayPasswordEnabled: boolean;
  requireAuthForLocalhost: boolean;
  requireAuthForLocalhostForced: boolean;
  localhostBypassActive: boolean;
  host?: string;
  configuredHost?: string;
  hostForced?: boolean;
  hostApplyScheduled?: boolean;
  hostApplyError?: string;
  gatewayFirewall?: GatewayFirewallResult;
  basePath?: string;
  basePathForced?: boolean;
  remoteAccess?: GatewayRemoteAccessSettings;
  port?: number;
  configuredPort?: number;
  portForced?: boolean;
  rateLimits: Record<string, { windowMs: number; maxRequests: number }>;
}

export interface GatewayRemoteAccessSettings {
  enabled: boolean;
  mode: "private_overlay" | "public_tunnel";
  provider: "tailscale" | "cloudflare" | "zerotier" | "netbird" | "custom";
  baseUrl: string;
  ready: boolean;
  requiresGatewayPassword: boolean;
  status: "off" | "ready" | "needs_url" | "needs_https" | "needs_password" | "invalid_url";
  message: string;
}

export interface GatewayFirewallResult {
  platform: string;
  required: boolean;
  attempted: boolean;
  configured: boolean;
  state: "not_required" | "configured" | "requires_admin" | "failed";
  ruleName?: string;
  command?: string;
  message: string;
  error?: string;
}

export interface SystemBackupSummary {
  version: 1;
  id: string;
  label: string;
  createdAt: string;
  entries: string[];
  includesCredentials: true;
  bytes: number;
}

export interface SystemRestoreStatus {
  state: "idle" | "pending" | "completed" | "failed";
  backupId?: string;
  updatedAt?: string;
  error?: string;
}

export interface SystemBackupsResponse {
  backups: SystemBackupSummary[];
  backupDirectory: string;
  restore: SystemRestoreStatus;
}

export interface SystemBuildInfo {
  version: string;
  release_repository_url: string;
  commit: string | null;
  executable_sha256: string | null;
  executable_name: string;
}

export const systemApi = {
  restart: () =>
    fetchApi<{ success: boolean; supervised: boolean; message: string }>("/system/restart", {
      method: "POST",
    }),
  health: () => fetchApi<{ status?: string; uptime?: number }>("/health"),
  buildInfo: () => fetchApi<SystemBuildInfo>("/build-info"),
  backups: () => fetchApi<SystemBackupsResponse>("/system/backups"),
  createBackup: (label: string) =>
    fetchApi<{ success: boolean; backup: SystemBackupSummary }>("/system/backups", {
      method: "POST",
      body: JSON.stringify({ label }),
    }),
  restoreBackup: (backupId: string) =>
    fetchApi<{
      success: boolean;
      restore: SystemRestoreStatus;
      restartRequired: boolean;
    }>(`/system/backups/${encodeURIComponent(backupId)}/restore`, {
      method: "POST",
    }),
  deleteBackup: (backupId: string) =>
    fetchApi<{ success: boolean }>(`/system/backups/${encodeURIComponent(backupId)}`, {
      method: "DELETE",
    }),
};

export const authApi = {
  settings: () => fetchApi<GatewayAuthSettings>("/auth/settings"),
  updateSettings: (payload: {
    requireAuthForLocalhost?: boolean;
    host?: string;
    applyHostNow?: boolean;
    basePath?: string;
    port?: number;
    gatewayPassword?: string;
    clearGatewayPassword?: true;
    remoteAccess?: Partial<GatewayRemoteAccessSettings>;
  }) =>
    fetchApi<GatewayAuthSettings>("/auth/settings", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  revealKey: () =>
    fetchApi<{
      success: boolean;
      apiKey: string | null;
      source: "env" | "file" | "none";
    }>("/auth/key"),
  rotateKey: () =>
    fetchApi<{ success: boolean; apiKey: string }>("/auth/rotate-key", {
      method: "POST",
    }),
};

export const settingsApi = {
  getConfig: () => fetchApi<Record<string, unknown>>("/config"),
  getSandboxStatus: () =>
    fetchApi<{
      enabled: boolean;
      configuredProvider: "auto" | "apple_sandbox" | "podman" | "docker";
      network: "allow" | "deny";
      resolvedProvider: "apple_sandbox" | "podman" | "docker" | null;
      available: boolean;
      reason?: string;
      providers: Array<{
        provider: "apple_sandbox" | "podman" | "docker";
        supported: boolean;
        installed: boolean;
        available: boolean;
        reason?: string;
      }>;
      checkedAt: string;
      lastEvent: {
        phase: "prepared" | "disabled" | "error";
        provider: "apple_sandbox" | "podman" | "docker" | "host" | null;
        commandPreview?: string;
        cwd?: string;
        network?: "allow" | "deny";
        reason?: string;
        timestamp: string;
      } | null;
    }>("/sandbox/status"),
  updateConfig: (data: Record<string, unknown>) =>
    fetchApi<{ success: boolean; restartRequired?: boolean } & Record<string, unknown>>("/config", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
};

export type ToolCapability =
  | "read"
  | "write"
  | "execution"
  | "network"
  | "browser"
  | "wallet"
  | "destructive";

export type ToolCapabilityPolicyMode = "inherit" | "ask" | "allow" | "deny";

export type ToolCapabilityPolicy = Record<ToolCapability, ToolCapabilityPolicyMode>;

export interface ExternalTelemetrySettings {
  enabled: boolean;
  serviceName: string;
  environment: string;
  prometheusEnabled: boolean;
  otlpEnabled: boolean;
  otlpEndpoint: string;
  otlpHeaders: Record<string, string>;
  metricsEnabled: boolean;
  tracesEnabled: boolean;
  exportIntervalMs: number;
}

export interface ExternalTelemetryStatus {
  enabled: boolean;
  queuedMetrics: number;
  queuedSpans: number;
  lastExportAt: string | null;
  lastError: string | null;
  exportedMetrics: number;
  exportedSpans: number;
}

export const toolCapabilityPolicyApi = {
  get: () => fetchApi<{ policy: ToolCapabilityPolicy }>("/settings/tool-capabilities"),
  update: (policy: ToolCapabilityPolicy) =>
    fetchApi<{ success: boolean; policy: ToolCapabilityPolicy }>("/settings/tool-capabilities", {
      method: "PUT",
      body: JSON.stringify(policy),
    }),
};

export const externalTelemetryApi = {
  getSettings: () => fetchApi<ExternalTelemetrySettings>("/telemetry/settings"),
  updateSettings: (settings: ExternalTelemetrySettings) =>
    fetchApi<{ success: boolean; settings: ExternalTelemetrySettings }>("/telemetry/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
  getStatus: () => fetchApi<ExternalTelemetryStatus>("/telemetry/status"),
  test: () =>
    fetchApi<{ success: boolean; status: ExternalTelemetryStatus }>("/telemetry/test", {
      method: "POST",
    }),
};

export type BrowserDownloadPolicy = "allow" | "deny";

export interface BrowserSupervisionSettings {
  autoRestart: boolean;
  healthCheckIntervalMs: number;
  downloadPolicy: BrowserDownloadPolicy;
  remoteRoutingEnabled: boolean;
  remoteEndpoint: string;
  remoteToken: string;
}

export interface BrowserSupervisionStatus {
  owner: "none" | "local" | "existing" | "remote";
  healthy: boolean;
  restartCount: number;
  lastHealthCheckAt: string | null;
  lastDisconnectAt: string | null;
  lastError: string | null;
}

export const browserSupervisionApi = {
  get: () =>
    fetchApi<{
      settings: BrowserSupervisionSettings;
      status: BrowserSupervisionStatus;
    }>("/browser/supervision"),
  update: (settings: BrowserSupervisionSettings) =>
    fetchApi<{
      success: boolean;
      settings: BrowserSupervisionSettings;
      status: BrowserSupervisionStatus;
    }>("/browser/supervision", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
};

export type WebResearchCredentialId = "firecrawl" | "parallel" | "tavily" | "exa" | "brave";
export type WebResearchSettingSource = "env" | "stored" | "none";

export interface WebResearchSettingsStatus {
  credentials: Array<{
    id: WebResearchCredentialId;
    label: string;
    envVar: string;
    configured: boolean;
    source: WebResearchSettingSource;
  }>;
  firecrawlApiUrl: {
    value: string;
    source: WebResearchSettingSource;
    envVar: string;
  };
  searxngUrl: {
    value: string;
    source: WebResearchSettingSource;
    envVar: string;
  };
}

export const webResearchApi = {
  settings: () => fetchApi<WebResearchSettingsStatus>("/web-research/settings"),
  updateSettings: (data: {
    credentials?: Partial<Record<WebResearchCredentialId, string | null>>;
    firecrawlApiUrl?: string | null;
    searxngUrl?: string | null;
  }) =>
    fetchApi<WebResearchSettingsStatus>("/web-research/settings", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
};

export type IntegrationCredentialId = "smithery" | "voyage";
export type IntegrationCredentialSource = "env" | "stored" | "none";

export interface IntegrationCredentialsStatus {
  credentials: Array<{
    id: IntegrationCredentialId;
    label: string;
    envVar: string;
    configured: boolean;
    source: IntegrationCredentialSource;
  }>;
}

export const integrationCredentialsApi = {
  status: () => fetchApi<IntegrationCredentialsStatus>("/integration-credentials"),
  update: (credentials: Partial<Record<IntegrationCredentialId, string | null>>) =>
    fetchApi<IntegrationCredentialsStatus>("/integration-credentials", {
      method: "PUT",
      body: JSON.stringify({ credentials }),
    }),
};

export type AccountConnectorId = "google_workspace" | "microsoft_365" | "dropbox" | "notion";
export type AccountConnectorAccess = "read" | "read_write";

export interface AccountConnectorStatus {
  id: AccountConnectorId;
  label: string;
  description: string;
  services: string[];
  docsUrl: string;
  clientIdLabel: string;
  clientSecretLabel?: string;
  redirectUri: string;
  configured: boolean;
  connected: boolean;
  access: AccountConnectorAccess;
  account?: string;
  scopes: string[];
  needsReauthorization: boolean;
}

export const accountConnectorsApi = {
  list: () => fetchApi<AccountConnectorStatus[]>("/connectors"),
  update: (
    id: AccountConnectorId,
    input: {
      clientId?: string | null;
      clientSecret?: string | null;
      access?: AccountConnectorAccess;
    }
  ) =>
    fetchApi<AccountConnectorStatus>(`/connectors/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  disconnect: (id: AccountConnectorId) =>
    fetchApi<AccountConnectorStatus>(`/connectors/${id}`, { method: "DELETE" }),
  startOAuth: (id: AccountConnectorId) =>
    fetchApi<{ state: string; authUrl: string; expiresAt: number }>(
      `/connectors/${id}/oauth/start`,
      { method: "POST" }
    ),
  oauthStatus: (state: string) =>
    fetchApi<{
      status: "pending" | "connected" | "error" | "not_found";
      connectorId?: AccountConnectorId;
      error?: string;
    }>(`/connectors/oauth/status?state=${encodeURIComponent(state)}`),
};

export const setupApi = {
  status: () => fetchApi<{ complete: boolean }>("/setup/status"),
  complete: () => fetchApi<{ success: boolean }>("/setup/complete", { method: "POST" }),
};

export * from "@/lib/api/wallet";
export const memoryApi = {
  list: (params?: { agentId?: string; userId?: string; search?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.agentId) query.append("agentId", params.agentId);
    if (params?.userId) query.append("userId", params.userId);
    if (params?.search) query.append("search", params.search);
    if (params?.limit) query.append("limit", params.limit.toString());
    return fetchApi<Memory[]>(`/memory?${query.toString()}`);
  },
  createFile: (file: string, content: string) =>
    fetchApi<{ success: boolean; file: string; appended?: boolean }>("/memory", {
      method: "POST",
      body: JSON.stringify({ file, content }),
    }),
  get: (id: string) => fetchApi<Memory>(`/memory/${encodeURIComponent(id)}`),
  status: () =>
    fetchApi<{
      success: boolean;
      chunks?: number;
      files?: number;
      provider?: string;
      model?: string;
      configuredProvider?: string;
      configuredModel?: string;
      fallbackReason?: string | null;
      error?: string;
    }>("/memory/status"),
  create: (memory: Omit<Memory, "id" | "createdAt" | "updatedAt">) =>
    fetchApi<Memory>("/memory", {
      method: "POST",
      body: JSON.stringify(memory),
    }),
  update: (id: string, memory: Partial<Memory>) =>
    fetchApi<Memory>(`/memory/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(memory),
    }),
  delete: (id: string) => fetchApi<void>(`/memory/${encodeURIComponent(id)}`, { method: "DELETE" }),
  search: (query: string, limit?: number) =>
    fetchApi<Memory[] | { results: Memory[] }>(
      `/memory/search?query=${encodeURIComponent(query)}${limit ? `&limit=${limit}` : ""}`
    ),
  providers: () =>
    fetchApi<{
      success: boolean;
      settings: Record<string, unknown>;
      providers: Array<{
        id: string;
        label: string;
        docsUrl: string;
        configured: boolean;
        active: boolean;
        fields: Array<{
          key: string;
          label: string;
          secret?: boolean;
          required?: boolean;
          placeholder?: string;
        }>;
      }>;
    }>("/memory/providers"),
  testProvider: (provider: string, settings?: Record<string, unknown>) =>
    fetchApi<{
      success: boolean;
      provider: string;
      ok: boolean;
      detail: string;
    }>("/memory/providers/test", {
      method: "POST",
      body: JSON.stringify({ provider, settings }),
    }),
};

export const tasksApi = {
  list: () => fetchApi<Task[]>("/tasks"),
  get: (id: string) => fetchApi<Task>(`/tasks/${id}`),
  getRuns: (id: string) =>
    fetchApi<
      Array<{
        id: string;
        task_id: string;
        status: "running" | "completed" | "failed";
        started_at: string;
        completed_at?: string;
        session_id?: string;
        result_preview?: string;
        error?: string;
      }>
    >(`/tasks/${id}/runs`),
  create: (task: Omit<Task, "id" | "createdAt">) =>
    fetchApi<Task>("/tasks", { method: "POST", body: JSON.stringify(task) }),
  update: (id: string, task: Partial<Task>) =>
    fetchApi<Task>(`/tasks/${id}`, {
      method: "PUT",
      body: JSON.stringify(task),
    }),
  delete: (id: string) => fetchApi<void>(`/tasks/${id}`, { method: "DELETE" }),
  run: (id: string) => fetchApi<void>(`/tasks/${id}/run`, { method: "POST" }),
};

export const skillsApi = {
  list: () => fetchApi<Skill[]>("/skills"),
  get: (id: string) => fetchApi<Skill>(`/skills/${id}`),
  create: (skill: Omit<Skill, "id" | "createdAt">) =>
    fetchApi<Skill>("/skills", { method: "POST", body: JSON.stringify(skill) }),
  update: (id: string, skill: Partial<Skill>) =>
    fetchApi<Skill>(`/skills/${id}`, {
      method: "PUT",
      body: JSON.stringify(skill),
    }),
  delete: (id: string) => fetchApi<void>(`/skills/${id}`, { method: "DELETE" }),
  test: (id: string, params: Record<string, unknown>) =>
    fetchApi<unknown>(`/skills/${id}/execute`, {
      method: "POST",
      body: JSON.stringify(params),
    }),
};

export interface ChatCapabilityOption {
  kind: "skill" | "mcp_server" | "mcp" | "agent" | "tool" | "connector" | "command";
  token: string;
  name: string;
  description: string;
  source: string;
}

export const chatApi = {
  capabilities: (workspaceDir?: string | null) =>
    fetchApi<{ capabilities: ChatCapabilityOption[] }>(
      `/chat/capabilities${workspaceDir ? `?workspaceDir=${encodeURIComponent(workspaceDir)}` : ""}`
    ),
  send: (
    message: string,
    agentId?: string,
    sessionId?: string,
    workspaceDir?: string | null,
    signal?: AbortSignal,
    queueMode?: "queue" | "steer",
    clientPendingId?: string,
    images?: ChatImageAttachment[],
    useModelRouter?: boolean
  ) =>
    fetchApi<{
      message: ChatMessage;
      sessionId: string;
      workspaceDir?: string | null;
      contextUsage?: SessionContextUsage;
      plan?: SessionPlanSnapshot | null;
      agent?: {
        id: string;
        name: string;
      };
      queued?: boolean;
      interrupted?: boolean;
      stopped?: boolean;
      pendingMessage?: PendingChatMessage;
      pendingMessages?: PendingChatMessage[];
    }>("/chat", {
      method: "POST",
      body: JSON.stringify({
        message,
        agentId,
        sessionId,
        workspaceDir,
        queueMode,
        clientPendingId,
        useModelRouter,
        ...(images && images.length ? { images } : {}),
      }),
      signal,
    }),
  steerPendingMessage: (
    sessionId: string,
    pendingMessageId: string,
    options?: { processActivities?: ChatProcessActivityPayload }
  ) =>
    fetchApi<{
      success: boolean;
      message?: ChatMessage;
      interruptedMessage?: ChatMessage;
      pendingMessage?: PendingChatMessage;
      pendingMessages?: PendingChatMessage[];
      error?: string;
    }>(`/chat/sessions/${sessionId}/pending/${pendingMessageId}/steer`, {
      method: "POST",
      body: JSON.stringify({
        processActivities: options?.processActivities || [],
      }),
    }),
  stopSession: (sessionId: string) =>
    fetchApi<{
      success: boolean;
      stopped: boolean;
      sessionId: string;
      error?: string;
    }>(`/chat/sessions/${sessionId}/stop`, { method: "POST" }),
  getPendingMessages: (sessionId: string) =>
    fetchApi<{ sessionId: string; pendingMessages: PendingChatMessage[] }>(
      `/chat/sessions/${sessionId}/pending`
    ),
  reorderPendingMessages: (sessionId: string, pendingMessageIds: string[]) =>
    fetchApi<{
      success: boolean;
      pendingMessages?: PendingChatMessage[];
      error?: string;
    }>(`/chat/sessions/${sessionId}/pending/reorder`, {
      method: "POST",
      body: JSON.stringify({ pendingMessageIds }),
    }),
  updatePendingMessage: (sessionId: string, pendingMessageId: string, content: string) =>
    fetchApi<{
      success: boolean;
      pendingMessage?: PendingChatMessage;
      pendingMessages?: PendingChatMessage[];
      error?: string;
    }>(`/chat/sessions/${sessionId}/pending/${pendingMessageId}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }),
  deletePendingMessage: (sessionId: string, pendingMessageId: string) =>
    fetchApi<{
      success: boolean;
      pendingMessages?: PendingChatMessage[];
      error?: string;
    }>(`/chat/sessions/${sessionId}/pending/${pendingMessageId}`, {
      method: "DELETE",
    }),
  localSpeechModels: () =>
    fetchApi<{
      success: boolean;
      tts?: {
        models: Array<{
          id: string;
          label: string;
          description: string;
          sizeMb: number;
          defaultVoice: string;
        }>;
        voices: Array<{
          id: string;
          label: string;
          language: string;
          gender: string;
        }>;
        status: Array<{
          id: string;
          state: "unloaded" | "loading" | "ready" | "error";
          loadProgress: number | null;
          lastError: string | null;
        }>;
      };
      stt?: {
        models: Array<{
          id: string;
          label: string;
          description: string;
          sizeMb: number;
          language: string;
        }>;
        status: Array<{
          id: string;
          state: "unloaded" | "loading" | "ready" | "error";
          loadProgress: number | null;
          lastError: string | null;
        }>;
      };
    }>("/speech/local/models"),
  loadLocalSpeechModel: (model?: string, kind: "tts" | "stt" = "tts") =>
    fetchApi<{ success: boolean; error?: string; status: unknown[] }>("/speech/local/load", {
      method: "POST",
      body: JSON.stringify({ model, kind }),
    }),
  unloadLocalSpeechModel: (model?: string, kind: "tts" | "stt" = "tts") =>
    fetchApi<{ success: boolean; unloaded: boolean; status: unknown[] }>("/speech/local/unload", {
      method: "POST",
      body: JSON.stringify({ model, kind }),
    }),
  getSpeechStatus: () =>
    fetchApi<{
      success: boolean;
      tts: {
        ready: boolean;
        provider: string | null;
        type: string | null;
        systemFallback: boolean;
        error: string | null;
      };
      stt?: {
        ready: boolean;
        provider: string | null;
        type: string | null;
        native: boolean;
        error: string | null;
      };
      realtime?: {
        provider: "managed" | "openai" | "gemini" | "moshi";
        ready: boolean;
        transport: "managed" | "webrtc" | "websocket";
        model: string;
        voice: string;
        serverUrl: string | null;
        error: string | null;
      };
      settings?: {
        ttsProvider: string;
        ttsVoice: string;
        sttProvider: string;
        realtimeProvider: string;
      };
    }>("/speech/status"),
  createRealtimeVoiceSession: () =>
    fetchApi<{
      success: boolean;
      session: {
        provider: "openai" | "gemini" | "moshi";
        transport: "webrtc" | "websocket";
        model: string;
        voice: string;
        endpoint: string;
        credential?: string;
        expiresAt?: string;
      };
    }>("/speech/realtime/session", { method: "POST" }),
  testRealtimeVoiceConnection: () =>
    fetchApi<{
      success: boolean;
      result: {
        success: true;
        provider: "managed" | "openai" | "gemini" | "moshi";
        detail: string;
      };
    }>("/speech/realtime/test", { method: "POST" }),
  dictate: (payload: {
    audioBase64: string;
    mimeType?: string;
    fileName?: string;
    model?: string;
    providerId?: string;
    provider?: "auto" | "native" | "local" | "openai";
  }) =>
    fetchApi<{
      success: boolean;
      text: string;
      providerId: string;
      providerType: string;
      model: string;
    }>("/speech/dictate", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  synthesizeSpeech: (payload: {
    text: string;
    providerId?: string;
    model?: string;
    voice?: string;
    format?: string;
    speed?: number;
  }) =>
    fetchApi<{
      success: boolean;
      audioPath: string;
      text: string;
      voice?: string;
      format: string;
      provider: string;
      providerId?: string;
      model?: string;
    }>("/speech/synthesize", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getSessions: (params?: { limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (typeof params?.limit === "number" && Number.isFinite(params.limit)) {
      query.set("limit", String(Math.max(1, Math.floor(params.limit))));
    }
    if (typeof params?.offset === "number" && Number.isFinite(params.offset)) {
      query.set("offset", String(Math.max(0, Math.floor(params.offset))));
    }
    const suffix = query.toString();
    return fetchApi<
      {
        id: string;
        agent_id: string;
        use_model_router?: boolean;
        title?: string | null;
        created_at: string;
        updated_at: string;
        workspace_dir?: string | null;
        pinned?: boolean;
        message_count?: number;
        last_message?: { role: string; content: string };
      }[]
    >("/sessions" + (suffix ? `?${suffix}` : ""));
  },
  getSession: (id: string, options?: { includeFullToolCalls?: boolean; signal?: AbortSignal }) =>
    fetchApi<{
      id: string;
      agent_id: string;
      use_model_router?: boolean;
      provider?: string;
      provider_id?: string;
      provider_name?: string;
      model?: string;
      title?: string | null;
      created_at: string;
      updated_at: string;
      workspace_dir?: string | null;
      contextUsage?: SessionContextUsage;
      tokenUsage?: SessionTokenUsage;
      plan?: SessionPlanSnapshot | null;
      messagesList: ChatMessage[];
    }>("/sessions/" + id + (options?.includeFullToolCalls ? "?includeFullToolCalls=1" : ""), {
      signal: options?.signal,
    }),
  getSessionMessage: (sessionId: string, messageId: string, signal?: AbortSignal) =>
    fetchApi<ChatMessage>(
      `/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}`,
      { signal }
    ),
  getSessionPlan: (id: string) =>
    fetchApi<{ sessionId: string; plan: SessionPlanSnapshot | null }>("/sessions/" + id + "/plan"),
  getSessionGoal: (sessionId: string) =>
    fetchApi<{ success: boolean; sessionId: string; goal: SessionGoal | null }>(
      "/sessions/" + sessionId + "/goal"
    ),
  setSessionGoal: (sessionId: string, objective: string) =>
    fetchApi<{
      success: boolean;
      error?: string;
      goal: SessionGoal | null;
      response?: string;
    }>("/sessions/" + sessionId + "/goal", {
      method: "POST",
      body: JSON.stringify({ objective }),
    }),
  updateSessionGoalStatus: (
    sessionId: string,
    action: "pause" | "resume" | "complete" | "clear",
    note?: string
  ) =>
    fetchApi<{
      success: boolean;
      error?: string;
      goal: SessionGoal | null;
      response?: string;
      cleared?: boolean;
    }>("/sessions/" + sessionId + "/goal/" + action, {
      method: "POST",
      ...(note ? { body: JSON.stringify({ note }) } : {}),
    }),
  updateSessionAgent: (id: string, agentId?: string, useModelRouter = false) =>
    fetchApi<{
      success: boolean;
      sessionId: string;
      agentId: string;
      agentName: string;
      useModelRouter: boolean;
      provider?: string;
      providerId?: string;
      providerName?: string;
      model?: string;
      contextUsage?: SessionContextUsage;
      tokenUsage?: SessionTokenUsage;
      error?: string;
    }>("/sessions/" + id + "/agent", {
      method: "PUT",
      body: JSON.stringify({ agentId, ...(useModelRouter ? { useModelRouter: true } : {}) }),
    }),
  revertSession: (
    id: string,
    payload: {
      messageIndex?: number;
      messageRole?: ChatMessage["role"];
      messageContent?: string;
      messageTimestamp?: string;
    }
  ) =>
    fetchApi<{
      success: boolean;
      sessionId: string;
      keptCount: number;
      removedCount: number;
      removedFromIndex: number;
      revertedMessage: ChatMessage;
      contextUsage?: SessionContextUsage;
      tokenUsage?: SessionTokenUsage;
      messagesList: ChatMessage[];
      error?: string;
    }>("/sessions/" + id + "/revert", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  forkSession: (
    id: string,
    payload: { throughMessageIndex?: number; agentId?: string; title?: string }
  ) =>
    fetchApi<{
      success: boolean;
      fork: {
        sessionId: string;
        sourceSessionId: string;
        agentId: string;
        messageCount: number;
        workspaceDir: string | null;
        title: string | null;
      };
      error?: string;
    }>("/sessions/" + id + "/fork", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  saveGolden: (
    id: string,
    payload: {
      messageIndex?: number;
      name?: string;
      description?: string;
      tags?: string[];
    }
  ) =>
    fetchApi<{ success: boolean; golden: AgentGolden; error?: string }>(
      "/sessions/" + id + "/golden",
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    ),
  updateSessionTitle: (id: string, title: string) =>
    fetchApi<{
      success: boolean;
      sessionId: string;
      title: string;
      error?: string;
    }>("/sessions/" + id + "/title", {
      method: "PUT",
      body: JSON.stringify({ title }),
    }),
  pinSession: (id: string, pinned: boolean) =>
    fetchApi<{
      success: boolean;
      sessionId: string;
      pinned: boolean;
      error?: string;
    }>("/sessions/" + id + "/pin", {
      method: "PUT",
      body: JSON.stringify({ pinned }),
    }),
  updateSessionWorkspace: (id: string, workspaceDir: string | null) =>
    fetchApi<{
      success: boolean;
      sessionId: string;
      workspaceDir: string | null;
      error?: string;
    }>("/sessions/" + id + "/workspace", {
      method: "PUT",
      body: JSON.stringify({ workspaceDir }),
    }),
  getSessionStatus: (sessionId?: string) =>
    fetchApi<{
      activeSessions?: StatusSessionSnapshot[];
      activeSessionIds: string[];
      count?: number;
      session?: StatusSessionSnapshot | null;
      active?: boolean;
      sessionId?: string;
    }>("/status/sessions" + (sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "")),
  listArtifacts: (sessionId?: string) =>
    fetchApi<{
      artifacts: Array<{
        sessionId: string;
        name: string;
        fileName: string;
        path: string;
        kind: "task" | "implementation" | "walkthrough" | "notes" | "custom";
        title: string;
        size: number;
        createdAt: string;
        updatedAt: string;
      }>;
      sessionId?: string;
    }>("/artifacts" + (sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "")),
  readSessionArtifact: (sessionId: string, artifactName: string) =>
    fetchApi<{
      sessionId: string;
      artifact: {
        sessionId: string;
        name: string;
        fileName: string;
        path: string;
        kind: "task" | "implementation" | "walkthrough" | "notes" | "custom";
        title: string;
        size: number;
        createdAt: string;
        updatedAt: string;
      };
      content: string;
      truncated: boolean;
      totalChars: number;
    }>(`/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactName)}`),
  deleteSessionArtifact: (sessionId: string, artifactName: string) =>
    fetchApi<{
      success: boolean;
      sessionId: string;
      artifactName: string;
      deleted?: boolean;
    }>(`/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactName)}`, {
      method: "DELETE",
    }),
  deleteSession: (id: string) => fetchApi<void>("/sessions/" + id, { method: "DELETE" }),
};

export * from "@/lib/api/lab";
export const workspaceOpenApi = {
  targets: (path: string, signal?: AbortSignal) =>
    fetchApi<{
      success: boolean;
      path: string;
      targets: WorkspaceOpenTarget[];
      error?: string;
    }>(`/ide/open-targets?path=${encodeURIComponent(path)}`, { signal }),
  open: (path: string, targetId: string) =>
    fetchApi<{ success: boolean; path: string; error?: string }>("/ide/open", {
      method: "POST",
      body: JSON.stringify({ path, targetId }),
    }),
};

export const dashboardApi = {
  getStats: () => fetchApi<DashboardStats>("/dashboard/stats"),
};

export * from "@/lib/api/computer-use";
export interface LogPageEntry {
  id: string;
  level: string;
  source: string;
  message: string;
  metadata?: string;
  created_at: string;
}

export type MigrationSourceKind = "openclaw" | "hermes" | "codex" | "claude-code" | "opencode";
export type MigrationPreset = "user-data" | "full";
export type MigrationSkillConflictMode = "skip" | "overwrite" | "rename";
export type MigrationItemStatus =
  | "planned"
  | "migrated"
  | "archived"
  | "skipped"
  | "conflict"
  | "error";

export interface MigrationSourceCandidate {
  kind: MigrationSourceKind;
  path: string;
  exists: boolean;
  label: string;
  confidence: "high" | "medium" | "manual";
  detected: {
    persona: boolean;
    memoryFiles: number;
    skillCount: number;
    configFiles: number;
    envFiles: number;
    sessionCount: number;
  };
}

export interface SourceMigrationRequest {
  sourceKind?: MigrationSourceKind;
  sourcePath?: string;
  preset?: MigrationPreset;
  dryRun?: boolean;
  overwrite?: boolean;
  migrateSecrets?: boolean;
  skillConflict?: MigrationSkillConflictMode;
  workspaceTarget?: string;
}

export interface MigrationItem {
  id: string;
  category: string;
  name: string;
  source?: string;
  target?: string;
  status: MigrationItemStatus;
  detail?: string;
}

export interface SourceMigrationReport {
  success: boolean;
  dryRun: boolean;
  sourceKind: MigrationSourceKind;
  sourceRoot: string;
  targetRoot: string;
  preset: MigrationPreset;
  migrateSecrets: boolean;
  overwrite: boolean;
  skillConflict: MigrationSkillConflictMode;
  reportPath?: string;
  createdAt: string;
  summary: Record<MigrationItemStatus | "total", number>;
  warnings: string[];
  items: MigrationItem[];
  nextSteps: string[];
}

export const migrationApi = {
  sources: () => fetchApi<{ sources: MigrationSourceCandidate[] }>("/migrations/sources"),
  preview: (payload: SourceMigrationRequest) =>
    fetchApi<SourceMigrationReport>("/migrations/preview", {
      method: "POST",
      body: JSON.stringify({ ...payload, dryRun: true }),
    }),
  run: (payload: SourceMigrationRequest) =>
    fetchApi<SourceMigrationReport>("/migrations/run", {
      method: "POST",
      body: JSON.stringify({ ...payload, dryRun: false }),
    }),
};

export const nearbyApi = {
  status: () => fetchApi<NearbyStatus>("/nearby"),
  updateSettings: (settings: NearbySettings) =>
    fetchApi<{ success: boolean; settings: NearbySettings; status: NearbyStatus }>(
      "/nearby/settings",
      { method: "PUT", body: JSON.stringify(settings) }
    ),
  makeDiscoverable: () =>
    fetchApi<{ success: boolean; discoverableUntil: string }>("/nearby/discoverable", {
      method: "POST",
    }),
  stopDiscoverable: () =>
    fetchApi<{ success: boolean }>("/nearby/discoverable", { method: "DELETE" }),
  refresh: () =>
    fetchApi<{ success: boolean; status: NearbyStatus }>("/nearby/refresh", { method: "POST" }),
  pair: (peerId: string, baseUrl?: string) =>
    fetchApi<NearbyPairing>("/nearby/pair", {
      method: "POST",
      body: JSON.stringify({ peerId, baseUrl }),
    }),
  pairByAddress: (baseUrl: string) =>
    fetchApi<NearbyPairing>("/nearby/pair-address", {
      method: "POST",
      body: JSON.stringify({ baseUrl }),
    }),
  confirmPairing: (pairingId: string) =>
    fetchApi<NearbyPairing>(`/nearby/pairings/${encodeURIComponent(pairingId)}/confirm`, {
      method: "POST",
    }),
  rejectPairing: (pairingId: string) =>
    fetchApi<{ success: boolean }>(`/nearby/pairings/${encodeURIComponent(pairingId)}`, {
      method: "DELETE",
    }),
  removePeer: (peerId: string) =>
    fetchApi<{ success: boolean }>(`/nearby/peers/${encodeURIComponent(peerId)}`, {
      method: "DELETE",
    }),
  updatePeer: (peerId: string, syncEnabled: boolean) =>
    fetchApi<NearbyStatus["pairedPeers"][number]>(`/nearby/peers/${encodeURIComponent(peerId)}`, {
      method: "PUT",
      body: JSON.stringify({ syncEnabled }),
    }),
  sendSession: (peerId: string, sessionId: string) =>
    fetchApi<{ transferId: string }>(`/nearby/peers/${encodeURIComponent(peerId)}/sessions`, {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }),
  acceptTransfer: (transferId: string, workspaceDir?: string | null) =>
    fetchApi<{ sessionId: string; duplicate: boolean }>(
      `/nearby/transfers/${encodeURIComponent(transferId)}/accept`,
      { method: "POST", body: JSON.stringify({ workspaceDir: workspaceDir || null }) }
    ),
  dismissTransfer: (transferId: string) =>
    fetchApi<{ success: boolean }>(`/nearby/transfers/${encodeURIComponent(transferId)}`, {
      method: "DELETE",
    }),
};

export const logsApi = {
  getSystem: () =>
    fetchApi<
      {
        id: string;
        level: string;
        source: string;
        message: string;
        created_at: string;
      }[]
    >("/logs/system"),
  getPage: (limit: number, offset: number) =>
    fetchApi<{
      logs: LogPageEntry[];
      total: number;
      limit: number;
      offset: number;
      hasMore: boolean;
    }>(`/logs/system?includeTotal=1&limit=${limit}&offset=${offset}`),
  search: (query: string) =>
    fetchApi<{
      system: {
        id: string;
        level: string;
        source: string;
        message: string;
        created_at: string;
      }[];
      sessionMessages: {
        id: string;
        session_id: string;
        role: string;
        content: string;
        created_at: string;
      }[];
      agent: {
        id: string;
        agent_id: string;
        action: string;
        created_at: string;
      }[];
      channel: {
        id: string;
        channel_type: string;
        content: string;
        created_at: string;
      }[];
    }>("/logs/search?q=" + encodeURIComponent(query)),
  getActivity: (minutes?: number) =>
    fetchApi<{
      system: {
        id: string;
        level: string;
        source: string;
        message: string;
        created_at: string;
      }[];
      messages: {
        id: string;
        session_id: string;
        role: string;
        content: string;
        created_at: string;
      }[];
      agent: {
        id: string;
        agent_id: string;
        action: string;
        created_at: string;
      }[];
      channel: {
        id: string;
        channel_type: string;
        content: string;
        created_at: string;
      }[];
    }>("/logs/activity?minutes=" + (minutes || 60)),
  getStats: (hours?: number) =>
    fetchApi<{
      counts: {
        system: number;
        messages: number;
        agent: number;
        channel: number;
        cli: number;
      };
      totals: {
        system: number;
        messages: number;
        agent: number;
        channel: number;
        cli: number;
        combined: number;
      };
      hours: number;
    }>("/logs/stats?hours=" + (hours || 24)),
};

export const sessionsApi = {
  list: (params?: { limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (typeof params?.limit === "number" && Number.isFinite(params.limit)) {
      query.set("limit", String(Math.max(1, Math.floor(params.limit))));
    }
    if (typeof params?.offset === "number" && Number.isFinite(params.offset)) {
      query.set("offset", String(Math.max(0, Math.floor(params.offset))));
    }
    const suffix = query.toString();
    return fetchApi<
      {
        id: string;
        agent_id: string;
        title?: string | null;
        created_at: string;
        updated_at: string;
        workspace_dir?: string | null;
        pinned?: boolean;
        message_count?: number;
        last_message?: { role: string; content: string };
      }[]
    >("/sessions" + (suffix ? `?${suffix}` : ""));
  },
  get: (id: string, options?: { includeFullToolCalls?: boolean }) =>
    fetchApi<{
      id: string;
      agent_id: string;
      messages?: string;
      created_at: string;
      updated_at: string;
      workspace_dir?: string | null;
      messagesList: ChatMessage[];
    }>("/sessions/" + id + (options?.includeFullToolCalls ? "?includeFullToolCalls=1" : "")),
  delete: (id: string) => fetchApi<void>("/sessions/" + id, { method: "DELETE" }),
};

export const subagentApi = {
  spawn: (
    task: string,
    options?: {
      model?: string;
      timeout?: number;
      label?: string;
      agentId?: string;
      workspaceDir?: string;
      requesterSessionId?: string;
    }
  ) =>
    fetchApi<{ subagentId: string; status: string }>("/subagents/spawn", {
      method: "POST",
      body: JSON.stringify({ task, ...options }),
    }),
  list: (requesterSessionId?: string) =>
    fetchApi<Array<Record<string, unknown>>>(
      `/subagents${requesterSessionId ? `?sessionId=${encodeURIComponent(requesterSessionId)}` : ""}`
    ),
  get: (id: string) => fetchApi<Record<string, unknown>>(`/subagents/${encodeURIComponent(id)}`),
  kill: (id: string) =>
    fetchApi<void>(`/subagents/${encodeURIComponent(id)}/kill`, {
      method: "POST",
    }),
  clear: (id: string) =>
    fetchApi<void>(`/subagents/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  clearHistory: (requesterSessionId: string) =>
    fetchApi<{ success: boolean; cleared: number }>(
      `/subagents?sessionId=${encodeURIComponent(requesterSessionId)}`,
      { method: "DELETE" }
    ),
};
