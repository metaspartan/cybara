import {
  createTask,
  getTask,
  listTasks,
  updateTaskStatus,
  linkTasks,
  addComment,
  getComments,
  type KanbanStatus,
  type KanbanTask,
} from "../../kanban";

const VALID_STATUSES = new Set<KanbanStatus>([
  "triage",
  "todo",
  "ready",
  "running",
  "blocked",
  "done",
  "archived",
]);

function summarize(task: KanbanTask) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    assignee: task.assignee,
    priority: task.priority,
    parents: task.parent_ids,
    children: task.child_ids,
    result: task.result,
    consecutive_failures: task.consecutive_failures,
  };
}

export async function handleKanbanShow(
  args: Record<string, unknown>
): Promise<{ task: ReturnType<typeof summarize> | null; comments: unknown[] }> {
  const id = typeof args.id === "string" ? args.id : "";
  if (!id) throw new Error("Validation error: 'id' is required.");
  const task = getTask(id);
  if (!task) return { task: null, comments: [] };
  return { task: summarize(task), comments: getComments(id) };
}

export async function handleKanbanList(
  args: Record<string, unknown>
): Promise<{ tasks: Array<ReturnType<typeof summarize>> }> {
  const status = typeof args.status === "string" ? (args.status as KanbanStatus) : undefined;
  const assignee = typeof args.assignee === "string" ? args.assignee : undefined;
  const limit = typeof args.limit === "number" ? args.limit : undefined;
  const tasks = listTasks({ status, assignee, limit });
  return { tasks: tasks.map(summarize) };
}

export async function handleKanbanComplete(
  args: Record<string, unknown>
): Promise<{ task: ReturnType<typeof summarize> | null }> {
  const id = typeof args.id === "string" ? args.id : "";
  const result = typeof args.result === "string" ? args.result : undefined;
  if (!id) throw new Error("Validation error: 'id' is required.");
  const task = updateTaskStatus(id, "done", result);
  return { task: task ? summarize(task) : null };
}

export async function handleKanbanBlock(
  args: Record<string, unknown>
): Promise<{ task: ReturnType<typeof summarize> | null }> {
  const id = typeof args.id === "string" ? args.id : "";
  const reason = typeof args.reason === "string" ? args.reason : undefined;
  if (!id) throw new Error("Validation error: 'id' is required.");
  const task = updateTaskStatus(id, "blocked");
  if (task && reason) addComment(id, "agent", `Blocked: ${reason}`);
  return { task: task ? summarize(task) : null };
}

export async function handleKanbanHeartbeat(
  args: Record<string, unknown>
): Promise<{ ok: boolean }> {
  const id = typeof args.id === "string" ? args.id : "";
  if (!id) throw new Error("Validation error: 'id' is required.");
  return { ok: getTask(id)?.status === "running" };
}

export async function handleKanbanComment(args: Record<string, unknown>): Promise<{ ok: boolean }> {
  const id = typeof args.id === "string" ? args.id : "";
  const body = typeof args.body === "string" ? args.body : "";
  const author = typeof args.author === "string" ? args.author : "agent";
  if (!id || !body) throw new Error("Validation error: 'id' and 'body' are required.");
  return { ok: addComment(id, author, body) };
}

export async function handleKanbanCreate(
  args: Record<string, unknown>
): Promise<{ task: ReturnType<typeof summarize> }> {
  const title = typeof args.title === "string" ? args.title : "";
  if (!title) throw new Error("Validation error: 'title' is required.");
  const parentIds = Array.isArray(args.parents)
    ? (args.parents as unknown[]).filter((p): p is string => typeof p === "string")
    : [];
  const task = createTask({
    title,
    body: typeof args.body === "string" ? args.body : undefined,
    assignee: typeof args.assignee === "string" ? args.assignee : undefined,
    priority: typeof args.priority === "number" ? args.priority : undefined,
    status:
      typeof args.status === "string" && VALID_STATUSES.has(args.status as KanbanStatus)
        ? (args.status as KanbanStatus)
        : "todo",
    parentIds,
  });
  return { task: summarize(task) };
}

export async function handleKanbanUnblock(
  args: Record<string, unknown>
): Promise<{ task: ReturnType<typeof summarize> | null }> {
  const id = typeof args.id === "string" ? args.id : "";
  if (!id) throw new Error("Validation error: 'id' is required.");
  const task = updateTaskStatus(id, "todo");
  return { task: task ? summarize(task) : null };
}

export async function handleKanbanLink(args: Record<string, unknown>): Promise<{ ok: boolean }> {
  const parentId = typeof args.parentId === "string" ? args.parentId : "";
  const childId = typeof args.childId === "string" ? args.childId : "";
  if (!parentId || !childId)
    throw new Error("Validation error: 'parentId' and 'childId' are required.");
  return { ok: linkTasks(parentId, childId) };
}
