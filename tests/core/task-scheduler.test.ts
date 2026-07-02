import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface Attempt {
  ok: boolean;
  error?: string;
  input?: string;
}

interface TaskSnapshot {
  id: string;
  name: string;
  type?: string;
  schedule?: string | null;
  config?: Record<string, unknown> | string | null;
  status: string;
  enabled?: boolean;
  next_run?: string | null;
  last_run?: string | null;
}

interface WorkerReport {
  nowBefore: number;
  nowAfter: number;
  errNoName: Attempt;
  errEmptyName: Attempt;
  errBadCron: Attempt;
  errShortCron: Attempt;
  fuzz: Attempt[];
  everyFive: TaskSnapshot;
  daily: TaskSnapshot;
  noSchedule: TaskSnapshot;
  emptySchedule: TaskSnapshot;
  disabled: TaskSnapshot;
  fetched: TaskSnapshot | null;
  listIds: string[];
  listEveryFive: TaskSnapshot | null;
  stopResult: boolean;
  afterStop: TaskSnapshot | null;
  startResult: boolean;
  afterStart: TaskSnapshot | null;
  startAt: number;
  stopMissing: boolean;
  startMissing: boolean;
  deleteResult: boolean;
  deletedGet: TaskSnapshot | null;
  deleteAgain: boolean;
  stats: Record<string, number>;
}

// The scheduler module opens the SQLite DB at import time (via core/paths →
// CYBARA_HOME), so everything runs in a child process pointed at a throwaway
// CYBARA_HOME. The worker never starts the 60s loop's work: it stops the
// scheduler and exits before any interval tick could fire.
const WORKER_SOURCE = `
import { taskScheduler } from "${join(ROOT_DIR, "src", "core", "scheduler.ts").replace(/\\/g, "/")}";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0xc0ffee);
const randInt = (max: number) => Math.floor(rand() * max);
const CRON_CHARS = "0123456789*/,-abcXYZ?@#%^ ";

function randomSchedule(): string {
  const len = 1 + randInt(24);
  let out = "";
  for (let i = 0; i < len; i++) out += CRON_CHARS[randInt(CRON_CHARS.length)];
  return out;
}

const attempt = (fn: () => unknown, input?: string) => {
  try {
    fn();
    return { ok: true, input };
  } catch (error) {
    return { ok: false, error: (error as Error).message, input };
  }
};

const report: Record<string, unknown> = {};
report.nowBefore = Date.now();

report.errNoName = attempt(() =>
  taskScheduler.create({} as unknown as Parameters<typeof taskScheduler.create>[0])
);
report.errEmptyName = attempt(() => taskScheduler.create({ name: "   " }));
report.errBadCron = attempt(() => taskScheduler.create({ name: "bad", schedule: "not a cron at all x" }));
report.errShortCron = attempt(() => taskScheduler.create({ name: "short", schedule: "* * *" }));

const fuzz: unknown[] = [];
for (let i = 0; i < 60; i++) {
  const schedule = randomSchedule();
  const result = attempt(
    () => taskScheduler.create({ name: "fuzz-" + i, schedule, enabled: false }),
    schedule
  );
  fuzz.push(result);
}
report.fuzz = fuzz;

const everyFive = taskScheduler.create({
  name: "every-five",
  description: "runs often",
  action: "do the thing",
  schedule: "*/5 * * * *",
  config: { foo: "bar" },
});
report.everyFive = everyFive;

report.daily = taskScheduler.create({ name: "daily", schedule: "0 3 * * *", enabled: false });
report.noSchedule = taskScheduler.create({ name: "no-sched" });
report.emptySchedule = taskScheduler.create({ name: "empty-sched", schedule: "" });
report.disabled = taskScheduler.create({ name: "disabled", enabled: false });
report.nowAfter = Date.now();

report.fetched = taskScheduler.get(everyFive.id) ?? null;
const listed = taskScheduler.list();
report.listIds = listed.map((t) => t.id);
report.listEveryFive = listed.find((t) => t.id === everyFive.id) ?? null;

report.stopResult = await taskScheduler.stop(everyFive.id);
report.afterStop = taskScheduler.get(everyFive.id) ?? null;
report.startAt = Date.now();
report.startResult = await taskScheduler.start(everyFive.id);
report.afterStart = taskScheduler.get(everyFive.id) ?? null;
report.stopMissing = await taskScheduler.stop("does-not-exist");
report.startMissing = await taskScheduler.start("does-not-exist");

report.stats = taskScheduler.getStats();

const dailySnapshot = report.daily as { id: string };
report.deleteResult = taskScheduler.delete(dailySnapshot.id);
report.deletedGet = taskScheduler.get(dailySnapshot.id) ?? null;
report.deleteAgain = taskScheduler.delete(dailySnapshot.id);

taskScheduler.stopScheduler();
console.log("REPORT:" + JSON.stringify(report));
process.exit(0);
`;

let tempHome = "";
let report: WorkerReport;

beforeAll(() => {
  tempHome = mkdtempSync(join(tmpdir(), "cybara-task-scheduler-"));
  const workerPath = join(tempHome, "worker.ts");
  writeFileSync(workerPath, WORKER_SOURCE, "utf-8");

  const result = Bun.spawnSync([process.execPath, "run", workerPath], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      CYBARA_HOME: tempHome,
      TZ: "Etc/UTC",
    },
  });
  const stdout = result.stdout.toString();
  if (result.exitCode !== 0) {
    throw new Error(`scheduler worker failed: ${result.stderr.toString()}\n${stdout}`);
  }
  const line = stdout
    .split("\n")
    .reverse()
    .find((l) => l.startsWith("REPORT:"));
  if (!line) {
    throw new Error(`scheduler worker produced no report:\n${stdout}\n${result.stderr.toString()}`);
  }
  report = JSON.parse(line.slice("REPORT:".length)) as WorkerReport;
});

afterAll(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
});

describe("taskScheduler.create validation", () => {
  test("missing name is rejected", () => {
    expect(report.errNoName.ok).toBe(false);
    expect(report.errNoName.error).toContain("Task name is required");
  });

  test("whitespace-only name is rejected", () => {
    expect(report.errEmptyName.ok).toBe(false);
    expect(report.errEmptyName.error).toContain("Task name is required");
  });

  test("garbage cron schedule is rejected", () => {
    expect(report.errBadCron.ok).toBe(false);
    expect(report.errBadCron.error).toContain("Invalid cron schedule");
  });

  test("cron with fewer than 5 fields is rejected", () => {
    expect(report.errShortCron.ok).toBe(false);
    expect(report.errShortCron.error).toContain("Invalid cron schedule");
    expect(report.errShortCron.error).toContain("5 fields");
  });

  test("fuzzed schedules either parse as cron or fail with a validation error", () => {
    expect(report.fuzz.length).toBe(60);
    expect(report.fuzz.some((f) => !f.ok)).toBe(true);
    for (const outcome of report.fuzz) {
      if (outcome.ok) {
        const parts = (outcome.input ?? "").trim().split(/\s+/);
        expect(parts.length === 5 || outcome.input === "").toBe(true);
      } else {
        expect(outcome.error).toStartWith("Validation error:");
      }
    }
  });

  test("undefined and empty-string schedules are accepted", () => {
    expect(report.noSchedule.name).toBe("no-sched");
    expect(report.noSchedule.next_run ?? null).toBeNull();
    expect(report.emptySchedule.name).toBe("empty-sched");
    expect(report.emptySchedule.next_run ?? null).toBeNull();
  });
});

describe("created task shape", () => {
  test("valid 5-part cron task has id, merged config, and computed next_run", () => {
    const t = report.everyFive;
    expect(t.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(t.name).toBe("every-five");
    expect(t.type).toBe("scheduled");
    expect(t.schedule).toBe("*/5 * * * *");
    expect(t.status).toBe("pending");
    expect(t.enabled).toBe(true);
    expect(t.config).toEqual({ foo: "bar", action: "do the thing", description: "runs often" });
    expect(typeof t.next_run).toBe("string");
  });

  test("action defaults to name and description to empty string", () => {
    expect(report.noSchedule.config).toEqual({ action: "no-sched", description: "" });
  });

  test("enabled:false creates a paused task", () => {
    expect(report.disabled.status).toBe("paused");
    expect(report.disabled.enabled).toBe(false);
  });
});

describe("calculateNextRun via created tasks", () => {
  test("*/5 * * * * schedules within ~5 minutes of creation", () => {
    const next = new Date(report.everyFive.next_run as string).getTime();
    expect(next).toBeGreaterThan(report.nowBefore);
    expect(next - report.nowBefore).toBeLessThanOrEqual(5 * 60 * 1000 + 60 * 1000);
  });

  test("0 3 * * * schedules the next 03:00 (worker pinned to UTC) within 24h", () => {
    const nextIso = report.daily.next_run as string;
    const next = new Date(nextIso);
    expect(next.getUTCHours()).toBe(3);
    expect(next.getUTCMinutes()).toBe(0);
    expect(next.getTime()).toBeGreaterThan(report.nowBefore);
    expect(next.getTime() - report.nowAfter).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 60 * 1000);
  });
});

describe("get and list", () => {
  test("get returns the persisted task with parsed config", () => {
    const fetched = report.fetched;
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(report.everyFive.id);
    expect(fetched?.name).toBe("every-five");
    expect(fetched?.config).toEqual({
      foo: "bar",
      action: "do the thing",
      description: "runs often",
    });
  });

  test("list contains every created task and derives enabled from status", () => {
    for (const t of [
      report.everyFive,
      report.daily,
      report.noSchedule,
      report.emptySchedule,
      report.disabled,
    ]) {
      expect(report.listIds).toContain(t.id);
    }
    expect(report.listEveryFive?.enabled).toBe(true);
    const listedIds = new Set(report.listIds);
    expect(listedIds.size).toBe(report.listIds.length);
  });
});

describe("start/stop transitions", () => {
  test("stop pauses the task and clears next_run while preserving identity fields", () => {
    expect(report.stopResult).toBe(true);
    const t = report.afterStop;
    expect(t?.status).toBe("paused");
    expect(t?.next_run ?? null).toBeNull();
    expect(t?.name).toBe("every-five");
    expect(t?.schedule).toBe("*/5 * * * *");
    expect(t?.config).toEqual({ foo: "bar", action: "do the thing", description: "runs often" });
  });

  test("start re-pends the task and recomputes next_run, preserving identity fields", () => {
    expect(report.startResult).toBe(true);
    const t = report.afterStart;
    expect(t?.status).toBe("pending");
    expect(t?.name).toBe("every-five");
    expect(t?.schedule).toBe("*/5 * * * *");
    expect(t?.config).toEqual({ foo: "bar", action: "do the thing", description: "runs often" });
    const next = new Date(t?.next_run as string).getTime();
    expect(next).toBeGreaterThan(report.startAt);
    expect(next - report.startAt).toBeLessThanOrEqual(5 * 60 * 1000 + 60 * 1000);
  });

  test("start/stop on a missing id return false", () => {
    expect(report.stopMissing).toBe(false);
    expect(report.startMissing).toBe(false);
  });
});

describe("delete and stats", () => {
  test("delete removes the task and reports changes", () => {
    expect(report.deleteResult).toBe(true);
    expect(report.deletedGet).toBeNull();
    expect(report.deleteAgain).toBe(false);
  });

  test("getStats buckets tasks by status", () => {
    const s = report.stats;
    expect(s.total).toBeGreaterThanOrEqual(5);
    expect(s.pending).toBeGreaterThanOrEqual(1);
    expect(s.paused).toBeGreaterThanOrEqual(1);
    expect(s.total).toBe(s.pending + s.running + s.completed + s.failed + s.paused);
  });
});
