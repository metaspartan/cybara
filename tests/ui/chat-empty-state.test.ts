import { describe, expect, test } from "bun:test";

describe("chat empty state", () => {
  test("uses a translucent monochrome Cybara mark", async () => {
    const source = await Bun.file("ui/src/pages/chat/ChatEmptyState.tsx").text();
    const styles = await Bun.file("ui/src/styles/index-foundation.css").text();

    expect(source).toContain('src="/cybara.png"');
    expect(source).toContain('aria-hidden="true"');
    expect(source).toContain("chat-empty-state-logo");
    expect(styles).toContain("filter: grayscale(1) contrast(1.12)");
    expect(styles).not.toContain(".chat-empty-state-logo::after");
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
    expect(emptyState).toContain("w-[min(100%,40rem)]");
    expect(emptyState).toContain('data-chat-empty-state="true"');
    expect(emptyState).toContain("mx-auto mt-4 w-full");
    expect(emptyState).toContain("<NewChatWorkspaceBar");
    expect(workspaceBar).toContain('appearance="inline"');
    expect(workspaceBar).toContain("workspaceFolderName(workspaceDir)");
    expect(workspaceBar).toContain('<X className="h-2.5 w-2.5"');
    expect(workspaceBar).toContain('aria-label="Clear workspace"');
    expect(workspaceBar).toContain("rounded-full bg-[var(--icon-muted)]");
    expect(workspaceBar).not.toContain("pb-1");
    expect(emptyState).toContain("onClearWorkspace={onClearWorkspace}");
    expect(chat).toContain("setWorkspaceFallbackSuppressed(true)");
    expect(chat).toContain("workspaceDir: effectiveWorkspaceDir");
    expect(workspaceBar).not.toContain("Local");
    expect(composer).toContain('layout?: "default" | "new-chat"');
    expect(composer).toContain("data-layout={layout}");
    expect(composer).toContain('layout === "new-chat"');
    expect(header).not.toContain("NewChatTitle");
  });

  test("uses a workspace-aware clickable heading with varied workspace-free prompts", async () => {
    const source = await Bun.file("ui/src/pages/chat/ChatEmptyState.tsx").text();

    expect(source).toContain("What should we build in");
    expect(source).toContain("workspaceFolderName(workspaceDir)");
    expect(source).toContain("onClick={onSelectWorkspace}");
    expect(source).toContain("Change workspace from ${workspaceName}");
    expect(source).toContain('"What should we build?"');
    expect(source).toContain('"Hello, what would you like to do?"');
    expect(source).toContain('"What would you like to work on?"');
    expect(source).toContain("text-xl font-medium");
    expect(source).not.toContain("Start a conversation");
  });
});
