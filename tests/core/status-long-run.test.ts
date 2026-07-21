import { afterEach, describe, expect, test } from "bun:test";
import { tables } from "../../src/core/database";
import { listSessionEvents } from "../../src/core/session-event-ledger";
import {
  broadcastStatus,
  getSessionRunStatusSnapshot,
  getSessionStatusSnapshot,
} from "../../src/core/status";

const sessionIds: string[] = [];

function createSessionId(label: string): string {
  const sessionId = `${label}-${crypto.randomUUID()}`;
  sessionIds.push(sessionId);
  tables.chatSessions.ensure(sessionId, "status-test-agent");
  return sessionId;
}

function broadcastToolLifecycle(sessionId: string, index: number, timestamp: number): void {
  const toolCallId = `tool-${index}`;
  broadcastStatus({
    status: "tool_executing",
    timestamp,
    detail: `Reading file ${index}`,
    sessionId,
    toolName: "read",
    toolCallId,
    toolPhase: "start",
  });
  broadcastStatus({
    status: "tool_completed",
    timestamp: timestamp + 1,
    detail: `Read file ${index}`,
    sessionId,
    toolName: "read",
    toolCallId,
    toolPhase: "result",
  });
}

afterEach(() => {
  for (const sessionId of sessionIds.splice(0)) {
    broadcastStatus({ status: "idle", timestamp: Date.now(), sessionId });
    tables.sessionEvents.deleteBySession(sessionId);
    tables.chatSessions.delete(sessionId);
  }
});

describe("long-running status lifecycle", () => {
  test("retains thousands of completed tools in original order and closes the run", () => {
    const sessionId = createSessionId("status-long-run");
    const baseTimestamp = Date.now();

    for (let index = 0; index < 2500; index += 1) {
      broadcastToolLifecycle(sessionId, index, baseTimestamp + index * 2);
    }

    const snapshot = getSessionRunStatusSnapshot(sessionId);
    expect(snapshot?.activities).toHaveLength(2500);
    expect(snapshot?.activities[0]).toMatchObject({
      phase: "result",
      text: "Read file 0",
      timestamp: baseTimestamp,
      toolCallId: "tool-0",
    });
    expect(snapshot?.activities[2499]).toMatchObject({
      phase: "result",
      text: "Read file 2499",
      timestamp: baseTimestamp + 2499 * 2,
      toolCallId: "tool-2499",
    });
    expect(snapshot?.activities.some((activity) => activity.phase === "start")).toBe(false);

    const firstPage = listSessionEvents(sessionId, 0, 5000);
    const secondPage = listSessionEvents(sessionId, 5000, 5000);
    const beforeIdle = [...firstPage, ...secondPage];
    expect(beforeIdle).toHaveLength(5001);
    expect(beforeIdle.every((event, index) => event.sequence === index + 1)).toBe(true);
    expect(new Set(beforeIdle.map((event) => event.runId)).size).toBe(1);

    broadcastStatus({ status: "idle", timestamp: baseTimestamp + 5001, sessionId });

    expect(getSessionStatusSnapshot(sessionId)).toBeNull();
    const completed = listSessionEvents(sessionId, 5000, 5000);
    expect(completed.at(-1)?.type).toBe("run_completed");
    expect(completed.at(-1)?.sequence).toBe(5003);
  });

  test("keeps interleaved long-running sessions isolated", () => {
    const firstSessionId = createSessionId("status-concurrent-a");
    const secondSessionId = createSessionId("status-concurrent-b");
    const baseTimestamp = Date.now();

    for (let index = 0; index < 500; index += 1) {
      broadcastToolLifecycle(firstSessionId, index, baseTimestamp + index * 4);
      broadcastToolLifecycle(secondSessionId, index, baseTimestamp + index * 4 + 2);
    }

    const first = getSessionRunStatusSnapshot(firstSessionId);
    const second = getSessionRunStatusSnapshot(secondSessionId);
    expect(first?.activities).toHaveLength(500);
    expect(second?.activities).toHaveLength(500);
    expect(first?.activities.every((activity) => activity.toolCallId?.startsWith("tool-"))).toBe(
      true
    );
    expect(second?.activities.every((activity) => activity.toolCallId?.startsWith("tool-"))).toBe(
      true
    );
    expect(first?.runId).not.toBe(second?.runId);
  });
});
