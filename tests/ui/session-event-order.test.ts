import { describe, expect, test } from "bun:test";
import { resolveSessionEventOrder } from "../../shared/session-event-order";

describe("session event ordering", () => {
  test("accepts the first event and increasing events in the same run", () => {
    const first = resolveSessionEventOrder(undefined, {
      runId: "run-a",
      sequence: 4,
      timestamp: 100,
    });
    const next = resolveSessionEventOrder(first.cursor, {
      runId: "run-a",
      sequence: 5,
      timestamp: 110,
    });

    expect(first.accepted).toBe(true);
    expect(first.runChanged).toBe(false);
    expect(next.accepted).toBe(true);
    expect(next.runChanged).toBe(false);
    expect(next.cursor).toEqual({ runId: "run-a", sequence: 5, timestamp: 110 });
  });

  test("rejects duplicate and out-of-order sequence numbers", () => {
    const cursor = { runId: "run-a", sequence: 8, timestamp: 200 };
    expect(resolveSessionEventOrder(cursor, { runId: "run-a", sequence: 8 }).accepted).toBe(
      false
    );
    expect(resolveSessionEventOrder(cursor, { runId: "run-a", sequence: 7 }).accepted).toBe(
      false
    );
  });

  test("marks a newer run boundary and rejects delayed prior-run events", () => {
    const previous = { runId: "run-a", sequence: 8, timestamp: 200 };
    const newer = resolveSessionEventOrder(previous, {
      runId: "run-b",
      sequence: 9,
      timestamp: 210,
    });
    const delayed = resolveSessionEventOrder(newer.cursor, {
      runId: "run-a",
      sequence: 7,
      timestamp: 220,
    });

    expect(newer.accepted).toBe(true);
    expect(newer.runChanged).toBe(true);
    expect(delayed.accepted).toBe(false);
    expect(delayed.cursor.runId).toBe("run-b");
  });

  test("uses timestamp ordering when no sequence is available", () => {
    const cursor = { runId: "run-a", sequence: 0, timestamp: 1_000 };
    expect(resolveSessionEventOrder(cursor, { timestamp: 990 }).accepted).toBe(true);
    expect(resolveSessionEventOrder(cursor, { timestamp: 900 }).accepted).toBe(false);
  });
});
