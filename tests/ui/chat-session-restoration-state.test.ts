import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("chat session restoration state", () => {
  test("shows a stable loading state until initial restoration finishes", () => {
    const source = readFileSync(join(process.cwd(), "ui/src/pages/Chat.tsx"), "utf8");

    expect(source).toContain("const [restoringInitialSession, setRestoringInitialSession]");
    expect(source).toContain("<ChatSessionLoadingState />");
    expect(source).toContain("setRestoringInitialSession(false)");
    expect(source.indexOf("restoringInitialSession ?")).toBeLessThan(
      source.indexOf("<ChatEmptyState")
    );
  });

  test("does not force persisted updates to the bottom while reading older messages", () => {
    const source = readFileSync(join(process.cwd(), "ui/src/pages/chat/useChatScroll.ts"), "utf8");
    const effectStart = source.indexOf("if (!keepScrolledToBottomRef.current");
    const effectEnd = source.indexOf("useEffect(() =>", effectStart + 1);
    const effect = source.slice(effectStart, effectEnd);

    expect(effect).toContain("isChatNearBottom(container, 96)");
    expect(effect).toContain("setShowScrollToBottomButton(true)");
    expect(effect).toContain('scrollToBottom("auto")');
  });
});
