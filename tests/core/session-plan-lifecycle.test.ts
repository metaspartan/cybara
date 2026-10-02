import { afterEach, describe, expect, test } from "bun:test";
import {
  beginSessionPlanTurn,
  deleteSessionPlan,
  finishSessionPlanTurn,
  readSessionPlan,
  recordSessionPlan,
  resetSessionPlanFromMessages,
} from "../../src/core/session-plan-store";
import { extractLatestSessionPlan, sanitizeTodoToolResult } from "../../src/core/session-plan";
import { onStatusStream } from "../../src/core/status";
import { handleTodo } from "../../src/core/tools/handlers/todo";
import type { TodoItem } from "../../src/core/tools/handlers/todo";

const ids: string[] = [];
function session(): string {
  const id = `plan-lifecycle-${crypto.randomUUID()}`;
  ids.push(id);
  return id;
}
afterEach(() => {
  for (const id of ids.splice(0)) deleteSessionPlan(id);
});
const items: TodoItem[] = [
  { content: "Inspect fixture", status: "completed", priority: "high" },
  { content: "Verify output", status: "in_progress", priority: "high" },
];

describe("durable ordered plan lifecycle", () => {
  test("publishes each authoritative update with a monotonic revision and preserves metadata", () => {
    const id = session();
    beginSessionPlanTurn(id);
    const observed: number[] = [];
    const stop = onStatusStream((event) => {
      if (event.type === "session_plan" && event.sessionId === id)
        observed.push(event.plan.revision ?? 0);
    });
    try {
      const first = recordSessionPlan(id, items, "writer");
      const second = recordSessionPlan(
        id,
        items.map((item) => ({ ...item, status: "completed" })),
        "writer"
      );
      expect(first.lifecycle).toBe("active");
      expect(second.lifecycle).toBe("completed");
      expect(second.revision).toBe((first.revision ?? 0) + 1);
      expect(observed).toEqual([first.revision ?? 0, second.revision ?? 0]);
      expect(readSessionPlan(id, [])).toEqual(second);
      expect(sanitizeTodoToolResult(second)).toMatchObject({
        revision: second.revision,
        updatedAt: second.updatedAt,
        lifecycle: "completed",
      });
    } finally {
      stop();
    }
  });

  test("ending without a final update keeps unfinished tasks honest but never looks actively stuck", () => {
    const id = session();
    beginSessionPlanTurn(id);
    const first = recordSessionPlan(id, items);
    const ended = finishSessionPlanTurn(id, "ended");
    expect(ended?.lifecycle).toBe("needs_update");
    expect(ended?.items).toEqual(items);
    expect(ended?.revision).toBe((first.revision ?? 0) + 1);
    expect(readSessionPlan(id, [])?.lifecycle).toBe("needs_update");
    expect(finishSessionPlanTurn(id, "ended")?.revision).toBe(ended?.revision);
  });

  test("stop and inactive recovery retain actionable unfinished items without fabricated completion", () => {
    const id = session();
    const first = recordSessionPlan(id, items);
    const recovered = readSessionPlan(id, []);
    expect(recovered?.lifecycle).toBe("paused");
    expect(recovered?.revision).toBe((first.revision ?? 0) + 1);
    beginSessionPlanTurn(id);
    const resumed = recordSessionPlan(id, items);
    expect(readSessionPlan(id, [])?.lifecycle).toBe("active");
    expect(finishSessionPlanTurn(id, "paused")?.lifecycle).toBe("paused");
    expect(readSessionPlan(id, [])?.items[1]?.status).toBe("in_progress");
    expect(readSessionPlan(id, [])?.revision).toBe((resumed.revision ?? 0) + 1);
  });

  test("cleared and cancelled plans remain terminal and never resurrect transcript work", () => {
    const id = session();
    beginSessionPlanTurn(id);
    recordSessionPlan(id, items);
    const cancelled = recordSessionPlan(
      id,
      items.map((item) => ({ ...item, status: "cancelled" }))
    );
    expect(cancelled.lifecycle).toBe("completed");
    expect(cancelled.summary.total).toBe(0);
    const cleared = recordSessionPlan(id, []);
    expect(readSessionPlan(id, [{ tool_calls: [{ name: "todo", result: { items } }] }])).toEqual(
      cleared
    );
    expect(cleared.lifecycle).toBe("cleared");
  });

  test("rejects failed or still executing todo arguments and orders canonical revisions instead of array position", () => {
    const id = session();
    const messages = [
      {
        timestamp: "2026-10-01T10:00:00Z",
        tool_calls: [
          {
            name: "todo",
            status: "completed",
            result: { items, revision: 5, updatedAt: "2026-10-01T10:01:00Z" },
          },
          {
            name: "todo",
            status: "completed",
            result: { items: [{ content: "old", status: "pending" }], revision: 4 },
          },
          {
            name: "todo",
            status: "failed",
            args: { items: [{ content: "false completion", status: "completed" }] },
          },
        ],
      },
    ];
    expect(extractLatestSessionPlan(id, messages)?.revision).toBe(5);
    expect(extractLatestSessionPlan(id, messages)?.updatedAt).toBe("2026-10-01T10:01:00Z");
    for (const status of ["pending", "executing", "failed", "error", "blocked"])
      expect(
        extractLatestSessionPlan(id, [{ tool_calls: [{ name: "todo", status, args: { items } }] }])
      ).toBeNull();
  });
});

test("late cancelled or malformed plan updates never erase the authoritative plan", async () => {
  const id = session();
  beginSessionPlanTurn(id);
  recordSessionPlan(id, items);
  const controller = new AbortController();
  controller.abort();
  await expect(
    handleTodo({ items: [] }, { sessionId: id, abortSignal: controller.signal })
  ).rejects.toThrow("cancelled");
  await expect(handleTodo({}, { sessionId: id })).rejects.toThrow("array");
  await expect(handleTodo({ items: [null, {}] }, { sessionId: id })).rejects.toThrow("valid items");
  expect(readSessionPlan(id, [])?.items).toEqual(items);
});

test("rewinding messages publishes a newer revision and preserves only the retained plan", () => {
  const id = session();
  beginSessionPlanTurn(id);
  const first = recordSessionPlan(id, items);
  const second = recordSessionPlan(id, [
    { content: "Later work", status: "completed", priority: "high" },
  ]);
  const rewound = resetSessionPlanFromMessages(id, [
    { tool_calls: [{ name: "todo", status: "completed", result: first }] },
  ]);
  expect(rewound.revision).toBe((second.revision ?? 0) + 1);
  expect(rewound.items).toEqual(items);
  expect(rewound.lifecycle).toBe("paused");
  const cleared = resetSessionPlanFromMessages(id, []);
  expect(cleared.lifecycle).toBe("cleared");
  expect(cleared.items).toEqual([]);
  expect(cleared.revision).toBe((rewound.revision ?? 0) + 1);
  expect(readSessionPlan(id, [])?.revision).toBe(cleared.revision);
});
