import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToString } from "ink";
import {
  ChatHeader,
  ChatShortcutRail,
  chatHeaderMeta,
  chatRunStatus,
  chatShortcutHints,
  terminalWorkspaceName,
  type ChatHeaderState,
} from "../../src/cli/tui/components/chat-chrome";
import { LiveRunView } from "../../src/cli/tui/components/interactive-chat-view";
import { tuiChatPalette } from "../../src/cli/tui/theme";

const baseHeader: ChatHeaderState = {
  approvalCount: 0,
  approvalMode: "always_allow",
  branch: "main",
  columns: 120,
  contextUsage: {
    tokensUsed: 18_000,
    contextWindow: 256_000,
    percentage: 7,
    compacted: false,
    compactionCount: 0,
    compactedTokens: 0,
  },
  model: "MiniMax-M3",
  pendingCount: 0,
  profile: "coding",
  reasoning: "high",
  sending: false,
  sessionId: "12345678-1234-1234-1234-123456789abc",
  status: "idle",
  title: "Build a responsive energy dashboard",
  workspaceDir: "C:\\Users\\Carsen\\Projects\\solarflow",
};

describe("CLI TUI chat chrome", () => {
  test("paints the complete terminal viewport at its measured dimensions", async () => {
    const source = await Bun.file(
      new URL("../../src/cli/tui/components/interactive-chat.tsx", import.meta.url),
    ).text();
    expect(source).toContain('height={layout.rows}');
    expect(source).toContain('width={layout.columns}');
    expect(source).toContain('backgroundColor={tuiPalette.canvas}');
  });

  test("normalizes cross-platform workspace labels and run status", () => {
    expect(terminalWorkspaceName("C:\\Users\\Carsen\\Projects\\solarflow\\")).toBe(
      "solarflow",
    );
    expect(terminalWorkspaceName("/Users/carsen/cybara/")).toBe("cybara");
    expect(chatRunStatus(false, "thinking")).toBe("ready");
    expect(chatRunStatus(true, "idle")).toBe("working");
    expect(chatRunStatus(true, "tool_running")).toBe("tool running");
  });

  test("prioritizes useful metadata without overflowing narrow terminals", () => {
    const meta = chatHeaderMeta({ ...baseHeader, columns: 40 });
    expect(meta[0]).toBe("MiniMax-M3");
    expect(meta).toContain("solarflow");
    expect(meta.join(" · ").length).toBeLessThanOrEqual(36);
    expect(meta).not.toContain("12345678");
  });

  test("adds operational detail when the terminal has room", () => {
    const meta = chatHeaderMeta(baseHeader);
    expect(meta).toContain("git main");
    expect(meta).toContain("reasoning high");
    expect(meta).toContain("tools coding");
    expect(meta).toContain("context 7%");
    expect(meta).toContain("12345678");
  });

  test("changes shortcut guidance with interaction state", () => {
    expect(
      chatShortcutHints({
        activeApproval: false,
        columns: 120,
        followUpsEnabled: true,
        panelOpen: false,
        paletteOpen: false,
        sending: false,
      }),
    ).toContain("Ctrl+T transcript");
    expect(
      chatShortcutHints({
        activeApproval: false,
        columns: 80,
        followUpsEnabled: true,
        panelOpen: false,
        paletteOpen: false,
        sending: true,
      }),
    ).toEqual(["Enter queue", "/steer redirect", "Ctrl+C stop"]);
    expect(
      chatShortcutHints({
        activeApproval: true,
        columns: 120,
        followUpsEnabled: true,
        panelOpen: false,
        paletteOpen: false,
        sending: true,
      }),
    ).toContain("4 deny");
    expect(
      chatShortcutHints({
        activeApproval: false,
        columns: 40,
        followUpsEnabled: true,
        panelOpen: false,
        paletteOpen: false,
        sending: true,
      }),
    ).toEqual(["Enter queue", "Ctrl+C stop"]);
  });

  test("renders clean responsive chrome without box-drawing borders", () => {
    const header = renderToString(<ChatHeader state={baseHeader} />, {
      columns: 120,
    });
    const shortcuts = renderToString(
      <ChatShortcutRail
        state={{
          activeApproval: false,
          columns: 120,
          followUpsEnabled: true,
          panelOpen: false,
          paletteOpen: false,
          sending: false,
        }}
      />,
      { columns: 120 },
    );
    expect(header).toContain("◆ Build a responsive energy dashboard");
    expect(header).toContain("● ready");
    expect(header).toContain("MiniMax-M3 · solarflow · git main");
    expect(header).not.toMatch(/[┌┐└┘]/);
    expect(shortcuts).toContain("@ capabilities");
    expect(shortcuts).toContain("Ctrl+O work");
  });

  test("keeps live work bounded while preserving the newest activity", () => {
    const output = renderToString(
      <LiveRunView
        activities={Array.from({ length: 8 }, (_, index) => ({
          id: `thought-${index}`,
          phase: "result" as const,
          text: `Inspection thought ${index}`,
          timestamp: index,
          toolName: "__thought",
        }))}
        content=""
        detail="Inspecting the workspace"
        maxColumns={72}
        colorScheme="dark"
        palette={tuiChatPalette("dark")}
      />,
      { columns: 80 },
    );

    expect(output).toContain("… 2 earlier work groups");
    expect(output).not.toContain("Inspection thought 0");
    expect(output).toContain("Inspection thought 7");
  });

  test("wraps complete live thoughts in narrow terminals", () => {
    const thought =
      "Inspecting the provider response before the next tool call and retaining every detail.";
    const output = renderToString(
      <LiveRunView
        activities={[
          {
            id: "long-thought",
            phase: "result",
            text: thought,
            timestamp: 1,
            toolName: "__thought",
          },
        ]}
        content=""
        detail={thought}
        maxColumns={32}
        colorScheme="dark"
        palette={tuiChatPalette("dark")}
      />,
      { columns: 40 },
    );

    expect(output.replace(/\s+/g, " ")).toContain(thought);
    expect(output).not.toContain("…");
  });
});
