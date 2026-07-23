import {
  supportedReasoningEfforts,
  supportsXHighReasoning,
  usesBinaryReasoning,
  usesProviderAdaptiveReasoning,
} from "cybara-shared/reasoning-capabilities";
import type {
  FeatureEndpointKey,
  FeatureSummary,
  HealthResponse,
  ProviderSummary,
  SessionDetailSummary,
  SessionSummary,
} from "./api";
import type { GatewayProfile } from "./connection";

export type MobileTabKey = "overview" | "sessions" | "metrics" | "usage" | "tasks" | "settings";
export type MobileSettingsTab =
  | "general"
  | "accessibility"
  | "gateway"
  | "ai"
  | "agents"
  | "providers"
  | "router"
  | "channels"
  | "evals"
  | "memory"
  | "voice"
  | "mcp"
  | "plugins"
  | "skills"
  | "tools"
  | "safety"
  | "wallet"
  | "migration"
  | "system"
  | "logs";
export type MobileSurfaceKey =
  | "agents"
  | "providers"
  | "skills"
  | "tools"
  | "approvals"
  | "wallet"
  | "channels"
  | "tasks"
  | "memory"
  | "logs"
  | "monitor";

export interface MobileTabDefinition {
  key: MobileTabKey;
  label: string;
  showsGatewayPanel: boolean;
}

export interface FeatureCounts {
  sessions: number;
  agents: number;
  providers: number;
  skills: number;
  tools: number;
  approvals: number;
  channels: number;
  tasks: number;
  memory: number;
  logs: number;
}

export function mergeSessionDetailIntoSummary(
  summary: FeatureSummary | null,
  detail: SessionDetailSummary
): FeatureSummary | null {
  if (!summary) return summary;
  const sessionIndex = summary.sessions.findIndex((session) => session.id === detail.id);
  if (sessionIndex < 0) return summary;
  const current = summary.sessions[sessionIndex];
  const lastMessage = detail.messages.at(-1);
  const nextSession = {
    ...current,
    title: detail.title ?? current.title,
    message_count: detail.messages.length,
    updated_at: detail.updatedAt ?? current.updated_at,
    last_message: lastMessage
      ? { role: lastMessage.role, content: lastMessage.content }
      : current.last_message,
  };
  const sessions = [...summary.sessions];
  sessions[sessionIndex] = nextSession;
  return { ...summary, sessions };
}

export interface MobileHeaderCopy {
  title: string;
  detail: string;
}

export const MOBILE_TABS: MobileTabDefinition[] = [
  { key: "overview", label: "Home", showsGatewayPanel: false },
  { key: "sessions", label: "Chats", showsGatewayPanel: false },
  { key: "metrics", label: "Metrics", showsGatewayPanel: false },
  { key: "usage", label: "Usage", showsGatewayPanel: false },
  { key: "tasks", label: "Tasks", showsGatewayPanel: false },
  { key: "settings", label: "Settings", showsGatewayPanel: false },
];

export const MOBILE_SETTINGS_TABS: Array<{
  label: string;
  value: MobileSettingsTab;
}> = [
  { label: "General", value: "general" },
  { label: "Accessibility", value: "accessibility" },
  { label: "Gateway", value: "gateway" },
  { label: "AI", value: "ai" },
  { label: "Agents", value: "agents" },
  { label: "Providers", value: "providers" },
  { label: "Router", value: "router" },
  { label: "Channels", value: "channels" },
  { label: "Lab", value: "evals" },
  { label: "Memory", value: "memory" },
  { label: "Voice", value: "voice" },
  { label: "MCP", value: "mcp" },
  { label: "Plugins", value: "plugins" },
  { label: "Skills", value: "skills" },
  { label: "Tools", value: "tools" },
  { label: "Safety", value: "safety" },
  { label: "Wallet", value: "wallet" },
  { label: "Migration", value: "migration" },
  { label: "System", value: "system" },
  { label: "Logs", value: "logs" },
];

export const MOBILE_HOME_CHROME = {
  firstSection: "recent_activity" as const,
  firstManagementSurface: "monitor" as const,
  managementGridEdgeToEdge: true,
  showsGatewayConnectionPanel: false,
  showsRemoteManagementTitle: false,
} as const;

export const MOBILE_NAV_CHROME = {
  height: 66,
  outerRadius: 26,
  floatingMargin: 12,
  pinnedToViewport: true,
} as const;

export const MOBILE_CHAT_CHROME = {
  autoScrollToLatestMessage: true,
  composerGapToNav: 0,
  composerHeight: 74,
  composerPinnedAboveNav: true,
  composerReservedBottom: MOBILE_NAV_CHROME.height,
  hidesSystemMessages: true,
  newChatButtonProminent: true,
  newChatButtonUsesIcon: true,
} as const;

export const MOBILE_CHAT_DETAIL_CHROME = {
  settingsInHeader: true,
  detailsMenuIncludesSessionId: false,
  detailsMenuIncludesProviderModel: true,
  detailsMenuIncludesWorkspaceDirectory: true,
  timelineMetadataBar: false,
} as const;

export const MOBILE_RECENT_ACTIVITY_CHROME = {
  chatsOpenSession: true,
  showTerminalRows: false,
  truncateTitles: true,
  useRecentStateForIdleChats: true,
} as const;

export const MOBILE_SETTINGS_DETAIL_CHROME = {
  agentsEditable: true,
  approvalsActionable: true,
  channelsEditable: true,
  providersEditable: true,
  tasksActionable: true,
  tasksUseRunningToggle: true,
  walletPolicyUsesToggles: true,
  monitorShowsHostTelemetry: true,
  itemBackReturnsToSurface: true,
  hidesRawInternalFields: true,
  providerCredentialUpdateMode: "blank-keeps-existing" as const,
} as const;

export const MOBILE_SETTINGS_ROOT_CHROME = {
  dangerousToolPolicyToggle: true,
  destructiveDisconnectButton: true,
  gatewayConnectionDetails: true,
  gatewayRefreshButton: false,
  modelRouterControls: true,
  nativeGroupedSections: true,
  nativeSegmentedControls: true,
  nativeSwitchControls: true,
  reasoningEffortSelector: true,
  settingsEdgeToEdgeContent: true,
  sandboxRuntimeControls: true,
  systemPromptFeatureToggles: true,
  migrationControls: true,
  nativeCategoryRail: true,
  speechControls: true,
  terminalToggle: true,
  toolApprovalModeSelector: true,
  walletAccessShortcut: true,
} as const;

export const MOBILE_PLATFORM_SETTING_KEYS = [
  "terminal_enabled",
  "tool_approval_mode",
  "follow_up_behavior_enabled",
  "chat_appearance",
  "reasoning_effort",
  "dangerous_tool_policy",
  "sandbox_runtime",
  "router",
  "speech",
] as const;

export const MOBILE_REASONING_EFFORT_OPTIONS = [
  { label: "Default", value: "" },
  { label: "Minimal", value: "minimal" },
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
  { label: "Extra High", value: "xhigh" },
  { label: "Max", value: "max" },
] as const;

const MOBILE_EFFORT_LABELS: Record<string, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

export function mobileSupportsXHighReasoning(
  provider?: string | null,
  model?: string | null
): boolean {
  return supportsXHighReasoning(provider, model);
}

export function mobileSupportedReasoningEfforts(
  provider?: string | null,
  model?: string | null,
  mode?: "adaptive" | "binary" | "effort",
  supportedEfforts?: Array<"minimal" | "low" | "medium" | "high" | "xhigh" | "max">
): readonly { label: string; value: MobileReasoningEffort }[] {
  if (mode === "adaptive" || (!mode && usesProviderAdaptiveReasoning(provider, model))) {
    return [{ label: "Adaptive", value: "" }];
  }
  if (mode === "binary" || (!mode && usesBinaryReasoning(provider))) {
    return [
      { label: "Default", value: "" },
      { label: "Thinking", value: "medium" },
    ];
  }
  const efforts = supportedEfforts?.length
    ? supportedEfforts
    : supportedReasoningEfforts(provider, model);
  return [
    { label: "Default", value: "" },
    ...efforts.map((level) => ({
      label: MOBILE_EFFORT_LABELS[level] ?? level,
      value: level as MobileReasoningEffort,
    })),
  ];
}

export function mobileReasoningLabel(
  effort: string | null | undefined,
  provider?: string | null,
  model?: string | null,
  mode?: "adaptive" | "binary" | "effort",
  supportedEfforts?: Array<"minimal" | "low" | "medium" | "high" | "xhigh" | "max">
): string {
  const options = mobileSupportedReasoningEfforts(provider, model, mode, supportedEfforts);
  return options.find((option) => option.value === (effort ?? ""))?.label ?? "Default";
}

export function createMobileSessionId(
  now = Date.now(),
  random: () => number = Math.random
): string {
  const entropy = Array.from({ length: 4 }, () =>
    Math.floor(random() * 0x1_0000_0000)
      .toString(16)
      .padStart(8, "0")
  ).join("");
  return `mobile-${now.toString(36)}-${entropy}`;
}

export const MOBILE_ROUTER_STRATEGY_OPTIONS = [
  { label: "Weighted", value: "weighted" },
  { label: "Round Robin", value: "round_robin" },
  { label: "Lowest Cost", value: "lowest_cost" },
  { label: "Priority", value: "priority" },
  { label: "Usage Aware", value: "usage_aware" },
  { label: "Mixture of Agents", value: "mixture_of_agents" },
] as const;

export type MobileReasoningEffort = (typeof MOBILE_REASONING_EFFORT_OPTIONS)[number]["value"];
export type MobileRouterStrategy = (typeof MOBILE_ROUTER_STRATEGY_OPTIONS)[number]["value"];

export const MOBILE_SYSTEM_PROMPT_FEATURE_KEYS = [
  "memoryEnabled",
  "skillsEnabled",
  "messagingEnabled",
  "replyTagsEnabled",
] as const;

export type MobileDetailBackInput =
  | { kind: "session" }
  | { kind: "newChat" }
  | { kind: "newTask" }
  | { kind: "systemPrompt" }
  | { kind: "modelRouter" }
  | { kind: "speech" }
  | { kind: "memory" }
  | { kind: "migration" }
  | { kind: "journey" }
  | { kind: "surface"; surface: MobileSurfaceKey }
  | { kind: "item"; surface: MobileSurfaceKey };

export function mobileBackRouteForDetail(
  route: MobileDetailBackInput | null
): { kind: "surface"; surface: MobileSurfaceKey } | null {
  if (route?.kind === "item") {
    return { kind: "surface", surface: route.surface };
  }
  return null;
}

const INTERNAL_SETTINGS_FIELD_LABELS = new Set([
  "id",
  "uuid",
  "source",
  "surface",
  "detail",
  "raw",
  "config",
  "created at",
  "created_at",
  "updated at",
  "updated_at",
  "agent id",
  "agent_id",
  "provider id",
  "provider_id",
  "session id",
  "session_id",
]);

export function isMobileSettingsDetailFieldVisible(label: string): boolean {
  const normalized = label.trim().toLowerCase().replace(/[-_]+/g, " ");
  if (INTERNAL_SETTINGS_FIELD_LABELS.has(normalized)) return false;
  return !/secret|token|api key|password|credential|mnemonic/i.test(normalized);
}

export const MOBILE_CHAT_COMPOSER = {
  estimatedCharsPerLine: 34,
  growsWithContent: true,
  lineHeight: 20,
  maxHeight: 184,
  minHeight: 42,
  newlineExpandsInput: true,
  preserveDraftOnFailure: true,
  resetAfterSend: true,
  sendButtonMode: "icon" as const,
} as const;

export const MOBILE_NEW_CHAT_CHROME = {
  composerMatchesChatComposer: true,
  composerStartsSingleLine: true,
  sendButtonMode: "icon" as const,
} as const;

export const MOBILE_MAIN_TAB_CHROME = {
  edgeToEdge: false,
  outerHorizontalPadding: 16,
  panelRadius: 26,
} as const;

export const MOBILE_GATEWAY_PANEL_CHROME = {
  showApiBaseRow: false,
  showApiStatusTile: false,
  showGatewayUrlRow: false,
  showUptime: true,
} as const;

export type MobileGatewayAuthStatus = "checking" | "connected" | "needs_pairing" | "unreachable";

const MOBILE_AUTH_HEALTH_ENDPOINTS: FeatureEndpointKey[] = [
  "sessions",
  "agents",
  "providers",
  "skills",
  "channels",
  "tasks",
  "tools",
  "memory",
  "logs",
  "systemMonitor",
  "systemPrompt",
  "config",
];

export function mobileGatewayAuthStatus(
  summary: Pick<FeatureSummary, "availability"> | null,
  connectionError?: string | null
): MobileGatewayAuthStatus {
  if (!summary) return "checking";
  if (connectionError || summary.availability.health.ok === false) return "unreachable";

  const denied = MOBILE_AUTH_HEALTH_ENDPOINTS.filter((key) => {
    const endpoint = summary.availability[key];
    return endpoint.status === 401;
  });
  if (summary.availability.health.ok === true && denied.length >= 3) return "needs_pairing";

  return "connected";
}

export function boundedMobileComposerHeight(height: number): number {
  return Math.min(
    MOBILE_CHAT_COMPOSER.maxHeight,
    Math.max(MOBILE_CHAT_COMPOSER.minHeight, Math.ceil(height))
  );
}

export function mobileComposerHeightForDraft(
  draft: string,
  measuredHeight: number = MOBILE_CHAT_COMPOSER.minHeight
): number {
  const lines = draft.length === 0 ? [""] : draft.split(/\r\n|\n|\r/);
  const explicitLines = lines.reduce((count, line) => {
    const visualLines = Math.max(
      1,
      Math.ceil(line.length / MOBILE_CHAT_COMPOSER.estimatedCharsPerLine)
    );
    return count + visualLines;
  }, 0);
  const explicitLineHeight =
    MOBILE_CHAT_COMPOSER.minHeight +
    Math.max(0, explicitLines - 1) * MOBILE_CHAT_COMPOSER.lineHeight;
  return boundedMobileComposerHeight(Math.max(measuredHeight, explicitLineHeight));
}

export const MOBILE_METRICS_CHROME = {
  backgroundRefreshMs: 120000,
  detailRefreshMs: 60000,
  headerRefreshButton: false,
  lazyLoadUntilOpened: true,
  liveRefreshMs: 15000,
  minRefreshMs: 60000,
  pullToRefresh: true,
} as const;

export const MOBILE_LOGS_CHROME = {
  lazyLoadsOnScroll: true,
  pageSize: 150,
  showsTotalCount: true,
} as const;

export const MOBILE_FEATURE_SECTIONS = [
  "sessions",
  "agents",
  "providers",
  "skills",
  "tools",
  "approvals",
  "wallet",
  "channels",
  "tasks",
  "memory",
  "logs",
  "monitor",
] as const;

export const MOBILE_SURFACES: MobileSurfaceKey[] = [
  "agents",
  "providers",
  "skills",
  "tools",
  "approvals",
  "wallet",
  "channels",
  "tasks",
  "memory",
  "logs",
  "monitor",
];

export const MOBILE_SETTINGS_SURFACES: MobileSurfaceKey[] = ["approvals", "tasks", "monitor"];

function countArray(value: unknown[] | undefined): number {
  return Array.isArray(value) ? value.length : 0;
}

export function summarizeFeatureCounts(summary: FeatureSummary | null): FeatureCounts {
  return {
    sessions: summary?.sessionTotal ?? summary?.sessions.length ?? 0,
    agents: summary?.agents.length ?? 0,
    providers: summary?.providers.length ?? 0,
    skills: countArray(summary?.skills),
    tools: countArray(summary?.tools),
    approvals: countArray(summary?.approvals),
    channels: countArray(summary?.channels),
    tasks: countArray(summary?.tasks),
    memory: countArray(summary?.memory),
    logs: summary?.logsTotal ?? countArray(summary?.logs),
  };
}

export function compactHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "");
  }
}

export function formatUptime(seconds?: number): string {
  if (!seconds || seconds < 0) return "checking";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function buildGatewayPanelMeta(health: HealthResponse | null | undefined): string {
  const versionLabel = health?.version
    ? `v${String(health.version).replace(/^v/i, "")}`
    : "version pending";
  return [
    versionLabel,
    MOBILE_GATEWAY_PANEL_CHROME.showUptime ? `uptime ${formatUptime(health?.uptime)}` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" - ");
}

export function buildMobileChatSettingsLines({
  agentId,
  model,
  provider,
  providerName,
  messageCount,
  sessionId,
  title,
  updatedLabel,
  gitBranch,
  workspaceDir,
}: {
  agentId?: string | null;
  gitBranch?: string | null;
  model?: string | null;
  provider?: string | null;
  providerName?: string | null;
  messageCount: number;
  sessionId: string;
  title?: string | null;
  updatedLabel: string;
  workspaceDir?: string | null;
}): string[] {
  const safeMessageCount = Math.max(0, messageCount);
  const lines = [
    `Title: ${mobileSessionTitle({ title })}`,
    `Messages: ${safeMessageCount} message${safeMessageCount === 1 ? "" : "s"}`,
    `Updated: ${updatedLabel}`,
  ];
  if (MOBILE_CHAT_DETAIL_CHROME.detailsMenuIncludesProviderModel) {
    lines.push(`Model: ${sessionProviderModelLabel({ agentId, model, provider, providerName })}`);
  }
  if (MOBILE_CHAT_DETAIL_CHROME.detailsMenuIncludesWorkspaceDirectory) {
    lines.push(`Workspace directory: ${workspaceDir || "No workspace"}`);
  }
  if (gitBranch) {
    lines.push(`Git branch: ${gitBranch}`);
  }
  if (MOBILE_CHAT_DETAIL_CHROME.detailsMenuIncludesSessionId) {
    lines.push(`Session ID: ${sessionId}`);
  }
  return lines;
}

export function mobileSessionTitle(
  session: Pick<SessionSummary, "title"> | { title?: string | null } | null | undefined
): string {
  const title = mobileFirstNonEmptyString(session?.title);
  return title || "Untitled chat";
}

export function mobileFirstNonEmptyString(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (trimmed) return trimmed;
  }
  return null;
}

export function sessionProviderModelLabel(
  session:
    | Pick<SessionSummary, "agent_id" | "provider" | "provider_id" | "provider_name" | "model">
    | {
        agentId?: string | null;
        provider?: string | null;
        providerId?: string | null;
        providerName?: string | null;
        model?: string | null;
      }
): string {
  const record = session as {
    agent_id?: string | null;
    agentId?: string | null;
    provider?: string | null;
    provider_id?: string | null;
    providerId?: string | null;
    provider_name?: string | null;
    providerName?: string | null;
    model?: string | null;
  };
  const provider = mobileFirstNonEmptyString(
    record.providerName,
    record.provider_name,
    record.provider,
    record.providerId,
    record.provider_id
  );
  const model = mobileFirstNonEmptyString(record.model);
  if (provider && model) return `${provider} - ${model}`;
  if (model) return model;
  if (provider) return provider;
  return "Model pending";
}

export type MobileProviderAuthMode = "api_key" | "oauth" | "access_token" | "aws_sdk" | "none";

export function mobileProviderAuthMode(
  provider: Pick<ProviderSummary, "authType"> | null | undefined
): MobileProviderAuthMode {
  const authType = provider?.authType || "api_key";
  if (authType === "oauth") return "oauth";
  if (authType === "bearer" || authType === "token") return "access_token";
  if (authType === "aws-sdk") return "aws_sdk";
  if (authType === "none") return "none";
  return "api_key";
}

export function recentSessionStateLabel(session: SessionSummary): "Working" | "Recent" {
  return session.last_message?.role === "user" ? "Working" : "Recent";
}

export function lastUpdatedLabel(session: SessionSummary, nowMs = Date.now()): string {
  const updated = Date.parse(session.updated_at);
  if (!Number.isFinite(updated)) return "recent";
  const minutes = Math.max(0, Math.round((nowMs - updated) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function compactLastUpdatedLabel(session: SessionSummary, nowMs = Date.now()): string {
  return lastUpdatedLabel(session, nowMs).replace("just now", "now").replace(/ ago$/, "");
}

export function buildMobileHeaderCopy(
  tab: MobileTabKey,
  counts: FeatureCounts,
  profile: GatewayProfile
): MobileHeaderCopy {
  switch (tab) {
    case "overview":
      return {
        title: "Cybara",
        detail: "Recent activity and controls",
      };
    case "sessions":
      return {
        title: "Chats",
        detail: counts.sessions === 1 ? "1 chat" : `${counts.sessions} chats`,
      };
    case "metrics": {
      const sessionLabel = counts.sessions === 1 ? "1 chat" : `${counts.sessions} chats`;
      const eventLabel = counts.logs === 1 ? "1 event" : `${counts.logs} events`;
      return {
        title: "Metrics",
        detail: `${sessionLabel} - ${counts.tools} tools - ${eventLabel}`,
      };
    }
    case "usage":
      return {
        title: "Usage",
        detail: "Provider plan windows",
      };
    case "tasks":
      return {
        title: "Tasks",
        detail: counts.tasks === 1 ? "1 scheduled task" : `${counts.tasks} scheduled tasks`,
      };
    case "settings":
      return {
        title: "Settings",
        detail: "Pairing, policies, and runtime safety",
      };
  }
}

export function formatMobileValue(value: unknown, fallback = "unknown"): string {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.length === 1 ? "1 item" : `${value.length} items`;
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length === 0) return "Configured";
    const enabled = keys.filter((key) => (value as Record<string, unknown>)[key] === true).length;
    if (enabled > 0) return `${enabled}/${keys.length} enabled`;
    return keys.length === 1 ? "1 setting" : `${keys.length} settings`;
  }
  return fallback;
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readMobileToolApprovalMode(config: Record<string, unknown> | undefined): string {
  return config?.tool_approval_mode === "ask" ? "ask" : "always_allow";
}

export function readMobileFollowUpBehaviorEnabled(
  config: Record<string, unknown> | undefined
): boolean {
  return config?.follow_up_behavior_enabled !== false;
}

export function readMobileReasoningEffort(
  config: Record<string, unknown> | undefined
): MobileReasoningEffort {
  const value = config?.reasoning_effort;
  return value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
    ? value
    : "";
}

export function readMobileRouterStrategy(value: unknown): MobileRouterStrategy {
  return value === "round_robin" ||
    value === "lowest_cost" ||
    value === "priority" ||
    value === "mixture_of_agents" ||
    value === "usage_aware" ||
    value === "weighted"
    ? value
    : "weighted";
}

export function readMobileDangerousToolPolicy(config: Record<string, unknown> | undefined): {
  enabled: boolean;
  mode: "audit" | "block";
} {
  const policy = asObjectRecord(config?.dangerous_tool_policy);
  return {
    enabled: policy?.enabled === true,
    mode: policy?.mode === "block" ? "block" : "audit",
  };
}

export function readMobileSandboxRuntime(config: Record<string, unknown> | undefined): {
  enabled: boolean;
  provider: "auto" | "apple_sandbox" | "podman" | "docker";
  network: "allow" | "deny";
} {
  const sandbox = asObjectRecord(config?.sandbox_runtime);
  const provider = sandbox?.provider;
  return {
    enabled: sandbox?.enabled === true,
    provider:
      provider === "apple_sandbox" || provider === "podman" || provider === "docker"
        ? provider
        : "auto",
    network: sandbox?.network === "allow" ? "allow" : "deny",
  };
}

export const MOBILE_ACCENT_KEYS = [
  "indigo",
  "blue",
  "cyan",
  "teal",
  "emerald",
  "amber",
  "orange",
  "rose",
  "pink",
  "purple",
  "catppuccin",
  "matrix",
] as const;

export type MobileAccentKey = (typeof MOBILE_ACCENT_KEYS)[number];

const MOBILE_ACCENT_KEY_SET = new Set<string>(MOBILE_ACCENT_KEYS);

export function mobileThemeConfigPayload(accent: MobileAccentKey): Record<string, string> {
  return {
    theme: accent,
    themeAccent: accent,
    theme_accent: accent,
    ui_accent: accent,
  };
}

function readNestedString(
  record: Record<string, unknown> | undefined,
  keys: string[]
): string | undefined {
  let current: unknown = record;
  for (const key of keys) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.trim().length > 0 ? current.trim() : undefined;
}

export function readMobileAccent(config: Record<string, unknown> | undefined): string {
  const candidates = [
    config?.themeAccent,
    config?.theme_accent,
    config?.theme,
    config?.accent,
    config?.ui_accent,
    readNestedString(config, ["ui", "accent"]),
    readNestedString(config, ["appearance", "accent"]),
    readNestedString(config, ["settings", "accent"]),
    readNestedString(config, ["identity", "accent"]),
    readNestedString(config, ["identity", "theme"]),
  ];
  const value = candidates
    .filter((candidate): candidate is string => typeof candidate === "string")
    .map((candidate) => candidate.trim().toLowerCase())
    .find((candidate) => MOBILE_ACCENT_KEY_SET.has(candidate));
  return value || "cyan";
}
