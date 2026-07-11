import { describe, expect, test } from "bun:test";
import { groupActivitiesForDisplay, type LiveActivityItem } from "../../ui/src/lib/chatActivities";

function activity(overrides: Partial<LiveActivityItem> & { id: string }): LiveActivityItem {
  return {
    phase: "result",
    text: "Explored file.ts",
    timestamp: 1,
    ...overrides,
  };
}

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
    expect(group.kind).toBe("read");
    expect(group.items.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  test("a single read stays a plain row (no group of one)", () => {
    const entries = groupActivitiesForDisplay([
      activity({ id: "a", toolName: "read" }),
      activity({ id: "t", toolName: "__thought", text: "Now I understand" }),
    ]);
    expect(entries.map((entry) => entry.type)).toEqual(["single", "single"]);
  });

  test("consecutive edits collapse into an 'Edited N files' group", () => {
    const entries = groupActivitiesForDisplay([
      activity({ id: "a", toolName: "edit", text: "Edited a.ts +10 -2" }),
      activity({ id: "b", toolName: "write", text: "Edited b.ts +4 -0" }),
      activity({ id: "c", toolName: "apply_patch", text: "Edited c.ts +1 -1" }),
    ]);
    expect(entries).toHaveLength(1);
    const group = entries[0];
    if (group.type !== "group") throw new Error("expected group");
    expect(group.label).toBe("Edited 3 files");
    expect(group.kind).toBe("edit");
  });

  test("edits between reads fold into one mixed group (Codex parity)", () => {
    const entries = groupActivitiesForDisplay([
      activity({ id: "a", toolName: "read", text: "Explored a.ts" }),
      activity({ id: "b", toolName: "read", text: "Explored b.ts" }),
      activity({ id: "x", toolName: "edit", text: "Edited a.ts +10 -2" }),
      activity({ id: "c", toolName: "read", text: "Explored c.ts" }),
    ]);
    expect(entries).toHaveLength(1);
    const group = entries[0];
    if (group.type !== "group") throw new Error("expected group");
    expect(group.label).toBe("Read 3 files, edited a file");
    expect(group.kind).toBe("edit");
  });

  test("web_fetch folds into the run", () => {
    const entries = groupActivitiesForDisplay([
      activity({ id: "a", toolName: "web_search", text: "Searched reasoning behavior" }),
      activity({ id: "b", toolName: "web_fetch", text: "Fetched https://example.com" }),
      activity({ id: "c", toolName: "web_search", text: "Searched effort levels" }),
    ]);
    expect(entries).toHaveLength(1);
    const group = entries[0];
    if (group.type !== "group") throw new Error("expected group");
    expect(group.label).toBe("Ran 2 searches, fetched a page");
    expect(group.kind).toBe("fetch");
  });

  test("an in-flight start row no longer breaks the run; it renders after the group", () => {
    const entries = groupActivitiesForDisplay([
      activity({ id: "a", toolName: "read", text: "Explored a.ts" }),
      activity({ id: "run", toolName: "read", phase: "start", text: "Exploring b.ts" }),
      activity({ id: "c", toolName: "read", text: "Explored c.ts" }),
      activity({ id: "d", toolName: "read", text: "Explored d.ts" }),
    ]);
    expect(entries.map((entry) => entry.type)).toEqual(["group", "single"]);
    const group = entries[0];
    if (group.type !== "group") throw new Error("expected group");
    expect(group.label).toBe("Read 3 files");
    const trailing = entries[1];
    if (trailing.type !== "single") throw new Error("expected single");
    expect(trailing.activity.id).toBe("run");
  });

  test("a state-changing exec command folds into the run with a mixed label", () => {
    const entries = groupActivitiesForDisplay([
      activity({ id: "a", toolName: "read", text: "Explored a.ts" }),
      activity({ id: "b", toolName: "read", text: "Explored b.ts" }),
      activity({ id: "x", toolName: "exec", text: "Ran bun test" }),
      activity({ id: "c", toolName: "read", text: "Explored c.ts" }),
      activity({ id: "d", toolName: "read", text: "Explored d.ts" }),
    ]);
    expect(entries).toHaveLength(1);
    const group = entries[0];
    if (group.type !== "group") throw new Error("expected group");
    expect(group.label).toBe("Read 4 files, ran a command");
    expect(group.items.map((item) => item.id)).toEqual(["a", "b", "x", "c", "d"]);
  });

  test("read-only shell commands fold into the exploring group", () => {
    const entries = groupActivitiesForDisplay([
      activity({ id: "a", toolName: "exec", text: "Ran ls -la" }),
      activity({ id: "b", toolName: "exec", text: "Ran find src -name '*.ts'" }),
      activity({ id: "c", toolName: "exec", text: "Ran grep -rn foo src" }),
      activity({ id: "d", toolName: "exec", text: "Ran cloc src" }),
      activity({ id: "e", toolName: "exec", text: "Ran git log --oneline" }),
    ]);
    expect(entries).toHaveLength(1);
    const group = entries[0];
    if (group.type !== "group") throw new Error("expected group");
    expect(group.label).toBe("Listed 2 locations, ran a search, ran 2 commands");
    expect(group.items).toHaveLength(5);
  });

  test("mixed tool reads and read-only shell reads share one group", () => {
    const entries = groupActivitiesForDisplay([
      activity({ id: "a", toolName: "read", text: "Explored a.ts" }),
      activity({ id: "b", toolName: "exec", text: "Ran cat b.ts" }),
      activity({ id: "c", toolName: "exec", text: "Ran head -20 c.ts" }),
    ]);
    expect(entries).toHaveLength(1);
    const group = entries[0];
    if (group.type !== "group") throw new Error("expected group");
    // All three are "read" kind -> specific label.
    expect(group.label).toBe("Read 3 files");
  });

  test("mutating and unknown shell commands group as commands", () => {
    const entries = groupActivitiesForDisplay([
      activity({ id: "a", toolName: "exec", text: "Ran git commit -m x" }),
      activity({ id: "b", toolName: "exec", text: "Ran rm -f tmp" }),
      activity({ id: "c", toolName: "exec", text: "Ran npm run build" }),
    ]);
    expect(entries).toHaveLength(1);
    const group = entries[0];
    if (group.type !== "group") throw new Error("expected group");
    expect(group.label).toBe("Ran 3 commands");
  });

  test("read-only git subcommands beyond log/status group (regression: git shortlog)", () => {
    const entries = groupActivitiesForDisplay([
      activity({ id: "a", toolName: "exec", text: "Ran git log --oneline -20" }),
      activity({ id: "b", toolName: "exec", text: "Ran git shortlog -sn --all" }),
      activity({ id: "c", toolName: "exec", text: "Ran git rev-parse HEAD" }),
    ]);
    expect(entries).toHaveLength(1);
    const group = entries[0];
    if (group.type !== "group") throw new Error("expected group");
    expect(group.label).toBe("Ran 3 commands");
  });

  test("compound read-only commands group; the leading echo does not fool it", () => {
    const entries = groupActivitiesForDisplay([
      activity({ id: "a", toolName: "exec", text: 'Ran echo "=== src ===" && find src -type f' }),
      activity({ id: "b", toolName: "exec", text: 'Ran echo "=== loc ===" && cloc src | tail -3' }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("group");
  });

  test("a mutation inside a compound folds in and is labelled as a command", () => {
    const entries = groupActivitiesForDisplay([
      activity({ id: "a", toolName: "exec", text: "Ran ls -la" }),
      activity({ id: "b", toolName: "exec", text: "Ran echo done && rm -rf build" }),
      activity({ id: "c", toolName: "exec", text: "Ran find src -name '*.ts'" }),
    ]);
    expect(entries).toHaveLength(1);
    const group = entries[0];
    if (group.type !== "group") throw new Error("expected group");
    expect(group.label).toBe("Listed 2 locations, ran a command");
  });

  test("interleaved thoughts stay visible between command groups", () => {
    const entries = groupActivitiesForDisplay([
      activity({ id: "t0", toolName: "__thought", text: "I'll explore the repo" }),
      activity({ id: "a", toolName: "exec", text: "Ran ls -la" }),
      activity({ id: "b", toolName: "grep", text: "Explored 53 files, 1 search" }),
      activity({ id: "t1", toolName: "__thought", text: "Context automatically compacted" }),
      activity({ id: "d", toolName: "exec", text: "Ran cd /repo && wc -l package.json" }),
      activity({ id: "e", toolName: "exec", text: "Ran git log --oneline" }),
    ]);
    expect(entries.map((entry) => entry.type)).toEqual(["single", "group", "single", "group"]);
    const firstThought = entries[0];
    if (firstThought.type !== "single") throw new Error("expected leading thought");
    expect(firstThought.activity.toolName).toBe("__thought");
    const group = entries[1];
    if (group.type !== "group") throw new Error("expected group");
    expect(group.label).toBe("Listed a location, ran a search");
    expect(group.items.map((item) => item.id)).toEqual(["a", "b"]);
    const middleThought = entries[2];
    if (middleThought.type !== "single") throw new Error("expected middle thought");
    expect(middleThought.activity.toolName).toBe("__thought");
    expect(middleThought.activity.text).toBe("Context automatically compacted");
    const finalGroup = entries[3];
    if (finalGroup.type !== "group") throw new Error("expected final group");
    expect(finalGroup.label).toBe("Ran 2 commands");
    expect(finalGroup.items.map((item) => item.id)).toEqual(["d", "e"]);
  });

  test("xargs-wrapped commands group whether read-only or mutating", () => {
    const readOnly = groupActivitiesForDisplay([
      activity({ id: "a", toolName: "exec", text: 'Ran find src -name "*.ts" | xargs wc -l' }),
      activity({ id: "b", toolName: "exec", text: "Ran ls -la" }),
    ]);
    expect(readOnly[0].type).toBe("group");

    const mutating = groupActivitiesForDisplay([
      activity({ id: "a", toolName: "exec", text: "Ran find . -name tmp | xargs rm -f" }),
      activity({ id: "b", toolName: "exec", text: "Ran ls -la" }),
    ]);
    expect(mutating).toHaveLength(1);
    expect(mutating[0].type).toBe("group");
  });

  test("cd-prefixed compound classifies by the real command", () => {
    const entries = groupActivitiesForDisplay([
      activity({ id: "a", toolName: "exec", text: "Ran cd /repo && grep -rn foo src" }),
      activity({ id: "b", toolName: "exec", text: "Ran cd /repo && wc -l package.json" }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("group");
  });

  test("truncated compound still classifies by its parseable stages", () => {
    const entries = groupActivitiesForDisplay([
      activity({ id: "a", toolName: "exec", text: 'Ran find src -type f -name "*.ts" -o -na...' }),
      activity({ id: "b", toolName: "exec", text: "Ran grep -rn cybara src ..." }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("group");
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
