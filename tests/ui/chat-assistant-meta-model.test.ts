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

  test("uses the widest reliable duration evidence", () => {
    expect(
      resolveWorkedDurationMs(
        [
          { id: "a", phase: "start", text: "start", timestamp: 2_000 },
          { id: "b", phase: "result", text: "done", timestamp: 5_000 },
        ],
        [toolCall({ started_at: 2_500, duration: 1_000 })],
        { assistantTimestamp: "7000", turnStartedAtMs: 1_000 }
      )
    ).toBe(6_000);
    expect(resolveWorkedDurationMs(undefined, undefined)).toBeUndefined();
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
