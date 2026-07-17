import { describe, expect, test } from "bun:test";
import {
  formatTUIWorkedDuration,
  limitTUIActivityDetails,
  presentTUIActivities,
  summarizeTUIActivities,
  tuiActivityTone,
} from "../../src/cli/tui/activity";

describe("CLI TUI activity summaries", () => {
  test("groups mixed tool work into a concise action heading", () => {
    expect(
      summarizeTUIActivities(
        [{ text: "Edited src/index.ts" }, { text: "Read package.json" }, { text: "Ran bun test" }],
        []
      )
    ).toEqual({
      icon: "◇",
      label: "Edited files, Read files, Ran commands",
      details: ["Edited src/index.ts", "Read package.json", "Ran bun test"],
    });
  });

  test("uses a specific icon for a single activity family", () => {
    const summary = summarizeTUIActivities(
      [],
      [
        { name: "browser_search", status: "completed" },
        { name: "fetch", status: "completed" },
      ]
    );
    expect(summary?.icon).toBe("◎");
    expect(summary?.label).toBe("Browsed the web");
  });

  test("returns no presentation for empty activity", () => {
    expect(summarizeTUIActivities([], [])).toBeNull();
  });

  test("does not present transient provider recovery as conversation work", () => {
    const activities = [
      {
        id: "provider-retry",
        phase: "start",
        text: "Provider rate limited; retrying (2/5)...",
        toolName: "__thought",
      },
    ];
    expect(presentTUIActivities(activities, [])).toEqual([]);
    expect(summarizeTUIActivities(activities, [])).toBeNull();
  });

  test("bounds compact activity detail rows without hiding their count", () => {
    expect(limitTUIActivityDetails(["one", "two"], 0)).toEqual([]);
    expect(limitTUIActivityDetails(["one", "two", "three", "four", "five"], 3)).toEqual([
      "four",
      "five",
      "… 3 earlier tool events",
    ]);
  });

  test("matches the ordered grouped presentation used by graphical chat", () => {
    const rows = presentTUIActivities(
      [
        {
          id: "thought-1",
          phase: "result",
          text: "I will inspect the runtime",
          toolName: "__thought",
        },
        { id: "read-1", phase: "result", text: "Explored src/index.ts", toolName: "read" },
        { id: "read-2", phase: "result", text: "Explored package.json", toolName: "read" },
        { id: "edit-1", phase: "result", text: "Edited src/index.ts", toolName: "edit" },
        {
          id: "thought-2",
          phase: "result",
          text: "The focused fix is ready",
          toolName: "__thought",
        },
        { id: "test-1", phase: "result", text: "Ran bun test", toolName: "exec" },
        { id: "test-2", phase: "result", text: "Ran bun run typecheck", toolName: "exec" },
      ],
      []
    );

    expect(rows.map((row) => row.label)).toEqual([
      "I will inspect the runtime",
      "Read 2 files, edited a file",
      "The focused fix is ready",
      "Ran 2 commands",
    ]);
    expect(rows.map((row) => row.icon)).toEqual(["", "✎", "", "▣"]);
    expect(rows[1]?.details).toEqual([
      "Explored src/index.ts",
      "Explored package.json",
      "Edited src/index.ts",
    ]);
  });

  test("keeps failures and active work visible as individual rows", () => {
    const rows = presentTUIActivities(
      [
        { id: "read", phase: "result", text: "Explored src/index.ts", toolName: "read" },
        { id: "failed", phase: "error", text: "Read failed for missing.ts", toolName: "read" },
        { id: "active", phase: "start", text: "Running tests", toolName: "exec" },
      ],
      []
    );

    expect(rows.map((row) => [row.label, row.phase])).toEqual([
      ["Explored src/index.ts", "result"],
      ["Read failed for missing.ts", "error"],
      ["Running tests", "start"],
    ]);
    expect(rows.map(tuiActivityTone)).toEqual(["activity", "danger", "warning"]);
  });

  test("keeps a tool row stable when later results join its group", () => {
    const first = presentTUIActivities(
      [{ id: "skill-load", phase: "result", text: "skill_load complete", toolName: "exec" }],
      []
    );
    const grouped = presentTUIActivities(
      [
        { id: "skill-load", phase: "result", text: "skill_load complete", toolName: "exec" },
        { id: "list-files", phase: "result", text: "Listed a location", toolName: "list" },
      ],
      []
    );

    expect(first[0]?.id).toBe("skill-load");
    expect(grouped[0]?.id).toBe("skill-load");
    expect(grouped[0]?.label).toBe("Ran a command, listed a location");
  });

  test("uses semantic tones for completed tool groups", () => {
    const toneFor = (text: string, toolName: string): string => {
      const row = presentTUIActivities([{ id: toolName, phase: "result", text, toolName }], [])[0];
      expect(row).toBeDefined();
      return row ? tuiActivityTone(row) : "";
    };

    expect(toneFor("Edited app.ts", "edit")).toBe("success");
    expect(toneFor("Ran tests", "exec")).toBe("success");
    expect(toneFor("Opened preview", "browser")).toBe("accent");
  });

  test("recovers complete commands from persisted tool arguments", () => {
    const command =
      'test "$(cat /tmp/cybara/result.txt)" = "GLM PERSISTENCE OK" && echo "contents match exactly"';
    const rows = presentTUIActivities(
      [
        {
          id: "thought-before-command",
          phase: "result",
          text: "I will verify the persisted file",
          toolName: "__thought",
        },
        {
          id: "command-result",
          phase: "result",
          text: 'Ran test "$(cat /tmp/cybara/result.txt)" = "GLM...',
          toolName: "exec",
          toolCallId: "runtime-call-id",
        },
      ],
      [
        {
          id: "provider-call-id",
          name: "exec",
          args: { command },
          status: "completed",
        },
      ]
    );

    expect(rows[1]?.label).toBe(`Ran ${command}`);
    expect(rows[1]?.label).not.toContain("...");
  });

  test("formats completed work duration from persisted activity and tool timing", () => {
    expect(
      formatTUIWorkedDuration(
        [
          { timestamp: 1_000, text: "Read a file" },
          { timestamp: 63_000, text: "Ran tests" },
        ],
        []
      )
    ).toBe("0h 01m 02s");
    expect(formatTUIWorkedDuration([], [{ durationMs: 3_725_000 }])).toBe("1h 02m 05s");
    expect(
      formatTUIWorkedDuration([{ timestamp: 7_000, text: "Read a file" }], [], {
        assistantTimestamp: 9_000,
        turnStartedAt: 2_000,
      })
    ).toBe("0h 00m 07s");
  });
});
