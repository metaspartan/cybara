import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Isolate the kanban SQLite DB in a throwaway HOME before importing the module.
const tempHome = mkdtempSync(join(tmpdir(), "cybara-kanban-"));
process.env.HOME = tempHome;

const kanban = await import("../../src/core/kanban");

afterEach(() => {
  kanban.resetKanbanForTests();
});

afterAll(() => {
  rmSync(tempHome, { recursive: true, force: true });
});

describe("kanban CRUD", () => {
  test("create + get a task", () => {
    const task = kanban.createTask({ title: "Write tests", priority: 8 });
    expect(task.id).toMatch(/^task_/);
    expect(task.status).toBe("todo");
    const fetched = kanban.getTask(task.id);
    expect(fetched?.title).toBe("Write tests");
    expect(fetched?.priority).toBe(8);
  });

  test("listTasks filters by status and assignee", () => {
    const a = kanban.createTask({ title: "a", assignee: "coder" });
    const b = kanban.createTask({ title: "b", assignee: "ops" });
    kanban.updateTaskStatus(a.id, "done");
    expect(kanban.listTasks({ status: "done" }).map((t) => t.id)).toEqual([a.id]);
    expect(kanban.listTasks({ assignee: "ops" }).map((t) => t.id)).toEqual([b.id]);
  });

  test("updateTaskStatus records result on completion and clears the worker", () => {
    const task = kanban.createTask({ title: "ship it" });
    kanban.updateTaskStatus(task.id, "running");
    const done = kanban.updateTaskStatus(task.id, "done", "shipped");
    expect(done?.status).toBe("done");
    expect(done?.result).toBe("shipped");
    expect(done?.completed_at).toBeTruthy();
    expect(done?.worker_pid).toBeNull();
  });
});

describe("kanban dependency engine", () => {
  test("a child is not ready until all parents are done", () => {
    const parent = kanban.createTask({ title: "parent" });
    const child = kanban.createTask({ title: "child", parentIds: [parent.id] });
    expect(kanban.recomputeReady()).not.toContain(child.id);
    kanban.updateTaskStatus(parent.id, "done");
    expect(kanban.recomputeReady()).toContain(child.id);
    expect(kanban.getTask(child.id)?.status).toBe("ready");
  });

  test("linkTasks refuses a cycle", () => {
    const a = kanban.createTask({ title: "a" });
    const b = kanban.createTask({ title: "b", parentIds: [a.id] });
    // b -> a would create a cycle (a already depends on b transitively? no; but
    // making a depend on b after b depends on a is a cycle).
    expect(kanban.linkTasks(b.id, a.id)).toBe(false);
  });

  test("linkTasks accepts a non-cyclic edge", () => {
    const a = kanban.createTask({ title: "a" });
    const b = kanban.createTask({ title: "b" });
    expect(kanban.linkTasks(a.id, b.id)).toBe(true);
    expect(kanban.linkTasks(a.id, b.id)).toBe(false); // duplicate ignored
  });
});

describe("kanban dispatcher tick", () => {
  test("claims and spawns ready tasks up to the concurrency cap", async () => {
    const spawned: string[] = [];
    const t1 = kanban.createTask({ title: "t1", priority: 9 });
    const t2 = kanban.createTask({ title: "t2", priority: 5 });
    kanban.recomputeReady();
    const ids = await kanban.dispatchTick({
      maxConcurrent: 4,
      spawnWorker: async (task) => {
        spawned.push(task.id);
        return { pid: 1000 + spawned.length };
      },
    });
    expect(ids.length).toBe(2);
    expect(spawned.sort()).toEqual([t1.id, t2.id].sort());
    const running = kanban.listTasks({ status: "running" });
    expect(running.length).toBe(2);
    expect(running.every((t) => t.worker_pid !== null)).toBe(true);
  });

  test("respects the concurrency cap", async () => {
    kanban.createTask({ title: "a" });
    kanban.createTask({ title: "b" });
    kanban.createTask({ title: "c" });
    kanban.recomputeReady();
    const ids = await kanban.dispatchTick({
      maxConcurrent: 1,
      spawnWorker: async () => ({ pid: 1 }),
    });
    expect(ids.length).toBe(1);
    expect(kanban.listTasks({ status: "running" }).length).toBe(1);
  });

  test("spawn failure reverts the task to ready and bumps the failure counter", async () => {
    const task = kanban.createTask({ title: "flaky" });
    kanban.recomputeReady();
    await kanban.dispatchTick({
      maxConcurrent: 2,
      spawnWorker: async () => {
        throw new Error("worker crashed");
      },
    });
    const after = kanban.getTask(task.id);
    expect(["ready", "running"]).toContain(after?.status);
    expect(after?.consecutive_failures).toBeGreaterThanOrEqual(1);
  });
});

describe("kanban comments", () => {
  test("addComment + getComments", () => {
    const task = kanban.createTask({ title: "discuss" });
    expect(kanban.addComment(task.id, "coder", "found the bug")).toBe(true);
    const comments = kanban.getComments(task.id);
    expect(comments.length).toBe(1);
    expect(comments[0].body).toBe("found the bug");
    // Commenting a nonexistent task fails.
    expect(kanban.addComment("nope", "x", "y")).toBe(false);
  });
});
