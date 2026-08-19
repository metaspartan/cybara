import { describe, expect, test } from "bun:test";

describe("goal panel visibility and layout", () => {
  test("renders nothing by default and only shows a transient loading row while fetching", async () => {
    const source = await Bun.file("ui/src/pages/chat/GoalPanel.tsx").text();

    expect(source).toContain("return null;");
    expect(source).not.toContain("Loop mode:");
    expect(source).not.toContain("Set a goal");
    expect(source).not.toContain("onSetGoal");
  });

  test("uses theme tokens instead of the hardcoded dark palette", async () => {
    const source = await Bun.file("ui/src/pages/chat/GoalPanel.tsx").text();

    expect(source).not.toContain("bg-[#0a0c13]");
    expect(source).not.toContain("text-white/85");
    expect(source).not.toContain("bg-white/5");
    expect(source).toContain("bg-[var(--surface-panel)]");
    expect(source).toContain("border-[var(--surface-border)]");
    expect(source).toContain("text-[var(--text-primary)]");
    expect(source).toContain("text-[var(--text-muted)]");
    expect(source).toContain("text-[var(--text-secondary)]");
  });

  test("new-chat layout matches the workspace bar width above the composer", async () => {
    const source = await Bun.file("ui/src/pages/chat/GoalPanel.tsx").text();
    const emptyState = await Bun.file("ui/src/pages/chat/ChatEmptyState.tsx").text();
    const chat = await Bun.file("ui/src/pages/Chat.tsx").text();

    expect(source).toContain('layout?: "default" | "new-chat";');
    expect(source).toContain('layout === "new-chat"');
    expect(source).toContain("new-chat-workspace-bar mx-4 flex h-9");
    expect(source).toContain("rounded-t-[18px] border border-b-0");
    expect(emptyState).toContain("goalPanel?: ReactNode;");
    expect(emptyState).toContain("{goalPanel}");
    expect(emptyState).toContain("rounded-none border-t-0");
    expect(emptyState).toContain("w-[min(100%,40rem)]");
    expect(chat).toContain("goalPanel={");
    expect(chat).toContain('layout="new-chat"');
    expect(chat).toContain("horizontalPadding={chatAppearance.horizontalPadding}");
    expect(chat).not.toContain("handleSetGoalDraft");
  });
});
