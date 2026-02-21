import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const chatPagePath = fileURLToPath(new URL("../../ui/src/pages/Chat.tsx", import.meta.url));

function readChatSource(): string {
  return readFileSync(chatPagePath, "utf8");
}

describe("Chat revert and diff wiring", () => {
  test("shows a revert action on user messages with confirmation modal", () => {
    const source = readChatSource();
    expect(source).toContain("Revert to here");
    expect(source).toContain("Revert Session To This Message");
    expect(source).toContain("handleConfirmRevert");
    expect(source).toContain("setInput(revertTarget.content)");
  });

  test("renders file-change summary and diff blocks from tool calls", () => {
    const source = readChatSource();
    expect(source).toContain("summarizeMessageFileChanges");
    expect(source).toContain("files changed");
    expect(source).toContain("<DiffCodeBlock code={file.diff} />");
    expect(source).toContain("Worked for");
    expect(source).toContain("section=\"work\"");
    expect(source).toContain("section=\"summary\"");
  });

  test("shows hidden tool-call summary with view-more loading full history on demand", () => {
    const source = readChatSource();
    expect(source).toContain("...and {hiddenToolCallsCount} more tool call");
    expect(source).toContain("View more");
    expect(source).toContain("chatApi.getSession(sessionId, { includeFullToolCalls: true })");
  });
});
