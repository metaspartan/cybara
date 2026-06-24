import { describe, expect, test } from "bun:test";
import { handleTodo } from "../../src/core/tools/handlers/todo";
import { handleClarify } from "../../src/core/tools/handlers/clarify";

describe("todo tool", () => {
  test("dedupes multiple in_progress items down to one", async () => {
    const result = await handleTodo({
      items: [
        { content: "a", status: "in_progress", priority: "high" },
        { content: "b", status: "in_progress", priority: "medium" },
        { content: "c", status: "in_progress", priority: "low" },
      ],
    });
    expect(result.summary.inProgress).toBe(1);
    expect(result.summary.total).toBe(3);
  });

  test("counts statuses correctly", async () => {
    const result = await handleTodo({
      items: [
        { content: "done1", status: "completed", priority: "high" },
        { content: "active", status: "in_progress", priority: "high" },
        { content: "later", status: "pending", priority: "medium" },
        { content: "later2", status: "pending", priority: "low" },
      ],
    });
    expect(result.summary).toEqual({ total: 4, pending: 2, inProgress: 1, completed: 1 });
  });

  test("defaults unknown status/priority to pending/medium", async () => {
    const result = await handleTodo({
      items: [{ content: "x", status: "bogus", priority: "nope" }],
    });
    expect(result.items[0].status).toBe("pending");
    expect(result.items[0].priority).toBe("medium");
  });

  test("skips items with empty content", async () => {
    const result = await handleTodo({
      items: [
        { content: "", status: "pending", priority: "medium" },
        { content: "real", status: "pending", priority: "medium" },
      ],
    });
    expect(result.summary.total).toBe(1);
  });

  test("returns a guidance note", async () => {
    const result = await handleTodo({ items: [] });
    expect(typeof result.note).toBe("string");
    expect(result.summary.total).toBe(0);
  });
});

describe("clarify tool", () => {
  test("builds a multiple-choice question", async () => {
    const result = await handleClarify({
      question: "Which approach?",
      options: [{ label: "A" }, { label: "B", description: "second option" }],
    });
    expect(result.question).toBe("Which approach?");
    expect(result.options?.length).toBe(2);
    expect(result.options?.[1].description).toBe("second option");
    expect(result.awaiting).toBe("user");
  });

  test("builds an open-ended question when no options are given", async () => {
    const result = await handleClarify({ question: "What do you want?" });
    expect(result.options).toBeUndefined();
  });

  test("caps options at 4 and ignores malformed ones", async () => {
    const result = await handleClarify({
      question: "q",
      options: [
        { label: "1" },
        { label: "2" },
        { label: "3" },
        { label: "4" },
        { label: "5" },
        { description: "no label" },
        "not-an-object",
      ] as never,
    });
    expect(result.options?.length).toBe(4);
  });

  test("throws when no question is provided", async () => {
    await expect(handleClarify({ question: "" })).rejects.toThrow(/question/i);
    await expect(handleClarify({})).rejects.toThrow(/question/i);
  });

  test("passes through header and multiSelect", async () => {
    const result = await handleClarify({
      question: "q",
      header: "Approach",
      multiSelect: true,
      options: [{ label: "A" }],
    });
    expect(result.header).toBe("Approach");
    expect(result.multiSelect).toBe(true);
  });
});
