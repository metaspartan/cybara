import type { ProviderPlanRouteConstraint } from "./apiProviderPlans";

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

export interface ComputerUseStatus {
  available: boolean;
  command: string;
  configuredCommand?: string;
  driverSource?:
    | "env"
    | "config"
    | "bundled"
    | "managed-runtime"
    | "path"
    | "known-install-dir"
    | "default";
  platform: string;
  version?: string;
  accessibility?: boolean;
  screenRecording?: boolean;
  ready: boolean;
  message: string;
  installHint?: string;
}

export interface SessionSummary {
  id: string;
  title: string | null;
  agent_id?: string;
  provider?: string;
  provider_id?: string;
  provider_type?: string;
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

export interface MobileEvalGolden {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  baseline: {
    sessionId: string;
    turnIndex: number;
    provider: string | null;
    model: string | null;
    request: { userMessage: { content: string } };
    structure: { tools: Array<{ name: string; status: string }> };
  };
}

export interface MobileEvalRun {
  id: string;
  goldenId: string;
  replaySessionId: string | null;
  status: "running" | "passed" | "failed" | "error";
  score: number | null;
  error: string | null;
}

export interface MobileResearchStats {
  total: number;
  toolCalls: number;
  failedToolCalls: number;
  reasoningTraces: number;
  cleanTraces: number;
  train: number;
  validation: number;
  test: number;
}

export interface GitBranchSummary {
  name: string;
  current: boolean;
}

export interface GitBranchListResponse {
  success: boolean;
  current: string | null;
  branches: GitBranchSummary[];
  error?: string;
}

export interface GitBranchCheckoutResponse {
  success: boolean;
  branch?: string | null;
  error?: string;
}

export interface AgentSummary {
  id: string;
  name: string;
  type?: string;
  status?: string;
  model?: string;
  provider?: string;
  provider_id?: string;
  provider_type?: string;
  system_prompt?: string;
  reasoning_effort?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null;
  supports_images?: boolean;
  config?: Record<string, unknown>;
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
  config?: Record<string, unknown>;
}

export interface ProviderUpdatePayload {
  name?: string;
  base_url?: string;
  api_key?: string;
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
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
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

export interface ProviderOAuthPollResponse {
  status?: string;
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
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
  rateLimits?: Record<string, { windowMs: number; maxRequests: number }>;
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

export interface MobileNearbySettings {
  enabled: boolean;
  displayName: string;
  port: number;
  discoveryMinutes: number;
  autoAdvertise: boolean;
}

export interface MobileNearbyStatus {
  settings: MobileNearbySettings;
  identity: { id: string; fingerprint: string };
  running: boolean;
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
    syncEnabled: boolean;
  }>;
  pairings: Array<{
    id: string;
    direction: "incoming" | "outgoing";
    peerId: string;
    peerName: string;
    peerBaseUrl: string;
    verificationCode: string;
    localConfirmed: boolean;
    remoteConfirmed: boolean;
    expiresAt: string;
  }>;
  incomingTransfers: Array<{
    id: string;
    peerId: string;
    peerName: string;
    receivedAt: string;
    title: string | null;
    messageCount: number;
    workspace: {
      name: string;
      branch?: string;
      commit?: string;
      dirty?: boolean;
    } | null;
  }>;
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

export interface GatewayAuthKeyResponse {
  success: boolean;
  apiKey: string | null;
  source?: "env" | "file" | "none";
}

export interface GatewayRestartResponse {
  success: boolean;
  supervised: boolean;
  message: string;
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

export interface MobilePushDeviceSummary {
  configured: boolean;
  enabled: boolean;
  provider?: "expo";
  platform?: "ios" | "android" | "unknown";
  preferences?: {
    chatCompletions: boolean;
    taskCompletions: boolean;
  };
  updatedAt?: string;
  lastSentAt?: string;
  lastError?: string;
}

export interface CurrentMobileDeviceResponse {
  device?: {
    id: string;
    name: string;
    push?: MobilePushDeviceSummary;
  };
}

export interface MobileMcpServer {
  id: string;
  name: string;
  command: string;
  args?: string;
  url?: string;
  enabled: boolean;
  status: string;
  toolCount: number;
  hasCredentials?: boolean;
  transport?: "stdio" | "http";
}

export interface MobilePlugin {
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

export type MobileAccountConnectorId = "google_workspace" | "microsoft_365" | "dropbox" | "notion";

export interface MobileAccountConnector {
  id: MobileAccountConnectorId;
  label: string;
  description: string;
  services: string[];
  docsUrl: string;
  clientIdLabel: string;
  clientSecretLabel?: string;
  redirectUri: string;
  configured: boolean;
  connected: boolean;
  access: "read" | "read_write";
  account?: string;
  needsReauthorization: boolean;
}

export interface MobilePushRegistrationResponse {
  success: boolean;
  device?: {
    id: string;
    name: string;
    push?: MobilePushDeviceSummary;
  };
  result?: {
    attempted: number;
    sent: number;
    skipped: boolean;
    errors: string[];
  };
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
  allowedSendRecipients: string[];
  maxSendAmount: string;
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
  | "memoryEnabled"
  | "skillsEnabled"
  | "messagingEnabled"
  | "replyTagsEnabled";

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

export interface PendingToolApproval {
  id: string;
  toolName: string;
  argsSummary: string;
}

export type RouterStrategy =
  | "weighted"
  | "round_robin"
  | "lowest_cost"
  | "priority"
  | "mixture_of_agents"
  | "usage_aware";

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
  plan?: ProviderPlanRouteConstraint;
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
  | "skills"
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
  agentId?: string;
  useModelRouter?: boolean;
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
  filePath?: string;
  contentType?: string;
}

export interface MobileMessageImage {
  url?: string;
  data?: string;
  mimeType?: string;
}

export interface SessionProcessActivitySummary {
  id: string;
  phase: string;
  text: string;
  timestamp?: number;
  toolName?: string;
  toolCallId?: string;
}

export interface MobileSteerPendingMessageOptions {
  processActivities?: SessionProcessActivitySummary[];
}

export interface MobilePendingChatMessage {
  id: string;
  sessionId: string;
  clientPendingId?: string;
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
  agentTransfers?: AgentTransferSummary[];
  images?: MobileMessageImage[];
}

export interface AgentTransferSummary {
  fromAgentId: string;
  fromAgentName: string;
  toAgentId: string;
  toAgentName: string;
  reason: string;
  contextMode: "full" | "recent" | "summary";
  contextSummary?: string;
  requestedAt?: string;
}

export interface SessionContextUsage {
  usedTokens: number;
  limitTokens: number;
  remainingTokens: number;
  usedPercent: number;
  messageCount: number;
  transcriptTokens?: number;
  metadataTokens?: number;
  compacted?: boolean;
  compactionCount?: number;
  compactedTokens?: number;
  source?: "estimated";
}

export interface SessionTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  cacheHitRate: number | null;
  totalTokens: number;
  callCount: number;
  durationMs: number;
  tokensPerSecond: number | null;
  firstTokenMs: number | null;
  source?: "metrics";
}

export type SessionPlanItemStatus = "pending" | "in_progress" | "completed";
export type SessionPlanItemPriority = "high" | "medium" | "low";

export interface SessionPlanItemSummary {
  content: string;
  status: SessionPlanItemStatus;
  priority: SessionPlanItemPriority;
}

export interface SessionPlanSummary {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
}

export interface SessionPlanSnapshot {
  sessionId: string;
  items: SessionPlanItemSummary[];
  summary: SessionPlanSummary;
  updatedAt?: string;
  source?: string;
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
  contextUsage?: SessionContextUsage;
  tokenUsage?: SessionTokenUsage;
  plan?: SessionPlanSnapshot | null;
  messages: SessionMessageSummary[];
}

export interface MobileSubagentActivity {
  id: string;
  phase: "start" | "result" | "error" | "blocked";
  text: string;
  timestamp: number;
  toolName?: string;
  toolCallId?: string;
  sandboxProvider?: string;
}

export interface MobileSubagentToolCall {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
  result: unknown;
  status?: "pending" | "executing" | "completed" | "failed";
  timeline_index?: number;
}

export interface MobileSubagentSummary {
  id: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed" | "timeout" | "killed";
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  task: string;
  sessionKey: string;
  requesterSessionId: string;
  model?: string;
  workspaceDir?: string;
  result?: string;
  error?: string;
  thinking?: string;
  activityCount: number;
  toolCallCount: number;
  activities?: MobileSubagentActivity[];
  toolCalls?: MobileSubagentToolCall[];
}

export interface MobileSubagentSpawnRequest {
  task: string;
  label?: string;
  agentId?: string;
  workspaceDir?: string;
  requesterSessionId: string;
}

export interface MobileSubagentSpawnResponse {
  success: boolean;
  subagentId?: string;
  sessionKey?: string;
  status?: string;
  warning?: string;
}

export type MobileAgentStatus =
  | "idle"
  | "thinking"
  | "tool_executing"
  | "tool_completed"
  | "generating"
  | "compacting"
  | "error";

export interface MobileStatusSessionSnapshot {
  sessionId: string;
  runId?: string;
  sequence?: number;
  status: MobileAgentStatus | string;
  timestamp: number;
  detail?: string;
  agentId?: string;
  activities: SessionProcessActivitySummary[];
  pendingMessages?: MobilePendingChatMessage[];
}

export interface MobileStatusStreamStatusEvent {
  type: "status";
  runId?: string;
  sequence?: number;
  status: MobileAgentStatus | string;
  timestamp: number;
  detail?: string;
  sessionId?: string;
  agentId?: string;
  toolName?: string;
  toolCallId?: string;
  toolPhase?: "start" | "result" | "error" | "blocked";
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
  runId?: string;
  sequence?: number;
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
  skills: RemoteItemSummary[];
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

export interface JourneyEvent {
  id: string;
  kind: "skill" | "memory";
  title: string;
  detail: string;
  category: string;
  createdAt: string;
  createdAtMs: number;
}

export interface JourneyResponse {
  events: JourneyEvent[];
  counts: { skills: number; memories: number; total: number };
}
