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
    expect(source).toContain("Confirm Revert");
    expect(source).toContain("Are you sure you want to revert here?");
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
    expect(source).toContain("const TOOL_CALL_PREVIEW_LIMIT = 50");
    expect(source).toContain("...and {hiddenToolCallsCount} more tool call");
    expect(source).toContain("View more");
    expect(source).toContain("chatApi.getSession(sessionId, { includeFullToolCalls: true })");
    expect(source).toContain("getToolCallsInTimelineOrder");
    expect(source).toContain("border-t border-white/12");
    expect(source).toContain("<ThinkingBlock thinking={message.thinking || \"\"} />");
  });

  test("shows effective workspace in empty state and uses robust tauri runtime detection", () => {
    const source = readChatSource();
    expect(source).toContain('("__TAURI_INTERNALS__" in window || "__TAURI__" in window)');
    expect(source).toContain("Workspace: {effectiveWorkspaceDir}");
    expect(source).toContain("cybara:lastWorkspaceDir");
    expect(source).toContain("Unable to open native folder picker. Enter workspace folder path manually:");
    expect(source).toContain("workspaceDir: effectiveWorkspaceDir || undefined");
  });

  test("shows session activity spinner wiring in the sessions panel", () => {
    const source = readChatSource();
    expect(source).toContain("activeSessionIds");
    expect(source).toContain("currentSessionLoading");
    expect(source).toContain("setActiveSessionIds");
    expect(source).toContain("status === \"idle\" || status === \"error\"");
    expect(source).toContain("<Loader2 className=\"w-3 h-3 animate-spin text-amber-400 flex-shrink-0\" />");
  });
});
