import type {
  FeatureEndpointKey,
  FeatureSummary,
  HealthResponse,
  ProviderSummary,
  SessionSummary,
} from "./api";
import type { GatewayProfile } from "./connection";

export type MobileTabKey = "overview" | "sessions" | "metrics" | "tasks" | "settings";
export type MobileSettingsTab =
  | "general"
  | "gateway"
  | "ai"
  | "memory"
  | "voice"
  | "safety"
  | "wallet"
  | "migration"
  | "system";
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

export interface MobileHeaderCopy {
  title: string;
  detail: string;
}

export const MOBILE_TABS: MobileTabDefinition[] = [
  { key: "overview", label: "Home", showsGatewayPanel: false },
  { key: "sessions", label: "Chats", showsGatewayPanel: false },
  { key: "metrics", label: "Metrics", showsGatewayPanel: false },
  { key: "tasks", label: "Tasks", showsGatewayPanel: false },
  { key: "settings", label: "Settings", showsGatewayPanel: false },
];

export const MOBILE_SETTINGS_TABS: Array<{ label: string; value: MobileSettingsTab }> = [
  { label: "General", value: "general" },
  { label: "Gateway", value: "gateway" },
  { label: "AI", value: "ai" },
  { label: "Memory", value: "memory" },
  { label: "Voice", value: "voice" },
  { label: "Safety", value: "safety" },
  { label: "Wallet", value: "wallet" },
  { label: "Migration", value: "migration" },
  { label: "System", value: "system" },
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
  speechControls: true,
  terminalToggle: true,
  toolApprovalModeSelector: true,
  walletAccessShortcut: true,
} as const;

export const MOBILE_PLATFORM_SETTING_KEYS = [
  "terminal_enabled",
  "tool_approval_mode",
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
  { label: "Max", value: "xhigh" },
] as const;

export const MOBILE_ROUTER_STRATEGY_OPTIONS = [
  { label: "Weighted", value: "weighted" },
  { label: "Round Robin", value: "round_robin" },
  { label: "Lowest Cost", value: "lowest_cost" },
  { label: "Priority", value: "priority" },
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
  growsWithContent: true,
  lineHeight: 20,
  maxHeight: 132,
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
  const explicitLines = draft.length === 0 ? 1 : draft.split(/\r\n|\n|\r/).length;
  const explicitLineHeight =
    MOBILE_CHAT_COMPOSER.minHeight +
    Math.max(0, explicitLines - 1) * MOBILE_CHAT_COMPOSER.lineHeight;
  return boundedMobileComposerHeight(Math.max(measuredHeight, explicitLineHeight));
}

export const MOBILE_METRICS_CHROME = {
  backgroundRefreshMs: 60000,
  headerRefreshButton: false,
  lazyLoadUntilOpened: true,
  liveRefreshMs: 15000,
  minRefreshMs: 15000,
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

export const MOBILE_SETTINGS_SURFACES: MobileSurfaceKey[] = [
  "agents",
  "providers",
  "skills",
  "tools",
  "approvals",
  "channels",
  "tasks",
  "memory",
  "logs",
  "monitor",
  "wallet",
];

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
  workspaceDir,
}: {
  agentId?: string | null;
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

export function readMobileReasoningEffort(
  config: Record<string, unknown> | undefined
): MobileReasoningEffort {
  const value = config?.reasoning_effort;
  return value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
    ? value
    : "";
}

export function readMobileRouterStrategy(value: unknown): MobileRouterStrategy {
  return value === "round_robin" ||
    value === "lowest_cost" ||
    value === "priority" ||
    value === "mixture_of_agents" ||
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
