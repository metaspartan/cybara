import { describe, expect, test } from "bun:test";
import { handleTodo, readTodo } from "../../src/core/tools/handlers/todo";
import type { ToolContext } from "../../src/core/tools/index";

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

  test("lets a model cancel stale work instead of resurrecting it forever", async () => {
    const ctx = context("cancel-stale");
    await handleTodo(
      {
        items: [
          { content: "Build widget", status: "in_progress", priority: "high" },
          { content: "Obsolete approach", status: "pending", priority: "medium" },
        ],
      },
      ctx
    );

    const result = await handleTodo(
      {
        items: [
          { content: "Build widget", status: "in_progress", priority: "high" },
          { content: "Obsolete approach", status: "cancelled", priority: "medium" },
        ],
      },
      ctx
    );

    expect(readTodo(ctx).map((item) => `${item.content}:${item.status}`)).toEqual([
      "Build widget:in_progress",
      "Obsolete approach:cancelled",
    ]);
    expect(result.summary.total).toBe(1);
    expect(result.summary.cancelled).toBe(1);
    expect(result.note).not.toContain("kept so the plan stays complete");
  });

  test("prunes a cancelled item once a later update omits it", async () => {
    const ctx = context("prune-cancelled");
    await handleTodo(
      {
        items: [
          { content: "Keep me", status: "pending", priority: "high" },
          { content: "Dead end", status: "cancelled", priority: "low" },
        ],
      },
      ctx
    );

    await handleTodo(
      { items: [{ content: "Keep me", status: "in_progress", priority: "high" }] },
      ctx
    );

    expect(readTodo(ctx).map((item) => item.content)).toEqual(["Keep me"]);
  });

  test("treats a reformatted item as the same entry", async () => {
    const ctx = context("reformatted");
    await handleTodo(
      { items: [{ content: "Write  the Migration", status: "pending", priority: "high" }] },
      ctx
    );

    await handleTodo(
      { items: [{ content: "write the migration.", status: "completed", priority: "high" }] },
      ctx
    );

    expect(readTodo(ctx).map((item) => `${item.content}:${item.status}`)).toEqual([
      "write the migration.:completed",
    ]);
  });

  test("collapses progress-annotated rewrites instead of stacking duplicates", async () => {
    const ctx = context("progress-rewrites");
    await handleTodo(
      {
        items: [
          { content: "Monitor training run", status: "in_progress", priority: "high" },
          { content: "Close residual gap", status: "pending", priority: "medium" },
        ],
      },
      ctx
    );

    for (const step of [1000, 1500, 2000, 2500]) {
      await handleTodo(
        {
          items: [
            {
              content: `Monitor training run (step ${step}/6000)`,
              status: "in_progress",
              priority: "high",
            },
            { content: "Close residual gap", status: "pending", priority: "medium" },
          ],
        },
        ctx
      );
    }

    expect(readTodo(ctx).map((item) => item.content)).toEqual([
      "Close residual gap",
      "Monitor training run (step 2500/6000)",
    ]);
  });

  test("drops an unfinished item the model omits a second time", async () => {
    const ctx = context("omitted-twice");
    await handleTodo(
      {
        items: [
          { content: "Keep me", status: "in_progress", priority: "high" },
          { content: "Stale backlog entry", status: "pending", priority: "low" },
        ],
      },
      ctx
    );

    const first = await handleTodo(
      { items: [{ content: "Keep me", status: "in_progress", priority: "high" }] },
      ctx
    );
    expect(readTodo(ctx).map((item) => item.content)).toEqual(["Keep me", "Stale backlog entry"]);
    expect(first.note).toContain("Stale backlog entry");

    await handleTodo(
      { items: [{ content: "Keep me", status: "in_progress", priority: "high" }] },
      ctx
    );
    expect(readTodo(ctx).map((item) => item.content)).toEqual(["Keep me"]);
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
