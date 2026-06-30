import type { FeatureSummary, HealthResponse, SessionSummary } from "./api";
import type { GatewayProfile } from "./connection";

export type MobileTabKey = "overview" | "sessions" | "metrics" | "settings";
export type MobileSurfaceKey =
  | "agents"
  | "providers"
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
  { key: "overview", label: "Home", showsGatewayPanel: true },
  { key: "sessions", label: "Chats", showsGatewayPanel: false },
  { key: "metrics", label: "Metrics", showsGatewayPanel: false },
  { key: "settings", label: "Settings", showsGatewayPanel: false },
];

export const MOBILE_NAV_CHROME = {
  height: 78,
  outerRadius: 0,
  pinnedToViewport: true,
} as const;

export const MOBILE_CHAT_CHROME = {
  autoScrollToLatestMessage: true,
  composerGapToNav: 0,
  composerHeight: 74,
  composerPinnedAboveNav: true,
  composerReservedBottom: MOBILE_NAV_CHROME.height,
  hidesSystemMessages: true,
} as const;

export const MOBILE_CHAT_DETAIL_CHROME = {
  settingsInHeader: true,
  detailsMenuIncludesSessionId: true,
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
  monitorUsesStatusToggles: true,
  itemBackReturnsToSurface: true,
  hidesRawInternalFields: true,
  providerCredentialUpdateMode: "blank-keeps-existing" as const,
} as const;

export type MobileDetailBackInput =
  | { kind: "session" }
  | { kind: "newChat" }
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

export const MOBILE_MAIN_TAB_CHROME = {
  edgeToEdge: true,
  outerHorizontalPadding: 0,
  panelRadius: 0,
} as const;

export const MOBILE_GATEWAY_PANEL_CHROME = {
  showApiBaseRow: false,
  showApiStatusTile: false,
  showGatewayUrlRow: false,
  showUptime: true,
} as const;

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
  backgroundRefreshMs: 30000,
  headerRefreshButton: false,
  liveRefreshMs: 5000,
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
  messageCount,
  sessionId,
  title,
  updatedLabel,
  workspaceDir,
}: {
  agentId?: string | null;
  messageCount: number;
  sessionId: string;
  title?: string | null;
  updatedLabel: string;
  workspaceDir?: string | null;
}): string[] {
  const safeMessageCount = Math.max(0, messageCount);
  const fallbackTitle = sessionId ? `Session ${sessionId.slice(0, 8)}` : "Chat";
  const lines = [
    `Title: ${title || fallbackTitle}`,
    `Messages: ${safeMessageCount} message${safeMessageCount === 1 ? "" : "s"}`,
    `Updated: ${updatedLabel}`,
    `Agent: ${agentId || "unknown"}`,
  ];
  if (MOBILE_CHAT_DETAIL_CHROME.detailsMenuIncludesWorkspaceDirectory) {
    lines.push(`Workspace directory: ${workspaceDir || "No workspace"}`);
  }
  if (MOBILE_CHAT_DETAIL_CHROME.detailsMenuIncludesSessionId) {
    lines.push(`Session ID: ${sessionId}`);
  }
  return lines;
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

export function buildMobileHeaderCopy(
  tab: MobileTabKey,
  counts: FeatureCounts,
  profile: GatewayProfile
): MobileHeaderCopy {
  switch (tab) {
    case "overview":
      return {
        title: "Cybara",
        detail: `${profile.name} - ${compactHost(profile.baseUrl)}`,
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
