import { describe, expect, test } from "bun:test";
import { groupSharedActivities, type SharedActivityItem } from "../../shared/chat-activity-groups";

describe("shared chat activity groups", () => {
  test("folds consecutive image views into their own labelled group", () => {
    const activities: SharedActivityItem[] = [
      { id: "a", phase: "result", text: "Ran ls", toolName: "exec" },
      { id: "b", phase: "result", text: "Viewed an image", toolName: "image" },
      { id: "c", phase: "result", text: "Viewed an image", toolName: "image" },
      { id: "d", phase: "result", text: "Viewed an image", toolName: "image" },
      { id: "e", phase: "result", text: "Ran pwd", toolName: "exec" },
    ];
    const entries = groupSharedActivities(activities);
    expect(
      entries.map((entry) => (entry.type === "group" ? entry.label : entry.activity.id))
    ).toEqual(["a", "Viewed 3 images", "e"]);
    const group = entries[1];
    expect(group.type === "group" && group.kind).toBe("view");
    expect(group.type === "group" && group.items.map((item) => item.id)).toEqual(["b", "c", "d"]);
  });

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
