import { describe, expect, test } from "bun:test";
import type { ToolContext } from "../../src/core/tools/index";
import { handleTodo, readTodo } from "../../src/core/tools/handlers/todo";

function context(sessionId: string): ToolContext {
  return { sessionId } as ToolContext;
}

describe("todo plan integrity", () => {
  test("keeps unfinished work when a model resends only the item it changed", async () => {
    const ctx = context("partial-update");
    await handleTodo(
      {
        items: [
          { content: "Design schema", status: "completed", priority: "high" },
          { content: "Write migration", status: "in_progress", priority: "high" },
          { content: "Add tests", status: "pending", priority: "medium" },
          { content: "Update docs", status: "pending", priority: "low" },
        ],
      },
      ctx
    );

    const result = await handleTodo(
      { items: [{ content: "Write migration", status: "completed", priority: "high" }] },
      ctx
    );

    expect(readTodo(ctx).map((item) => item.content)).toEqual([
      "Design schema",
      "Write migration",
      "Add tests",
      "Update docs",
    ]);
    expect(readTodo(ctx).find((item) => item.content === "Write migration")?.status).toBe(
      "completed"
    );
    expect(result.summary.total).toBe(4);
    expect(result.note).toContain("Add tests");
  });

  test("still lets a model rewrite the plan when it introduces new work", async () => {
    const ctx = context("full-rewrite");
    await handleTodo(
      {
        items: [
          { content: "Old A", status: "pending", priority: "high" },
          { content: "Old B", status: "in_progress", priority: "high" },
        ],
      },
      ctx
    );

    await handleTodo(
      { items: [{ content: "Brand new plan", status: "in_progress", priority: "high" }] },
      ctx
    );

    expect(readTodo(ctx).map((item) => item.content)).toEqual(["Brand new plan"]);
  });

  test("still lets a model prune items it already finished", async () => {
    const ctx = context("prune-completed");
    await handleTodo(
      {
        items: [
          { content: "Done thing", status: "completed", priority: "low" },
          { content: "Live thing", status: "in_progress", priority: "high" },
        ],
      },
      ctx
    );

    await handleTodo(
      { items: [{ content: "Live thing", status: "in_progress", priority: "high" }] },
      ctx
    );

    expect(readTodo(ctx).map((item) => item.content)).toEqual(["Live thing"]);
  });
});
