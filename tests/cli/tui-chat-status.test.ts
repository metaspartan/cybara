import { describe, expect, test } from "bun:test";
import {
  reconcileQueuedTurnHandoff,
  type QueuedTurnHandoff,
} from "../../src/cli/tui/components/interactive-chat-status";
import type { TUIStatusStreamEvent } from "../../src/cli/tui/status-stream";

const started: QueuedTurnHandoff = {
  sessionId: "session-1",
  pendingChatId: "pending-1",
  phase: "started",
  timestamp: 10,
};

describe("TUI queued turn status reconciliation", () => {
  test("marks a queued handoff started and then completed on idle", () => {
    const startEvent: TUIStatusStreamEvent = {
      type: "status",
      status: "thinking",
      timestamp: 10,
      detail: "Starting queued follow-up",
      sessionId: "session-1",
      pendingChatId: "pending-1",
    };
    const handoff = reconcileQueuedTurnHandoff(null, startEvent, "session-1");
    expect(handoff).toEqual(started);
    expect(
      reconcileQueuedTurnHandoff(
        handoff,
        {
          type: "status",
          status: "idle",
          timestamp: 20,
          sessionId: "session-1",
        },
        "session-1"
      )
    ).toEqual({ ...started, phase: "completed", timestamp: 20 });
  });

  test("uses an inactive snapshot to recover a missed completion event", () => {
    expect(
      reconcileQueuedTurnHandoff(
        started,
        { type: "snapshot", timestamp: 30, activeSessions: [] },
        "session-1"
      )
    ).toEqual({ ...started, phase: "completed", timestamp: 30 });
  });

  test("ignores unrelated sessions and repeated completed snapshots", () => {
    const completed = { ...started, phase: "completed" as const, timestamp: 20 };
    const event: TUIStatusStreamEvent = {
      type: "snapshot",
      timestamp: 30,
      activeSessions: [],
    };
    expect(reconcileQueuedTurnHandoff(completed, event, "session-1")).toBe(completed);
    expect(
      reconcileQueuedTurnHandoff(
        started,
        {
          type: "status",
          status: "idle",
          timestamp: 30,
          sessionId: "session-2",
        },
        "session-1"
      )
    ).toBe(started);
  });
});
