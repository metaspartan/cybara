import { describe, expect, test } from "bun:test";
import {
  collectMessageArtifacts,
  formatWorkedDuration,
  inferThoughtActivitiesFromContent,
  inferThoughtActivitiesFromThinking,
  parseTimestampMs,
  resolveWorkedDurationMs,
} from "../../ui/src/pages/chat/assistantMetaModel";
import type { ToolCall } from "../../ui/src/pages/chat/chatModel";

function toolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: "tool-1",
    name: "exec",
    status: "completed",
    ...overrides,
  };
}

describe("chat assistant metadata", () => {
  test("formats worked durations without negative output", () => {
    expect(formatWorkedDuration(-1)).toBe("0h 00m 00s");
    expect(formatWorkedDuration(3_661_999)).toBe("1h 01m 01s");
  });

  test("parses numeric and ISO timestamps and rejects malformed values", () => {
    expect(parseTimestampMs(1_000)).toBe(1_000);
    expect(parseTimestampMs("2000")).toBe(2_000);
    expect(parseTimestampMs("2026-07-14T12:00:00.000Z")).toBe(
      Date.parse("2026-07-14T12:00:00.000Z")
    );
    expect(parseTimestampMs("not-a-date")).toBeUndefined();
    expect(parseTimestampMs(null)).toBeUndefined();
  });

  test("infers thoughts without treating tool summaries as thoughts", () => {
    expect(
      inferThoughtActivitiesFromContent(
        "I'll inspect the route.\nRan 2 commands\nNext I will add coverage.",
        100
      ).map((activity) => [activity.text, activity.timestamp])
    ).toEqual([
      ["I'll inspect the route.", 100],
      ["Next I will add coverage.", 102],
    ]);
    expect(inferThoughtActivitiesFromThinking("Check state\nVerify output", 200)).toHaveLength(2);
  });

  test("measures from the first observed activity through assistant completion", () => {
    expect(
      resolveWorkedDurationMs(
        [
          { id: "a", phase: "start", text: "start", timestamp: 2_000 },
          { id: "b", phase: "result", text: "done", timestamp: 5_000 },
        ],
        [toolCall({ started_at: 2_500, duration: 1_000 })],
        { assistantTimestamp: "7000", turnStartedAtMs: 1_000 }
      )
    ).toBe(5_000);
    expect(
      resolveWorkedDurationMs(
        [
          { id: "tool-start", phase: "start", text: "Running", timestamp: 8_700_000 },
          { id: "tool-result", phase: "result", text: "Ran", timestamp: 8_725_000 },
        ],
        undefined,
        { assistantTimestamp: "8725000", turnStartedAtMs: 0 }
      )
    ).toBe(25_000);
    expect(
      resolveWorkedDurationMs(
        [
          { id: "thought", phase: "result", text: "Working", timestamp: 14_500 },
          { id: "tool-result", phase: "result", text: "Ran", timestamp: 21_500 },
        ],
        undefined,
        { assistantTimestamp: "49500", turnStartedAtMs: 14_000 }
      )
    ).toBe(35_000);
  });

  test("falls back to turn wall time when no granular timing exists", () => {
    expect(
      resolveWorkedDurationMs(undefined, undefined, {
        assistantTimestamp: "26000",
        turnStartedAtMs: 1_000,
      })
    ).toBe(25_000);
    expect(resolveWorkedDurationMs(undefined, undefined)).toBeUndefined();
  });

  test("prefers the persisted run duration over partial tool timing", () => {
    expect(
      resolveWorkedDurationMs(
        [
          { id: "tool-start", phase: "start", text: "Running", timestamp: 20_000 },
          { id: "tool-result", phase: "result", text: "Ran", timestamp: 25_000 },
        ],
        undefined,
        { workedDurationMs: 26_000 }
      )
    ).toBe(26_000);
  });

  test("ignores stale activity timestamps from an earlier steered run", () => {
    const turnStartedAtMs = 7_200_000;
    expect(
      resolveWorkedDurationMs(
        [
          { id: "stale", phase: "result", text: "Old work", timestamp: 1_000 },
          { id: "start", phase: "start", text: "New work", timestamp: 7_205_000 },
          { id: "done", phase: "result", text: "Done", timestamp: 7_230_000 },
        ],
        undefined,
        { assistantTimestamp: "7230000", turnStartedAtMs }
      )
    ).toBe(25_000);
  });

  test("collects only artifact mutation results", () => {
    const artifacts = collectMessageArtifacts(
      [
        toolCall({
          id: "create",
          name: "artifacts",
          arguments: { action: "create", name: "report" },
          result: JSON.stringify({
            created: true,
            artifact: {
              sessionId: "session-1",
              name: "report",
              fileName: "report.md.resolved",
              title: "Report",
            },
          }),
        }),
        toolCall({
          id: "list",
          name: "artifacts",
          arguments: { action: "list" },
          result: JSON.stringify({ artifacts: [] }),
        }),
        toolCall({ id: "other", name: "exec", result: "ok" }),
      ],
      "session-1"
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.fileName).toBe("report.md.resolved");
    expect(artifacts[0]?.sessionId).toBe("session-1");
  });
});
