import { describe, expect, test } from "bun:test";
import { sanitizeSessionMessages } from "../../src/api/routes/_shared";

describe("chat plan API sanitization", () => {
  test("keeps todo tool results structured in sanitized session messages", () => {
    const messages = sanitizeSessionMessages([
      {
        role: "assistant",
        content: "working",
        timestamp: "2026-07-08T00:00:00.000Z",
        tool_calls: [
          {
            id: "call-plan",
            name: "todo",
            args: {
              items: [{ content: "inspect", status: "in_progress", priority: "high" }],
            },
            status: "completed",
            result: {
              items: [
                { content: "inspect", status: "completed", priority: "high" },
                { content: "test", status: "pending", priority: "medium" },
              ],
              summary: { total: 2, pending: 1, inProgress: 0, completed: 1, cancelled: 0 },
              note: "Task list updated",
            },
          },
        ],
      },
    ]);

    const toolCall = messages[0]?.tool_calls?.[0];
    expect(toolCall?.name).toBe("todo");
    expect(toolCall?.result).toEqual({
      items: [
        { content: "inspect", status: "completed", priority: "high" },
        { content: "test", status: "pending", priority: "medium" },
      ],
      summary: { total: 2, pending: 1, inProgress: 0, completed: 1, cancelled: 0 },
      note: "Task list updated",
    });
  });
});
