import { describe, expect, test } from "bun:test";
import { groupSharedActivities, type SharedActivityItem } from "../../shared/chat-activity-groups";

describe("shared chat activity groups", () => {
  test("assigns stable distinct ids when source activity ids are empty", () => {
    const activities: SharedActivityItem[] = [
      { id: "", phase: "result", text: "Read first", toolName: "read" },
      { id: "", phase: "result", text: "Read second", toolName: "read" },
      { id: "thought", phase: "result", text: "Checking", toolName: "__thought" },
      { id: "", phase: "result", text: "Ran first", toolName: "exec" },
      { id: "", phase: "result", text: "Ran second", toolName: "exec" },
    ];

    const groups = groupSharedActivities(activities).filter((entry) => entry.type === "group");

    expect(groups.map((group) => group.id)).toEqual(["activity-group-0", "activity-group-3"]);
    expect(new Set(groups.map((group) => group.id)).size).toBe(groups.length);
  });
});
