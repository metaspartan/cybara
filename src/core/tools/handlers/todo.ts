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

export function readTodo(context?: ToolContext): TodoItem[] {
  return getState(context).items;
}

export function noteToolActivityForTodoReminder(
  toolName: string,
  context?: ToolContext
): string | null {
  const key = keyFor(context);
  if (toolName === "todo") {
    return null;
  }
  const items = sessionTodos[key]?.items ?? [];
  const pending = items.filter((item) => item.status === "pending").length;
  const inProgress = items.filter((item) => item.status === "in_progress").length;
  const incomplete = pending + inProgress;
  if (incomplete === 0) {
    return null;
  }
  return `Plan check: ${incomplete} item${incomplete === 1 ? "" : "s"} remain (${inProgress} in progress, ${pending} pending). Call todo before continuing: mark finished work completed, keep genuinely unfinished work pending, and leave at most one current item in progress. Before a final answer, reconcile the full plan so its statuses match the work actually delivered.`;
}
