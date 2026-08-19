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
    expect(source).not.toContain("border-white/10");
    expect(source).not.toContain("text-white/85");
    expect(source).not.toContain("bg-white/5");
    expect(source).toContain("bg-[var(--surface-panel)]");
    expect(source).toContain("border-[var(--surface-border)]");
    expect(source).toContain("text-[var(--text-primary)]");
    expect(source).toContain("text-[var(--text-muted)]");
    expect(source).toContain("text-[var(--text-secondary)]");
  });

  test("renders full-width above the centered 40rem empty-state column", async () => {
    const chat = await Bun.file("ui/src/pages/Chat.tsx").text();
    const emptyState = await Bun.file("ui/src/pages/chat/ChatEmptyState.tsx").text();

    expect(emptyState).toContain("banner?: ReactNode;");
    expect(emptyState).toContain("{banner}");
    expect(emptyState).toContain('className="flex w-full flex-col items-center"');
    expect(emptyState).toContain("w-[min(100%,40rem)]");
    expect(chat).toContain("banner={");
    expect(chat).toContain("<GoalPanel");
    expect(chat).toContain("typedMessages.length > 0 ? (");
    expect(chat).toContain("<ChatComposer {...chatComposerProps} />");
  });
});
