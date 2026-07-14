import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  formatFilePathForDisplay,
  summarizeSessionFileChanges,
  type ChatMessage,
} from "../../ui/src/pages/chat/chatModel";

const chatPagePath = fileURLToPath(new URL("../../ui/src/pages/Chat.tsx", import.meta.url));
const chatModelPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/chatModel.ts", import.meta.url)
);
const sessionSidebarPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/SessionSidebar.tsx", import.meta.url)
);
const activityTimelinePath = fileURLToPath(
  new URL("../../ui/src/pages/chat/ActivityTimeline.tsx", import.meta.url)
);
const fileChangesCardPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/FileChangesCard.tsx", import.meta.url)
);
const contextUsageRingPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/ContextUsageRing.tsx", import.meta.url)
);
const messageContentPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/MessageContent.tsx", import.meta.url)
);
const sessionFileChangesPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/useSessionFileChanges.ts", import.meta.url)
);
const sessionDiffPanelPath = fileURLToPath(
  new URL("../../ui/src/pages/chat/SessionDiffPanel.tsx", import.meta.url)
);
const desktopHostPath = fileURLToPath(new URL("../../ui/src/lib/desktopHost.ts", import.meta.url));

function readChatSource(): string {
  return (
    readFileSync(chatPagePath, "utf8") +
    readFileSync(chatModelPath, "utf8") +
    readFileSync(sessionSidebarPath, "utf8") +
    readFileSync(activityTimelinePath, "utf8") +
    readFileSync(fileChangesCardPath, "utf8") +
    readFileSync(messageContentPath, "utf8") +
    readFileSync(sessionFileChangesPath, "utf8") +
    readFileSync(sessionDiffPanelPath, "utf8")
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
    expect(source).toContain("useSessionFileChanges(");
    expect(source).toContain("includeFullToolCalls: true");
    expect(source).toContain("files changed");
    expect(source).toContain("formatFilePathForDisplay");
    expect(source).toContain("workspaceDir={effectiveWorkspaceDir}");
    expect(source).toContain("title={pathDisplay.fullPath}");
    expect(source).toContain("<DiffCodeBlock code={selectedFile.diff} fill />");
    expect(source).toContain('t("chat.workedFor", {');
    expect(source).toContain('section="work"');
    expect(source).toContain('section="summary"');
    expect(source).toContain("export function SessionDiffPanel");
    expect(source).toContain("No file diffs in this session yet");
    expect(source).toContain('toggleWorkspaceTab("review")');
    expect(source).toContain('activeWorkspaceKind === "review"');
    expect(source).toContain('aria-label="File diffs"');
    expect(source).not.toContain("hasUnreadFileDiffs");
    expect(source).not.toContain("markCurrentFileDiffsSeen");
    expect(source).toContain("findPriorUserTimestampMs");
    expect(source).toContain("turnStartedAtMs");
    expect(source).toContain("assistantTimestamp: message.timestamp");
    expect(source).toContain("touch-pan-x overflow-auto");
    expect(source).toContain("grid-cols-[48px_20px_max-content]");
  });

  test("shortens file diff paths relative to the active workspace", () => {
    const workspaceDir = "/Users/carsen/Documents/GitHub/cybara";
    expect(
      formatFilePathForDisplay(
        "/Users/carsen/Documents/GitHub/cybara/ui/src/pages/Chat.tsx",
        workspaceDir
      )
    ).toMatchObject({
      fileName: "Chat.tsx",
      parentPath: "ui/src/pages",
      relativePath: "ui/src/pages/Chat.tsx",
      isOutsideWorkspace: false,
    });
    expect(formatFilePathForDisplay("/tmp/cybara-secret.txt", workspaceDir)).toMatchObject({
      fileName: "cybara-secret.txt",
      parentPath: "Outside workspace",
      isOutsideWorkspace: true,
    });
    expect(formatFilePathForDisplay("src/api/chat.ts", workspaceDir)).toMatchObject({
      fileName: "chat.ts",
      parentPath: "src/api",
      relativePath: "src/api/chat.ts",
      isOutsideWorkspace: false,
    });
  });

  test("includes live and persisted edit activities in session file changes", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        content: "",
        process_activities: [
          {
            phase: "result",
            text: "Edited src/persisted.ts +3 -1",
            timestamp: 1,
          },
        ],
      },
    ];
    const summary = summarizeSessionFileChanges(messages, [
      {
        id: "live-edit",
        phase: "result",
        text: "Edited _path_keys.py +182 -0",
        timestamp: 2,
        toolName: "edit",
      },
    ]);
    expect(summary?.files.map((file) => file.path)).toEqual(["_path_keys.py", "src/persisted.ts"]);
    expect(summary?.totalAdded).toBe(185);
    expect(summary?.totalRemoved).toBe(1);
  });

  test("prefers full tool diffs over duplicate case-normalized activity paths", () => {
    const before = Array.from({ length: 260 }, (_, index) => `before ${index}`).join("\n");
    const after = Array.from({ length: 260 }, (_, index) => `after ${index}`).join("\n");
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        content: "",
        process_activities: [
          {
            phase: "result",
            text: "Edited readme.md +260 -260",
            timestamp: 3,
          },
        ],
        tool_calls: [
          {
            id: "read-1",
            name: "read",
            status: "completed",
            arguments: { path: "README.md" },
            result: { path: "README.md", content: before },
          },
          {
            id: "write-1",
            name: "write",
            status: "completed",
            arguments: { path: "README.md", content: after },
            result: {
              path: "readme.md",
              change: {
                path: "readme.md",
                type: "updated",
                addedLines: 260,
                removedLines: 260,
                diff: "--- a/readme.md\n+++ b/readme.md\n... [diff truncated, 300 lines omitted]",
              },
            },
          },
        ],
      },
    ];

    const summary = summarizeSessionFileChanges(messages);
    expect(summary?.files).toHaveLength(1);
    expect(summary?.files[0]?.path).toBe("README.md");
    expect(summary?.files[0]?.diff).toContain("-before 259");
    expect(summary?.files[0]?.diff).toContain("+after 259");
    expect(summary?.files[0]?.diff).not.toContain("[diff truncated");
    expect(summary?.totalAdded).toBe(260);
    expect(summary?.totalRemoved).toBe(260);
  });

  test("keeps context tooltip focused on concrete counts", () => {
    const source = readFileSync(contextUsageRingPath, "utf8");
    expect(source).not.toContain("Estimated from the active provider prompt");
  });

  test("keeps the full tool-call timeline behind the completed work disclosure", () => {
    const source = readChatSource();
    expect(source).not.toContain("const TOOL_CALL_PREVIEW_LIMIT = 50");
    expect(source).not.toContain("hiddenToolCallsCount");
    expect(source).not.toContain("View more");
    expect(source).toContain("getToolCallsInTimelineOrder");
    expect(source).toContain("function CompletedActivityTimeline");
    expect(source).toContain("<CompletedActivityTimeline");
    expect(source).not.toContain("hasAssistantToolCalls");
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
    expect(source).toContain("LocalFolderPickerModal");
    expect(source).toContain("openDesktopDirectoryDialog({");
    expect(source).not.toContain('title="Clear session workspace"');
    expect(source).not.toContain('title="Clear Chat"');
    expect(source).toContain("cybara:lastWorkspaceDir");
    expect(source).toContain("setShowWorkspacePicker(true);");
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
    expect(source).toContain('<Loader2 className="h-3 w-3 animate-spin text-gray-400" />');
    expect(source).toContain("compactSidebarRelativeTime(");
  });

  test("keeps route metadata in compact chat row tooltips instead of title prefixes", () => {
    const source = readChatSource();
    expect(source).toContain("function sessionRouteLabel");
    expect(source).toContain("function sessionDisplayTitle");
    expect(source).toContain("const routeLabel = sessionRouteLabel");
    expect(source).toContain("function sessionTooltipText");
    expect(source).toContain("function SessionHoverCard");
    expect(source).toContain("if (routeLabel) details.push(`Model: ${routeLabel}`)");
    expect(source).toContain("details.push(`${session.message_count || 0} messages`)");
    expect(source).toContain('data-testid="chat-session-hover-card"');
    expect(source).toContain("function stripDisplayTitleAgentPrefix");
    expect(source).toContain("(?::|[-–—])");
  });

  test("restores last active session when chat page is reopened", () => {
    const source = readChatSource();
    expect(source).toContain("cybara:lastSessionId");
    expect(source).toContain("readPersistedSessionId");
    expect(source).toContain("persistSessionId(sessionId)");
    expect(source).toContain("const resolveFreshestActiveSessionId = async () =>");
    expect(source).toContain("const activeSessionLookup = resolveFreshestActiveSessionId()");
    expect(source).toContain("restoreSessionFromId(persistedSessionId)");
    expect(source).toContain("persistSessionId(freshestActiveSessionId)");
    expect(source).toContain("Failed to restore chat session:");
    expect(source).toContain("Failed to inspect active chat sessions:");
  });
});
