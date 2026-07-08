import { describe, expect, test } from "bun:test";
import {
  extractLatestSessionPlan,
  normalizeSessionPlanItems,
  sanitizeTodoToolResult,
} from "../../src/core/session-plan";

describe("session plan snapshots", () => {
  test("extracts the latest todo tool call as a plan", () => {
    const plan = extractLatestSessionPlan("session-plan-1", [
      {
        timestamp: "2026-07-08T00:00:00.000Z",
        tool_calls: [
          {
            name: "todo",
            result: {
              items: [{ content: "older", status: "completed", priority: "low" }],
            },
          },
        ],
      },
      {
        timestamp: "2026-07-08T00:01:00.000Z",
        tool_calls: [
          {
            name: "todo",
            result: {
              items: [
                { content: "review route", status: "completed", priority: "high" },
                { content: "add UI card", status: "in_progress", priority: "medium" },
                { content: "run tests", status: "pending", priority: "medium" },
              ],
            },
          },
        ],
      },
    ]);

    expect(plan?.sessionId).toBe("session-plan-1");
    expect(plan?.updatedAt).toBe("2026-07-08T00:01:00.000Z");
    expect(plan?.summary).toEqual({ total: 3, pending: 1, inProgress: 1, completed: 1 });
    expect(plan?.items.map((item) => item.content)).toEqual([
      "review route",
      "add UI card",
      "run tests",
    ]);
  });

  test("sanitizes serialized todo results and defaults invalid fields", () => {
    const result = sanitizeTodoToolResult(
      JSON.stringify({
        items: [
          { content: "ship", status: "bogus", priority: "weird" },
          { content: "", status: "completed", priority: "high" },
        ],
        note: "n".repeat(500),
      })
    );

    expect(result?.items).toEqual([{ content: "ship", status: "pending", priority: "medium" }]);
    expect(result?.summary).toEqual({ total: 1, pending: 1, inProgress: 0, completed: 0 });
    expect(result?.note?.length).toBe(300);
  });

  test("falls back to todo args when a result is unavailable", () => {
    const plan = extractLatestSessionPlan("session-plan-2", [
      {
        timestamp: "2026-07-08T00:02:00.000Z",
        tool_calls: [
          {
            name: "todo",
            args: {
              items: [{ content: "from args", status: "pending", priority: "high" }],
            },
          },
        ],
      },
    ]);

    expect(plan?.items[0]).toEqual({
      content: "from args",
      status: "pending",
      priority: "high",
    });
  });

  test("ignores malformed later todo calls and keeps the latest valid plan", () => {
    const plan = extractLatestSessionPlan("session-plan-3", [
      {
        timestamp: "2026-07-08T00:02:00.000Z",
        tool_calls: [
          {
            name: "todo",
            result: {
              items: [{ content: "valid plan", status: "completed", priority: "high" }],
            },
          },
        ],
      },
      {
        timestamp: "2026-07-08T00:03:00.000Z",
        tool_calls: [
          { name: "todo", result: "not json" },
          { name: "todo", args: { items: [{ content: "   " }] } },
        ],
      },
    ]);

    expect(plan?.updatedAt).toBe("2026-07-08T00:02:00.000Z");
    expect(plan?.items).toEqual([{ content: "valid plan", status: "completed", priority: "high" }]);
  });

  test("fuzzes hostile item shapes without throwing or leaking unbounded output", () => {
    const hostileValues: unknown[] = [
      null,
      undefined,
      true,
      42,
      "plain text",
      '{"items": "not array"}',
      { items: [{ content: "x".repeat(2000), status: "done", priority: "urgent" }] },
      { items: Array.from({ length: 80 }, (_, index) => ({ content: `task-${index}` })) },
      { items: [{ content: "\u0000hidden", status: "in_progress", priority: "low" }] },
    ];

    for (let i = 0; i < 200; i += 1) {
      hostileValues.push({
        items: Array.from({ length: i % 73 }, (_, index) => ({
          content: index % 5 === 0 ? "" : `${index}-${"task".repeat((i + index) % 80)}`,
          status: index % 3 === 0 ? "completed" : index % 3 === 1 ? "in_progress" : "other",
          priority: index % 3 === 0 ? "high" : index % 3 === 1 ? "low" : "other",
        })),
      });
    }

    for (const value of hostileValues) {
      expect(() => sanitizeTodoToolResult(value)).not.toThrow();
      const result = sanitizeTodoToolResult(value);
      if (result) {
        expect(result.items.length).toBeLessThanOrEqual(50);
        for (const item of result.items) {
          expect(item.content.length).toBeLessThanOrEqual(500);
          expect(["pending", "in_progress", "completed"]).toContain(item.status);
          expect(["low", "medium", "high"]).toContain(item.priority);
        }
      }
    }
  });

  test("caps normalized plan items to bounded display-safe content", () => {
    const items = normalizeSessionPlanItems(
      Array.from({ length: 75 }, (_, index) => ({
        content: `${index}-${"x".repeat(700)}`,
        status: "completed",
        priority: "high",
      }))
    );

    expect(items).toHaveLength(50);
    expect(items[0]?.content.length).toBe(500);
    expect(items[49]?.content.startsWith("49-")).toBe(true);
  });
});
