import { describe, expect, test } from "bun:test";
import {
  clearCachedLiveSessionState,
  isLiveSessionRunning,
  readCachedLiveSessionState,
  resolveLiveSessionStartedAtMs,
  writeCachedLiveSessionState,
} from "../../ui/src/pages/chat/liveSessionState";

describe("web chat live session cache", () => {
  test("only treats authoritative session or request state as running", () => {
    expect(isLiveSessionRunning("s1", ["s1"], false, null)).toBe(true);
    expect(isLiveSessionRunning("s1", [], true, "s1")).toBe(true);
    expect(isLiveSessionRunning("s1", [], true, null)).toBe(true);
    expect(isLiveSessionRunning(null, [], true, null)).toBe(true);
    expect(isLiveSessionRunning("s1", ["s2"], true, "s2")).toBe(false);
    expect(isLiveSessionRunning("s1", [], false, "s1")).toBe(false);
  });

  test("restores active run state after chat route remounts", () => {
    const sessionId = `web-live-${Date.now()}`;
    writeCachedLiveSessionState(sessionId, {
      status: "thinking",
      currentStep: "Running bun test",
      streamingContent: "partial answer",
      runId: "run-1",
      sequence: 42,
      startedAtMs: 1783015199000,
      activities: [
        {
          id: "activity-1",
          phase: "start",
          text: "Running bun test",
          timestamp: 1783015200000,
          toolName: "exec_command",
        },
      ],
    });

    const cached = readCachedLiveSessionState(sessionId);
    expect(cached?.status).toBe("thinking");
    expect(cached?.currentStep).toBe("Running bun test");
    expect(cached?.streamingContent).toBe("partial answer");
    expect(cached?.runId).toBe("run-1");
    expect(cached?.sequence).toBe(42);
    expect(cached?.startedAtMs).toBe(1783015199000);
    expect(cached?.activities[0]?.text).toBe("Running bun test");

    clearCachedLiveSessionState(sessionId);
    expect(readCachedLiveSessionState(sessionId)).toBeNull();
  });

  test("drops stale cached run state", () => {
    const sessionId = `web-live-stale-${Date.now()}`;
    writeCachedLiveSessionState(sessionId, {
      status: "generating",
      currentStep: "Generating response...",
      streamingContent: "stale",
      updatedAt: Date.now() - 16 * 60 * 1000,
      activities: [],
    });

    expect(readCachedLiveSessionState(sessionId)).toBeNull();
  });

  test("restores elapsed time from a snapshot run start", () => {
    expect(
      resolveLiveSessionStartedAtMs({
        startedAt: 1_000,
        timestamp: 9_000,
        activities: [{ timestamp: 4_000 }],
      })
    ).toBe(1_000);
    expect(
      resolveLiveSessionStartedAtMs({
        timestamp: 9_000,
        activities: [{ timestamp: 4_000 }, { timestamp: 7_000 }],
      })
    ).toBe(4_000);
  });
});
