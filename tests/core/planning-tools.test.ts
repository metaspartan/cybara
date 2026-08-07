import { describe, expect, test } from "bun:test";
import { handleClarify } from "../../src/core/tools/handlers/clarify";
import { handleTodo, noteToolActivityForTodoReminder } from "../../src/core/tools/handlers/todo";

describe("todo stale-plan reminder", () => {
  test("reminds after each tool result while a plan is incomplete", async () => {
    const context = { sessionId: "todo-reminder-session" };
    await handleTodo(
      {
        items: [
          { content: "step one", status: "in_progress", priority: "high" },
          { content: "step two", status: "pending", priority: "medium" },
        ],
      },
      context
    );
    const reminder = noteToolActivityForTodoReminder("exec", context);
    expect(reminder).toContain("2 items remain");
    expect(reminder).toContain("todo");
    expect(reminder).toContain("genuinely unfinished work pending");
    expect(noteToolActivityForTodoReminder("exec", context)).toContain("2 items remain");
  });

  test("todo calls and completed lists suppress the reminder", async () => {
    const context = { sessionId: "todo-reminder-complete" };
    await handleTodo(
      {
        items: [{ content: "only step", status: "in_progress", priority: "high" }],
      },
      context
    );
    expect(noteToolActivityForTodoReminder("todo", context)).toBeNull();
    await handleTodo(
      {
        items: [{ content: "only step", status: "completed", priority: "high" }],
      },
      context
    );
    for (let call = 0; call < 12; call += 1) {
      expect(noteToolActivityForTodoReminder("exec", context)).toBeNull();
    }
  });

  test("sessions without a todo list never get reminders", () => {
    const context = { sessionId: "todo-reminder-empty" };
    for (let call = 0; call < 12; call += 1) {
      expect(noteToolActivityForTodoReminder("exec", context)).toBeNull();
    }
  });
});

describe("todo tool", () => {
  test("dedupes multiple in_progress items down to one", async () => {
    const result = await handleTodo(
      {
        items: [
          { content: "a", status: "in_progress", priority: "high" },
          { content: "b", status: "in_progress", priority: "medium" },
          { content: "c", status: "in_progress", priority: "low" },
        ],
      },
      { sessionId: "todo-dedupe" }
    );
    expect(result.summary.inProgress).toBe(1);
    expect(result.summary.total).toBe(3);
  });

  test("counts statuses correctly", async () => {
    const result = await handleTodo(
      {
        items: [
          { content: "done1", status: "completed", priority: "high" },
          { content: "active", status: "in_progress", priority: "high" },
          { content: "later", status: "pending", priority: "medium" },
          { content: "later2", status: "pending", priority: "low" },
        ],
      },
      { sessionId: "todo-counts" }
    );
    expect(result.summary).toEqual({
      total: 4,
      pending: 2,
      inProgress: 1,
      completed: 1,
      cancelled: 0,
    });
  });

  test("defaults unknown status/priority to pending/medium", async () => {
    const result = await handleTodo(
      {
        items: [{ content: "x", status: "bogus", priority: "nope" }],
      },
      { sessionId: "todo-defaults" }
    );
    expect(result.items[0].status).toBe("pending");
    expect(result.items[0].priority).toBe("medium");
  });

  test("skips items with empty content", async () => {
    const result = await handleTodo(
      {
        items: [
          { content: "", status: "pending", priority: "medium" },
          { content: "real", status: "pending", priority: "medium" },
        ],
      },
      { sessionId: "todo-empty-content" }
    );
    expect(result.summary.total).toBe(1);
  });

  test("returns a guidance note", async () => {
    const result = await handleTodo({ items: [] }, { sessionId: "todo-guidance" });
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
