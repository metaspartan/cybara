import { describe, expect, test } from "bun:test";
import {
  buildActivitiesFromToolCalls,
  finalizeCompletedActivities,
  mergeActivityLists,
  normalizeActivityTextForPhase,
  type ToolCallLike,
} from "../../ui/src/lib/chatActivities";

function formatToolIntent(
  toolName: string,
  args: Record<string, unknown>,
  phase: "start" | "result" | "error"
): string {
  if (toolName === "file_search") {
    const pattern = typeof args.pattern === "string" ? args.pattern : "query";
    if (phase === "start") return `Searching for "${pattern}"`;
    if (phase === "result") return `Search complete for "${pattern}"`;
    return `Search failed for "${pattern}"`;
  }

  if (phase === "start") return `${toolName} running...`;
  if (phase === "result") return `${toolName} complete`;
  return `${toolName} failed`;
}

describe("chat activity lifecycle helpers", () => {
  test("normalizes progressive activity text for completed phases", () => {
    expect(normalizeActivityTextForPhase('Searching for "wallet"', "result")).toBe(
      'Searched for "wallet"'
    );
    expect(normalizeActivityTextForPhase("Exploring src/main.ts", "result")).toBe(
      "Explored src/main.ts"
    );
  });

  test("builds process activities from tool calls with status-aware phases", () => {
    const toolCalls: ToolCallLike[] = [
      { id: "1", name: "file_search", status: "completed", args: { pattern: "wallet" } },
      { id: "2", name: "exec", status: "pending", args: { command: "ls -la" } },
    ];
    const activities = buildActivitiesFromToolCalls(toolCalls, formatToolIntent);

    expect(activities).toHaveLength(2);
    expect(activities[0]?.phase).toBe("result");
    expect(activities[0]?.text).toBe('Search complete for "wallet"');
    expect(activities[1]?.phase).toBe("start");
    expect(activities[1]?.text).toContain("exec");
  });

  test("merges and deduplicates repeated activity items", () => {
    const merged = mergeActivityLists(
      [{ id: "a", phase: "result", text: "Search complete", timestamp: 1 }],
      [
        { id: "b", phase: "result", text: "Search complete", timestamp: 2 },
        { id: "c", phase: "error", text: "Search failed", timestamp: 3 },
      ]
    );

    expect(merged).toHaveLength(2);
    expect(merged[0]?.text).toBe("Search complete");
    expect(merged[1]?.text).toBe("Search failed");
  });

  test("finalizes lingering start items after an assistant response is complete", () => {
    const finalized = finalizeCompletedActivities([
      { id: "a", phase: "start", text: "Searching files...", timestamp: 1 },
      { id: "b", phase: "error", text: "Search failed", timestamp: 2 },
    ]);

    expect(finalized).toHaveLength(2);
    expect(finalized[0]?.phase).toBe("result");
    expect(finalized[0]?.text).toBe("Searched files...");
    expect(finalized[1]?.phase).toBe("error");
  });
});
