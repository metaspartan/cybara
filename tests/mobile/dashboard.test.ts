import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { FeatureSummary } from "../../apps/mobile/src/lib/api";
import type { GatewayProfile } from "../../apps/mobile/src/lib/connection";
import {
  MOBILE_FEATURE_SECTIONS,
  MOBILE_ACCENT_KEYS,
  MOBILE_CHAT_COMPOSER,
  MOBILE_CHAT_DETAIL_CHROME,
  MOBILE_CHAT_CHROME,
  MOBILE_GATEWAY_PANEL_CHROME,
  MOBILE_HOME_CHROME,
  MOBILE_LOGS_CHROME,
  MOBILE_MAIN_TAB_CHROME,
  MOBILE_METRICS_CHROME,
  MOBILE_NAV_CHROME,
  MOBILE_NEW_CHAT_CHROME,
  MOBILE_RECENT_ACTIVITY_CHROME,
  MOBILE_REASONING_EFFORT_OPTIONS,
  MOBILE_ROUTER_STRATEGY_OPTIONS,
  MOBILE_SETTINGS_DETAIL_CHROME,
  MOBILE_SETTINGS_ROOT_CHROME,
  MOBILE_SETTINGS_SURFACES,
  MOBILE_PLATFORM_SETTING_KEYS,
  MOBILE_SYSTEM_PROMPT_FEATURE_KEYS,
  MOBILE_SURFACES,
  MOBILE_TABS,
  boundedMobileComposerHeight,
  buildGatewayPanelMeta,
  buildMobileChatSettingsLines,
  buildMobileHeaderCopy,
  sessionProviderModelLabel,
  formatMobileValue,
  formatUptime,
  isMobileSettingsDetailFieldVisible,
  lastUpdatedLabel,
  mobileComposerHeightForDraft,
  mobileBackRouteForDetail,
  mobileFirstNonEmptyString,
  mobileSessionTitle,
  mobileThemeConfigPayload,
  recentSessionStateLabel,
  readMobileDangerousToolPolicy,
  readMobileReasoningEffort,
  readMobileRouterStrategy,
  readMobileSandboxRuntime,
  readMobileAccent,
  readMobileToolApprovalMode,
  summarizeFeatureCounts,
} from "../../apps/mobile/src/lib/dashboard";

const dashboardScreenSource = readFileSync(
  new URL("../../apps/mobile/src/screens/DashboardScreen.tsx", import.meta.url),
  "utf8"
);

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
      provider: "openai",
      provider_name: "OpenAI",
      model: "gpt-5-mini",
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
  logsTotal: 2604,
  logsLimit: 150,
  logsOffset: 0,
  logsHasMore: true,
  systemMonitor: {
    status: "healthy",
    timestamp: "2026-06-30T08:00:00.000Z",
    sampleIntervalMs: 1000,
    platform: { type: "darwin", arch: "arm64", release: "26.0.0" },
    cpu: {
      usagePct: 12.5,
      loadPct: 45,
      loadAverage: [1.2, 1.1, 1],
      cores: 10,
      model: "Apple M-series",
    },
    memory: {
      totalBytes: 32 * 1024 * 1024 * 1024,
      freeBytes: 12 * 1024 * 1024 * 1024,
      usedBytes: 20 * 1024 * 1024 * 1024,
      usedPct: 62.5,
      swap: {
        totalBytes: 4 * 1024 * 1024 * 1024,
        freeBytes: 1 * 1024 * 1024 * 1024,
        usedBytes: 3 * 1024 * 1024 * 1024,
        usedPct: 75,
      },
    },
    process: {
      pid: 123,
      uptimeSeconds: 3600,
      cpuUsagePct: 3.2,
      memory: {
        rssBytes: 512 * 1024 * 1024,
        heapUsedBytes: 128 * 1024 * 1024,
        heapTotalBytes: 256 * 1024 * 1024,
        externalBytes: 64 * 1024 * 1024,
        arrayBuffersBytes: 8 * 1024 * 1024,
      },
    },
    disk: {
      path: "/Users/carsen/Documents/GitHub/cybara",
      totalBytes: 1000 * 1024 * 1024 * 1024,
      freeBytes: 400 * 1024 * 1024 * 1024,
      usedBytes: 600 * 1024 * 1024 * 1024,
      usedPct: 60,
    },
  },
  systemPrompt: {
    template: "default",
    customPrompt: "",
    defaultBasePrompt: "You are Cybara.",
    identity: {
      name: "Cybara",
      emoji: "",
      creature: "AI assistant",
      vibe: "Useful",
      theme: "dark",
    },
    features: {
      memoryEnabled: true,
      skillsEnabled: true,
      messagingEnabled: true,
      replyTagsEnabled: false,
    },
  },
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
    systemMonitor: { ok: true },
    systemPrompt: { ok: true },
    config: { ok: true },
  },
};

describe("mobile dashboard model", () => {
  test("keeps recent activity first and moves gateway connection details to settings", () => {
    expect(MOBILE_TABS.map((tab) => tab.key)).toEqual([
      "overview",
      "sessions",
      "metrics",
      "tasks",
    ]);
    expect(MOBILE_TABS.find((tab) => tab.key === "sessions")?.label).toBe("Chats");
    // Settings is reached from the header gear, not a bottom tab.
    expect(MOBILE_TABS.some((tab) => tab.key === "settings")).toBe(false);
    expect(MOBILE_TABS.filter((tab) => tab.showsGatewayPanel).map((tab) => tab.key)).toEqual([]);
    expect(MOBILE_HOME_CHROME.firstSection).toBe("recent_activity");
    expect(MOBILE_HOME_CHROME.firstManagementSurface).toBe("monitor");
    expect(MOBILE_HOME_CHROME.managementGridEdgeToEdge).toBe(true);
    expect(MOBILE_HOME_CHROME.showsGatewayConnectionPanel).toBe(false);
    expect(MOBILE_HOME_CHROME.showsRemoteManagementTitle).toBe(false);
    expect(MOBILE_SETTINGS_ROOT_CHROME.gatewayConnectionDetails).toBe(true);
    expect(MOBILE_SETTINGS_ROOT_CHROME.gatewayRefreshButton).toBe(false);
    expect(MOBILE_SETTINGS_ROOT_CHROME.destructiveDisconnectButton).toBe(true);
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

  test("floats the bottom nav with rounded corners above the home indicator", () => {
    expect(MOBILE_NAV_CHROME.pinnedToViewport).toBe(true);
    expect(MOBILE_NAV_CHROME.outerRadius).toBeGreaterThan(0);
    expect(MOBILE_NAV_CHROME.floatingMargin).toBeGreaterThan(0);
    expect(MOBILE_NAV_CHROME.height).toBeLessThanOrEqual(82);
    expect(MOBILE_CHAT_CHROME.composerPinnedAboveNav).toBe(true);
    expect(MOBILE_CHAT_CHROME.composerGapToNav).toBe(0);
    expect(MOBILE_CHAT_CHROME.composerHeight).toBeGreaterThanOrEqual(70);
    expect(MOBILE_CHAT_CHROME.composerReservedBottom).toBe(MOBILE_NAV_CHROME.height);
    expect(MOBILE_CHAT_CHROME.autoScrollToLatestMessage).toBe(true);
    expect(MOBILE_CHAT_CHROME.hidesSystemMessages).toBe(true);
    expect(MOBILE_CHAT_CHROME.newChatButtonProminent).toBe(true);
    expect(MOBILE_CHAT_CHROME.newChatButtonUsesIcon).toBe(true);
    expect(MOBILE_NEW_CHAT_CHROME.composerStartsSingleLine).toBe(true);
    expect(MOBILE_NEW_CHAT_CHROME.composerMatchesChatComposer).toBe(true);
    expect(MOBILE_NEW_CHAT_CHROME.sendButtonMode).toBe("icon");
    expect(MOBILE_MAIN_TAB_CHROME.edgeToEdge).toBe(false);
    expect(MOBILE_MAIN_TAB_CHROME.outerHorizontalPadding).toBeGreaterThan(0);
    expect(MOBILE_MAIN_TAB_CHROME.panelRadius).toBeGreaterThan(0);
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
    expect(MOBILE_CHAT_DETAIL_CHROME.detailsMenuIncludesSessionId).toBe(false);
    expect(MOBILE_CHAT_DETAIL_CHROME.detailsMenuIncludesProviderModel).toBe(true);
    expect(MOBILE_CHAT_DETAIL_CHROME.detailsMenuIncludesWorkspaceDirectory).toBe(true);
    expect(
      buildMobileChatSettingsLines({
        agentId: "minimax-m3-mini",
        provider: "minimax",
        model: "MiniMax-M1",
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
      "Model: minimax - MiniMax-M1",
      "Workspace directory: /Users/carsen/Documents/GitHub/cybara",
    ]);
    expect(
      sessionProviderModelLabel({
        agent_id: "agent-1",
        provider_name: " OpenAI ",
        provider: "openai",
        model: " gpt-5-mini ",
      })
    ).toBe("OpenAI - gpt-5-mini");
    expect(sessionProviderModelLabel({ provider_name: "   ", model: " gpt-5 " })).toBe("gpt-5");
    expect(
      sessionProviderModelLabel({
        provider_name: "   ",
        provider: " Anthropic ",
        provider_id: "provider-id-fallback",
        model: " Claude Sonnet 4 ",
      })
    ).toBe("Anthropic - Claude Sonnet 4");
    expect(sessionProviderModelLabel({ agent_id: "agent-1" })).toBe("Model pending");
  });

  test("normalizes mobile chat titles before rendering or destructive actions", () => {
    expect(mobileFirstNonEmptyString("  ", "  Build a release  ")).toBe("Build a release");
    expect(mobileSessionTitle({ title: "  Build a release  " })).toBe("Build a release");
    expect(mobileSessionTitle({ title: "   " })).toBe("Untitled chat");
    expect(mobileSessionTitle({ title: null })).toBe("Untitled chat");
    expect(
      buildMobileChatSettingsLines({
        messageCount: 1,
        sessionId: "session-hidden",
        title: "   ",
        updatedLabel: "just now",
      })
    ).toEqual([
      "Title: Untitled chat",
      "Messages: 1 message",
      "Updated: just now",
      "Model: Model pending",
      "Workspace directory: No workspace",
    ]);
  });

  test("keeps metrics live without an in-page refresh button", () => {
    expect(MOBILE_METRICS_CHROME.headerRefreshButton).toBe(false);
    expect(MOBILE_METRICS_CHROME.lazyLoadUntilOpened).toBe(true);
    expect(MOBILE_METRICS_CHROME.pullToRefresh).toBe(true);
    expect(MOBILE_METRICS_CHROME.liveRefreshMs).toBeLessThan(
      MOBILE_METRICS_CHROME.backgroundRefreshMs
    );
  });

  test("does not fetch all metrics on initial dashboard load before metrics opens", () => {
    expect(dashboardScreenSource).toContain("const hasLoadedMetrics = metrics !== null;");
    expect(dashboardScreenSource).toContain("const shouldRefreshMetrics =");
    expect(dashboardScreenSource).toContain('activeTab === "metrics" || hasLoadedMetrics');
    expect(dashboardScreenSource).toContain(
      "shouldRefreshMetrics ? refreshMetrics({ force: true }) : Promise.resolve()"
    );
    expect(dashboardScreenSource).toContain(
      'activeTab !== "metrics" && !hasLoadedMetrics'
    );
  });

  test("keeps logs paged while still showing the total count", () => {
    expect(MOBILE_LOGS_CHROME.showsTotalCount).toBe(true);
    expect(MOBILE_LOGS_CHROME.lazyLoadsOnScroll).toBe(true);
    expect(MOBILE_LOGS_CHROME.pageSize).toBe(150);
    expect(summarizeFeatureCounts(summary).logs).toBe(2604);
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
    expect(MOBILE_SETTINGS_DETAIL_CHROME.tasksUseRunningToggle).toBe(true);
    expect(MOBILE_SETTINGS_DETAIL_CHROME.walletPolicyUsesToggles).toBe(true);
    expect(MOBILE_SETTINGS_DETAIL_CHROME.monitorShowsHostTelemetry).toBe(true);
    expect(MOBILE_SETTINGS_DETAIL_CHROME.itemBackReturnsToSurface).toBe(true);
    expect(MOBILE_SETTINGS_DETAIL_CHROME.hidesRawInternalFields).toBe(true);
    expect(MOBILE_SETTINGS_DETAIL_CHROME.providerCredentialUpdateMode).toBe("blank-keeps-existing");

    expect(mobileBackRouteForDetail({ kind: "item", surface: "logs" })).toEqual({
      kind: "surface",
      surface: "logs",
    });
    expect(mobileBackRouteForDetail({ kind: "item", surface: "wallet" })).toEqual({
      kind: "surface",
      surface: "wallet",
    });
    expect(mobileBackRouteForDetail({ kind: "surface", surface: "logs" })).toBeNull();
    expect(mobileBackRouteForDetail({ kind: "session" })).toBeNull();

    expect(isMobileSettingsDetailFieldVisible("name")).toBe(true);
    expect(isMobileSettingsDetailFieldVisible("model")).toBe(true);
    expect(isMobileSettingsDetailFieldVisible("provider_id")).toBe(false);
    expect(isMobileSettingsDetailFieldVisible("session id")).toBe(false);
    expect(isMobileSettingsDetailFieldVisible("api_key")).toBe(false);
    expect(isMobileSettingsDetailFieldVisible("access token")).toBe(false);
  });

  test("exposes root settings toggles that mirror web and Tauri settings", () => {
    expect(MOBILE_SETTINGS_ROOT_CHROME.terminalToggle).toBe(true);
    expect(MOBILE_SETTINGS_ROOT_CHROME.toolApprovalModeSelector).toBe(true);
    expect(MOBILE_SETTINGS_ROOT_CHROME.reasoningEffortSelector).toBe(true);
    expect(MOBILE_SETTINGS_ROOT_CHROME.modelRouterControls).toBe(true);
    expect(MOBILE_SETTINGS_ROOT_CHROME.dangerousToolPolicyToggle).toBe(true);
    expect(MOBILE_SETTINGS_ROOT_CHROME.sandboxRuntimeControls).toBe(true);
    expect(MOBILE_SETTINGS_ROOT_CHROME.systemPromptFeatureToggles).toBe(true);
    expect(MOBILE_SETTINGS_ROOT_CHROME.settingsEdgeToEdgeContent).toBe(true);
    expect(MOBILE_SETTINGS_ROOT_CHROME.nativeGroupedSections).toBe(true);
    expect(MOBILE_SETTINGS_ROOT_CHROME.nativeSegmentedControls).toBe(true);
    expect(MOBILE_SETTINGS_ROOT_CHROME.nativeSwitchControls).toBe(true);
    expect(MOBILE_PLATFORM_SETTING_KEYS).toEqual([
      "terminal_enabled",
      "tool_approval_mode",
      "reasoning_effort",
      "dangerous_tool_policy",
      "sandbox_runtime",
      "router",
    ]);
    expect(MOBILE_REASONING_EFFORT_OPTIONS.map((option) => option.value)).toEqual([
      "",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(MOBILE_ROUTER_STRATEGY_OPTIONS.map((option) => option.value)).toEqual([
      "weighted",
      "round_robin",
      "lowest_cost",
      "priority",
      "mixture_of_agents",
    ]);
    expect(MOBILE_SYSTEM_PROMPT_FEATURE_KEYS).toEqual([
      "memoryEnabled",
      "skillsEnabled",
      "messagingEnabled",
      "replyTagsEnabled",
    ]);
    expect(
      readMobileDangerousToolPolicy({
        dangerous_tool_policy: { enabled: true, mode: "block" },
      })
    ).toEqual({ enabled: true, mode: "block" });
    expect(
      readMobileSandboxRuntime({
        sandbox_runtime: { enabled: true, provider: "podman", network: "allow" },
      })
    ).toEqual({ enabled: true, provider: "podman", network: "allow" });
    expect(readMobileToolApprovalMode({ tool_approval_mode: "ask" })).toBe("ask");
    expect(readMobileToolApprovalMode({ tool_approval_mode: "always_allow" })).toBe("always_allow");
    expect(readMobileReasoningEffort({ reasoning_effort: "high" })).toBe("high");
    expect(readMobileReasoningEffort({ reasoning_effort: "invalid" })).toBe("");
    expect(readMobileRouterStrategy("lowest_cost")).toBe("lowest_cost");
    expect(readMobileRouterStrategy("unknown")).toBe("weighted");
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
      logs: 2604,
    });
    expect(summarizeFeatureCounts(null).sessions).toBe(0);
  });

  test("builds one title per tab from the active destination", () => {
    const counts = summarizeFeatureCounts(summary);
    expect(buildMobileHeaderCopy("overview", counts, profile)).toEqual({
      title: "Cybara",
      detail: "Recent activity and controls",
    });
    expect(buildMobileHeaderCopy("sessions", counts, profile).title).toBe("Chats");
    expect(buildMobileHeaderCopy("metrics", counts, profile).detail).toBe(
      "1234 chats - 2 tools - 2604 events"
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
