export interface Agent {
  id: string;
  name: string;
  description?: string;
  model: string;
  provider: string;
  provider_id?: string;
  provider_type?: string;
  provider_pool_id?: string;
  provider_pool_name?: string;
  fallback_provider_id?: string;
  type?: string;
  status?: "active" | "inactive" | "idle" | "running" | "stopped";
  systemPrompt?: string;
  system_prompt?: string;
  temperature?: number;
  maxTokens?: number;
  max_tokens?: number;
  tools?: string[];
  config?: Record<string, unknown> | string;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
}

export interface AgentSummary {
  id: string;
  name: string;
  type?: string;
  model?: string;
  provider?: string;
  provider_id?: string;
  provider_type?: string;
  provider_pool_id?: string;
  provider_pool_name?: string;
  fallback_provider_id?: string;
  status?: Agent["status"];
  created_at?: string;
  reasoning_effort?: AgentReasoningEffort | null;
  tool_profile?: string;
  supports_images?: boolean;
}

export type AgentReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface AgentMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  tool_call_id?: string;
}

export type ProviderAuthType = "none" | "api_key" | "bearer" | "token" | "oauth" | "aws-sdk";

export interface Provider {
  id: string;
  name: string;
  type?: string;
  provider?: string;
  description?: string;
  baseUrl?: string;
  base_url?: string;
  apiKey?: string;
  api_key?: string;
  accessToken?: string;
  access_token?: string;
  refreshToken?: string;
  refresh_token?: string;
  expiresAt?: number;
  expires_at?: number;
  models: string[];
  isDefault?: boolean | number;
  is_default?: boolean | number;
  config?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  authType?: ProviderAuthType;
  createdAt?: string;
  created_at?: string;
}

export interface ProviderAccountPool {
  id: string;
  name: string;
  provider: string;
  enabled: boolean;
  routing_mode: "usage" | "priority_then_usage";
  accounts: Array<{
    provider_id: string;
    provider_name?: string;
    priority: number | null;
  }>;
}

export interface ProviderAccountPoolInput {
  name: string;
  provider: string;
  enabled: boolean;
  accounts: Array<{
    provider_id: string;
    provider_name?: string;
    priority?: number;
  }>;
}

export type ProviderPlanStatusState = "ok" | "warning" | "exhausted" | "unconfigured" | "disabled";
export type ProviderPlanSourceMode =
  | "local"
  | "provider_api"
  | "oauth_api"
  | "browser_cookie"
  | "cli"
  | "manual";

export type ProviderPlanPresetConfidence = "exact" | "published" | "dynamic" | "estimated";

export interface ProviderPlanPresetSuggestion {
  id: string;
  label: string;
  planName: string;
  description: string;
  confidence: ProviderPlanPresetConfidence;
  sourceMode: ProviderPlanSourceMode;
  sourceUrl?: string;
  limitDescription: string;
  monthlyTokenLimit?: number;
  monthlySpendLimit?: number;
  weeklyTokenLimit?: number;
  fiveHourTokenLimit?: number;
  routeLimit5h?: number;
  routeLimitWeekly?: number;
  externalSourceEnabled?: boolean;
}

export interface ProviderPlanWindow {
  id: string;
  title: string;
  kind: "rolling_5h" | "rolling_week" | "billing_month";
  usedTokens: number;
  tokenLimit?: number;
  usedSpend: number;
  spendLimit?: number;
  usedPercent?: number;
  remainingPercent?: number;
  resetsAt?: string;
  resetDescription: string;
  usageKnown: boolean;
  unlimited?: boolean;
}

export interface ProviderPlanSnapshot {
  providerId: string;
  configuredProviderId?: string;
  providerType: string;
  providerName: string;
  authType: string;
  monitored: boolean;
  managedAutomatically: boolean;
  manualPlanEditable: boolean;
  automaticTrackingLabel?: string;
  appliedPresetId?: string;
  planName?: string;
  source: string;
  sourceMode: ProviderPlanSourceMode;
  sourceLabel: string;
  sourceDescription?: string;
  externalSourceAvailable: boolean;
  externalSourceMode?: ProviderPlanSourceMode;
  externalSourceLabel?: string;
  externalSourceHint?: string;
  status: ProviderPlanStatusState;
  reason?: string;
  warningThresholdPct: number;
  hardStopPct: number;
  dataConfidence: "exact" | "estimated" | "local";
  updatedAt: string;
  localTokens30d: number;
  localSpend30d: number;
  windows: ProviderPlanWindow[];
  presetSuggestions: ProviderPlanPresetSuggestion[];
}

export interface ProviderPlanWindowConfig {
  enabled?: boolean;
  tokenLimit?: number;
  spendLimit?: number;
}

export interface ProviderPlanProviderConfig {
  enabled?: boolean;
  presetId?: string;
  planName?: string;
  currency?: string;
  sourceMode?: ProviderPlanSourceMode;
  externalSourceEnabled?: boolean;
  warningThresholdPct?: number;
  hardStopPct?: number;
  billingCycleAnchorDay?: number;
  fiveHour?: ProviderPlanWindowConfig;
  weekly?: ProviderPlanWindowConfig;
  monthly?: ProviderPlanWindowConfig;
}

export interface ProviderPlanMonitoringConfig {
  enabled: boolean;
  routerEnforcement: boolean;
  warningThresholdPct: number;
  staleAfterMinutes: number;
  providers: Record<string, ProviderPlanProviderConfig>;
}

export interface ProviderPlanStatusResponse {
  enabled: boolean;
  routerEnforcement: boolean;
  warningThresholdPct: number;
  providers: ProviderPlanSnapshot[];
  summary: {
    total: number;
    monitored: number;
    configured: number;
    warnings: number;
    exhausted: number;
  };
}

export interface Channel {
  id: string;
  name: string;
  type: "telegram" | "discord" | "slack" | "whatsapp" | "signal" | "imessage" | "web" | "webhook";
  config: Record<string, unknown>;
  enabled?: boolean;
  isActive?: boolean;
  is_active?: boolean;
  createdAt?: string;
  created_at?: string;
}

export interface ChannelField {
  name: string;
  label: string;
  type: "text" | "password" | "number" | "boolean" | "select";
  required?: boolean;
  description?: string;
  options?: string[];
}

export interface Memory {
  id?: string;
  file?: string;
  content: string;
  type?: "user" | "agent" | "system";
  agentId?: string;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
  entries?: MemoryEntry[];
  date?: string;
  index?: number;
}

export interface Task {
  id: string;
  name: string;
  description?: string;
  agentId?: string;
  agent_id?: string;
  sessionId?: string | null;
  session_id?: string | null;
  action?: string;
  status?: "pending" | "running" | "completed" | "failed" | "active" | "paused";
  enabled?: boolean;
  schedule?: string;
  lastRun?: string;
  last_run?: string;
  nextRun?: string;
  next_run?: string;
  createdAt?: string;
  created_at?: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  code?: string;
  language?: string;
  category?: string;
  parameters?: SkillParameter[];
  enabled?: boolean;
  location?: string;
  createdAt?: string;
  created_at?: string;
}

export interface SkillParameter {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  arguments?: Record<string, unknown>; // Alias for compatibility
  status: "pending" | "executing" | "completed" | "failed" | "success" | "error" | "blocked";
  result?: unknown;
  error?: string;
  duration?: number;
}

export interface ChatImageAttachment {
  data?: string;
  url?: string;
  path?: string;
  mimeType?: string;
  name?: string;
  size?: number;
}

export interface AgentTransferInfo {
  protocol: "cybara-agent-transfer-v1";
  status: "accepted";
  sessionId: string;
  fromAgentId: string;
  fromAgentName: string;
  toAgentId: string;
  toAgentName: string;
  reason: string;
  contextMode: "full" | "recent" | "summary";
  contextSummary?: string;
  requestedAt: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp?: string;
  thinking?: string;
  tool_calls?: ToolCallInfo[];
  agent_transfers?: AgentTransferInfo[];
  images?: ChatImageAttachment[];
  pending_chat_id?: string;
  client_pending_id?: string;
  _truncated?: string;
  _tool_calls_hidden_count?: number;
  _tool_calls_total_count?: number;
}

export type SessionPlanItemStatus = "pending" | "in_progress" | "completed";
export type SessionPlanItemPriority = "high" | "medium" | "low";

export interface SessionPlanItem {
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
  items: SessionPlanItem[];
  summary: SessionPlanSummary;
  updatedAt?: string;
  source: "todo_tool";
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

export interface ChatSession {
  id: string;
  agentId: string;
  title: string;
  status: string;
  workspaceDir?: string;
  workspace_dir?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface AvailableProvider {
  id: string;
  name: string;
  description: string;
  models: string[];
  authType?: ProviderAuthType;
  oauthFlow?: "device_code" | "redirect" | null;
  hasOAuthConfig?: boolean;
  oauthLoginUrl?: string | null;
}

export interface AvailableChannel {
  id: string;
  name: string;
  description: string;
  icon?: string;
  fields?: ChannelField[];
  webhook?: boolean;
}

export interface Session {
  id: string;
  agentId: string;
  title: string;
  status: string;
  workspaceDir?: string;
  workspace_dir?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryEntry {
  id?: string;
  file?: string;
  content: string;
  index?: number;
  date?: string;
  timestamp?: string;
}

export interface Toast {
  id: string;
  type: "success" | "error" | "warning" | "info";
  message: string;
  duration?: number;
}

export interface DashboardStats {
  totalAgents: number;
  totalChannels: number;
  totalMemories: number;
  totalTasks: number;
  activeProviders: number;
  recentActivity: {
    type: string;
    description: string;
    timestamp: string;
  }[];
}

export interface HealthStatus {
  status: string;
  uptime?: number;
  memory?: {
    heapUsed: number;
    heapTotal: number;
  };
  checks?: Record<string, { status: string; error?: string }>;
}

export interface Tool {
  name: string;
  description: string;
  category: string;
  input_schema?: {
    type: string;
    properties?: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
  permissions?: string[];
}

export interface MobileDevice {
  id: string;
  name: string;
  baseUrl: string;
  status: "active" | "revoked";
  createdAt: string;
  lastSeenAt?: string;
  revokedAt?: string;
  userAgent?: string;
  push?: {
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
  };
}

export interface MobileConnectPayload {
  protocol: "cybara-mobile-connect-v1";
  name: string;
  baseUrl: string;
  apiKey: string;
  deviceId: string;
  createdAt: string;
}

export interface MobileConnectInfo {
  baseUrl: string;
  currentBaseUrl: string;
  candidates: string[];
  lanAddresses: string[];
  lanAccessEnabled: boolean;
  remoteAccess: {
    enabled: boolean;
    mode: "private_overlay" | "public_tunnel";
    provider: "tailscale" | "cloudflare" | "zerotier" | "netbird" | "custom";
    baseUrl: string;
    ready: boolean;
    requiresGatewayPassword: boolean;
    status: string;
    message: string;
  };
  isCurrentLoopback: boolean;
  warnings: string[];
  troubleshooting: string[];
  exposeCommand: string;
  firewallCommand?: string;
  platform: string;
}

export interface MobileDevicePairing {
  success: boolean;
  device: MobileDevice;
  payload: MobileConnectPayload;
  encoded: string;
  qrDataUrl: string;
}

export interface MobilePairing {
  success: boolean;
  code: string;
  expiresAt: number;
  payload: {
    protocol: "cybara-mobile-pair-v1";
    name: string;
    baseUrl: string;
    code: string;
    role?: string;
    expiresAt: number;
  };
  encoded: string;
  qrDataUrl: string;
}

export interface SystemInfo {
  name: string;
  version: string;
  setupComplete?: boolean;
  setup_complete?: boolean;
  stats?: {
    agents: { total: number };
    providers: { total: number };
    channels: { total: number };
    tasks: { total: number };
  };
}
