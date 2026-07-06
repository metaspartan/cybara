import { describe, expect, test } from "bun:test";
import {
  clearCachedMobileLiveAssistant,
  liveAssistantFromStatusSnapshot,
  liveAssistantMessage,
  prunePersistedMobileLiveAssistant,
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

  test("drops cached live rows after matching activity is persisted", () => {
    const sessionId = `mobile-prune-live-${Date.now()}`;
    const live = {
      ...liveAssistantMessage(sessionId, null, 1783015200000),
      processActivities: [
        {
          id: "activity-1",
          phase: "result" as const,
          text: "Ran tests",
          timestamp: 1783015200100,
          toolName: "exec_command",
          toolCallId: "tool-1",
        },
      ],
    };

    const pruned = prunePersistedMobileLiveAssistant(live, [
      {
        id: "assistant-1",
        role: "assistant",
        content: "Done.",
        timestamp: "2026-07-02T18:00:00.000Z",
        processActivities: live.processActivities,
      },
    ]);

    expect(pruned).toBeNull();
  });

  test("keeps live rows that persisted messages have not caught up with yet", () => {
    const sessionId = `mobile-keep-live-${Date.now()}`;
    const live = {
      ...liveAssistantMessage(sessionId, null, 1783015200000),
      processActivities: [
        {
          id: "activity-1",
          phase: "start" as const,
          text: "Running build",
          timestamp: 1783015200100,
          toolName: "exec_command",
          toolCallId: "tool-1",
        },
      ],
    };

    const pruned = prunePersistedMobileLiveAssistant(live, [
      {
        id: "assistant-1",
        role: "assistant",
        content: "Earlier reply.",
        timestamp: "2026-07-02T17:59:00.000Z",
        processActivities: [
          {
            id: "other-activity",
            phase: "result",
            text: "Read package.json",
            timestamp: 1783015190100,
            toolName: "read",
            toolCallId: "tool-previous",
          },
        ],
      },
    ]);

    expect(pruned?.processActivities?.[0]?.text).toBe("Running build");
  });
});
