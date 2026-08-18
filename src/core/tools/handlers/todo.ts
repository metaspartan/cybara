import type { ToolContext } from "../index";

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface TodoItem {
  content: string;
  status: TodoStatus;
  priority: "high" | "medium" | "low";
}

export interface TodoState {
  items: TodoItem[];
  updatedAt: number;
  restoredKeys: Set<string>;
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
    sessionTodos[key] = { items: [], updatedAt: Date.now(), restoredKeys: new Set() };
  }
  return sessionTodos[key];
}

function identityKey(content: string): string {
  return content
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const REWORD_SIMILARITY_THRESHOLD = 0.6;

function tokenSet(content: string): Set<string> {
  return new Set(identityKey(content).split(" ").filter(Boolean));
}

function similarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  return shared / (left.size + right.size - shared);
}

export async function handleTodo(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<{
  items: TodoItem[];
  summary: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    cancelled: number;
  };
  note?: string;
}> {
  const rawItems = Array.isArray(args.items) ? (args.items as unknown[]) : [];
  const items: TodoItem[] = [];
  const validStatuses: TodoStatus[] = ["pending", "in_progress", "completed", "cancelled"];
  const validPriorities = ["high", "medium", "low"] as const;

  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const content = typeof obj.content === "string" ? obj.content.trim() : "";
    if (!content) continue;
    const rawStatus = obj.status === "canceled" ? "cancelled" : obj.status;
    const status = validStatuses.includes(rawStatus as TodoStatus)
      ? (rawStatus as TodoStatus)
      : "pending";
    const priority = (validPriorities as readonly string[]).includes(obj.priority as string)
      ? (obj.priority as TodoItem["priority"])
      : "medium";
    items.push({ content, status, priority });
  }

  const isSettled = (status: TodoStatus) => status === "completed" || status === "cancelled";

  const state = getState(context);
  const effectiveKey = new Map<TodoItem, string>();
  const incoming = new Map<string, TodoItem>();
  for (const item of items) {
    const key = identityKey(item.content);
    effectiveKey.set(item, key);
    incoming.set(key, item);
  }

  const previousKeys = new Set(state.items.map((previous) => identityKey(previous.content)));
  const claimed = new Set<TodoItem>();
  for (const previous of state.items) {
    const previousKey = identityKey(previous.content);
    if (incoming.has(previousKey)) continue;
    const previousTokens = tokenSet(previous.content);
    let best: TodoItem | undefined;
    let bestScore = REWORD_SIMILARITY_THRESHOLD;
    for (const candidate of items) {
      if (claimed.has(candidate)) continue;
      if (previousKeys.has(effectiveKey.get(candidate) as string)) continue;
      const score = similarity(previousTokens, tokenSet(candidate.content));
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (!best) continue;
    claimed.add(best);
    incoming.delete(effectiveKey.get(best) as string);
    effectiveKey.set(best, previousKey);
    incoming.set(previousKey, best);
  }

  const droppedIncomplete =
    items.length === 0
      ? []
      : state.items.filter(
          (previous) => !isSettled(previous.status) && !incoming.has(identityKey(previous.content))
        );
  const restored = droppedIncomplete.filter(
    (previous) => !state.restoredKeys.has(identityKey(previous.content))
  );
  const restoredKeys = new Set(restored.map((previous) => identityKey(previous.content)));

  const merged: TodoItem[] = [];
  const emitted = new Set<string>();
  for (const previous of state.items) {
    const key = identityKey(previous.content);
    if (emitted.has(key)) continue;
    const update = incoming.get(key);
    if (update) {
      merged.push(update);
      emitted.add(key);
    } else if (restoredKeys.has(key)) {
      merged.push(previous);
      emitted.add(key);
    }
  }
  for (const item of items) {
    const key = effectiveKey.get(item) as string;
    if (emitted.has(key)) continue;
    merged.push(item);
    emitted.add(key);
  }
  items.length = 0;
  items.push(...merged);
  state.restoredKeys = restoredKeys;

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

  state.items = items;
  state.updatedAt = Date.now();

  const cancelled = items.filter((i) => i.status === "cancelled").length;
  const summary = {
    total: items.length - cancelled,
    pending: items.filter((i) => i.status === "pending").length,
    inProgress: items.filter((i) => i.status === "in_progress").length,
    completed: items.filter((i) => i.status === "completed").length,
    cancelled,
  };

  const restoredNote = restored.length
    ? ` This update left out ${restored.length} unfinished item${restored.length === 1 ? "" : "s"} (${restored.map((item) => item.content).join("; ")}), kept this once in case the omission was accidental. Send the full list; to retire work, mark it completed (done) or cancelled (obsolete or no longer needed). If you omit these again on the next update they will be dropped.`
    : "";

  return {
    items,
    summary,
    note:
      "Task list updated. Keep at most one item in_progress at a time. Use this list to track multi-step work and avoid drift. Mark items cancelled when they become obsolete or out of scope. When all work is done, send a final update with every remaining item marked completed or cancelled before giving your answer." +
      restoredNote,
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
