import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const KANBAN_MODULE = join(ROOT_DIR, "src", "core", "kanban.ts").replace(/\\/g, "/");

// kanban.ts resolves its SQLite path from paths.ts (CYBARA_HOME / HOME), both
// fixed at process startup, so the operations run in a child process with those
// env vars pointed at a throwaway directory. The worker emits a single JSON line.
const WORKER_SOURCE = `
import * as kanban from "${KANBAN_MODULE}";

const out: Record<string, unknown> = {};

const t = kanban.createTask({ title: "first", priority: 8 });
out.createdId = t.id;
out.createdIsString = typeof t.id === "string";
out.createdStatus = t.status;
out.createdPriority = t.priority;

const t2 = kanban.createTask({ title: "second" });
out.defaultPriority = t2.priority;

const listed = kanban.listTasks();
out.listCount = listed.length;
out.listHasBoth = listed.some((x) => x.id === t.id) && listed.some((x) => x.id === t2.id);
out.listOrderTopId = listed[0]?.id;

const running = kanban.updateTaskStatus(t.id, "running");
out.runningStatus = running?.status;
out.runningStartedAt = !!running?.started_at;

const done = kanban.updateTaskStatus(t.id, "done", "the result");
out.doneStatus = done?.status;
out.doneResult = done?.result;
out.doneCompletedAt = !!done?.completed_at;
out.doneWorkerPid = done?.worker_pid;

const blocked = kanban.updateTaskStatus(t2.id, "blocked");
out.blockedStatus = blocked?.status;
const unblocked = kanban.updateTaskStatus(t2.id, "todo");
out.unblockedStatus = unblocked?.status;

const listDone = kanban.listTasks({ status: "done" });
out.listDoneIds = listDone.map((x) => x.id);

const p = kanban.createTask({ title: "parent-card" });
const c = kanban.createTask({ title: "child-card" });
out.linkOk = kanban.linkTasks(p.id, c.id);
out.linkDup = kanban.linkTasks(p.id, c.id);
out.linkSelf = kanban.linkTasks(p.id, p.id);
const parentAfter = kanban.getTask(p.id);
const childAfter = kanban.getTask(c.id);
out.parentChildIds = parentAfter?.child_ids;
out.childParentIds = childAfter?.parent_ids;

out.getMissing = kanban.getTask("does-not-exist");
out.updateMissing = kanban.updateTaskStatus("does-not-exist", "done");
out.commentMissing = kanban.addComment("does-not-exist", "a", "b");

const INJECT = "'; DROP TABLE tasks; -- \\" OR 1=1";
const inj = kanban.createTask({ title: INJECT, body: INJECT });
out.injTitle = kanban.getTask(inj.id)?.title;
out.injBody = kanban.getTask(inj.id)?.body;
out.injRoundtrips = out.injTitle === INJECT;
// Table survived the injection-looking title (prepared statements).
out.tableSurvived = kanban.listTasks().length > 0;

kanban.addComment(inj.id, "'; DELETE FROM tasks; --", INJECT);
const comments = kanban.getComments(inj.id);
out.commentBody = comments[0]?.body;
out.commentAuthor = comments[0]?.author;
out.commentRoundtrips = comments[0]?.body === INJECT;
out.commentCount = comments.length;

// addComment with empty author defaults to "agent".
const cc = kanban.createTask({ title: "cc" });
kanban.addComment(cc.id, "", "hi");
out.emptyAuthorDefault = kanban.getComments(cc.id)[0]?.author;

// recomputeReady promotes a todo with no pending parents.
const promoted = kanban.recomputeReady();
out.promotedIsArray = Array.isArray(promoted);

console.log("__RESULT__" + JSON.stringify(out));
`;

let tempHome = "";
let result: Record<string, unknown>;

beforeAll(() => {
  tempHome = mkdtempSync(join(tmpdir(), "cybara-kanban-unit-"));
  const cybaraHome = join(tempHome, ".cybara");
  const workerPath = join(tempHome, "worker.ts");
  writeFileSync(workerPath, WORKER_SOURCE, "utf-8");

  const proc = Bun.spawnSync([process.execPath, "run", workerPath], {
    cwd: ROOT_DIR,
    env: { ...process.env, HOME: tempHome, USERPROFILE: tempHome, CYBARA_HOME: cybaraHome },
  });
  const stdout = proc.stdout.toString();
  if (proc.exitCode !== 0) {
    throw new Error(`kanban worker failed: ${proc.stderr.toString()}\n${stdout}`);
  }
  const line = stdout.split("\n").find((l) => l.startsWith("__RESULT__")) ?? "";
  result = JSON.parse(line.slice("__RESULT__".length)) as Record<string, unknown>;
});

afterAll(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
});

describe("kanban create/get", () => {
  test("create returns a string id and default todo status", () => {
    expect(result.createdIsString).toBe(true);
    expect(String(result.createdId)).toMatch(/^task_/);
    expect(result.createdStatus).toBe("todo");
    expect(result.createdPriority).toBe(8);
  });

  test("createTask applies a default priority of 5", () => {
    expect(result.defaultPriority).toBe(5);
  });
});

describe("kanban list", () => {
  test("list reflects created tasks", () => {
    expect(result.listCount).toBeGreaterThanOrEqual(2);
    expect(result.listHasBoth).toBe(true);
  });

  test("list is ordered by priority DESC (higher-priority card first)", () => {
    expect(result.listOrderTopId).toBe(result.createdId);
  });

  test("status filter returns only matching cards", () => {
    expect(result.listDoneIds).toEqual([result.createdId]);
  });
});

describe("kanban status transitions", () => {
  test("running sets started_at", () => {
    expect(result.runningStatus).toBe("running");
    expect(result.runningStartedAt).toBe(true);
  });

  test("done records result, completed_at, and clears worker_pid", () => {
    expect(result.doneStatus).toBe("done");
    expect(result.doneResult).toBe("the result");
    expect(result.doneCompletedAt).toBe(true);
    expect(result.doneWorkerPid).toBeNull();
  });

  test("block then unblock transitions", () => {
    expect(result.blockedStatus).toBe("blocked");
    expect(result.unblockedStatus).toBe("todo");
  });
});

describe("kanban linking", () => {
  test("link between two cards succeeds once and dedupes", () => {
    expect(result.linkOk).toBe(true);
    expect(result.linkDup).toBe(false);
    expect(result.linkSelf).toBe(false);
  });

  test("link is reflected in parent/child id arrays", () => {
    expect(Array.isArray(result.parentChildIds)).toBe(true);
    expect((result.childParentIds as string[]).length).toBe(1);
  });
});

describe("kanban invalid ids fail cleanly", () => {
  test("getTask / updateTaskStatus on missing id return null, addComment false", () => {
    expect(result.getMissing).toBeNull();
    expect(result.updateMissing).toBeNull();
    expect(result.commentMissing).toBe(false);
  });
});

describe("kanban SQL-injection-looking input is stored verbatim", () => {
  test("injection-looking title/body round-trip and the table survives", () => {
    expect(result.injRoundtrips).toBe(true);
    expect(result.injBody).toBe(result.injTitle);
    expect(result.tableSurvived).toBe(true);
  });

  test("comment body/author with injection payloads round-trip verbatim", () => {
    expect(result.commentRoundtrips).toBe(true);
    expect(result.commentCount).toBe(1);
    expect(String(result.commentAuthor)).toContain("DELETE FROM tasks");
  });

  test("empty comment author defaults to 'agent'", () => {
    expect(result.emptyAuthorDefault).toBe("agent");
  });
});

describe("kanban recomputeReady", () => {
  test("returns an array of promoted ids", () => {
    expect(result.promotedIsArray).toBe(true);
  });
});
