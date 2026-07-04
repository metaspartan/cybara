import { describe, expect, test } from "bun:test";
import {
  groupActivitiesForDisplay,
  type LiveActivityItem,
} from "../../ui/src/lib/chatActivities";

function activity(overrides: Partial<LiveActivityItem> & { id: string }): LiveActivityItem {
  return {
    phase: "result",
    text: "Explored file.ts",
    timestamp: 1,
    ...overrides,
  };
}

// Codex-style grouping: consecutive completed reads/searches/lists collapse
// into one expandable summary row; failures and in-flight steps never group.
describe("groupActivitiesForDisplay", () => {
  test("collapses consecutive reads into a 'Read N files' group", () => {
    const entries = groupActivitiesForDisplay([
      activity({ id: "a", toolName: "read", text: "Explored a.ts" }),
      activity({ id: "b", toolName: "read", text: "Explored b.ts" }),
      activity({ id: "c", toolName: "read", text: "Explored c.ts" }),
    ]);
    expect(entries).toHaveLength(1);
    const group = entries[0];
    if (group.type !== "group") throw new Error("expected group");
    expect(group.label).toBe("Read 3 files");
    expect(group.items.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  test("a single read stays a plain row (no group of one)", () => {
    const entries = groupActivitiesForDisplay([
      activity({ id: "a", toolName: "read" }),
      activity({ id: "b", toolName: "exec", text: "Ran ls" }),
    ]);
    expect(entries.map((entry) => entry.type)).toEqual(["single", "single"]);
  });

  test("non-groupable tools break a run and order is preserved", () => {
    const entries = groupActivitiesForDisplay([
      activity({ id: "a", toolName: "read", text: "Explored a.ts" }),
      activity({ id: "b", toolName: "read", text: "Explored b.ts" }),
      activity({ id: "x", toolName: "exec", text: "Ran bun test" }),
      activity({ id: "c", toolName: "read", text: "Explored c.ts" }),
      activity({ id: "d", toolName: "read", text: "Explored d.ts" }),
    ]);
    expect(entries.map((entry) => entry.type)).toEqual(["group", "single", "group"]);
    const first = entries[0];
    if (first.type !== "group") throw new Error("expected group");
    expect(first.label).toBe("Read 2 files");
  });

  test("searches group separately from reads", () => {
    const entries = groupActivitiesForDisplay([
      activity({ id: "a", toolName: "read", text: "Explored a.ts" }),
      activity({ id: "b", toolName: "read", text: "Explored b.ts" }),
      activity({ id: "c", toolName: "grep", text: "Searched for foo" }),
      activity({ id: "d", toolName: "file_search", text: "Searched *.ts" }),
    ]);
    expect(entries).toHaveLength(2);
    const [reads, searches] = entries;
    if (reads.type !== "group" || searches.type !== "group") throw new Error("expected groups");
    expect(reads.label).toBe("Read 2 files");
    expect(searches.label).toBe("Ran 2 searches");
  });

  test("failures and in-flight steps are never hidden inside a group", () => {
    const entries = groupActivitiesForDisplay([
      activity({ id: "a", toolName: "read", text: "Explored a.ts" }),
      activity({ id: "err", toolName: "read", phase: "error", text: "Read failed for b.ts" }),
      activity({ id: "c", toolName: "read", text: "Explored c.ts" }),
      activity({ id: "run", toolName: "read", phase: "start", text: "Exploring d.ts" }),
    ]);
    expect(entries.map((entry) => entry.type)).toEqual(["single", "single", "single", "single"]);
  });

  test("classifies persisted activities without toolName by canonical verb", () => {
    const entries = groupActivitiesForDisplay([
      activity({ id: "a", text: "Explored a.ts" }),
      activity({ id: "b", text: "Explored b.ts (lines 1-40)" }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("group");
  });

  test("thought activities pass through untouched", () => {
    const entries = groupActivitiesForDisplay([
      activity({ id: "t", toolName: "__thought", text: "Considering the layout" }),
      activity({ id: "a", toolName: "read", text: "Explored a.ts" }),
    ]);
    expect(entries.map((entry) => entry.type)).toEqual(["single", "single"]);
  });
});
