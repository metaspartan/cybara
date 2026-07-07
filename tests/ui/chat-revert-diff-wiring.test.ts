import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const chatPagePath = fileURLToPath(new URL("../../ui/src/pages/Chat.tsx", import.meta.url));
const chatModelPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/chatModel.ts", import.meta.url)
);
const activityTimelinePath = fileURLToPath(
  new URL("../../ui/src/pages/chat/ActivityTimeline.tsx", import.meta.url)
);
const desktopHostPath = fileURLToPath(new URL("../../ui/src/lib/desktopHost.ts", import.meta.url));

function readChatSource(): string {
  return (
    readFileSync(chatPagePath, "utf8") +
    readFileSync(chatModelPath, "utf8") +
    readFileSync(activityTimelinePath, "utf8")
  );
}

function readDesktopHostSource(): string {
  return readFileSync(desktopHostPath, "utf8");
}

describe("Chat revert and diff wiring", () => {
  test("shows icon-only revert + copy actions below the message with confirmation modal", () => {
    const source = readChatSource();
    // Icon-only actions live BELOW the message box, not inside it.
    expect(source).not.toContain("Revert to here");
    expect(source).toContain('aria-label="Revert session to this message"');
    expect(source).toContain('aria-label="Copy message"');
    expect(source).toContain("handleCopyMessage(originalIndex, message.content)");
    // Copy shows transient success feedback and has a legacy fallback.
    expect(source).toContain("copiedMessageIndex === originalIndex");
    expect(source).toContain('document.execCommand("copy")');
    // Revert still requires confirmation.
    expect(source).toContain("Confirm Revert");
    expect(source).toContain("Are you sure you want to revert here?");
    expect(source).toContain("handleConfirmRevert");
    expect(source).toContain("setInput(revertTarget.content)");
  });

  test("renders file-change summary and diff blocks from tool calls", () => {
    const source = readChatSource();
    expect(source).toContain("summarizeMessageFileChanges");
    expect(source).toContain("summarizeSessionFileChanges");
    expect(source).toContain("files changed");
    expect(source).toContain("<DiffCodeBlock code={file.diff} />");
    expect(source).toContain("Worked for");
    expect(source).toContain('section="work"');
    expect(source).toContain('section="summary"');
    expect(source).toContain("function SessionDiffPanel");
    expect(source).toContain("No file diffs in this session yet");
    expect(source).toContain("showDiffPanel");
    expect(source).toContain("findPriorUserTimestampMs");
    expect(source).toContain("turnStartedAtMs");
    expect(source).toContain("assistantTimestamp: message.timestamp");
  });

  test("renders full tool-call timeline inline without truncation controls", () => {
    const source = readChatSource();
    expect(source).not.toContain("const TOOL_CALL_PREVIEW_LIMIT = 50");
    expect(source).not.toContain("hiddenToolCallsCount");
    expect(source).not.toContain("View more");
    expect(source).toContain("getToolCallsInTimelineOrder");
    expect(source).toContain("border-t border-white/12");
    expect(source).toContain("function ProcessActivityList");
    expect(source).toContain("<ProcessActivityList activities={workActivitiesWithSandbox} />");
  });

  test("shows effective workspace in empty state and uses robust tauri runtime detection", () => {
    const source = readChatSource();
    const desktopHostSource = readDesktopHostSource();
    expect(desktopHostSource).toMatch(
      /\(["']__TAURI_INTERNALS__["'] in window \|\| ["']__TAURI__["'] in window\)/
    );
    expect(source).toContain("Workspace: ${effectiveWorkspaceDir}");
    expect(source).toContain("info?.defaultWorkspaceDir");
    expect(source).toContain("lastWorkspaceDir || configuredWorkspaceDir || homeWorkspaceDir");
    // Workspace chips are clickable-to-change (header + empty state), with no separate clear button.
    expect(source).toContain("void handleSelectWorkspace()");
    expect(source).not.toContain('title="Clear session workspace"');
    expect(source).toContain("cybara:lastWorkspaceDir");
    expect(source).toContain(
      "Unable to open native folder picker. Enter workspace folder path manually:"
    );
    expect(source).toContain("workspaceDir: effectiveWorkspaceDir || undefined");
  });

  test("shows session activity spinner wiring in the sessions panel", () => {
    const source = readChatSource();
    expect(source).toContain("activeSessionIds");
    expect(source).toContain("currentSessionLoading");
    expect(source).toContain("setActiveSessionIds");
    expect(source).toContain("chatApi.getSessionStatus(");
    expect(source).toContain("hydrateSessionStatus");
    expect(source).toContain('(status === "idle" && !isSteeringHandoff) || status === "error"');
    expect(source).toContain(
      '<Loader2 className="w-3 h-3 animate-spin text-amber-400 flex-shrink-0" />'
    );
  });

  test("shows route metadata beside the message count instead of prefixing chat titles", () => {
    const source = readChatSource();
    expect(source).toContain("function sessionRouteLabel");
    expect(source).toContain("function sessionDisplayTitle");
    expect(source).toContain("const routeLabel = sessionRouteLabel");
    expect(source).toContain(
      '<span className="flex-shrink-0">{session.message_count || 0} messages</span>'
    );
    expect(source).toContain('<span className="min-w-0 flex-1 truncate" title={routeLabel}>');
    expect(source).toContain("rawTitle.toLowerCase().startsWith(`${agentName.toLowerCase()}:`)");
  });

  test("restores last active session when chat page is reopened", () => {
    const source = readChatSource();
    expect(source).toContain("cybara:lastSessionId");
    expect(source).toContain("readPersistedSessionId");
    expect(source).toContain("persistSessionId(sessionId)");
    expect(source).toContain("const resolveFreshestActiveSessionId = async () =>");
    expect(source).toContain(
      "const targetSessionId = freshestActiveSessionId || persistedSessionId"
    );
    expect(source).toContain("persistSessionId(targetSessionId)");
    expect(source).toContain("Failed to restore chat session:");
    expect(source).toContain("Failed to inspect active chat sessions:");
  });
});
