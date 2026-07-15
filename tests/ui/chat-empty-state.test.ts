import { describe, expect, test } from "bun:test";

describe("chat empty state", () => {
  test("uses the transparent monochrome Cybara mark", async () => {
    const source = await Bun.file("ui/src/pages/chat/ChatEmptyState.tsx").text();

    expect(source).toContain('src="/cybara.png"');
    expect(source).toContain('aria-hidden="true"');
    expect(source).toContain("grayscale brightness-[1.7] contrast-150");
    expect(source).not.toContain('<Sparkles className="mx-auto mb-3');
  });

  test("centers a narrow composer beneath the workspace without a fresh-chat header", async () => {
    const chat = await Bun.file("ui/src/pages/Chat.tsx").text();
    const emptyState = await Bun.file("ui/src/pages/chat/ChatEmptyState.tsx").text();
    const composer = await Bun.file("ui/src/pages/chat/ChatComposer.tsx").text();
    const workspaceBar = await Bun.file("ui/src/pages/chat/NewChatWorkspaceBar.tsx").text();
    const header = await Bun.file("ui/src/pages/chat/ChatPageHeader.tsx").text();

    expect(chat).toContain("{sessionId ? (");
    expect(chat).toContain("<ChatEmptyState");
    expect(chat).toContain('layout="new-chat"');
    expect(chat).toContain("typedMessages.length > 0 ? <ChatComposer");
    expect(emptyState).toContain("max-w-[42rem]");
    expect(emptyState).toContain('data-chat-empty-state="true"');
    expect(emptyState).toContain("mt-4 w-full");
    expect(emptyState).toContain("<NewChatWorkspaceBar");
    expect(workspaceBar).toContain('appearance="inline"');
    expect(workspaceBar).toContain("workspaceName(workspaceDir)");
    expect(workspaceBar).toContain("Local");
    expect(composer).toContain('layout?: "default" | "new-chat"');
    expect(composer).toContain("data-layout={layout}");
    expect(composer).toContain('layout === "new-chat"');
    expect(header).not.toContain("NewChatTitle");
  });
});
