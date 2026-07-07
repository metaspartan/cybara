export interface Agent {
  id: string;
  name: string;
  description?: string;
  model: string;
  provider: string;
  provider_id?: string;
  fallback_provider_id?: string;
  type?: string;
  status?: "active" | "inactive" | "idle" | "running" | "stopped";
  systemPrompt?: string;
  system_prompt?: string;
  temperature?: number;
  maxTokens?: number;
  max_tokens?: number;
  tools?: string[];
  config?: Record<string, unknown>;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
}

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
  models: string[];
  isDefault?: boolean;
  is_default?: boolean;
  config?: Record<string, unknown>;
  authType?: ProviderAuthType;
  createdAt?: string;
  created_at?: string;
}

export type ProviderPlanStatusState = "ok" | "warning" | "exhausted" | "unconfigured" | "disabled";
export type ProviderPlanSourceMode =
  "local" | "provider_api" | "oauth_api" | "browser_cookie" | "cli" | "manual";

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
}

export interface ProviderPlanSnapshot {
  providerId: string;
  configuredProviderId?: string;
  providerType: string;
  providerName: string;
  authType: string;
  monitored: boolean;
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
  status: "pending" | "executing" | "completed" | "failed" | "success" | "error";
  result?: unknown;
  error?: string;
  duration?: number;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp?: string;
  thinking?: string;
  tool_calls?: ToolCallInfo[];
  _truncated?: string;
  _tool_calls_hidden_count?: number;
  _tool_calls_total_count?: number;
}

export interface SessionContextUsage {
  usedTokens: number;
  limitTokens: number;
  remainingTokens: number;
  usedPercent: number;
  messageCount: number;
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
