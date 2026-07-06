import { describe, expect, test } from "bun:test";
import {
  broadcastStatus,
  broadcastStatusSnapshot,
  broadcastTaskEvent,
  broadcastTokenDelta,
  createStatusSnapshotEvent,
  onStatusStream,
  setSessionPendingChatMessages,
} from "../../src/core/status";

describe("status stream events", () => {
  test("emits typed status and task stream events", () => {
    const sessionId = `status-stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const received: Array<{ type: string; sessionId?: string }> = [];
    const unsubscribe = onStatusStream((event) => {
      received.push({
        type: event.type,
        sessionId: "sessionId" in event ? event.sessionId : undefined,
      });
    });

    broadcastStatus({
      status: "thinking",
      timestamp: Date.now(),
      sessionId,
      detail: "Investigating status stream events",
    });

    broadcastTaskEvent({
      type: "task_completed",
      taskId: "task-1",
      taskName: "Status stream smoke",
      status: "completed",
      sessionId,
    });

    unsubscribe();

    expect(received.length).toBeGreaterThanOrEqual(2);
    expect(received.some((event) => event.type === "status")).toBe(true);
    expect(received.some((event) => event.type === "task_completed")).toBe(true);

    broadcastStatus({
      status: "idle",
      timestamp: Date.now() + 1,
      sessionId,
      detail: "idle",
    });
  });

  test("creates snapshot payload with active session ids", () => {
    const sessionId = `status-snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    broadcastStatus({
      status: "tool_executing",
      timestamp: Date.now(),
      sessionId,
      detail: "Running status snapshot test",
      toolName: "exec",
    });

    const snapshot = createStatusSnapshotEvent();
    expect(snapshot.type).toBe("snapshot");
    expect(snapshot.activeSessionIds.includes(sessionId)).toBe(true);
    expect(snapshot.count).toBeGreaterThan(0);

    broadcastStatus({
      status: "idle",
      timestamp: Date.now() + 2,
      sessionId,
      detail: "idle",
    });
  });

  test("includes pending chat messages in snapshots", () => {
    const sessionId = `pending-status-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const received: string[] = [];
    const unsubscribe = onStatusStream((event) => {
      if (event.type === "snapshot") {
        const snapshot = event.activeSessions.find((entry) => entry.sessionId === sessionId);
        const mode = snapshot?.pendingMessages?.[0]?.mode;
        if (mode) received.push(mode);
      }
    });

    setSessionPendingChatMessages(sessionId, [
      {
        id: "pending-1",
        sessionId,
        clientPendingId: "optimistic-status-1",
        content: "follow up",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        mode: "queued",
        sequence: 1,
      },
    ]);
    const snapshot = createStatusSnapshotEvent();
    broadcastStatusSnapshot();
    unsubscribe();
    setSessionPendingChatMessages(sessionId, []);

    const pendingSnapshot = snapshot.activeSessions.find((entry) => entry.sessionId === sessionId);
    expect(pendingSnapshot?.pendingMessages?.[0]).toMatchObject({
      clientPendingId: "optimistic-status-1",
      content: "follow up",
      mode: "queued",
    });
    expect(snapshot.activeSessionIds.includes(sessionId)).toBe(true);
    expect(received).toContain("queued");
  });

  test("keeps compacting sessions in active snapshots", () => {
    const sessionId = `compacting-status-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    broadcastStatus({
      status: "compacting",
      timestamp: Date.now(),
      sessionId,
      detail: "Summarizing earlier conversation to continue...",
    });

    const snapshot = createStatusSnapshotEvent();
    const compactingSnapshot = snapshot.activeSessions.find(
      (entry) => entry.sessionId === sessionId
    );

    expect(compactingSnapshot?.status).toBe("compacting");
    expect(snapshot.activeSessionIds.includes(sessionId)).toBe(true);

    broadcastStatus({
      status: "idle",
      timestamp: Date.now() + 1,
      sessionId,
      detail: "idle",
    });
  });

  test("redacts secrets from status events, token deltas, and pending snapshots", () => {
    const sessionId = `redacted-status-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const apiKey = "sk-1234567890abcdef";
    const mobileKey = "cybara_mobile_abcdefabcdefabcdefabcdef";
    const received: unknown[] = [];
    const unsubscribe = onStatusStream((event) => {
      received.push(event);
    });

    broadcastStatus({
      status: "tool_executing",
      timestamp: Date.now(),
      sessionId,
      detail: `Running curl -H "Authorization: Bearer ${apiKey}"`,
      toolName: "fetch",
    });
    broadcastTaskEvent({
      type: "task_completed",
      taskId: "secret-task",
      taskName: `token=${mobileKey}`,
      status: "failed",
      sessionId,
      resultPreview: `preview ${apiKey}`,
      error: `Authorization: Bearer ${apiKey}`,
    });
    broadcastTokenDelta({
      sessionId,
      delta: `assistant leaked token=${mobileKey}`,
    });
    setSessionPendingChatMessages(sessionId, [
      {
        id: "pending-secret",
        sessionId,
        content: `follow up with ${apiKey}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        mode: "queued",
        sequence: 1,
      },
    ]);
    const snapshot = createStatusSnapshotEvent();

    unsubscribe();
    setSessionPendingChatMessages(sessionId, []);
    broadcastStatus({
      status: "idle",
      timestamp: Date.now() + 1,
      sessionId,
      detail: "idle",
    });

    const serialized = JSON.stringify({ received, snapshot });
    expect(serialized).not.toContain(apiKey);
    expect(serialized).not.toContain(mobileKey);
    expect(serialized).toContain("[REDACTED]");
  });
});
