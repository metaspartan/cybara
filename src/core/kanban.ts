/**
 * Kanban multi-agent orchestration — lean MVP.
 *
 * A SQLite-backed task board with a dependency engine and a tick-loop
 * dispatcher. Tasks flow triage → todo → ready → running → (done|blocked).
 * The dispatcher promotes tasks to `ready` once their parent dependencies are
 * `done`, then claims + spawns a worker agent for each ready task. Workers
 * self-report completion via the kanban_* tools.
 *
 * Core kanban kernel (recompute_ready + dispatch_once). The LLM-driven
 * decompose/specify/swarm
 * helpers are intentionally omitted here (they're pure DB writes on top and
 * can be layered later) — this is the durable foundation.
 *
 * Storage: one SQLite DB at <cybaraDir>/kanban.db via bun:sqlite.
 */
import { Database, type SQLQueryBindings } from "bun:sqlite";
import { cybaraDir } from "./paths";
import { join } from "path";

export type KanbanStatus =
  "triage" | "todo" | "ready" | "running" | "blocked" | "done" | "archived";

export const VALID_STATUSES: KanbanStatus[] = [
  "triage",
  "todo",
  "ready",
  "running",
  "blocked",
  "done",
  "archived",
];

export interface KanbanTask {
  id: string;
  title: string;
  body: string | null;
  assignee: string | null;
  status: KanbanStatus;
  priority: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  parent_ids: string[];
  child_ids: string[];
  result: string | null;
  consecutive_failures: number;
  max_runtime_seconds: number | null;
  worker_pid: number | null;
  claim_expires: number | null;
  metadata: Record<string, unknown> | null;
}

let db: Database | null = null;

function getDb(): Database {
  if (db) return db;
  const dbPath = join(cybaraDir, "kanban.db");
  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 120000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT,
      assignee TEXT,
      status TEXT NOT NULL DEFAULT 'todo',
      priority INTEGER NOT NULL DEFAULT 5,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      result TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      max_runtime_seconds INTEGER,
      worker_pid INTEGER,
      claim_expires INTEGER,
      metadata TEXT
    );
    CREATE TABLE IF NOT EXISTS task_links (
      parent_id TEXT NOT NULL,
      child_id TEXT NOT NULL,
      PRIMARY KEY (parent_id, child_id)
    );
    CREATE TABLE IF NOT EXISTS task_comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      author TEXT,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_events (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_links_child ON task_links(child_id);
    CREATE INDEX IF NOT EXISTS idx_links_parent ON task_links(parent_id);
  `);
  return db;
}

function rowToTask(row: Record<string, unknown>): KanbanTask {
  const database = getDb();
  const id = row.id as string;
  const parentRows = database
    .query("SELECT parent_id FROM task_links WHERE child_id = ?")
    .all(id) as Array<Record<string, unknown>>;
  const parentIds = parentRows.map((r) => r.parent_id as string);
  const childRows = database
    .query("SELECT child_id FROM task_links WHERE parent_id = ?")
    .all(id) as Array<Record<string, unknown>>;
  const childIds = childRows.map((r) => r.child_id as string);
  const metadataRaw = row.metadata as string | null;
  let metadata: Record<string, unknown> | null = null;
  if (metadataRaw) {
    try {
      metadata = JSON.parse(metadataRaw);
    } catch {
      metadata = null;
    }
  }
  return {
    id,
    title: row.title as string,
    body: (row.body as string) ?? null,
    assignee: (row.assignee as string) ?? null,
    status: row.status as KanbanStatus,
    priority: row.priority as number,
    created_at: row.created_at as string,
    started_at: (row.started_at as string) ?? null,
    completed_at: (row.completed_at as string) ?? null,
    parent_ids: parentIds,
    child_ids: childIds,
    result: (row.result as string) ?? null,
    consecutive_failures: row.consecutive_failures as number,
    max_runtime_seconds: (row.max_runtime_seconds as number) ?? null,
    worker_pid: (row.worker_pid as number) ?? null,
    claim_expires: (row.claim_expires as number) ?? null,
    metadata,
  };
}

function newId(): string {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

function recordEvent(taskId: string, kind: string, payload: Record<string, unknown> = {}): void {
  const database = getDb();
  database
    .query(
      "INSERT INTO task_events (id, task_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(crypto.randomUUID(), taskId, kind, JSON.stringify(payload), now());
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function createTask(input: {
  title: string;
  body?: string;
  assignee?: string;
  priority?: number;
  status?: KanbanStatus;
  parentIds?: string[];
}): KanbanTask {
  const database = getDb();
  const id = newId();
  const status: KanbanStatus = input.status ?? "todo";
  database
    .query(
      `INSERT INTO tasks (id, title, body, assignee, status, priority, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.title,
      input.body ?? null,
      input.assignee ?? null,
      status,
      input.priority ?? 5,
      now()
    );
  for (const parentId of input.parentIds ?? []) {
    if (parentId === id) continue;
    if (wouldCycle(parentId, id)) continue;
    database
      .query("INSERT OR IGNORE INTO task_links (parent_id, child_id) VALUES (?, ?)")
      .run(parentId, id);
  }
  recordEvent(id, "created", { title: input.title });
  return getTask(id)!;
}

export function getTask(id: string): KanbanTask | null {
  const database = getDb();
  const row = database.query("SELECT * FROM tasks WHERE id = ?").get(id) as Record<
    string,
    unknown
  > | null;
  return row ? rowToTask(row) : null;
}

export function listTasks(filter?: {
  status?: KanbanStatus;
  assignee?: string;
  limit?: number;
}): KanbanTask[] {
  const database = getDb();
  const limit = Math.min(filter?.limit ?? 50, 200);
  let sql = "SELECT * FROM tasks";
  const conditions: string[] = [];
  const params: SQLQueryBindings[] = [];
  if (filter?.status) {
    conditions.push("status = ?");
    params.push(filter.status);
  }
  if (filter?.assignee) {
    conditions.push("assignee = ?");
    params.push(filter.assignee);
  }
  if (conditions.length) sql += ` WHERE ${conditions.join(" AND ")}`;
  sql += ` ORDER BY priority DESC, created_at ASC LIMIT ?`;
  params.push(limit);
  const rows = database.query(sql).all(...params) as Record<string, unknown>[];
  return rows.map(rowToTask);
}

export function updateTaskStatus(
  id: string,
  status: KanbanStatus,
  result?: string
): KanbanTask | null {
  const database = getDb();
  const task = getTask(id);
  if (!task) return null;
  const updates: string[] = ["status = ?"];
  const params: SQLQueryBindings[] = [status];
  if (status === "running" && !task.started_at) {
    updates.push("started_at = ?");
    params.push(now());
  }
  if (status === "done") {
    updates.push("completed_at = ?");
    params.push(now());
    if (result !== undefined) {
      updates.push("result = ?");
      params.push(result);
    }
    updates.push("worker_pid = NULL", "claim_expires = NULL");
  }
  params.push(id);
  database.query(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`).run(...params);
  recordEvent(id, status, result ? { result } : {});
  return getTask(id);
}

export function linkTasks(parentId: string, childId: string): boolean {
  if (parentId === childId || wouldCycle(parentId, childId)) return false;
  const database = getDb();
  const result = database
    .query("INSERT OR IGNORE INTO task_links (parent_id, child_id) VALUES (?, ?)")
    .run(parentId, childId);
  return result.changes > 0;
}

export function addComment(taskId: string, author: string, body: string): boolean {
  const database = getDb();
  if (!getTask(taskId)) return false;
  database
    .query(
      "INSERT INTO task_comments (id, task_id, author, body, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(crypto.randomUUID(), taskId, author || "agent", body, now());
  return true;
}

export function getComments(
  taskId: string
): Array<{ author: string; body: string; created_at: string }> {
  const database = getDb();
  return database
    .query(
      "SELECT author, body, created_at FROM task_comments WHERE task_id = ? ORDER BY created_at ASC"
    )
    .all(taskId) as Array<{ author: string; body: string; created_at: string }>;
}

/** Cycle detection: would adding parent→child create a cycle (child already an ancestor of parent)? */
function wouldCycle(parentId: string, childId: string): boolean {
  // A cycle exists if childId can already reach parentId by following child links.
  const database = getDb();
  const visited = new Set<string>();
  const stack = [childId];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === parentId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const childRows = database
      .query("SELECT child_id FROM task_links WHERE parent_id = ?")
      .all(current) as Array<Record<string, unknown>>;
    const children = childRows.map((r) => r.child_id as string);
    stack.push(...children);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Dependency engine + dispatcher
// ---------------------------------------------------------------------------

/** Number of parents of a task that are NOT yet done/archived. */
function pendingParentCount(taskId: string): number {
  const database = getDb();
  const rows = database
    .query(
      `SELECT COUNT(*) as n FROM task_links
       WHERE child_id = ? AND parent_id NOT IN (
         SELECT id FROM tasks WHERE status IN ('done', 'archived')
       )`
    )
    .get(taskId) as { n: number };
  return rows.n;
}

/**
 * Promote tasks from todo/blocked → ready when all parents are done/archived.
 * Returns the IDs that were promoted. This is the heart of the task graph.
 */
export function recomputeReady(): string[] {
  const database = getDb();
  const candidates = database
    .query("SELECT id FROM tasks WHERE status IN ('todo', 'blocked')")
    .all() as Array<{ id: string }>;
  const promoted: string[] = [];
  for (const { id } of candidates) {
    if (pendingParentCount(id) === 0) {
      database.query("UPDATE tasks SET status = 'ready' WHERE id = ?").run(id);
      promoted.push(id);
    }
  }
  return promoted;
}

const TICK_INTERVAL_MS = 5_000;
const CLAIM_TTL_MS = 10 * 60 * 1000;
let tickTimer: NodeJS.Timeout | null = null;

/**
 * One dispatcher tick: release expired claims, recompute ready tasks, claim +
 * spawn a worker for each ready task (up to maxConcurrent). Safe to call
 * directly or via startDispatcherTick().
 *
 * The worker-spawn callback is injected so this module stays decoupled from the
 * agent runner. Returning the spawned task IDs lets tests assert behavior.
 */
export async function dispatchTick(options?: {
  maxConcurrent?: number;
  spawnWorker?: (task: KanbanTask) => Promise<{ pid?: number } | void>;
}): Promise<string[]> {
  const database = getDb();
  const maxConcurrent = options?.maxConcurrent ?? 4;

  // 1. Release expired claims (crashed/timed-out workers).
  const nowMs = Date.now();
  database
    .query(
      "UPDATE tasks SET status = 'todo', worker_pid = NULL, claim_expires = NULL WHERE status = 'running' AND claim_expires IS NOT NULL AND claim_expires < ?"
    )
    .run(nowMs);

  // 2. Promote ready tasks.
  recomputeReady();

  // 3. Count running; claim + spawn up to the concurrency cap.
  const running = database
    .query("SELECT COUNT(*) as n FROM tasks WHERE status = 'running'")
    .get() as { n: number };
  const slotsAvailable = Math.max(0, maxConcurrent - running.n);
  if (slotsAvailable === 0) return [];

  const readyTasks = database
    .query(
      "SELECT * FROM tasks WHERE status = 'ready' ORDER BY priority DESC, created_at ASC LIMIT ?"
    )
    .all(slotsAvailable) as Array<Record<string, unknown>>;

  const spawned: string[] = [];
  for (const row of readyTasks) {
    const task = rowToTask(row);
    // Atomic claim: set running + claim expiry in one statement.
    const claim = database
      .query(
        "UPDATE tasks SET status = 'running', claim_expires = ? WHERE id = ? AND status = 'ready'"
      )
      .run(nowMs + CLAIM_TTL_MS, task.id);
    if (claim.changes === 0) continue; // lost the race
    recordEvent(task.id, "claimed", {});
    if (options?.spawnWorker) {
      try {
        const spawnResult = await options.spawnWorker(task);
        if (spawnResult?.pid) {
          database
            .query("UPDATE tasks SET worker_pid = ? WHERE id = ?")
            .run(spawnResult.pid, task.id);
        }
      } catch (error) {
        // Spawn failed: revert to ready, bump failure counter.
        database
          .query(
            "UPDATE tasks SET status = 'ready', claim_expires = NULL, consecutive_failures = consecutive_failures + 1 WHERE id = ?"
          )
          .run(task.id);
        recordEvent(task.id, "spawn_failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }
    spawned.push(task.id);
  }
  return spawned;
}

/** Start the background tick loop. Returns a stop() function. */
export function startDispatcherTick(
  spawnWorker: (task: KanbanTask) => Promise<{ pid?: number } | void>,
  options?: { maxConcurrent?: number; intervalMs?: number }
): () => void {
  if (tickTimer) return () => {};
  const intervalMs = options?.intervalMs ?? TICK_INTERVAL_MS;
  tickTimer = setInterval(() => {
    void dispatchTick({ maxConcurrent: options?.maxConcurrent, spawnWorker }).catch((error) => {
      console.warn(
        `[Kanban] dispatch tick failed: ${error instanceof Error ? error.message : String(error)}`
      );
    });
  }, intervalMs);
  tickTimer.unref?.();
  return () => {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };
}

/**
 * For tests: clear all kanban data and close the connection so the next call
 * starts from an empty board. In production this is never called; the tick
 * timer is also stopped.
 */
export function resetKanbanForTests(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  if (db) {
    try {
      db.exec("DELETE FROM task_events;");
      db.exec("DELETE FROM task_comments;");
      db.exec("DELETE FROM task_links;");
      db.exec("DELETE FROM tasks;");
    } catch {
      /* ignore if schema not yet created */
    }
    db.close();
    db = null;
  }
}
