import { describe, expect, test } from "bun:test";
import {
  clearCachedMobileLiveAssistant,
  liveAssistantFromStatusSnapshot,
  liveAssistantMessage,
  readCachedMobileLiveAssistant,
  writeCachedMobileLiveAssistant,
} from "../../apps/mobile/src/screens/dashboardLiveChat";

describe("mobile live chat cache", () => {
  test("restores cached live assistant rows by session", () => {
    const sessionId = `mobile-live-${Date.now()}`;
    const live = liveAssistantMessage(sessionId, null, 1783015200000);

    writeCachedMobileLiveAssistant(sessionId, {
      ...live,
      content: "partial answer",
      processActivities: [
        {
          id: "activity-1",
          phase: "start",
          text: "Running bun test",
          timestamp: 1783015200100,
          toolName: "exec_command",
        },
      ],
    });

    const cached = readCachedMobileLiveAssistant(sessionId);
    expect(cached?.message.content).toBe("partial answer");
    expect(cached?.message.processActivities?.[0]?.text).toBe("Running bun test");

    clearCachedMobileLiveAssistant(sessionId);
    expect(readCachedMobileLiveAssistant(sessionId)).toBeNull();
  });

  test("builds live assistant rows from active status snapshots", () => {
    const sessionId = `mobile-snapshot-${Date.now()}`;
    const live = liveAssistantFromStatusSnapshot(sessionId, null, {
      sessionId,
      status: "tool_executing",
      timestamp: 1783015200500,
      activities: [
        {
          id: "activity-1",
          phase: "start",
          text: "Exploring package.json",
          timestamp: 1783015200400,
          toolName: "read",
          toolCallId: "read-1",
        },
      ],
    });

    expect(live.id).toBe(`live-assistant-${sessionId}`);
    expect(live.processActivities?.[0]).toMatchObject({
      text: "Exploring package.json",
      toolCallId: "read-1",
    });
  });
});
