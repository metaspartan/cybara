import { describe, expect, test } from "bun:test";
import {
  pruneInactiveSessions,
  reconcileActiveSessionSnapshot,
  SIDEBAR_ACTIVE_STATUSES,
} from "../../ui/src/components/layout/activeSessionTracker";

describe("sidebar active session tracker", () => {
  test("retains an active session across a transient empty snapshot", () => {
    const active = new Map([["session-1", 1_000]]);
    const reconciled = reconcileActiveSessionSnapshot(active, [], 1_100);

    expect([...reconciled.keys()]).toEqual(["session-1"]);
    expect(pruneInactiveSessions(reconciled, 2_000, 60_000).has("session-1")).toBe(true);
  });

  test("treats tool completion as an active point in the run", () => {
    const reconciled = reconcileActiveSessionSnapshot(
      new Map(),
      [
        {
          sessionId: "session-1",
          status: "tool_completed",
          timestamp: 1_000,
          activities: [],
        },
      ],
      1_100
    );

    expect(SIDEBAR_ACTIVE_STATUSES.has("tool_completed")).toBe(true);
    expect(reconciled.get("session-1")).toBe(1_100);
  });

  test("expires activity when no terminal event arrives", () => {
    const active = new Map([["session-1", 1_000]]);
    expect(pruneInactiveSessions(active, 62_001, 60_000).size).toBe(0);
  });
});
