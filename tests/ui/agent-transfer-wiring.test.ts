import { describe, expect, test } from "bun:test";

const files = {
  "ui/src/pages/chat/ChatMessageTimeline.tsx": "AgentTransferTimeline",
  "ui/src/pages/ide/IDEChatPanel.tsx": "AgentTransferTimeline",
  "apps/mobile/src/screens/dashboardChat.tsx": "MobileAgentTransferTimeline",
  "apps/macos/Cybara/Sources/Cybara/NativeScreens.swift": "Transferred from",
  "src/cli-chat.ts": "Transferred from",
  "src/cli-tui-interactive-chat.tsx": "Transferred from",
};

describe("agent transfer client wiring", () => {
  test("all chat clients render persisted transfer metadata", async () => {
    for (const [file, transferPresentation] of Object.entries(files)) {
      const source = await Bun.file(file).text();
      expect(source).toMatch(/agent_transfers|agentTransfers/);
      expect(source).toContain(transferPresentation);
    }
  });

  test("web activity timeline uses a transfer-specific icon", async () => {
    const source = await Bun.file("ui/src/pages/chat/ActivityTimeline.tsx").text();
    expect(source).toContain('activity.toolName === "sessions_transfer"');
    expect(source).toContain("ArrowRightLeft");
  });
});
