/**
 * `todo` tool — a session-scoped task list with status discipline.
 *
 * A structured list of tasks, each pending/in_progress/completed,
 * with a "max one in_progress at a time" rule. Surfacing a plan to the model
 * measurably improves multi-step task quality and reduces drift.
 *
 * State is held in-memory keyed by sessionId (matching how subagents/sessions
 * are tracked elsewhere). When no sessionId is present, a singleton list is
 * used so the tool still works in single-shot CLI invocations.
 */
import type { ToolContext } from "../index";

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  content: string;
  status: TodoStatus;
  priority: "high" | "medium" | "low";
}

export interface TodoState {
  items: TodoItem[];
  updatedAt: number;
}

/** Internal representation; status is derived from items for the model. */
type SessionTodos = Record<string, TodoState>;

const sessionTodos: SessionTodos = {};

const NO_SESSION_KEY = "__default__";

function keyFor(context?: ToolContext): string {
  return context?.sessionId || NO_SESSION_KEY;
}

function getState(context?: ToolContext): TodoState {
  const key = keyFor(context);
  if (!sessionTodos[key]) {
    sessionTodos[key] = { items: [], updatedAt: Date.now() };
  }
  return sessionTodos[key];
}

/**
 * Replace the entire task list (the model sends the full list each call, like
 * TodoWrite / update_plan). Enforces status discipline: only one item may be
 * `in_progress`; if more than one is marked in_progress, the first is kept and
 * the rest are demoted to `pending`.
 */
export async function handleTodo(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<{
  items: TodoItem[];
  summary: { total: number; pending: number; inProgress: number; completed: number };
  note?: string;
}> {
  const rawItems = Array.isArray(args.items) ? (args.items as unknown[]) : [];
  const items: TodoItem[] = [];
  const validStatuses: TodoStatus[] = ["pending", "in_progress", "completed"];
  const validPriorities = ["high", "medium", "low"] as const;

  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const content = typeof obj.content === "string" ? obj.content.trim() : "";
    if (!content) continue;
    const status = validStatuses.includes(obj.status as TodoStatus)
      ? (obj.status as TodoStatus)
      : "pending";
    const priority = (validPriorities as readonly string[]).includes(obj.priority as string)
      ? (obj.priority as TodoItem["priority"])
      : "medium";
    items.push({ content, status, priority });
  }

  // Enforce "max one in_progress".
  let inProgressSeen = false;
  for (const item of items) {
    if (item.status === "in_progress") {
      if (inProgressSeen) {
        item.status = "pending";
      } else {
        inProgressSeen = true;
      }
    }
  }

  const state = getState(context);
  state.items = items;
  state.updatedAt = Date.now();

  const summary = {
    total: items.length,
    pending: items.filter((i) => i.status === "pending").length,
    inProgress: items.filter((i) => i.status === "in_progress").length,
    completed: items.filter((i) => i.status === "completed").length,
  };

  return {
    items,
    summary,
    note: "Task list updated. Keep at most one item in_progress at a time. Use this list to track multi-step work and avoid drift. When all work is done, send a final update with every item marked completed before giving your answer.",
  };
}

/** Read the current list without mutating it (used by UI / status tooling). */
export function readTodo(context?: ToolContext): TodoItem[] {
  return getState(context).items;
}

const TODO_REMINDER_INTERVAL = 6;
const toolCallsSinceTodoUpdate = new Map<string, number>();

/**
 * Called for every executed tool. Returns a reminder string when the session
 * has an incomplete todo list and the model hasn't touched it for a while, so
 * plans get reconciled instead of freezing at "1/7 complete" after the work is
 * actually done.
 */
export function noteToolActivityForTodoReminder(
  toolName: string,
  context?: ToolContext
): string | null {
  const key = keyFor(context);
  if (toolName === "todo") {
    toolCallsSinceTodoUpdate.set(key, 0);
    return null;
  }
  const items = sessionTodos[key]?.items ?? [];
  const pending = items.filter((item) => item.status === "pending").length;
  const inProgress = items.filter((item) => item.status === "in_progress").length;
  const incomplete = pending + inProgress;
  if (incomplete === 0) {
    toolCallsSinceTodoUpdate.delete(key);
    return null;
  }
  const count = (toolCallsSinceTodoUpdate.get(key) ?? 0) + 1;
  if (count < TODO_REMINDER_INTERVAL) {
    toolCallsSinceTodoUpdate.set(key, count);
    return null;
  }
  toolCallsSinceTodoUpdate.set(key, 0);
  return `Your todo list has ${incomplete} item${incomplete === 1 ? "" : "s"} not marked completed (${inProgress} in_progress, ${pending} pending). Update it with the todo tool now: mark finished items completed, set the current item in_progress, and before giving your final answer make sure every finished item is marked completed.`;
}
