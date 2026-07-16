import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToString } from "ink";
import { EnvironmentPanel } from "../../src/cli-tui-chat-environment-view";
import type { TuiEnvironmentSnapshot } from "../../src/cli-tui-chat-environment";

const snapshot: TuiEnvironmentSnapshot = {
  workspaceDir: "/workspaces/solar-dashboard",
  gitBranch: "feature/energy-view",
  contextUsage: {
    tokensUsed: 12_000,
    contextWindow: 128_000,
    percentage: 9,
    compacted: false,
    compactionCount: 0,
    compactedTokens: 0,
  },
  tokenUsage: {
    inputTokens: 10_000,
    outputTokens: 2_000,
    totalTokens: 12_000,
    tokensPerSecond: 48.5,
    callCount: 3,
  },
  plan: {
    summary: { completed: 1, total: 3 },
    items: [
      { content: "Inspect the existing dashboard", status: "completed" },
      { content: "Build responsive charts", status: "in_progress" },
      { content: "Verify keyboard controls", status: "pending" },
    ],
  },
  fileChanges: {
    files: [
      {
        path: "/workspaces/solar-dashboard/src/Dashboard.tsx",
        added: 42,
        removed: 8,
        type: "updated",
      },
    ],
    totalAdded: 42,
    totalRemoved: 8,
  },
};

describe("CLI TUI chat environment panel", () => {
  test("renders a data-rich right sidebar for wide chat layouts", () => {
    const output = renderToString(
      React.createElement(EnvironmentPanel, {
        snapshot,
        tasks: [{ id: "task-1", title: "Refresh telemetry", status: "active" }],
        subagents: [{ id: "agent-1", label: "Chart reviewer", status: "running" }],
        lspServers: [{ id: "vtsls", name: "TypeScript", command: "vtsls" }],
        colorScheme: "dark",
        variant: "sidebar",
        width: 40,
      }),
      { columns: 160 }
    );
    expect(output).toContain("Session inspector");
    expect(output).toContain("solar-dashboard");
    expect(output).toContain("git feature/energy-view");
    expect(output).toContain("Usage");
    expect(output).toContain("Plan: 1/3 complete");
    expect(output).toContain("Build responsive charts");
    expect(output).toContain("Changes");
    expect(output).toContain("Dashboard.tsx");
    expect(output).toContain("Refresh telemetry");
    expect(output).toContain("Chart reviewer");
    expect(output).toContain("LSP");
    expect(output).toContain("TypeScript");
    expect(output).toContain("vtsls");
  });

  test("renders the wide inspector in a contrasting light terminal surface", () => {
    const output = renderToString(
      React.createElement(EnvironmentPanel, {
        snapshot,
        tasks: [],
        subagents: [],
        colorScheme: "light",
        variant: "sidebar",
        width: 40,
      }),
      { columns: 160 }
    );
    expect(output).toContain("Session inspector");
    expect(output).toContain("solar-dashboard");
  });

  test("keeps the narrow stacked panel concise", () => {
    const output = renderToString(
      React.createElement(EnvironmentPanel, {
        snapshot,
        tasks: [],
        subagents: [],
        compact: true,
      }),
      { columns: 64 }
    );
    expect(output).toContain("Tasks 0 · Subagents 0");
    expect(output).toContain("Diffs: 1 files");
    expect(output).not.toContain("Inspect the existing dashboard");
  });
});
