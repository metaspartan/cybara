import type { GatewayProfile } from "./connection";
import { emptyMetricsAvailability, type MetricsEndpointKey, type MetricsSnapshot } from "./metrics";
import {
  asRecord,
  normalizeArrayResponse,
  readBoolean,
  readNumber,
  readString,
} from "./apiNormalizeUtils";
import {
  normalizeProviderPlanMonitoringConfig,
  normalizeProviderPlanRouteConstraint,
  normalizeProviderPlanStatus,
  type ProviderPlanMonitoringConfig,
  type ProviderPlanRouteConstraint,
  type ProviderPlanStatusResponse,
} from "./apiProviderPlans";
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
    workspace: { name: string; branch?: string; commit?: string; dirty?: boolean } | null;
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

function normalizeMessageImages(value: unknown): MobileMessageImage[] | undefined {
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
    counts: { skills, memories, total: readNumber(countsRecord, ["total"]) ?? events.length },
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
          | SessionSummary["last_message"]
          | null,
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
    messages,
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
  const computedSummary = {
    total: items.length,
    pending: items.filter((item) => item.status === "pending").length,
    inProgress: items.filter((item) => item.status === "in_progress").length,
    completed: items.filter((item) => item.status === "completed").length,
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
    },
    updatedAt: readString(record, ["updatedAt", "updated_at"]),
    source: readString(record, ["source"]),
  };
}

function normalizeSessionContextUsage(value: unknown): SessionContextUsage | undefined {
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

function normalizeSessionTokenUsage(value: unknown): SessionTokenUsage | undefined {
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

function normalizeMessageToolCalls(value: unknown): SessionToolCallSummary[] | undefined {
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

function normalizeAgentTransfers(value: unknown): AgentTransferSummary[] | undefined {
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
  url.searchParams.set("token", profile.apiKey);
  url.hash = "";
  return url.toString();
}

function normalizeAgentConfig(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return asRecord(value) ?? {};
  try {
    return asRecord(JSON.parse(value)) ?? {};
  } catch {
    return {};
  }
}

function normalizeAgent(agent: unknown, index = 0): AgentSummary {
  const record = asRecord(agent) ?? {};
  const id = readString(record, ["id", "name"]) || `agent-${index + 1}`;
  const providerId = readString(record, ["provider_id", "providerId", "provider"]);
  const providerType = readString(record, ["provider_type", "providerType"]);
  const config = normalizeAgentConfig(record.config);
  const modelParams = asRecord(config.model_params ?? config.modelParams) ?? {};
  const reasoningEffort =
    readString(record, ["reasoning_effort", "reasoningEffort"]) ??
    readString(modelParams, ["reasoning_effort", "reasoningEffort"]);
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
    supports_images: readBoolean(record, ["supports_images", "supportsImages"]),
    config,
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
    value === "usage_aware" ||
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
        plan: normalizeProviderPlanRouteConstraint(routeRecord?.plan),
      };
    }),
  };
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
    const response = await this.request<{ success: boolean; plugin: MobilePlugin }>(
      `/api/plugins/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      }
    );
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
    input: { clientId?: string; clientSecret?: string; access: "read" | "read_write" }
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
    if (!trimmed) return { success: false, current: null, branches: [], error: "Missing path" };
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

  forkSession(
    id: string,
    payload: { throughMessageIndex?: number; agentId?: string; title?: string } = {}
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
    format: "cybara_trace" | "trl_sft" | "prompt_completion" | "long_context"
  ): Promise<{ filename: string; mimeType: string; content: string; count: number }> {
    return this.request(`/api/evals/research/export?format=${format}&sanitize=1`);
  }

  replayEval(id: string): Promise<{ success: boolean; run?: MobileEvalRun; error?: string }> {
    return this.request(`/api/evals/goldens/${encodeURIComponent(id)}/replay`, {
      method: "POST",
      body: "{}",
    });
  }

  deleteEval(id: string): Promise<{ success: boolean }> {
    return this.request(`/api/evals/goldens/${encodeURIComponent(id)}`, { method: "DELETE" });
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
    return this.request<{ success: boolean; settings: ExternalTelemetrySettings }>(
      "/api/telemetry/settings",
      { method: "PUT", body: JSON.stringify(settings) }
    );
  }

  testExternalTelemetry(): Promise<{ success: boolean; status: ExternalTelemetryStatus }> {
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
    await this.request<unknown>("/api/nearby/discoverable", { method: "DELETE" });
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
