import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const chatPath = fileURLToPath(new URL("../../ui/src/pages/Chat.tsx", import.meta.url));
const sidebarPath = fileURLToPath(
  new URL("../../ui/src/components/layout/Sidebar.tsx", import.meta.url)
);
const notificationsPath = fileURLToPath(
  new URL("../../ui/src/hooks/useNotifications.ts", import.meta.url)
);
const gatewayIndexPath = fileURLToPath(new URL("../../src/index.ts", import.meta.url));

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

describe("status stream websocket wiring", () => {
  test("chat page uses shared status websocket stream helper", () => {
    const source = readSource(chatPath);
    expect(source).toContain("connectStatusStream");
    expect(source).toContain("PendingChatQueue");
    expect(source).toContain("chatApi.steerPendingMessage");
    expect(source).toContain("chatApi.reorderPendingMessages");
    expect(source).toContain("chatApi.updatePendingMessage");
    expect(source).toContain("chatApi.deletePendingMessage");
    expect(source).toContain("chatApi.getPendingMessages");
    expect(source).toContain("ChatAgentControls");
    expect(source).toContain("useUpdateSessionAgent");
    expect(source).toContain("contextUsageLabel");
    expect(source).toContain("contextUsageTooltip");
    expect(source).toContain('id="chat-agent-selector"');
    expect(source).not.toContain('<Zap className="pointer-events-none absolute left-2');
    expect(source).toContain("setSessionAgentId(nextAgentId ?? null)");
    expect(source).toContain("setSessionContextUsage(updated.contextUsage ?? null)");
    expect(source).toContain("clientPendingId: optimisticPendingMessageId");
    expect(source).toContain(
      "appendSessionMessages(sessionId, [preSteerMessage, steeredMessage], workspaceDir)"
    );
    expect(source).toContain("buildPreSteeringActivityMessage(");
    expect(source).toContain("const sessionStillActive =");
    expect(source).toContain("if (!sessionStillActive) {");
    expect(source).toContain("refreshPendingMessages(sessionId)");
    expect(source).toContain("mergePendingChatMessages(snapshot?.pendingMessages, current)");
    expect(source).toContain("readCachedOptimisticPendingMessages(sessionId)");
    expect(source).toContain("writeCachedOptimisticPendingMessages(sessionId, pendingMessages)");
    expect(source).toContain("const resetChatSession = useCallback");
    expect(source).toContain("const suppressAutoRestoreRef = useRef(false)");
    expect(source).toContain("suppressAutoRestoreRef.current = true");
    expect(source).toContain("if (suppressAutoRestoreRef.current) return");
    expect(source).toContain("activeSessionRef.current = null");
    expect(source).toContain("restoreSessionGenerationRef.current += 1");
    expect(source).toContain("resetChatSession({");
    expect(source).toContain("resetAgentSelection: true");
    expect(source).toContain("onMouseDown={(event) =>");
    expect(source).toContain("onMouseUp={() =>");
    expect(source).toContain("Drag to reorder");
    expect(source).toContain('aria-label="Edit queued message"');
    expect(source).toContain('aria-label="Delete queued message"');
    expect(source).toContain('"Context automatically compacted"');
    expect(source).toContain("canQueueCurrentMessage");
    expect(source).toContain("const locallyLoadingCurrentSession =");
    expect(source).toContain("const requestSessionId = requestedQueueMode");
    expect(source).toContain("sessionId || activeSessionRef.current || crypto.randomUUID()");
    expect(source).toContain("persistSessionId(requestSessionId)");
    expect(source).toContain("if (sessionId) {\n      persistSessionId(sessionId);\n    }");
    expect(source).toContain(".getSessionStatus()");
    expect(source).toContain("const restoreGeneration = restoreSessionGenerationRef.current");
    expect(source).toContain("const resolveFreshestActiveSessionId = async () =>");
    expect(source).toContain(
      "const freshestActiveSessionId = await resolveFreshestActiveSessionId()"
    );
    expect(source).toContain(
      "const targetSessionId = freshestActiveSessionId || persistedSessionId"
    );
    expect(source).toContain("void hydrateSessionStatus(targetSessionId)");
    expect(source).toContain("if (!restored && !freshestActiveSessionId");
    expect(source).toContain("restoreSessionGenerationRef.current !== restoreGeneration");
    expect(source).toContain('!value.startsWith("agent:")');
    expect(source).toContain("freshestActiveSessionId");
    expect(source).toContain("Failed to restore chat session");
    expect(source).toContain("Failed to inspect active chat sessions");
    expect(source).toContain("sessionId: requestSessionId");
    expect(source).toContain("sessionId: requestSessionId || undefined");
    expect(source).toContain("optimisticPendingMessageCounterRef");
    expect(source).toContain("optimisticPendingMessageId = `optimistic-${now}-");
    expect(source).toContain('message.id.startsWith("optimistic-")');
    expect(source).toContain('"Queueing..."');
    expect(source).toContain(
      "const sendQueuesFollowUp = showWorkingTimeline || pendingMessages.length > 0"
    );
    expect(source).not.toContain("new EventSource(");
  });

  test("sidebar status indicator uses websocket status stream", () => {
    const source = readSource(sidebarPath);
    expect(source).toContain("connectStatusStream");
    expect(source).not.toContain("new EventSource(");
  });

  test("chat idle status refresh is not blocked by pending process capture", () => {
    const source = readSource(chatPath);
    const idleBranch = source.slice(source.indexOf('if (status === "idle")'));
    expect(idleBranch).toContain("void refreshSessionMessagesRef.current(sessionToRefresh)");
    expect(idleBranch).toContain("if (!loadingRef.current) {");
    expect(idleBranch).not.toContain("hasPendingCaptureForVisibleSession");
  });

  test("task notifications subscribe through websocket status stream", () => {
    const source = readSource(notificationsPath);
    expect(source).toContain("connectStatusStream");
    expect(source).not.toContain("new EventSource(");
  });

  test("sse status stream sends an initial active-session snapshot", () => {
    const source = readSource(gatewayIndexPath);
    expect(source).toContain("JSON.stringify(createStatusSnapshotEvent())");
    expect(source).not.toContain('JSON.stringify({ status: "idle", timestamp: Date.now() })');
  });
});
