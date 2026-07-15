import { apiFetch } from "@/lib/auth";
import type { PendingChatMessage } from "@/lib/status-stream";
import type {
  Agent,
  AgentSummary,
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
  SessionPlanSnapshot,
  SessionTokenUsage,
  Skill,
  Task,
} from "@/types";

const API_BASE = "/api";

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

/**
 * Resolve a human-readable error from an ApiResponse: prefer a nested
 * `data.error` (envelope returned with HTTP 200), then the transport `error`,
 * then the caller's fallback. Centralizes the chain repeated across hooks.
 */
export function extractApiError<T>(response: ApiResponse<T>, fallback: string): string {
  const data = response.data as { error?: unknown } | undefined;
  const dataError =
    data && typeof data === "object" && typeof data.error === "string" ? data.error : null;
  return dataError || response.error || fallback;
}

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
  const url = `${API_BASE}${endpoint}`;
  const response = await apiFetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.text();
    return { success: false, error };
  }

  const data = await response.json();
  return { success: true, data };
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
  categories?: string[];
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

export const systemApi = {
  restart: () =>
    fetchApi<{ success: boolean; supervised: boolean; message: string }>("/system/restart", {
      method: "POST",
    }),
  health: () => fetchApi<{ status?: string; uptime?: number }>("/health"),
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

export type BrowserDownloadPolicy = "ask" | "allow" | "deny";

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

export interface WalletStatus {
  exists: boolean;
  unlocked: boolean;
  address?: string;
  createdAt?: string;
  updatedAt?: string;
  unlockExpiresAt?: string;
  wordCount?: number;
  kdf?: {
    name: "PBKDF2";
    hash: "SHA-256";
    iterations: number;
  };
  agentAccessEnabled: boolean;
  chains: Array<WalletChain>;
  primaryAddresses?: Record<WalletChain, string>;
}

export type WalletChain = "eth" | "btc" | "sol";
export type WalletTokenChain = "eth" | "sol";

export interface WalletAccount {
  chain: WalletChain;
  index: number;
  path: string;
  address: string;
}

export interface WalletBalance extends WalletAccount {
  symbol: "ETH" | "BTC" | "SOL";
  decimals: number;
  amount: string;
  raw: string;
}

export interface WalletTransaction {
  chain: WalletChain;
  txid: string;
  status: "confirmed" | "pending" | "failed";
  from?: string;
  to?: string;
  amount?: string;
  fee?: string;
  confirmations?: number;
  timestamp?: string;
  explorerUrl: string;
}

export interface WalletTokenBalance {
  chain: WalletTokenChain;
  index: number;
  address: string;
  tokenAddress: string;
  symbol: string;
  name?: string;
  decimals: number;
  amount: string;
  raw: string;
  tokenAccount?: string;
}

export interface WalletInstructionAccount {
  pubkey: string;
  isSigner?: boolean;
  isWritable?: boolean;
}

export interface WalletRpcConfig {
  ethRpc: string;
  solRpc: string;
  btcApi: string;
}

export interface WalletRpcServiceStatus {
  chain: WalletChain;
  endpoint: string;
  healthy: boolean;
  latencyMs: number;
  latestHeight?: string;
  error?: string;
}

export interface WalletRpcStatus {
  checkedAt: string;
  services: WalletRpcServiceStatus[];
}

export interface WalletTokenTransaction {
  chain: WalletTokenChain;
  index: number;
  address: string;
  tokenAddress: string;
  symbol: string;
  name?: string;
  decimals: number;
  txid: string;
  status: "confirmed" | "pending" | "failed";
  direction: "in" | "out" | "self" | "unknown";
  from?: string;
  to?: string;
  amount: string;
  raw: string;
  fee?: string;
  timestamp?: string;
  explorerUrl: string;
}

export interface WalletAgentPolicy {
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
  allowedSendRecipients: string[];
  maxSendAmount: string;
}

export interface WalletSwapEthUniswapResult {
  chain: "eth";
  dex: "uniswap_v2";
  from: string;
  toTokenAddress: string;
  toTokenSymbol: string;
  amountInEth: string;
  amountInWei: string;
  quotedAmountOut: string;
  quotedAmountOutRaw: string;
  minAmountOut: string;
  minAmountOutRaw: string;
  slippageBps: number;
  recipient: string;
  deadline: string;
  txid?: string;
  explorerUrl?: string;
  dryRun: boolean;
}

export const walletApi = {
  status: () => fetchApi<WalletStatus>("/wallet/status"),
  rpc: () => fetchApi<WalletRpcConfig>("/wallet/rpc"),
  rpcStatus: () => fetchApi<WalletRpcStatus>("/wallet/rpc/status"),
  updateRpc: (payload: { ethRpc?: string; solRpc?: string; btcApi?: string }) =>
    fetchApi<{ success: boolean; config: WalletRpcConfig }>("/wallet/rpc", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  create: (password: string) =>
    fetchApi<{
      success: boolean;
      mnemonic: string;
      address: string;
      primaryAddresses: Record<WalletChain, string>;
    }>("/wallet/create", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  importWallet: (mnemonic: string, password: string) =>
    fetchApi<{
      success: boolean;
      mnemonic: string;
      address: string;
      primaryAddresses: Record<WalletChain, string>;
    }>("/wallet/import", {
      method: "POST",
      body: JSON.stringify({ mnemonic, password }),
    }),
  unlock: (password: string) =>
    fetchApi<{
      success: boolean;
      address: string;
      primaryAddresses: Record<WalletChain, string>;
      unlockExpiresAt: string;
    }>("/wallet/unlock", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  revealSeed: (password: string, acknowledgement: string) =>
    fetchApi<{ mnemonic: string; wordCount: number }>("/wallet/seed", {
      method: "POST",
      body: JSON.stringify({ password, acknowledgement }),
    }),
  lock: () => fetchApi<{ success: boolean }>("/wallet/lock", { method: "POST" }),
  accounts: (params?: { chains?: WalletChain[]; count?: number; startIndex?: number }) => {
    const query = new URLSearchParams();
    if (params?.chains?.length) query.set("chains", params.chains.join(","));
    if (typeof params?.count === "number") query.set("count", String(params.count));
    if (typeof params?.startIndex === "number") query.set("startIndex", String(params.startIndex));
    return fetchApi<WalletAccount[]>(`/wallet/accounts${query.size ? `?${query.toString()}` : ""}`);
  },
  receive: (chain: WalletChain, index = 0) =>
    fetchApi<WalletAccount>(
      `/wallet/receive?chain=${encodeURIComponent(chain)}&index=${encodeURIComponent(index)}`
    ),
  balances: (params?: { chains?: WalletChain[]; count?: number; startIndex?: number }) => {
    const query = new URLSearchParams();
    if (params?.chains?.length) query.set("chains", params.chains.join(","));
    if (typeof params?.count === "number") query.set("count", String(params.count));
    if (typeof params?.startIndex === "number") query.set("startIndex", String(params.startIndex));
    return fetchApi<WalletBalance[]>(`/wallet/balances${query.size ? `?${query.toString()}` : ""}`);
  },
  tokenBalances: (params: { chain: WalletTokenChain; index?: number; includeZero?: boolean }) => {
    const query = new URLSearchParams();
    query.set("chain", params.chain);
    if (typeof params.index === "number") query.set("index", String(params.index));
    if (params.includeZero) query.set("includeZero", "true");
    return fetchApi<WalletTokenBalance[]>(`/wallet/tokens?${query.toString()}`);
  },
  tokenTransactions: (params: {
    chain: WalletTokenChain;
    index?: number;
    limit?: number;
    tokenAddress?: string;
    rpcUrl?: string;
  }) => {
    const query = new URLSearchParams();
    query.set("chain", params.chain);
    if (typeof params.index === "number") query.set("index", String(params.index));
    if (typeof params.limit === "number") query.set("limit", String(params.limit));
    if (params.tokenAddress) query.set("tokenAddress", params.tokenAddress);
    if (params.rpcUrl) query.set("rpcUrl", params.rpcUrl);
    return fetchApi<WalletTokenTransaction[]>(`/wallet/token-transactions?${query.toString()}`);
  },
  transactions: (params: {
    chain: WalletChain;
    index?: number;
    limit?: number;
    rpcUrl?: string;
  }) => {
    const query = new URLSearchParams();
    query.set("chain", params.chain);
    if (typeof params.index === "number") query.set("index", String(params.index));
    if (typeof params.limit === "number") query.set("limit", String(params.limit));
    if (params.rpcUrl) query.set("rpcUrl", params.rpcUrl);
    return fetchApi<WalletTransaction[]>(`/wallet/transactions?${query.toString()}`);
  },
  send: (payload: {
    chain: WalletChain;
    to: string;
    amount: string;
    index?: number;
    memo?: string;
    rpcUrl?: string;
    feeRate?: number;
  }) =>
    fetchApi<{ chain: WalletChain; txid: string; explorerUrl: string }>("/wallet/send", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  sendToken: (payload: {
    chain: WalletTokenChain;
    tokenAddress: string;
    to: string;
    amount: string;
    index?: number;
    decimals?: number;
    memo?: string;
    rpcUrl?: string;
  }) =>
    fetchApi<{
      chain: WalletTokenChain;
      txid: string;
      explorerUrl: string;
      tokenAddress: string;
    }>("/wallet/send-token", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  ethContractCall: (payload: {
    contractAddress: string;
    abi?: string;
    method: string;
    methodSignature?: string;
    args?: unknown[];
    index?: number;
    value?: string;
    gasLimit?: number | string;
    gasPriceGwei?: string;
    maxFeePerGasGwei?: string;
    maxPriorityFeePerGasGwei?: string;
    nonce?: number;
    readOnly?: boolean;
    rpcUrl?: string;
  }) =>
    fetchApi<Record<string, unknown>>("/wallet/eth-contract", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  solProgramInstruction: (payload: {
    programId: string;
    keys?: WalletInstructionAccount[];
    accounts?: WalletInstructionAccount[];
    dataBase64?: string;
    dataHex?: string;
    dataUtf8?: string;
    index?: number;
    rpcUrl?: string;
    computeUnitLimit?: number;
    computeUnitPriceMicroLamports?: number;
    skipPreflight?: boolean;
  }) =>
    fetchApi<{ chain: "sol"; txid: string; explorerUrl: string }>("/wallet/sol-instruction", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  swapEthUniswap: (payload: {
    tokenOut: string;
    amountEth?: string;
    percent?: number;
    minAmountOut?: string;
    slippageBps?: number;
    deadlineSeconds?: number;
    index?: number;
    recipient?: string;
    rpcUrl?: string;
    dryRun?: boolean;
  }) =>
    fetchApi<WalletSwapEthUniswapResult>("/wallet/swap-eth-uniswap", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  priceQuote: (payload: {
    source?: "auto" | "chainlink" | "pyth" | "jupiter";
    symbol?: string;
    pair?: string;
    feedAddress?: string;
    feedId?: string;
    pythFeedId?: string;
    mint?: string;
    quoteCurrency?: string;
    rpcUrl?: string;
  }) =>
    fetchApi<{
      source: "chainlink" | "pyth" | "jupiter";
      base: string;
      quote: string;
      price: string;
      confidence?: string;
      publishTime?: string;
      feedAddress?: string;
      feedId?: string;
      mint?: string;
    }>("/wallet/price", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  swap: (payload: {
    venue: "uniswap_v2" | "uniswap_v3" | "jupiter" | "uniswap" | "jup" | string;
    tokenOut?: string;
    tokenAddress?: string;
    amountEth?: string;
    percent?: number;
    minAmountOut?: string;
    recipient?: string;
    feeTier?: number;
    inputMint?: string;
    outputMint?: string;
    amount?: string;
    amountRaw?: string;
    index?: number;
    slippageBps?: number;
    deadlineSeconds?: number;
    rpcUrl?: string;
    wrapUnwrapSol?: boolean;
    computeUnitPriceMicroLamports?: number;
    skipPreflight?: boolean;
    dryRun?: boolean;
    execute?: boolean;
    broadcast?: boolean;
  }) =>
    fetchApi<{
      venue: "uniswap_v2" | "uniswap_v3" | "jupiter";
      chain: "eth" | "sol";
      from: string;
      inputToken: string;
      outputToken: string;
      amountIn: string;
      amountInRaw: string;
      quotedAmountOut: string;
      quotedAmountOutRaw: string;
      minAmountOut: string;
      minAmountOutRaw: string;
      slippageBps: number;
      dryRun: boolean;
      route?: string;
      routePlan?: Array<{
        label?: string;
        ammKey?: string;
        inputMint?: string;
        outputMint?: string;
        inAmount?: string;
        outAmount?: string;
      }>;
      txid?: string;
      explorerUrl?: string;
    }>("/wallet/swap", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  endpoints: () =>
    fetchApi<{
      ethereum: {
        wrappedNative: string;
        dex: Record<string, string>;
        oracles: {
          chainlinkFeedRegistry: string;
          usdDenomination: string;
          chainlinkUsdFeeds: Record<string, string>;
          chainlinkBaseAssets: Record<string, string>;
        };
      };
      solana: {
        nativeMint: string;
        commonMints: Record<string, string>;
        programs: Record<string, string>;
      };
      services: Record<string, string>;
    }>("/wallet/endpoints"),
  dapps: () =>
    fetchApi<{
      adapters: Array<{
        adapter: string;
        chain: string;
        write: boolean;
        description: string;
      }>;
      notes: string[];
    }>("/wallet/dapps"),
  rpcCall: (payload: {
    chain: "eth" | "sol";
    method: string;
    params?: unknown[];
    rpcUrl?: string;
    id?: string | number;
  }) =>
    fetchApi<{
      chain: "eth" | "sol";
      rpcUrl: string;
      method: string;
      id?: string | number;
      result?: unknown;
      error?: unknown;
    }>("/wallet/rpc-call", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  dapp: (payload: { adapter: string; payload?: Record<string, unknown> }) =>
    fetchApi<unknown>("/wallet/dapp", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  x402: (payload: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    network?: string;
    maxAmountAtomic?: string;
    index?: number;
    timeoutMs?: number;
    dryRun?: boolean;
    parseJsonResponse?: boolean;
  }) =>
    fetchApi<{
      url: string;
      method: string;
      status: number;
      paid: boolean;
      attemptedPayment: boolean;
      paymentHeaderUsed?: string;
      paymentRequirement?: {
        x402Version: number;
        scheme: string;
        network: string;
        amount: string;
        asset: string;
        payTo: string;
        maxTimeoutSeconds: number;
        extra?: Record<string, unknown>;
      };
      settlement?: {
        success?: boolean;
        errorReason?: string;
        errorMessage?: string;
        payer?: string;
        transaction?: string;
        network?: string;
      };
      responseHeaders: Record<string, string>;
      body?: unknown;
    }>("/wallet/x402", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  signMessage: (message: string, chain: WalletChain = "eth", index = 0) =>
    fetchApi<{ address: string; signature: string }>("/wallet/sign", {
      method: "POST",
      body: JSON.stringify({ message, chain, index }),
    }),
  deleteWallet: (password?: string) =>
    fetchApi<{ success: boolean }>("/wallet", {
      method: "DELETE",
      body: password ? JSON.stringify({ password }) : undefined,
    }),
  setAgentAccess: (enabled: boolean) =>
    fetchApi<{ success: boolean; enabled: boolean }>("/wallet/agent-access", {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    }),
  getAgentPolicy: () => fetchApi<WalletAgentPolicy>("/wallet/agent-policy"),
  updateAgentPolicy: (policy: Partial<WalletAgentPolicy>) =>
    fetchApi<{ success: boolean; policy: WalletAgentPolicy }>("/wallet/agent-policy", {
      method: "PUT",
      body: JSON.stringify(policy),
    }),
};

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
  getSessionPlan: (id: string) =>
    fetchApi<{ sessionId: string; plan: SessionPlanSnapshot | null }>("/sessions/" + id + "/plan"),
  updateSessionAgent: (id: string, agentId: string) =>
    fetchApi<{
      success: boolean;
      sessionId: string;
      agentId: string;
      agentName: string;
      provider?: string;
      providerId?: string;
      providerName?: string;
      model?: string;
      contextUsage?: SessionContextUsage;
      tokenUsage?: SessionTokenUsage;
      error?: string;
    }>("/sessions/" + id + "/agent", {
      method: "PUT",
      body: JSON.stringify({ agentId }),
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
      activeSessions?: Array<{
        sessionId: string;
        status: string;
        timestamp: number;
        detail?: string;
        agentId?: string;
        activities: Array<{
          id: string;
          phase: "start" | "result" | "error" | "blocked";
          text: string;
          timestamp: number;
          toolName?: string;
        }>;
      }>;
      activeSessionIds: string[];
      count?: number;
      session?: {
        sessionId: string;
        status: string;
        timestamp: number;
        detail?: string;
        agentId?: string;
        activities: Array<{
          id: string;
          phase: "start" | "result" | "error" | "blocked";
          text: string;
          timestamp: number;
          toolName?: string;
        }>;
      } | null;
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

export interface AgentTrajectoryStructure {
  tools: Array<{
    name: string;
    status: string;
    argumentKeys: string[];
    resultKeys: string[];
  }>;
  response: {
    hasContent: boolean;
    hasThinking: boolean;
    contentKind: "empty" | "text" | "structured";
  };
}

export interface AgentGolden {
  id: string;
  trajectoryId: string;
  name: string;
  description: string | null;
  tags: string[];
  baseline: {
    id: string;
    sessionId: string;
    turnIndex: number;
    agentId: string;
    provider: string | null;
    model: string | null;
    request: {
      userMessage: ChatMessage;
      userMessageIndex: number;
      workspaceDir: string | null;
    };
    structure: AgentTrajectoryStructure;
    createdAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface AgentEvalRun {
  id: string;
  goldenId: string;
  replaySessionId: string | null;
  status: "running" | "passed" | "failed" | "error";
  score: number | null;
  comparison: {
    equivalent: boolean;
    score: number;
    differences: Array<{
      path: string;
      expected: unknown;
      actual: unknown;
      severity: "error" | "warning";
    }>;
  } | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export type ResearchExportFormat =
  | "cybara_trace"
  | "trl_sft"
  | "prompt_completion"
  | "long_context";

export interface ResearchTraceSummary {
  id: string;
  sessionId: string;
  turnIndex: number;
  agentId: string;
  provider: string | null;
  model: string | null;
  promptPreview: string;
  responsePreview: string;
  messageCount: number;
  toolCallCount: number;
  toolNames: string[];
  failedToolCallCount: number;
  hasObservableReasoning: boolean;
  observableReasoningCharacters: number;
  qualityScore: number;
  qualityFlags: string[];
  split: "train" | "validation" | "test";
  createdAt: string;
}

export interface ResearchTraceStats {
  total: number;
  toolCalls: number;
  failedToolCalls: number;
  reasoningTraces: number;
  cleanTraces: number;
  train: number;
  validation: number;
  test: number;
}

export type IntelligenceTaskDifficulty =
  | "basic"
  | "intermediate"
  | "advanced"
  | "expert"
  | "frontier";

export interface IntelligenceBenchmarkResult {
  taskId: string;
  label: string;
  category: "instruction" | "reasoning" | "coding" | "transformation" | "tool_use";
  passed: boolean;
  score: number;
  rating?: number;
  response: string;
  expected: string;
  difficulty: IntelligenceTaskDifficulty;
  weight: number;
  gradingReason: string;
  durationMs: number;
  toolCalls: string[];
  error: string | null;
}

export interface IntelligenceBenchmarkRun {
  id: string;
  suiteId: string;
  agentId: string;
  provider: string | null;
  model: string | null;
  status: "running" | "completed" | "cancelled" | "error";
  score: number;
  currentTask: number;
  results: IntelligenceBenchmarkResult[];
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export const evalsApi = {
  list: () => fetchApi<{ goldens: AgentGolden[]; runs: AgentEvalRun[] }>("/evals"),
  export: (format: "bundle" | "jsonl", sanitize: boolean) =>
    fetchApi<{
      filename: string;
      mimeType: string;
      content: string;
      count: number;
    }>(`/evals/export?format=${format}&sanitize=${sanitize ? "1" : "0"}`),
  import: (bundle: unknown) =>
    fetchApi<{
      success: boolean;
      imported: AgentGolden[];
      count: number;
      error?: string;
    }>("/evals/import", { method: "POST", body: JSON.stringify({ bundle }) }),
  replay: (goldenId: string, payload?: { agentId?: string; modelOverride?: string }) =>
    fetchApi<{ success: boolean; run: AgentEvalRun; error?: string }>(
      `/evals/goldens/${goldenId}/replay`,
      { method: "POST", body: JSON.stringify(payload ?? {}) }
    ),
  runSuite: (goldenIds?: string[]) =>
    fetchApi<{ success: boolean; runs: AgentEvalRun[]; error?: string }>("/evals/run", {
      method: "POST",
      body: JSON.stringify(goldenIds ? { goldenIds } : {}),
    }),
  deleteGolden: (goldenId: string) =>
    fetchApi<{ success: boolean }>(`/evals/goldens/${goldenId}`, {
      method: "DELETE",
    }),
};

export const researchApi = {
  traces: (limit = 200, offset = 0) =>
    fetchApi<{
      traces: ResearchTraceSummary[];
      stats: ResearchTraceStats;
      total: number;
      limit: number;
      offset: number;
    }>(`/evals/research/traces?limit=${limit}&offset=${offset}`),
  export: (format: ResearchExportFormat, sanitize: boolean, ids: string[]) => {
    const params = new URLSearchParams({
      format,
      sanitize: sanitize ? "1" : "0",
    });
    if (ids.length > 0) params.set("ids", ids.join(","));
    return fetchApi<{
      format: ResearchExportFormat;
      filename: string;
      mimeType: string;
      content: string;
      count: number;
    }>(`/evals/research/export?${params.toString()}`);
  },
};

export const benchmarksApi = {
  list: () =>
    fetchApi<{
      suite: {
        id: string;
        name: string;
        description: string;
        taskCount: number;
        minRating?: number;
        maxRating?: number;
        tasks: Array<{
          id: string;
          label: string;
          category: string;
          prompt: string;
          rating?: number;
          difficulty: IntelligenceTaskDifficulty;
          weight: number;
          requiredTool?: string;
        }>;
      };
      runs: IntelligenceBenchmarkRun[];
    }>("/evals/benchmarks"),
  run: (agentId: string) =>
    fetchApi<{
      success: boolean;
      run?: IntelligenceBenchmarkRun;
      error?: string;
    }>("/evals/benchmarks/run", {
      method: "POST",
      body: JSON.stringify({ agentId }),
    }),
  export: () =>
    fetchApi<{
      filename: string;
      mimeType: string;
      content: string;
      count: number;
    }>("/evals/benchmarks/export"),
  manifest: () =>
    fetchApi<{ filename: string; mimeType: string; content: string }>("/evals/benchmarks/manifest"),
  cancel: (runId: string) =>
    fetchApi<{
      success: boolean;
      run?: IntelligenceBenchmarkRun;
      error?: string;
    }>("/evals/benchmarks/cancel", {
      method: "POST",
      body: JSON.stringify({ runId }),
    }),
  remove: (runId: string) =>
    fetchApi<{ success: boolean; error?: string }>("/evals/benchmarks", {
      method: "DELETE",
      body: JSON.stringify({ runId }),
    }),
};

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

export interface ComputerUseStatus {
  available: boolean;
  command: string;
  driverSource?:
    | "env"
    | "config"
    | "bundled"
    | "managed-runtime"
    | "path"
    | "known-install-dir"
    | "default";
  configuredCommand?: string;
  platform: string;
  version?: string;
  accessibility?: boolean;
  screenRecording?: boolean;
  ready: boolean;
  message: string;
  installHint?: string;
  searchedPaths?: string[];
}

export interface ComputerUseTrajectorySummary {
  id: string;
  sessionId: string;
  status: "recording" | "completed" | "interrupted" | "error";
  recordVideo: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  replayOf?: string;
  turnCount: number;
  screenshotCount: number;
  clickCount: number;
  durationMs: number;
  videoAvailable: boolean;
}

export interface ComputerUseTrajectoryTurn {
  index: number;
  tool: string;
  arguments: Record<string, unknown>;
  result: unknown;
  pid?: number;
  clickPoint?: { x: number; y: number };
  timestamp?: string;
  hasScreenshot: boolean;
  hasClickImage: boolean;
  hasAppState: boolean;
}

export interface ComputerUseTrajectoryDetail extends ComputerUseTrajectorySummary {
  turns: ComputerUseTrajectoryTurn[];
}

export interface ComputerUseTrajectorySettings {
  driverCommand: string;
  trajectoryCaptureEnabled: boolean;
  trajectoryVideoEnabled: boolean;
}

export const computerUseApi = {
  getStatus: () => fetchApi<ComputerUseStatus>("/computer-use/status"),
  grantPermissions: () =>
    fetchApi<{ ok: boolean; message: string }>("/computer-use/permissions/grant", {
      method: "POST",
    }),
  trajectories: () =>
    fetchApi<{
      trajectories: ComputerUseTrajectorySummary[];
      activeId: string | null;
      settings: ComputerUseTrajectorySettings;
    }>("/computer-use/trajectories"),
  trajectory: (id: string) =>
    fetchApi<{
      success: boolean;
      trajectory?: ComputerUseTrajectoryDetail;
      error?: string;
    }>(`/computer-use/trajectories/${encodeURIComponent(id)}`),
  configureTrajectories: (settings: {
    trajectoryCaptureEnabled?: boolean;
    trajectoryVideoEnabled?: boolean;
  }) =>
    fetchApi<{ success: boolean; settings: ComputerUseTrajectorySettings }>(
      "/computer-use/trajectories/config",
      { method: "POST", body: JSON.stringify(settings) }
    ),
  exportTrajectories: (ids: string[], includeMedia: boolean, redact: boolean) => {
    const params = new URLSearchParams({
      includeMedia: includeMedia ? "1" : "0",
      redact: redact ? "1" : "0",
    });
    if (ids.length > 0) params.set("ids", ids.join(","));
    return fetchApi<{
      filename: string;
      mimeType: string;
      content: string;
      count: number;
    }>(`/computer-use/trajectories/export?${params.toString()}`);
  },
  replayTrajectory: (id: string, options?: { delayMs?: number; stopOnError?: boolean }) =>
    fetchApi<{
      success: boolean;
      source: ComputerUseTrajectoryDetail;
      replay: ComputerUseTrajectoryDetail | null;
      result: string;
    }>(`/computer-use/trajectories/${encodeURIComponent(id)}/replay`, {
      method: "POST",
      body: JSON.stringify(options ?? {}),
    }),
  deleteTrajectory: (id: string) =>
    fetchApi<{ success: boolean }>(`/computer-use/trajectories/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
};

export interface SandboxBrowserStatus {
  dockerAvailable: boolean;
  imageBuilt: boolean;
  running: boolean;
  cdpPort: number;
  novncPort: number;
  cdpUrl: string;
  novncUrl: string;
  reason?: string;
}

export const sandboxBrowserApi = {
  getStatus: () => fetchApi<SandboxBrowserStatus>("/browser/sandbox/status"),
  start: () =>
    fetchApi<{
      success: boolean;
      status?: SandboxBrowserStatus;
      error?: string;
    }>("/browser/sandbox/start", { method: "POST" }),
  stop: () =>
    fetchApi<{ success: boolean; status?: SandboxBrowserStatus }>("/browser/sandbox/stop", {
      method: "POST",
    }),
};

export interface LogPageEntry {
  id: string;
  level: string;
  source: string;
  message: string;
  metadata?: string;
  created_at: string;
}

export type MigrationSourceKind = "openclaw" | "hermes";
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
