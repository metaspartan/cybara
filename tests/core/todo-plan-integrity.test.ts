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
      "Write migration",
      "Add tests",
      "Update docs",
    ]);
    expect(readTodo(ctx).find((item) => item.content === "Write migration")?.status).toBe(
      "completed"
    );
    expect(result.note).toContain("Add tests");
    expect(result.note).toContain("Update docs");
  });

  test("keeps unfinished work even when the update also adds new work", async () => {
    const ctx = context("adds-new-work");
    await handleTodo(
      {
        items: [
          { content: "A", status: "pending", priority: "high" },
          { content: "B", status: "pending", priority: "high" },
        ],
      },
      ctx
    );

    await handleTodo(
      {
        items: [
          { content: "A", status: "completed", priority: "high" },
          { content: "C", status: "pending", priority: "high" },
        ],
      },
      ctx
    );

    expect(readTodo(ctx).map((item) => `${item.content}:${item.status}`)).toEqual([
      "A:completed",
      "B:pending",
      "C:pending",
    ]);
  });

  test("does not resurrect a completed item the model pruned alongside other edits", async () => {
    const ctx = context("prune-with-edits");
    await handleTodo(
      {
        items: [
          { content: "A", status: "completed", priority: "low" },
          { content: "B", status: "pending", priority: "high" },
          { content: "C", status: "pending", priority: "high" },
        ],
      },
      ctx
    );

    await handleTodo({ items: [{ content: "B", status: "completed", priority: "high" }] }, ctx);

    expect(readTodo(ctx).map((item) => item.content)).toEqual(["B", "C"]);
  });

  test("a rewrite replaces cleanly once the old work is marked finished", async () => {
    const ctx = context("full-rewrite");
    await handleTodo(
      {
        items: [
          { content: "Old A", status: "completed", priority: "high" },
          { content: "Old B", status: "completed", priority: "high" },
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
