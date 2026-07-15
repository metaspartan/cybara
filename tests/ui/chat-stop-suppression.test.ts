import { describe, expect, test } from "bun:test";
import {
  isStoppedRunSuppressed,
  markStoppedRun,
  type StoppedRunSuppressions,
} from "../../ui/src/pages/chat/stopSuppression";

describe("chat stopped run suppression", () => {
  test("suppresses late events from the stopped run only", () => {
    const suppressions: StoppedRunSuppressions = {};
    markStoppedRun(suppressions, "session-1", "run-1", 1_000, 12_000);

    expect(isStoppedRunSuppressed(suppressions, "session-1", "run-1", 2_000)).toBe(true);
    expect(isStoppedRunSuppressed(suppressions, "session-1", "run-2", 2_000)).toBe(false);
  });

  test("falls back to session suppression when legacy events have no run id", () => {
    const suppressions: StoppedRunSuppressions = {};
    markStoppedRun(suppressions, "session-1", null, 1_000, 12_000);

    expect(isStoppedRunSuppressed(suppressions, "session-1", null, 2_000)).toBe(true);
    expect(isStoppedRunSuppressed(suppressions, "session-1", "run-2", 2_000)).toBe(true);
    expect(isStoppedRunSuppressed(suppressions, "session-1", "run-2", 13_000)).toBe(false);
    expect(suppressions).toEqual({});
  });
});
