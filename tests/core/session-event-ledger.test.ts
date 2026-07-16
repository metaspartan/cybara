import { afterEach, describe, expect, test } from "bun:test";
import { tables } from "../../src/core/database";
import {
  appendBufferedAssistantDelta,
  appendSessionEvent,
  completeSessionRun,
  ensureSessionRunId,
  flushBufferedAssistantDeltas,
  latestSessionEventSequence,
  listRunEvents,
  listSessionEvents,
} from "../../src/core/session-event-ledger";

const sessionIds: string[] = [];

function createSession(): string {
  const id = `ledger-${crypto.randomUUID()}`;
  sessionIds.push(id);
  tables.chatSessions.upsert({
    id,
    agent_id: "test-agent",
    title: "Ledger test",
    messages: "[]",
    created_at: new Date().toISOString(),
  });
  return id;
}

afterEach(() => {
  for (const sessionId of sessionIds.splice(0)) {
    completeSessionRun(sessionId);
    tables.chatSessions.delete(sessionId);
  }
});

describe("session event ledger", () => {
  test("assigns monotonic sequence numbers and replays by session or run", () => {
    const sessionId = createSession();
    const runId = ensureSessionRunId(sessionId);
    const first = appendSessionEvent({
      sessionId,
      runId,
      type: "run_started",
      payload: { source: "test" },
    });
    const second = appendSessionEvent({
      sessionId,
      runId,
      type: "status",
      payload: { status: "thinking" },
    });
    const third = appendSessionEvent({
      sessionId,
      runId,
      type: "run_completed",
      payload: { status: "idle" },
    });

    expect([first.sequence, second.sequence, third.sequence]).toEqual([1, 2, 3]);
    expect(latestSessionEventSequence(sessionId)).toBe(3);
    expect(listSessionEvents(sessionId, 1, 1).map((event) => event.sequence)).toEqual([2]);
    expect(listRunEvents(runId).map((event) => event.type)).toEqual([
      "run_started",
      "status",
      "run_completed",
    ]);
  });

  test("redacts secrets and rejects missing identifiers", () => {
    const sessionId = createSession();
    const runId = ensureSessionRunId(sessionId);
    const event = appendSessionEvent({
      sessionId,
      runId,
      type: "message",
      payload: { apiKey: "secret-value", content: "safe" },
    });

    expect(event.payload).toEqual({ apiKey: "[REDACTED]", content: "safe" });
    expect(() => appendSessionEvent({ sessionId: "", runId, type: "status", payload: {} })).toThrow(
      "require session and run identifiers"
    );
  });

  test("coalesces streamed assistant chunks before writing replay events", () => {
    const sessionId = createSession();
    const runId = ensureSessionRunId(sessionId);
    appendBufferedAssistantDelta({
      sessionId,
      runId,
      agentId: "mini",
      delta: "first ",
      timestamp: 1000,
    });
    appendBufferedAssistantDelta({
      sessionId,
      runId,
      agentId: "mini",
      delta: "second",
      timestamp: 1001,
    });

    const flushed = flushBufferedAssistantDeltas(sessionId, runId);
    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.type).toBe("assistant_delta");
    expect(flushed[0]?.payload).toEqual({
      agentId: "mini",
      delta: "first second",
      timestamp: 1001,
    });
    expect(listRunEvents(runId).filter((event) => event.type === "assistant_delta")).toHaveLength(
      1
    );
  });
});
