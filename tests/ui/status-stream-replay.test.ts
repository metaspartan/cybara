import { describe, expect, test } from "bun:test";
import { StatusStreamReplayBuffer } from "../../ui/src/lib/status-stream-replay";

describe("status stream replay buffer", () => {
  test("buffers only session status and token events", () => {
    const buffer = new StatusStreamReplayBuffer();
    buffer.record({
      type: "snapshot",
      timestamp: 1,
      activeSessions: [],
      activeSessionIds: [],
      count: 0,
    });
    buffer.record({
      type: "task_completed",
      taskId: "task-1",
      taskName: "Task",
      status: "completed",
    });
    buffer.record({ type: "status", status: "thinking", timestamp: 2 });
    buffer.record({
      type: "status",
      sessionId: " session-1 ",
      runId: "run-1",
      sequence: 1,
      status: "thinking",
      timestamp: 3,
    });

    expect(buffer.consume()).toEqual([
      {
        type: "status",
        sessionId: "session-1",
        runId: "run-1",
        sequence: 1,
        status: "thinking",
        timestamp: 3,
      },
    ]);
  });

  test("deduplicates sequenced events and consumes them once", () => {
    const buffer = new StatusStreamReplayBuffer();
    const event = {
      type: "assistant_token" as const,
      sessionId: "session-1",
      runId: "run-1",
      sequence: 4,
      delta: "hello",
      timestamp: 10,
    };

    buffer.record(event, 10);
    buffer.record(event, 11);

    expect(buffer.size).toBe(1);
    expect(buffer.consume(12)).toEqual([event]);
    expect(buffer.consume(13)).toEqual([]);
  });

  test("bounds retained events and expires stale entries", () => {
    const buffer = new StatusStreamReplayBuffer(2, 100);
    for (let sequence = 1; sequence <= 3; sequence += 1) {
      buffer.record(
        {
          type: "status",
          sessionId: "session-1",
          runId: "run-1",
          sequence,
          status: "thinking",
          timestamp: sequence,
        },
        sequence
      );
    }

    expect(buffer.consume(4).map((event) => event.sequence)).toEqual([2, 3]);

    buffer.record(
      {
        type: "status",
        sessionId: "session-2",
        sequence: 1,
        status: "thinking",
        timestamp: 10,
      },
      10
    );
    expect(buffer.consume(111)).toEqual([]);
  });
});
