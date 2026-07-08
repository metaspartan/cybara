import { describe, expect, test } from "bun:test";

import {
  broadcastStatus,
  getSessionStatusSnapshot,
  listSessionStatusSnapshots,
} from "../../src/core/status";
import { isSessionStatusActive } from "../../src/api/routes/_shared";

describe("session status snapshots", () => {
  test("classifies only in-progress statuses as active", () => {
    expect(isSessionStatusActive("thinking")).toBe(true);
    expect(isSessionStatusActive("generating")).toBe(true);
    expect(isSessionStatusActive("tool_executing")).toBe(true);
    expect(isSessionStatusActive("compacting")).toBe(true);
    expect(isSessionStatusActive("tool_completed")).toBe(false);
    expect(isSessionStatusActive("idle")).toBe(false);
  });

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

  test("updates in-flight tool activities to completed instead of leaving stale start entries", () => {
    const sessionId = `status-tool-merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const baseTimestamp = Date.now();

    broadcastStatus({
      status: "tool_executing",
      timestamp: baseTimestamp,
      sessionId,
      toolName: "exec",
      detail: "Running bun test",
    });

    broadcastStatus({
      status: "tool_completed",
      timestamp: baseTimestamp + 10,
      sessionId,
      toolName: "exec",
      detail: "Ran bun test",
    });

    const snapshot = getSessionStatusSnapshot(sessionId);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.activities).toHaveLength(1);
    expect(snapshot?.activities[0]?.phase).toBe("result");
    expect(snapshot?.activities[0]?.text).toBe("Ran bun test");

    broadcastStatus({
      status: "idle",
      timestamp: baseTimestamp + 20,
      sessionId,
      detail: "idle",
    });
  });

  test("falls back to canonical completion text when tool completion detail is missing", () => {
    const sessionId = `status-tool-fallback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const baseTimestamp = Date.now();

    broadcastStatus({
      status: "tool_executing",
      timestamp: baseTimestamp,
      sessionId,
      toolName: "read",
      detail: "Exploring src/core/agent.ts",
    });

    broadcastStatus({
      status: "tool_completed",
      timestamp: baseTimestamp + 10,
      sessionId,
      toolName: "read",
    });

    const snapshot = getSessionStatusSnapshot(sessionId);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.activities).toHaveLength(1);
    expect(snapshot?.activities[0]?.phase).toBe("result");
    expect(snapshot?.activities[0]?.text).toBe("Explored src/core/agent.ts");

    broadcastStatus({
      status: "idle",
      timestamp: baseTimestamp + 20,
      sessionId,
      detail: "idle",
    });
  });

  test("preserves blocked tool activity phase without turning it into an error", () => {
    const sessionId = `status-tool-blocked-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const baseTimestamp = Date.now();

    broadcastStatus({
      status: "tool_executing",
      timestamp: baseTimestamp,
      sessionId,
      toolName: "read",
      toolCallId: "read-blocked",
      detail: "Exploring .env.example",
    });

    broadcastStatus({
      status: "tool_completed",
      timestamp: baseTimestamp + 10,
      sessionId,
      toolName: "read",
      toolCallId: "read-blocked",
      toolPhase: "blocked",
      detail: "Read blocked for .env.example",
    });

    const snapshot = getSessionStatusSnapshot(sessionId);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.activities).toHaveLength(1);
    expect(snapshot?.activities[0]?.phase).toBe("blocked");
    expect(snapshot?.activities[0]?.text).toBe("Read blocked for .env.example");

    broadcastStatus({
      status: "idle",
      timestamp: baseTimestamp + 20,
      sessionId,
      detail: "idle",
    });
  });

  test("does not list tool completion result snapshots as active sessions", () => {
    const sessionId = `status-tool-result-inactive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const baseTimestamp = Date.now();

    broadcastStatus({
      status: "tool_executing",
      timestamp: baseTimestamp,
      sessionId,
      toolName: "read",
      detail: "Exploring src/index.ts",
    });

    expect(listSessionStatusSnapshots().some((snapshot) => snapshot.sessionId === sessionId)).toBe(
      true
    );

    broadcastStatus({
      status: "tool_completed",
      timestamp: baseTimestamp + 10,
      sessionId,
      toolName: "read",
      detail: "Explored src/index.ts",
    });

    const snapshot = getSessionStatusSnapshot(sessionId);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.status).toBe("tool_completed");
    expect(snapshot?.activities[0]?.phase).toBe("result");
    expect(listSessionStatusSnapshots().some((entry) => entry.sessionId === sessionId)).toBe(false);

    broadcastStatus({
      status: "idle",
      timestamp: baseTimestamp + 20,
      sessionId,
      detail: "idle",
    });
  });

  test("matches repeated tool events by toolCallId to avoid stale in-flight ordering", () => {
    const sessionId = `status-tool-call-id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const baseTimestamp = Date.now();

    broadcastStatus({
      status: "tool_executing",
      timestamp: baseTimestamp,
      sessionId,
      toolName: "read",
      toolCallId: "read-1",
      detail: "Exploring package.json",
    });

    broadcastStatus({
      status: "tool_executing",
      timestamp: baseTimestamp + 1,
      sessionId,
      toolName: "read",
      toolCallId: "read-2",
      detail: "Exploring package.json",
    });

    broadcastStatus({
      status: "tool_completed",
      timestamp: baseTimestamp + 2,
      sessionId,
      toolName: "read",
      toolCallId: "read-1",
      detail: "Explored package.json",
    });

    const snapshot = getSessionStatusSnapshot(sessionId);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.activities).toHaveLength(2);

    const first = snapshot?.activities[0];
    const second = snapshot?.activities[1];
    expect(first?.toolCallId).toBe("read-1");
    expect(first?.phase).toBe("result");
    expect(first?.text).toBe("Explored package.json");
    expect(second?.toolCallId).toBe("read-2");
    expect(second?.phase).toBe("start");
    expect(second?.text).toBe("Exploring package.json");

    broadcastStatus({
      status: "idle",
      timestamp: baseTimestamp + 3,
      sessionId,
      detail: "idle",
    });
  });
});
