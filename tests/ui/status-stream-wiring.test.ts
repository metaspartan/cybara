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
    expect(source).toContain("onMouseDown={(event) =>");
    expect(source).toContain("onMouseUp={() =>");
    expect(source).toContain("Drag to reorder");
    expect(source).toContain("normalizePendingChatMessages(snapshot?.pendingMessages)");
    expect(source).toContain("canQueueCurrentMessage");
    expect(source).toContain("const locallyLoadingCurrentSession =");
    expect(source).toContain("const requestSessionId = requestedQueueMode");
    expect(source).toContain("sessionId || activeSessionRef.current || crypto.randomUUID()");
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
