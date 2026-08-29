import { describe, expect, test } from "bun:test";

describe("goal panel visibility and layout", () => {
  test("renders nothing by default and only shows a transient loading row while fetching", async () => {
    const source = await Bun.file("ui/src/pages/chat/GoalPanel.tsx").text();

    expect(source).toContain("return null;");
    expect(source).not.toContain("Loop mode:");
    expect(source).not.toContain("Set a goal");
    expect(source).not.toContain("onSetGoal");
    expect(source).toContain("Autonomous iterations started in the current loop run");
    expect(source).not.toContain("Autonomous iterations completed in the current loop run");
  });

  test("uses theme tokens instead of the hardcoded dark palette", async () => {
    const source = await Bun.file("ui/src/pages/chat/GoalPanel.tsx").text();
    const styles = await Bun.file("ui/src/styles/index-foundation.css").text();

    expect(source).not.toContain("bg-[#0a0c13]");
    expect(source).not.toContain("text-white/85");
    expect(source).not.toContain("bg-white/5");
    expect(source).not.toContain("border-t border-white/10");
    expect(source).toContain("new-chat-workspace-bar");
    expect(source).toContain("border-[var(--surface-border)]");
    expect(source).toContain("text-[var(--text-primary)]");
    expect(source).toContain("text-[var(--text-muted)]");
    expect(source).toContain("text-[var(--text-secondary)]");
    expect(source).toContain("bg-[var(--surface-raised)]");
    expect(styles).toContain(".new-chat-workspace-bar {");
    expect(styles).toContain("color-mix(in srgb, var(--surface-raised) 86%, transparent)");
    expect(styles).toContain("backdrop-filter: blur(18px)");
  });

  test("new-chat controls are standalone rounded surfaces while the message view stays fused", async () => {
    const source = await Bun.file("ui/src/pages/chat/GoalPanel.tsx").text();
    const styles = await Bun.file("ui/src/styles/index-foundation.css").text();
    const emptyState = await Bun.file("ui/src/pages/chat/ChatEmptyState.tsx").text();
    const chat = await Bun.file("ui/src/pages/Chat.tsx").text();

    expect(source).toContain('layout?: "default" | "new-chat";');
    expect(source).toContain('layout === "new-chat"');
    expect(source).toContain("new-chat-workspace-bar mx-3 mb-2 flex min-h-10");
    expect(source).toContain("new-chat-workspace-bar mx-4 flex min-h-9");
    expect(source).toContain("rounded-2xl border");
    expect(source).toContain("rounded-t-[18px] border border-b-0");
    expect(source).toContain(
      'cn("chat-goal-bar", chatHorizontalPaddingClassName(horizontalPadding))'
    );
    expect(styles).toContain(".chat-goal-bar + .chat-composer-responsive {");
    expect(styles).toContain("border-top: none;");
    expect(styles).toContain("padding-top: 0;");
    expect(styles).toContain("margin-top: -1px;");
    expect(emptyState).toContain("goalPanel?: ReactNode;");
    expect(emptyState).toContain("{goalPanel}");
    expect(emptyState).toContain('bot ? "mt-2" : "rounded-none border-t-0"');
    expect(emptyState).toContain("w-[min(100%,40rem)]");
    expect(chat).toContain("goalPanel={");
    expect(chat).toContain('layout="new-chat"');
    expect(chat).toContain("horizontalPadding={chatAppearance.horizontalPadding}");
    expect(chat).not.toContain("handleSetGoalDraft");
  });
});
