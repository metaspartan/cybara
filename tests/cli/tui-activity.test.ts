import { describe, expect, test } from "bun:test";
import { limitTUIActivityDetails, summarizeTUIActivities } from "../../src/cli-tui-activity";

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

  test("bounds compact activity detail rows without hiding their count", () => {
    expect(limitTUIActivityDetails(["one", "two"], 0)).toEqual([]);
    expect(limitTUIActivityDetails(["one", "two", "three", "four", "five"], 3)).toEqual([
      "four",
      "five",
      "… 3 earlier tool events",
    ]);
  });
});
