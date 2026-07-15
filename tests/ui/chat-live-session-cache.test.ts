import { describe, expect, test } from "bun:test";
import {
  clearCachedLiveSessionState,
  readCachedLiveSessionState,
  writeCachedLiveSessionState,
} from "../../ui/src/pages/chat/liveSessionState";

describe("web chat live session cache", () => {
  test("restores active run state after chat route remounts", () => {
    const sessionId = `web-live-${Date.now()}`;
    writeCachedLiveSessionState(sessionId, {
      status: "thinking",
      currentStep: "Running bun test",
      streamingContent: "partial answer",
      runId: "run-1",
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
});
