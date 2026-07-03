import { describe, expect, test } from "bun:test";
import {
  broadcastStatus,
  broadcastTaskEvent,
  createStatusSnapshotEvent,
  onStatusStream,
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
});
