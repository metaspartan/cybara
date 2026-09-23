import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type LiveActivityItem, mergeActivityLists } from "../../ui/src/lib/chatActivities";
import { activityRowKey } from "../../ui/src/pages/chat/ActivityTimeline";
import { toLiveActivityItems } from "../../ui/src/pages/chat/chatModel";
import { applyLiveActivityEvent } from "../../ui/src/pages/chat/liveActivityModel";
import { LIVE_TOOL_DETAIL_MAX_CHARS, liveToolFullDetail } from "../../src/core/live-tool-detail";
import { reduceSessionStatusSnapshot } from "../../src/core/status";

const longCommand = `echo '${"x".repeat(200)}' && sleep 45`;

describe("live activity expansion", () => {
  test("the server formats the same expanded detail finished messages use, capped", () => {
    const detail = liveToolFullDetail("exec", { command: longCommand }, "start");
    expect(detail).toContain("sleep 45");
    const huge = liveToolFullDetail("exec", { command: "y".repeat(20_000) }, "start");
    expect(huge?.length).toBeLessThanOrEqual(LIVE_TOOL_DETAIL_MAX_CHARS + 1);
    expect(liveToolFullDetail("exec", {}, "start")).toBeUndefined();
  });

  test("session snapshots keep the full detail from start through result", () => {
    const base = { sessionId: "s1", runId: "r1", toolName: "exec", toolCallId: "call-1" };
    const started = reduceSessionStatusSnapshot(undefined, {
      ...base,
      status: "tool_executing",
      toolPhase: "start",
      timestamp: 1_000,
      sequence: 1,
      detail: "Running echo",
      fullDetail: "Running echo full",
    });
    expect(started?.activities[0]?.fullDetail).toBe("Running echo full");
    const finished = reduceSessionStatusSnapshot(started ?? undefined, {
      ...base,
      status: "tool_completed",
      toolPhase: "result",
      timestamp: 2_000,
      sequence: 2,
      detail: "Ran echo",
    });
    expect(finished?.activities).toHaveLength(1);
    expect(finished?.activities[0]).toMatchObject({
      phase: "result",
      fullDetail: "Running echo full",
    });
    expect(toLiveActivityItems(finished?.activities)[0]?.fullText).toBe("Running echo full");
  });

  test("live events carry full text and keep it when the result replaces the start", () => {
    const started = applyLiveActivityEvent([], {
      phase: "start",
      text: "Running echo",
      toolName: "exec",
      toolCallId: "call-1",
      timestamp: 1_000,
      runId: "r1",
      sequence: 1,
      fullText: longCommand,
    });
    expect(started[0]?.fullText).toBe(longCommand);
    const finished = applyLiveActivityEvent(started, {
      phase: "result",
      text: "Ran echo",
      toolName: "exec",
      toolCallId: "call-1",
      timestamp: 2_000,
      runId: "r1",
      sequence: 2,
    });
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ phase: "result", fullText: longCommand });
  });

  test("merging keeps full text from whichever copy has it", () => {
    const withoutDetail: LiveActivityItem = {
      id: "a",
      phase: "result",
      text: "Ran echo",
      timestamp: 5,
      toolName: "exec",
      toolCallId: "call-9",
    };
    const withDetail: LiveActivityItem = { ...withoutDetail, id: "b", fullText: longCommand };
    const merged = mergeActivityLists([withoutDetail], [withDetail]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.fullText).toBe(longCommand);
  });

  test("row keys stay stable when a result from another source replaces the start", () => {
    const start: LiveActivityItem = {
      id: "r1:1",
      phase: "start",
      text: "Viewing",
      timestamp: 1,
      toolCallId: "Call-7",
    };
    const result: LiveActivityItem = {
      id: "server-42",
      phase: "result",
      text: "Viewed an image",
      timestamp: 2,
      toolCallId: "call-7",
    };
    expect(activityRowKey(start)).toBe(activityRowKey(result));
    expect(activityRowKey({ id: "t1", phase: "result", text: "note", timestamp: 3 })).toBe("t1");
  });

  test("expanded state lives in the list, keyed by the stable row key", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../ui/src/pages/chat/ActivityTimeline.tsx", import.meta.url)),
      "utf8"
    );
    expect(source).toContain(
      "const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());"
    );
    expect(source).toContain("key={key}");
    expect(source).toContain("expanded={expandedRows.has(key)}");
    expect(source).not.toContain("<ActivityRow key={activity.id}");
  });
});
