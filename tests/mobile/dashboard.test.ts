import { describe, expect, test } from "bun:test";
import type { FeatureSummary } from "../../apps/mobile/src/lib/api";
import type { GatewayProfile } from "../../apps/mobile/src/lib/connection";
import {
  MOBILE_FEATURE_SECTIONS,
  MOBILE_ACCENT_KEYS,
  MOBILE_CHAT_COMPOSER,
  MOBILE_CHAT_DETAIL_CHROME,
  MOBILE_CHAT_CHROME,
  MOBILE_GATEWAY_PANEL_CHROME,
  MOBILE_MAIN_TAB_CHROME,
  MOBILE_METRICS_CHROME,
  MOBILE_NAV_CHROME,
  MOBILE_RECENT_ACTIVITY_CHROME,
  MOBILE_SETTINGS_DETAIL_CHROME,
  MOBILE_SETTINGS_SURFACES,
  MOBILE_SURFACES,
  MOBILE_TABS,
  boundedMobileComposerHeight,
  buildGatewayPanelMeta,
  buildMobileChatSettingsLines,
  buildMobileHeaderCopy,
  formatMobileValue,
  formatUptime,
  isMobileSettingsDetailFieldVisible,
  lastUpdatedLabel,
  mobileComposerHeightForDraft,
  mobileThemeConfigPayload,
  recentSessionStateLabel,
  readMobileAccent,
  summarizeFeatureCounts,
} from "../../apps/mobile/src/lib/dashboard";

const profile: GatewayProfile = {
  id: "local",
  name: "Studio Gateway",
  baseUrl: "http://127.0.0.1:4269",
  apiKey: "cybara_mobile_test",
  createdAt: "2026-06-30T00:00:00.000Z",
};

const summary: FeatureSummary = {
  health: null,
  sessions: [
    {
      id: "session-1",
      title: "Build mobile app",
      message_count: 4,
      updated_at: "2026-06-30T08:00:00.000Z",
    },
  ],
  sessionTotal: 1234,
  agents: [{ id: "agent-1", name: "Agent" }],
  providers: [{ id: "provider-1", name: "OpenAI", provider: "openai" }],
  channels: [{ id: "web", title: "Web", detail: "enabled" }],
  tasks: [{ id: "task-1", title: "Task", detail: "pending" }],
  tools: [
    { id: "read", title: "read", detail: "tool" },
    { id: "write", title: "write", detail: "tool" },
  ],
  approvals: [{ id: "approval-1", title: "Approval", detail: "pending" }],
  walletStatus: null,
  walletPolicy: { enabled: true },
  memory: [{ id: "memory-1", title: "memory.md", detail: "1 entry" }],
  logs: [{ id: "log-1", title: "Started", detail: "system", source: "system" }],
  config: {},
  availability: {
    health: { ok: true },
    sessions: { ok: true },
    agents: { ok: true },
    providers: { ok: true },
    channels: { ok: true },
    tasks: { ok: true },
    tools: { ok: true },
    approvals: { ok: true },
    walletStatus: { ok: true },
    walletPolicy: { ok: true },
    memory: { ok: true },
    logs: { ok: true },
    config: { ok: true },
  },
};

describe("mobile dashboard model", () => {
  test("keeps the gateway control panel on the home tab only", () => {
    expect(MOBILE_TABS.map((tab) => tab.key)).toEqual([
      "overview",
      "sessions",
      "metrics",
      "settings",
    ]);
    expect(MOBILE_TABS.find((tab) => tab.key === "sessions")?.label).toBe("Chats");
    expect(MOBILE_TABS.filter((tab) => tab.showsGatewayPanel).map((tab) => tab.key)).toEqual([
      "overview",
    ]);
    expect(MOBILE_GATEWAY_PANEL_CHROME.showUptime).toBe(true);
    expect(MOBILE_GATEWAY_PANEL_CHROME.showApiStatusTile).toBe(false);
    expect(MOBILE_GATEWAY_PANEL_CHROME.showGatewayUrlRow).toBe(false);
    expect(MOBILE_GATEWAY_PANEL_CHROME.showApiBaseRow).toBe(false);
    expect(
      buildGatewayPanelMeta({
        status: "healthy",
        version: "1.0.330",
        uptime: 568,
        timestamp: "2026-06-30T12:17:30.336Z",
      })
    ).toBe("v1.0.330 - uptime 9m");
  });

  test("keeps the pinned bottom nav squared to the viewport", () => {
    expect(MOBILE_NAV_CHROME.pinnedToViewport).toBe(true);
    expect(MOBILE_NAV_CHROME.outerRadius).toBe(0);
    expect(MOBILE_NAV_CHROME.height).toBeLessThanOrEqual(82);
    expect(MOBILE_CHAT_CHROME.composerPinnedAboveNav).toBe(true);
    expect(MOBILE_CHAT_CHROME.composerGapToNav).toBe(0);
    expect(MOBILE_CHAT_CHROME.composerHeight).toBeGreaterThanOrEqual(70);
    expect(MOBILE_CHAT_CHROME.composerReservedBottom).toBe(MOBILE_NAV_CHROME.height);
    expect(MOBILE_CHAT_CHROME.autoScrollToLatestMessage).toBe(true);
    expect(MOBILE_CHAT_CHROME.hidesSystemMessages).toBe(true);
    expect(MOBILE_MAIN_TAB_CHROME.edgeToEdge).toBe(true);
    expect(MOBILE_MAIN_TAB_CHROME.outerHorizontalPadding).toBe(0);
    expect(MOBILE_MAIN_TAB_CHROME.panelRadius).toBe(0);
  });

  test("keeps the chat composer compact, dynamic, and icon driven", () => {
    expect(MOBILE_CHAT_COMPOSER.sendButtonMode).toBe("icon");
    expect(MOBILE_CHAT_COMPOSER.growsWithContent).toBe(true);
    expect(MOBILE_CHAT_COMPOSER.resetAfterSend).toBe(true);
    expect(MOBILE_CHAT_COMPOSER.preserveDraftOnFailure).toBe(true);
    expect(MOBILE_CHAT_COMPOSER.newlineExpandsInput).toBe(true);
    expect(MOBILE_CHAT_COMPOSER.minHeight).toBeLessThan(MOBILE_CHAT_COMPOSER.maxHeight);
    expect(boundedMobileComposerHeight(20)).toBe(MOBILE_CHAT_COMPOSER.minHeight);
    expect(boundedMobileComposerHeight(84.2)).toBe(85);
    expect(boundedMobileComposerHeight(300)).toBe(MOBILE_CHAT_COMPOSER.maxHeight);
    expect(mobileComposerHeightForDraft("one\ntwo")).toBe(
      MOBILE_CHAT_COMPOSER.minHeight + MOBILE_CHAT_COMPOSER.lineHeight
    );
    expect(mobileComposerHeightForDraft("one\ntwo\nthree", 300)).toBe(
      MOBILE_CHAT_COMPOSER.maxHeight
    );
  });

  test("keeps chat settings in the persistent header with heavy metadata in the menu", () => {
    expect(MOBILE_CHAT_DETAIL_CHROME.settingsInHeader).toBe(true);
    expect(MOBILE_CHAT_DETAIL_CHROME.timelineMetadataBar).toBe(false);
    expect(MOBILE_CHAT_DETAIL_CHROME.detailsMenuIncludesSessionId).toBe(true);
    expect(MOBILE_CHAT_DETAIL_CHROME.detailsMenuIncludesWorkspaceDirectory).toBe(true);
    expect(
      buildMobileChatSettingsLines({
        agentId: "minimax-m3-mini",
        messageCount: 2,
        sessionId: "session-abc123",
        title: "Mobile chat polish",
        updatedLabel: "6/30/2026, 12:30:00 PM",
        workspaceDir: "/Users/carsen/Documents/GitHub/cybara",
      })
    ).toEqual([
      "Title: Mobile chat polish",
      "Messages: 2 messages",
      "Updated: 6/30/2026, 12:30:00 PM",
      "Agent: minimax-m3-mini",
      "Workspace directory: /Users/carsen/Documents/GitHub/cybara",
      "Session ID: session-abc123",
    ]);
  });

  test("keeps metrics live without an in-page refresh button", () => {
    expect(MOBILE_METRICS_CHROME.headerRefreshButton).toBe(false);
    expect(MOBILE_METRICS_CHROME.pullToRefresh).toBe(true);
    expect(MOBILE_METRICS_CHROME.liveRefreshMs).toBeLessThan(
      MOBILE_METRICS_CHROME.backgroundRefreshMs
    );
  });

  test("tracks the remote management surfaces the mobile app should expose", () => {
    expect(new Set(MOBILE_FEATURE_SECTIONS).size).toBe(MOBILE_FEATURE_SECTIONS.length);
    expect(MOBILE_FEATURE_SECTIONS).toEqual([
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
    ]);
    expect(MOBILE_SURFACES).toEqual(
      MOBILE_FEATURE_SECTIONS.filter((surface) => surface !== "sessions")
    );
    expect(MOBILE_SETTINGS_SURFACES).toEqual([
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
    ]);
    expect(MOBILE_RECENT_ACTIVITY_CHROME.showTerminalRows).toBe(false);
  });

  test("opens first-class editors for editable settings and hides internal fields", () => {
    expect(MOBILE_SETTINGS_DETAIL_CHROME.agentsEditable).toBe(true);
    expect(MOBILE_SETTINGS_DETAIL_CHROME.approvalsActionable).toBe(true);
    expect(MOBILE_SETTINGS_DETAIL_CHROME.channelsEditable).toBe(true);
    expect(MOBILE_SETTINGS_DETAIL_CHROME.providersEditable).toBe(true);
    expect(MOBILE_SETTINGS_DETAIL_CHROME.tasksActionable).toBe(true);
    expect(MOBILE_SETTINGS_DETAIL_CHROME.hidesRawInternalFields).toBe(true);
    expect(MOBILE_SETTINGS_DETAIL_CHROME.providerCredentialUpdateMode).toBe("blank-keeps-existing");

    expect(isMobileSettingsDetailFieldVisible("name")).toBe(true);
    expect(isMobileSettingsDetailFieldVisible("model")).toBe(true);
    expect(isMobileSettingsDetailFieldVisible("provider_id")).toBe(false);
    expect(isMobileSettingsDetailFieldVisible("session id")).toBe(false);
    expect(isMobileSettingsDetailFieldVisible("api_key")).toBe(false);
    expect(isMobileSettingsDetailFieldVisible("access token")).toBe(false);
  });

  test("keeps recent activity chat rows tappable and honest about state", () => {
    expect(MOBILE_RECENT_ACTIVITY_CHROME.chatsOpenSession).toBe(true);
    expect(MOBILE_RECENT_ACTIVITY_CHROME.truncateTitles).toBe(true);
    expect(MOBILE_RECENT_ACTIVITY_CHROME.useRecentStateForIdleChats).toBe(true);
    expect(recentSessionStateLabel(summary.sessions[0])).toBe("Recent");
    expect(
      recentSessionStateLabel({
        ...summary.sessions[0],
        last_message: { role: "user", content: "continue" },
      })
    ).toBe("Working");
  });

  test("summarizes feature counts without requiring every optional endpoint", () => {
    expect(summarizeFeatureCounts(summary)).toEqual({
      sessions: 1234,
      agents: 1,
      providers: 1,
      tools: 2,
      approvals: 1,
      channels: 1,
      tasks: 1,
      memory: 1,
      logs: 1,
    });
    expect(summarizeFeatureCounts(null).sessions).toBe(0);
  });

  test("builds one title per tab from the active destination", () => {
    const counts = summarizeFeatureCounts(summary);
    expect(buildMobileHeaderCopy("overview", counts, profile)).toEqual({
      title: "Cybara",
      detail: "Studio Gateway - 127.0.0.1:4269",
    });
    expect(buildMobileHeaderCopy("sessions", counts, profile).title).toBe("Chats");
    expect(buildMobileHeaderCopy("metrics", counts, profile).detail).toBe(
      "1234 chats - 2 tools - 1 event"
    );
    expect(buildMobileHeaderCopy("settings", counts, profile).title).toBe("Settings");
  });

  test("formats dashboard time labels", () => {
    expect(formatUptime(65)).toBe("1m");
    expect(formatUptime(3 * 3600 + 90)).toBe("3h 1m");
    expect(formatUptime(2 * 86400 + 5 * 3600)).toBe("2d 5h 0m");
    expect(lastUpdatedLabel(summary.sessions[0], Date.parse("2026-06-30T08:06:00.000Z"))).toBe(
      "6m ago"
    );
  });

  test("formats object values for native settings rows", () => {
    expect(formatMobileValue("always_allow")).toBe("always_allow");
    expect(formatMobileValue({ read_file: true, shell: false })).toBe("1/2 enabled");
    expect(formatMobileValue({ mode: "ask", limit: 5 })).toBe("2 settings");
    expect(formatMobileValue(undefined)).toBe("unknown");
  });

  test("reads supported accent themes from gateway config without using dark mode as an accent", () => {
    expect(readMobileAccent({ ui_accent: "emerald" })).toBe("emerald");
    expect(readMobileAccent({ theme: "teal" })).toBe("teal");
    expect(readMobileAccent({ ui: { accent: "rose" } })).toBe("rose");
    expect(readMobileAccent({ theme: "dark" })).toBe("cyan");
    expect(readMobileAccent({ identity: { theme: "dark" } })).toBe("cyan");
    expect(readMobileAccent({ themeAccent: "purple" })).toBe("purple");
  });

  test("builds a shared gateway payload for mobile theme accents", () => {
    expect(MOBILE_ACCENT_KEYS).toContain("emerald");
    expect(mobileThemeConfigPayload("emerald")).toEqual({
      theme: "emerald",
      themeAccent: "emerald",
      theme_accent: "emerald",
      ui_accent: "emerald",
    });
  });
});
