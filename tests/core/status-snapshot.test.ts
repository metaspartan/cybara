import { describe, expect, test } from "bun:test";

import { broadcastStatus, getSessionStatusSnapshot } from "../../src/core/status";

describe("session status snapshots", () => {
  test("persists meaningful thought details and excludes generic generating text", () => {
    const sessionId = `status-thought-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    broadcastStatus({
      status: "thinking",
      timestamp: Date.now(),
      sessionId,
      detail: "I am reviewing routes and preparing edits.",
    });

    broadcastStatus({
      status: "generating",
      timestamp: Date.now() + 1,
      sessionId,
      detail: "Generating response...",
    });

    const snapshot = getSessionStatusSnapshot(sessionId);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.status).toBe("generating");

    const thoughtActivities = snapshot?.activities.filter(
      (activity) => activity.toolName === "__thought"
    );
    expect(thoughtActivities?.length).toBe(1);
    expect(thoughtActivities?.[0]?.phase).toBe("result");
    expect(thoughtActivities?.[0]?.text).toBe("I am reviewing routes and preparing edits.");

    broadcastStatus({
      status: "idle",
      timestamp: Date.now() + 2,
      sessionId,
      detail: "idle",
    });

    expect(getSessionStatusSnapshot(sessionId)).toBeNull();
  });

  test("deduplicates repeated thought details", () => {
    const sessionId = `status-dedupe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    broadcastStatus({
      status: "thinking",
      timestamp: Date.now(),
      sessionId,
      detail: "Checking project structure",
    });

    broadcastStatus({
      status: "thinking",
      timestamp: Date.now() + 1,
      sessionId,
      detail: "Checking project structure",
    });

    const snapshot = getSessionStatusSnapshot(sessionId);
    expect(snapshot).not.toBeNull();

    const thoughtActivities = snapshot?.activities.filter(
      (activity) => activity.toolName === "__thought"
    );
    expect(thoughtActivities?.length).toBe(1);

    broadcastStatus({
      status: "idle",
      timestamp: Date.now() + 2,
      sessionId,
      detail: "idle",
    });
  });

  test("preserves long thought detail text without truncation", () => {
    const sessionId = `status-long-thought-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const longThought = `Investigating context behavior: ${"x".repeat(600)}`;

    broadcastStatus({
      status: "thinking",
      timestamp: Date.now(),
      sessionId,
      detail: longThought,
    });

    const snapshot = getSessionStatusSnapshot(sessionId);
    expect(snapshot).not.toBeNull();
    const thought = snapshot?.activities.find((activity) => activity.toolName === "__thought");
    expect(thought?.text).toBe(longThought);

    broadcastStatus({
      status: "idle",
      timestamp: Date.now() + 1,
      sessionId,
      detail: "idle",
    });
  });
});
