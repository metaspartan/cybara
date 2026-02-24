import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const chatPagePath = fileURLToPath(new URL("../../ui/src/pages/Chat.tsx", import.meta.url));

function readChatSource(): string {
  return readFileSync(chatPagePath, "utf8");
}

describe("Chat scroll-to-latest button wiring", () => {
  test("shows a centered floating down-arrow button when message list is scrolled up", () => {
    const source = readChatSource();
    expect(source).toContain("showScrollToBottomButton");
    expect(source).toContain("ref={messagesContainerRef}");
    expect(source).toContain("onScroll={refreshScrollToBottomVisibility}");
    expect(source).toContain("aria-label=\"Scroll to latest message\"");
    expect(source).toContain("<ArrowDown className=\"h-4 w-4\" />");
  });
});
