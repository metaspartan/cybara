import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readNativeChatSource } from "../shared/source-bundles";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

// Copy + revert message actions must exist on every client, icon-only, below
// the message, with revert always behind a confirmation dialog.
describe("chat message actions parity (copy + confirmed revert on all clients)", () => {
  test("mobile: actions row with clipboard copy and confirmed revert", () => {
    const chat = read("apps/mobile/src/screens/dashboardChat.tsx");
    expect(chat).toContain("function MessageActionsRow");
    expect(chat).toContain('accessibilityLabel="Copy message"');
    expect(chat).toContain('accessibilityLabel="Revert to before this message"');
    expect(chat).toContain("Clipboard.setStringAsync(content)");

    const screen = read("apps/mobile/src/screens/dashboardSessionDetail.tsx");
    // Revert goes through a native confirmation alert and refreshes the session.
    expect(screen).toContain('"Revert to before this message?"');
    expect(screen).toContain('{ text: "Cancel", style: "cancel" }');
    expect(screen).toContain(".revertSession(sessionId, {");
    expect(screen).toContain(
      'onRevert={message.role === "user" ? confirmRevertToMessage : undefined}'
    );

    const api = read("apps/mobile/src/lib/api.ts");
    expect(api).toContain("revertSession(");
    expect(api).toContain("/revert`");
  });

  test("macos: actions row with pasteboard copy and confirmed revert", () => {
    const screens = readNativeChatSource();
    expect(screens).toContain("struct NativeMessageActions: View");
    expect(screens).toContain("NSPasteboard.general.setString(content, forType: .string)");
    expect(screens).toContain(
      '.alert("Revert to before this message?", isPresented: $showRevertConfirm)'
    );
    expect(screens).toContain('Button("Revert", role: .destructive)');
    expect(screens).toContain("performRevert(candidate)");

    const client = read("apps/macos/Cybara/Sources/Cybara/GatewayClient.swift");
    expect(client).toContain("func revertSession(");
    expect(client).toContain("api/sessions/\\(id)/revert");
  });

  test("mobile revert resolves the target by content/timestamp like the web client", () => {
    const screen = read("apps/mobile/src/screens/dashboardSessionDetail.tsx");
    expect(screen).toContain('messageRole: "user"');
    expect(screen).toContain("messageContent: message.content");
    expect(screen).toContain("messageTimestamp: message.timestamp");
    expect(screen).toContain(
      'setComposerDraft(result.revertedMessage?.content ?? message.content ?? "")'
    );
  });

  test("IDE revert fallback removes the selected user message", () => {
    const panel = read("ui/src/pages/ide/IDEChatPanel.tsx");
    expect(panel).toContain("messages.slice(0, messageIndex)");
    expect(panel).toContain("response.data.revertedMessage?.content ?? target.content");
    expect(panel).not.toContain("messages.slice(0, messageIndex + 1)");
  });

  test("macos restores the authoritative reverted prompt", () => {
    const screens = readNativeChatSource();
    expect(screens).toContain("draft = response.revertedMessage?.content ?? message.content");
  });
});
