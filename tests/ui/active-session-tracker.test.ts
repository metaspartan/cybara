import { describe, expect, test } from "bun:test";
import {
  reconcileActiveSessionSnapshot,
  reconcileAuthoritativeActiveSessions,
  SIDEBAR_ACTIVE_STATUSES,
} from "../../ui/src/components/layout/activeSessionTracker";

describe("sidebar active session tracker", () => {
  test("retains an active session across a transient empty snapshot", () => {
    const active = new Map([["session-1", 1_000]]);
    const reconciled = reconcileActiveSessionSnapshot(active, [], 1_100);

    expect([...reconciled.keys()]).toEqual(["session-1"]);
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

  test("retains a long-running session until the gateway confirms it ended", () => {
    const active = new Map([["session-1", 1_000]]);
    const afterTenHours = reconcileActiveSessionSnapshot(active, [], 36_001_000);
    expect(afterTenHours.has("session-1")).toBe(true);

    const reconciled = reconcileAuthoritativeActiveSessions(
      afterTenHours,
      [],
      36_002_000,
      36_002_100
    );
    expect(reconciled.size).toBe(0);
  });

  test("does not erase a stream event newer than an in-flight gateway snapshot", () => {
    const active = new Map([["session-1", 2_100]]);
    const reconciled = reconcileAuthoritativeActiveSessions(active, [], 2_000, 2_200);

    expect(reconciled.get("session-1")).toBe(2_100);
  });

  test("refreshes sessions confirmed active by the gateway", () => {
    const reconciled = reconcileAuthoritativeActiveSessions(
      new Map([["session-1", 1_000]]),
      ["session-1", " session-2 ", ""],
      2_000,
      2_100
    );

    expect([...reconciled.entries()]).toEqual([
      ["session-1", 2_100],
      ["session-2", 2_100],
    ]);
  });
});
