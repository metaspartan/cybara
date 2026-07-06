import { describe, expect, test } from "bun:test";
import {
  groupMobileActivities,
  type MobileWorkActivity,
} from "../../apps/mobile/src/lib/chat-format";

function activity(overrides: Partial<MobileWorkActivity> & { id: string }): MobileWorkActivity {
  return {
    phase: "result",
    text: "Explored file.ts",
    timestamp: 1,
    ...overrides,
  };
}

// Mobile parity with the web/Tauri Codex-style grouping
// (tests/ui/chat-activity-grouping.test.ts): same rules, same labels.
describe("groupMobileActivities", () => {
  test("collapses consecutive reads into 'Read N files'", () => {
    const entries = groupMobileActivities([
      activity({ id: "a", toolName: "read", text: "Explored a.ts" }),
      activity({ id: "b", toolName: "read", text: "Explored b.ts" }),
      activity({ id: "c", toolName: "read", text: "Explored c.ts" }),
    ]);
    expect(entries).toHaveLength(1);
    const group = entries[0];
    if (group.type !== "group") throw new Error("expected group");
    expect(group.label).toBe("Read 3 files");
  });

  test("read-only shell commands (incl. git shortlog, cd/xargs) group", () => {
    const entries = groupMobileActivities([
      activity({ id: "a", toolName: "exec", text: "Ran ls -la" }),
      activity({ id: "b", toolName: "exec", text: "Ran git shortlog -sn --all" }),
      activity({ id: "c", toolName: "exec", text: "Ran cd /repo && grep -rn foo src" }),
      activity({ id: "d", toolName: "exec", text: 'Ran find src -name "*.ts" | xargs wc -l' }),
    ]);
    expect(entries).toHaveLength(1);
    const group = entries[0];
    if (group.type !== "group") throw new Error("expected group");
    expect(group.label).toBe("Ran 4 commands");
  });

  test("interleaved thoughts stay visible between command groups", () => {
    const entries = groupMobileActivities([
      activity({ id: "a", toolName: "exec", text: "Ran ls" }),
      activity({ id: "b", toolName: "grep", text: "Explored 5 files, 1 search" }),
      activity({ id: "t", toolName: "__thought", text: "Context automatically compacted" }),
      activity({ id: "c", toolName: "exec", text: "Ran cd /repo && wc -l package.json" }),
      activity({ id: "d", toolName: "exec", text: "Ran git log --oneline" }),
    ]);
    expect(entries.map((entry) => entry.type)).toEqual(["group", "single", "group"]);
    const group = entries[0];
    if (group.type !== "group") throw new Error("expected group");
    expect(group.label).toBe("Ran 2 commands");
    expect(group.items.map((item) => item.id)).toEqual(["a", "b"]);
    const thought = entries[1];
    if (thought.type !== "single") throw new Error("expected thought");
    expect(thought.activity.toolName).toBe("__thought");
    expect(thought.activity.text).toBe("Context automatically compacted");
    const finalGroup = entries[2];
    if (finalGroup.type !== "group") throw new Error("expected final group");
    expect(finalGroup.label).toBe("Ran 2 commands");
  });

  test("mutations and in-flight/failure steps never group", () => {
    const entries = groupMobileActivities([
      activity({ id: "a", toolName: "exec", text: "Ran git commit -m x" }),
      activity({ id: "b", toolName: "read", phase: "start", text: "Exploring a.ts" }),
      activity({ id: "c", toolName: "read", phase: "error", text: "Read failed for b.ts" }),
    ]);
    expect(entries.map((entry) => entry.type)).toEqual(["single", "single", "single"]);
  });
});
