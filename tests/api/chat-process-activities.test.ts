import { describe, expect, test } from "bun:test";
import {
  buildFallbackProcessActivities,
  dedupeProcessActivities,
  formatProcessActivityFromToolCall,
  type ProcessActivityInfo,
} from "../../src/api/chat-process-activities";

describe("chat process activities", () => {
  test("formats paths and multiline commands without losing detail", () => {
    expect(
      formatProcessActivityFromToolCall({
        id: "read-1",
        name: "read",
        args: { path: "C:\\workspace\\src\\index.ts" },
        status: "completed",
      })
    ).toBe("Explored index.ts");
    expect(
      formatProcessActivityFromToolCall({
        id: "exec-1",
        name: "exec",
        args: { command: "bun test\nbun run typecheck" },
        status: "completed",
      })
    ).toBe("Ran bun test bun run typecheck");
  });

  test("formats complete command activity without shortening it", () => {
    const command =
      "printf 'complete command activity remains fully visible across every client surface' >/dev/null";
    expect(
      formatProcessActivityFromToolCall({
        id: "complete-command-call",
        name: "exec",
        args: { command },
        status: "completed",
      })
    ).toBe(`Ran ${command}`);
  });

  test("replaces a start activity with its later completion", () => {
    const activities: ProcessActivityInfo[] = [
      {
        id: "start",
        phase: "start",
        text: "Running tests",
        timestamp: 10,
        toolCallId: "call-1",
        toolName: "exec",
      },
      {
        id: "result",
        phase: "result",
        text: "Running tests",
        timestamp: 20,
        toolCallId: "call-1",
        toolName: "exec",
      },
    ];

    expect(dedupeProcessActivities(activities)).toEqual([
      expect.objectContaining({ id: "result", phase: "result", text: "Ran tests" }),
    ]);
  });

  test("keeps a later start when only an earlier completion exists", () => {
    const activities: ProcessActivityInfo[] = [
      {
        id: "result",
        phase: "result",
        text: "Running initial tests",
        timestamp: 10,
        toolCallId: "call-1",
        toolName: "exec",
      },
      {
        id: "start",
        phase: "start",
        text: "Running tests again",
        timestamp: 20,
        toolCallId: "call-1",
        toolName: "exec",
      },
    ];

    expect(dedupeProcessActivities(activities)).toEqual([
      expect.objectContaining({ id: "result", phase: "result", text: "Ran initial tests" }),
      expect.objectContaining({ id: "start", phase: "start", text: "Running tests again" }),
    ]);
  });

  test("collapses repeated progress thoughts across nested recovery attempts", () => {
    const activities: ProcessActivityInfo[] = [
      {
        id: "thought-1",
        phase: "result",
        text: "Actually, let me try using a different tool.",
        timestamp: 10,
        toolName: "__thought",
      },
      {
        id: "thought-2",
        phase: "result",
        text: "Actually, let me try using a different tool.",
        timestamp: 20_000,
        toolName: "__thought",
      },
      {
        id: "thought-3",
        phase: "result",
        text: "Checking the deployment result.",
        timestamp: 21_000,
        toolName: "__thought",
      },
    ];

    expect(dedupeProcessActivities(activities)).toEqual([activities[0], activities[2]]);
  });

  test("builds ordered fallbacks with sandbox provenance and meaningful thoughts", () => {
    expect(
      buildFallbackProcessActivities(
        [
          {
            id: "failed-search",
            name: "file_search",
            args: { pattern: "TODO" },
            status: "failed",
            timeline_index: 4,
          },
          {
            id: "sandboxed-exec",
            name: "exec",
            args: { command: "bun test" },
            status: "completed",
            result: { sandbox_provider: "docker" },
            timeline_index: 1,
          },
        ],
        "Thinking...\nVerified the failure path",
        100
      )
    ).toEqual([
      expect.objectContaining({
        id: "fallback-sandboxed-exec",
        phase: "result",
        text: "Ran bun test",
        timestamp: 101,
        sandboxProvider: "docker",
      }),
      expect.objectContaining({
        id: "fallback-thought-0",
        phase: "result",
        text: "Verified the failure path",
        timestamp: 103,
      }),
      expect.objectContaining({
        id: "fallback-failed-search",
        phase: "error",
        text: 'Search complete for "TODO"',
        timestamp: 104,
      }),
    ]);
  });

  test("returns no fallback for empty generic activity", () => {
    expect(buildFallbackProcessActivities([], "Thinking...", Number.NaN)).toBeUndefined();
  });
});
