import { describe, expect, test } from "bun:test";
import {
  MULTI_CHAT_ACTIVE_STATUSES,
  projectMultiChatSnapshot,
  projectMultiChatStatusEvent,
} from "../../ui/src/pages/chat/multiChatLiveStatus";

describe("multi-chat live status", () => {
  test("hydrates in-progress tool calls and thoughts from a session snapshot", () => {
    const state = projectMultiChatSnapshot(
      {
        sessionId: "session-1",
        runId: "run-1",
        sequence: 8,
        status: "tool_executing",
        timestamp: 1_000,
        detail: "Searching the workspace",
        activities: [
          {
            id: "thought-1",
            phase: "result",
            text: "I will inspect the relevant files first.",
            timestamp: 900,
            toolName: "__thought",
          },
          {
            id: "tool-1",
            phase: "start",
            text: "Searching for configuration",
            timestamp: 1_000,
            toolName: "grep",
            toolCallId: "call-1",
          },
        ],
      },
      undefined,
      1_100
    );

    expect(state.activities).toHaveLength(2);
    expect(state.activities.map((activity) => activity.text)).toEqual([
      "I will inspect the relevant files first.",
      "Searching for configuration",
    ]);
    expect(state.currentStep).toBe("Searching for configuration");
    expect(state.liveStatus).toBe("thinking");
    expect(state.startedAtMs).toBe(1_000);
  });

  test("keeps a session active between a tool result and the next model step", () => {
    const running = projectMultiChatStatusEvent(undefined, {
      type: "status",
      sessionId: "session-1",
      runId: "run-1",
      sequence: 1,
      status: "tool_executing",
      timestamp: 1_000,
      toolName: "read",
      toolCallId: "call-1",
      detail: "Exploring package.json",
    });
    const completed = projectMultiChatStatusEvent(running || undefined, {
      type: "status",
      sessionId: "session-1",
      runId: "run-1",
      sequence: 2,
      status: "tool_completed",
      timestamp: 1_100,
      toolName: "read",
      toolCallId: "call-1",
      detail: "Explored package.json",
    });

    expect(completed).not.toBeNull();
    expect(MULTI_CHAT_ACTIVE_STATUSES.has(completed?.status || "idle")).toBe(true);
    expect(completed?.activities).toHaveLength(1);
    expect(completed?.activities[0]?.phase).toBe("result");
    expect(completed?.activities[0]?.text).toBe("Explored package.json");
  });

  test("clears live state only for a terminal status", () => {
    const running = projectMultiChatStatusEvent(undefined, {
      type: "status",
      sessionId: "session-1",
      status: "thinking",
      timestamp: 1_000,
      detail: "Reviewing the test output",
    });
    const idle = projectMultiChatStatusEvent(running || undefined, {
      type: "status",
      sessionId: "session-1",
      status: "idle",
      timestamp: 1_100,
    });

    expect(running?.activities[0]?.toolName).toBe("__thought");
    expect(idle).toBeNull();
  });
});
