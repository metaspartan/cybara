import { describe, expect, test } from "bun:test";
import {
  clearCachedMobileLiveAssistant,
  liveAssistantFromStatusSnapshot,
  liveAssistantMessage,
  liveActivityFromStatusEvent,
  mergeLiveActivity,
  mobileAgentUsingBrowser,
  mobilePreSteerProcessActivities,
  prunePersistedMobileLiveAssistant,
  readCachedMobileLiveAssistant,
  subscribeCachedMobileLiveAssistant,
  writeCachedMobileLiveAssistant,
} from "../../apps/mobile/src/screens/dashboardLiveChat";

describe("mobile live chat cache", () => {
  test("replaces active compaction with its completed result", () => {
    const started = liveActivityFromStatusEvent({
      type: "status",
      status: "compacting",
      detail: "Summarizing earlier conversation to continue...",
      timestamp: 100,
    });
    const completed = liveActivityFromStatusEvent({
      type: "status",
      status: "thinking",
      detail: "Context compacted · 4,200 tokens freed",
      timestamp: 200,
    });
    if (!started || !completed) throw new Error("expected compaction activities");

    const activities = mergeLiveActivity([started], completed);
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      phase: "result",
      text: "Context compacted · 4,200 tokens freed",
      toolName: "__context_compaction",
    });
  });

  test("reports browser use only for active in-flight browser activities", () => {
    const sessionId = `mobile-browser-${Date.now()}`;
    const live = {
      ...liveAssistantMessage(sessionId, null, 1783015200000),
      processActivities: [
        {
          id: "browser-1",
          phase: "start" as const,
          text: "Opening browser",
          timestamp: 1783015200100,
          toolName: "browser",
          toolCallId: "browser-1",
        },
      ],
    };

    expect(mobileAgentUsingBrowser(live, true)).toBe(true);
    expect(mobileAgentUsingBrowser(live, false)).toBe(false);
    expect(
      mobileAgentUsingBrowser(
        {
          ...live,
          processActivities: live.processActivities.map((activity) => ({
            ...activity,
            phase: "result" as const,
          })),
        },
        true
      )
    ).toBe(false);
  });

  test("notifies mounted chat screens when background live state changes", () => {
    const sessionId = `mobile-live-subscribe-${Date.now()}`;
    const updates: Array<string | null> = [];
    const unsubscribe = subscribeCachedMobileLiveAssistant(sessionId, (cached) => {
      updates.push(cached?.message.id ?? null);
    });
    const live = liveAssistantMessage(sessionId, null, 1783015200000);

    writeCachedMobileLiveAssistant(sessionId, live, 1783015200000);
    clearCachedMobileLiveAssistant(sessionId);
    unsubscribe();
    writeCachedMobileLiveAssistant(sessionId, live, 1783015200001);

    expect(updates).toEqual([live.id, null]);
    clearCachedMobileLiveAssistant(sessionId);
  });

  test("restores cached live assistant rows by session", () => {
    const sessionId = `mobile-live-${Date.now()}`;
    const live = liveAssistantMessage(sessionId, null, 1783015200000);

    writeCachedMobileLiveAssistant(
      sessionId,
      {
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
      },
      1783015200000,
      { runId: "run-1", sequence: 7 }
    );

    const cached = readCachedMobileLiveAssistant(sessionId);
    expect(cached?.message.content).toBe("partial answer");
    expect(cached?.message.processActivities?.[0]?.text).toBe("Running bun test");
    expect(cached?.runId).toBe("run-1");
    expect(cached?.sequence).toBe(7);

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

  test("keeps mobile live rows when queue snapshots have no activity rows", () => {
    const sessionId = `mobile-queue-snapshot-${Date.now()}`;
    const current = {
      ...liveAssistantMessage(sessionId, null, 1783015200000),
      processActivities: [
        {
          id: "activity-1",
          phase: "result" as const,
          text: "Ran repo review command",
          timestamp: 1783015200100,
          toolName: "exec_command",
          toolCallId: "tool-1",
        },
      ],
    };

    const live = liveAssistantFromStatusSnapshot(sessionId, current, {
      sessionId,
      status: "thinking",
      timestamp: 1783015200500,
      activities: [],
    });

    expect(live.processActivities?.map((activity) => activity.text)).toEqual([
      "Ran repo review command",
    ]);
  });

  test("merges partial snapshots without dropping earlier tool activity", () => {
    const sessionId = `mobile-partial-snapshot-${Date.now()}`;
    const current = {
      ...liveAssistantMessage(sessionId, null, 1783015200000),
      processActivities: [
        {
          id: "tool-1",
          phase: "result" as const,
          text: "Read package.json",
          timestamp: 1783015200100,
          toolName: "read",
          toolCallId: "tool-1",
        },
      ],
    };

    const live = liveAssistantFromStatusSnapshot(sessionId, current, {
      sessionId,
      status: "tool_executing",
      timestamp: 1783015200500,
      activities: [
        {
          id: "tool-2",
          phase: "start",
          text: "Running tests",
          timestamp: 1783015200500,
          toolName: "exec",
          toolCallId: "tool-2",
        },
      ],
    });

    expect(live.processActivities?.map((activity) => activity.text)).toEqual([
      "Read package.json",
      "Running tests",
    ]);
  });

  test("keeps long-running tool completion at its original timeline position", () => {
    const baseTimestamp = 1_783_700_000_000;
    const completed = mergeLiveActivity(
      [
        {
          id: "long-command",
          phase: "start",
          text: "Running repository tests",
          timestamp: baseTimestamp,
          toolName: "exec",
          toolCallId: "long-command",
        },
        {
          id: "later-thought",
          phase: "result",
          text: "Reviewing another issue",
          timestamp: baseTimestamp + 1,
          toolName: "__thought",
        },
      ],
      {
        id: "long-command",
        phase: "result",
        text: "Ran repository tests",
        timestamp: baseTimestamp + 25 * 60_000,
        toolName: "exec",
        toolCallId: "long-command",
      }
    );

    expect(completed.map((activity) => activity.text)).toEqual([
      "Ran repository tests",
      "Reviewing another issue",
    ]);
    expect(completed[0]?.timestamp).toBe(baseTimestamp);
  });

  test("does not discard older live activities during long runs", () => {
    let activities = [];
    for (let index = 0; index < 24; index += 1) {
      activities = mergeLiveActivity(activities, {
        id: `tool-${index}`,
        phase: "result",
        text: `Ran command ${index}`,
        timestamp: 1783015200000 + index,
        toolName: "exec",
        toolCallId: `tool-${index}`,
      });
    }

    expect(activities).toHaveLength(24);
    expect(activities[0]?.text).toBe("Ran command 0");
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

  test("drops live rows after a later persisted assistant reply catches up", () => {
    const sessionId = `mobile-live-caught-up-${Date.now()}`;
    const live = {
      ...liveAssistantMessage(sessionId, null, 1783015200000),
      content: "Partial answer",
    };

    const pruned = prunePersistedMobileLiveAssistant(live, [
      {
        id: "assistant-1",
        role: "assistant",
        content: "Final answer",
        timestamp: "2026-07-02T18:00:01.000Z",
      },
    ]);

    expect(pruned).toBeNull();
  });

  test("prunes persisted live tool work without requiring identical timestamps", () => {
    const sessionId = `mobile-prune-live-timestamp-${Date.now()}`;
    const live = {
      ...liveAssistantMessage(sessionId, null, 1783015200000),
      processActivities: [
        {
          id: "live-tool-1-start",
          phase: "start" as const,
          text: "Running sleep 35; echo token",
          timestamp: 1783015200100,
          toolName: "exec",
          toolCallId: "tool-1",
        },
      ],
    };

    const pruned = prunePersistedMobileLiveAssistant(live, [
      {
        id: "assistant-1",
        role: "assistant",
        content: "",
        timestamp: "2026-07-02T18:00:00.000Z",
        processActivities: [
          {
            id: "persisted-tool-1",
            phase: "result",
            text: "Ran sleep 35; echo token",
            timestamp: 1783015204900,
            toolName: "exec",
            toolCallId: "tool-1",
          },
        ],
      },
    ]);

    expect(pruned).toBeNull();
  });

  test("keeps newer live work when persisted assistant only has partial activity rows", () => {
    const sessionId = `mobile-prune-partial-${Date.now()}`;
    const live = {
      ...liveAssistantMessage(sessionId, null, 1783015200000),
      processActivities: [
        {
          id: "live-tool-1-result",
          phase: "result" as const,
          text: "Ran package manager install",
          timestamp: 1783015200100,
          toolName: "exec",
          toolCallId: "tool-1",
        },
        {
          id: "live-tool-2-start",
          phase: "start" as const,
          text: "Running tests",
          timestamp: 1783015200200,
          toolName: "exec",
          toolCallId: "tool-2",
        },
      ],
    };

    const pruned = prunePersistedMobileLiveAssistant(live, [
      {
        id: "assistant-1",
        role: "assistant",
        content: "",
        timestamp: "2026-07-02T18:00:00.000Z",
        processActivities: [
          {
            id: "persisted-tool-1",
            phase: "result",
            text: "Ran package manager install",
            timestamp: 1783015204900,
            toolName: "exec",
            toolCallId: "tool-1",
          },
        ],
      },
    ]);

    expect(pruned?.processActivities?.map((activity) => activity.text)).toEqual(["Running tests"]);
  });

  test("keeps post-steer handoff rows while pruning duplicated pre-steer work", () => {
    const sessionId = `mobile-prune-live-steer-${Date.now()}`;
    const live = {
      ...liveAssistantMessage(sessionId, null, 1783015200000),
      processActivities: [
        {
          id: "live-tool-1-result",
          phase: "result" as const,
          text: "Ran sleep 35; echo token",
          timestamp: 1783015200100,
          toolName: "exec",
          toolCallId: "tool-1",
        },
        {
          id: "handoff",
          phase: "result" as const,
          text: "Steering to follow-up...",
          timestamp: 1783015200200,
          toolName: "__thought",
        },
      ],
    };

    const pruned = prunePersistedMobileLiveAssistant(live, [
      {
        id: "assistant-1",
        role: "assistant",
        content: "",
        timestamp: "2026-07-02T18:00:00.000Z",
        processActivities: [
          {
            id: "persisted-tool-1",
            phase: "result",
            text: "Ran sleep 35; echo token",
            timestamp: 1783015204900,
            toolName: "exec",
            toolCallId: "tool-1",
          },
        ],
      },
      {
        id: "user-1",
        role: "user",
        content: "steer now",
        timestamp: "2026-07-02T18:00:01.000Z",
      },
    ]);

    expect(pruned?.processActivities?.map((activity) => activity.text)).toEqual([
      "Steering to follow-up...",
    ]);
  });

  test("captures only meaningful live work for mobile steering payloads", () => {
    const sessionId = `mobile-pre-steer-${Date.now()}`;
    const live = {
      ...liveAssistantMessage(sessionId, null, 1783015200000),
      processActivities: [
        {
          id: "tool-1",
          phase: "result" as const,
          text: "Ran repo review before steering",
          timestamp: 1783015200100,
          toolName: "exec",
          toolCallId: "tool-1",
        },
        {
          id: "handoff",
          phase: "result" as const,
          text: "Steering to follow-up...",
          timestamp: 1783015200200,
          toolName: "__thought",
        },
      ],
    };

    expect(mobilePreSteerProcessActivities(live)).toEqual([
      {
        id: "tool-1",
        phase: "result",
        text: "Ran repo review before steering",
        timestamp: 1783015200100,
        toolName: "exec",
        toolCallId: "tool-1",
      },
    ]);
  });
});
