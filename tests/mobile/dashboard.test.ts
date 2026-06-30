import { describe, expect, test } from "bun:test";
import type { FeatureSummary } from "../../apps/mobile/src/lib/api";
import type { GatewayProfile } from "../../apps/mobile/src/lib/connection";
import {
  MOBILE_FEATURE_SECTIONS,
  MOBILE_NAV_CHROME,
  MOBILE_TABS,
  buildMobileHeaderCopy,
  formatUptime,
  lastUpdatedLabel,
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
      "tools",
      "settings",
    ]);
    expect(MOBILE_TABS.filter((tab) => tab.showsGatewayPanel).map((tab) => tab.key)).toEqual([
      "overview",
    ]);
  });

  test("keeps the pinned bottom nav squared to the viewport", () => {
    expect(MOBILE_NAV_CHROME.pinnedToViewport).toBe(true);
    expect(MOBILE_NAV_CHROME.outerRadius).toBe(0);
    expect(MOBILE_NAV_CHROME.height).toBeLessThanOrEqual(82);
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
      "terminal",
      "logs",
      "monitor",
    ]);
  });

  test("summarizes feature counts without requiring every optional endpoint", () => {
    expect(summarizeFeatureCounts(summary)).toEqual({
      sessions: 1,
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
    expect(buildMobileHeaderCopy("sessions", counts, profile).title).toBe("Sessions");
    expect(buildMobileHeaderCopy("tools", counts, profile).detail).toBe(
      "2 tools - 1 approvals - 1 providers"
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
});
