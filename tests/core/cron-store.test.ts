import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const STORE_PATH = join(ROOT_DIR, "src", "core", "cron", "store.ts").replace(/\\/g, "/");

const WORKER_SOURCE = `
import { homedir } from "os";
import {
  loadJobs,
  saveJobs,
  createJob,
  updateJob,
  removeJob,
  getJob,
  listJobs,
  computeNextRun,
  loadRunLogs,
  saveRunLogs,
  addRunLog,
  getRunLogs,
} from "${STORE_PATH}";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

function mulberry32(seed) {
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
const randInt = (max) => Math.floor(rand() * max);

const results = { assertions: [], fuzz: {}, error: null };
const check = (label, cond) => results.assertions.push({ label, ok: !!cond });

function baseCreate(over = {}) {
  return {
    name: "n",
    enabled: true,
    schedule: { kind: "every", everyMs: 60000 },
    sessionTarget: "main",
    wakeMode: "next-heartbeat",
    payload: { kind: "systemEvent", text: "hi" },
    ...over,
  };
}

try {
  // Empty store before anything is written.
  check("initial loadJobs empty", loadJobs().length === 0);
  check("initial listJobs empty", listJobs().length === 0);
  check("initial loadRunLogs empty", loadRunLogs().length === 0);

  // createJob returns id + persists.
  const j = createJob(baseCreate({ name: "first" }));
  check("createJob has id", typeof j.id === "string" && j.id.length > 0);
  check("createJob default enabled true", j.enabled === true);
  check("createJob sets nextRunAtMs", typeof j.state.nextRunAtMs === "number");
  check("createJob persisted", loadJobs().length === 1);
  check("getJob reflects create", getJob(j.id)?.name === "first");
  check("listJobs reflects create", listJobs().some((x) => x.id === j.id));

  // Second job disabled to test filtering.
  const jd = createJob(baseCreate({ name: "disabled", enabled: false }));
  check("listJobs includeDisabled default returns both", listJobs().length === 2);
  check("listJobs includeDisabled=true returns both", listJobs(true).length === 2);
  const enabledOnly = listJobs(false);
  check("listJobs(false) filters disabled", enabledOnly.length === 1 && enabledOnly[0].id === j.id);

  // updateJob patches and preserves unspecified fields (COALESCE-style).
  const beforeUpdate = getJob(j.id);
  const upd = updateJob(j.id, { description: "desc-added" });
  check("updateJob returns job", upd !== null);
  check("updateJob patched description", upd?.description === "desc-added");
  check("updateJob preserved name", upd?.name === "first");
  check("updateJob preserved enabled", upd?.enabled === true);
  check("updateJob preserved sessionTarget", upd?.sessionTarget === "main");
  check("updateJob preserved createdAtMs", upd?.createdAtMs === beforeUpdate?.createdAtMs);
  check("updateJob bumped updatedAtMs", (upd?.updatedAtMs ?? 0) >= (beforeUpdate?.updatedAtMs ?? 0));
  check("updateJob persisted description", getJob(j.id)?.description === "desc-added");

  // updateJob schedule change recomputes nextRunAtMs.
  const updSched = updateJob(j.id, { schedule: { kind: "at", atMs: Date.now() + 5_000_000 } });
  check("updateJob schedule recomputes nextRunAtMs", updSched?.state.nextRunAtMs === updSched?.schedule.atMs);
  check("updateJob schedule preserved description", updSched?.description === "desc-added");

  // updateJob nested payload patch preserves other payload fields.
  const withAgent = createJob(baseCreate({
    name: "agent",
    payload: { kind: "agentTurn", message: "hello", model: "m1", timeoutSeconds: 30 },
  }));
  const updPayload = updateJob(withAgent.id, { payload: { kind: "agentTurn", message: "changed" } });
  check("payload patch changed message", updPayload?.payload.kind === "agentTurn" && updPayload.payload.message === "changed");
  check("payload patch preserved model", updPayload?.payload.kind === "agentTurn" && updPayload.payload.model === "m1");
  check("payload patch preserved timeoutSeconds", updPayload?.payload.kind === "agentTurn" && updPayload.payload.timeoutSeconds === 30);

  // updateJob on missing id -> null.
  check("updateJob missing id null", updateJob("nope_missing", { name: "x" }) === null);

  // removeJob true/false.
  check("removeJob existing true", removeJob(jd.id) === true);
  check("removeJob persisted removal", getJob(jd.id) === null);
  check("removeJob missing false", removeJob("nope_missing") === false);

  // saveJobs/loadJobs round-trip.
  const roundtrip = loadJobs();
  saveJobs(roundtrip);
  const reloaded = loadJobs();
  check("saveJobs/loadJobs round-trip count", reloaded.length === roundtrip.length);
  check("saveJobs/loadJobs round-trip ids", JSON.stringify(reloaded.map((x) => x.id).sort()) === JSON.stringify(roundtrip.map((x) => x.id).sort()));

  const cronDir = join(homedir(), ".cybara", "cron");
  mkdirSync(cronDir, { recursive: true });
  writeFileSync(join(cronDir, "jobs.json"), "{ this is not valid json ][", "utf-8");
  let corruptThrew = false;
  let corruptResult = null;
  try {
    corruptResult = loadJobs();
  } catch {
    corruptThrew = true;
  }
  check("corrupt jobs.json does not throw", corruptThrew === false);
  check("corrupt jobs.json recovers backup", Array.isArray(corruptResult) && corruptResult.length === roundtrip.length);

  // jobs.json with missing jobs array -> [].
  writeFileSync(join(cronDir, "jobs.json"), JSON.stringify({ version: 1 }), "utf-8");
  check("jobs.json missing jobs recovers backup", loadJobs().length === roundtrip.length);

  // Run logs save/load round-trip + filtering + cap.
  saveRunLogs([]);
  check("run logs start empty", loadRunLogs().length === 0);
  addRunLog({ jobId: "A", runId: "r1", startedAtMs: 1, status: "ok" });
  addRunLog({ jobId: "B", runId: "r2", startedAtMs: 2, status: "error", error: "boom" });
  const logs = loadRunLogs();
  check("addRunLog round-trip count", logs.length === 2);
  check("getRunLogs filters by jobId", getRunLogs("A").length === 1 && getRunLogs("A")[0].runId === "r1");
  check("getRunLogs empty for unknown", getRunLogs("Z").length === 0);

  writeFileSync(join(cronDir, "runs.json"), "not json", "utf-8");
  let runsCorruptThrew = false;
  try { loadRunLogs(); } catch { runsCorruptThrew = true; }
  check("corrupt runs.json does not throw", runsCorruptThrew === false);
  check("corrupt runs.json recovers backup", loadRunLogs().length === 1);

  // MAX_RUN_LOGS cap = 100 (slice(-100) on save).
  const many = [];
  for (let i = 0; i < 250; i++) many.push({ jobId: "cap", runId: "r" + i, startedAtMs: i, status: "ok" });
  saveRunLogs(many);
  const capped = loadRunLogs();
  check("run logs capped at 100", capped.length === 100);
  check("run logs cap keeps most recent (tail)", capped[capped.length - 1].runId === "r249" && capped[0].runId === "r150");

  // ---- computeNextRun fuzz ----
  const fuzz = { atMonotonic: true, everyStrictlyFuture: true, everyAlignedToAnchor: true, invalidEveryRejected: true, cronMonotonic: true, invalidCronRejected: true, noUnexpectedResult: true, unexpectedDetail: null };

  // 'at' schedule: future returns exact, past/equal returns fromMs (documented behavior).
  for (let i = 0; i < 400; i++) {
    const from = 1_600_000_000_000 + randInt(2_000_000_000);
    const at = from + randInt(20_000_000) - 10_000_000;
    const next = computeNextRun({ kind: "at", atMs: at }, from);
    if (at > from) { if (next !== at) fuzz.atMonotonic = false; }
    else { if (next !== from) fuzz.atMonotonic = false; }
  }

  // 'every' schedule with random anchor + interval.
  for (let i = 0; i < 800; i++) {
    const from = 1_600_000_000_000 + randInt(2_000_000_000);
    const everyMs = 1 + randInt(86_400_000);
    const useAnchor = rand() < 0.5;
    const anchorMs = useAnchor ? from - randInt(10_000_000_000) : undefined;
    const sched = useAnchor ? { kind: "every", everyMs, anchorMs } : { kind: "every", everyMs };
    const next = computeNextRun(sched, from);
    if (next <= from) fuzz.everyStrictlyFuture = false;
    // Result must be aligned to the anchor grid.
    const anchor = anchorMs ?? from;
    if ((next - anchor) % everyMs !== 0) fuzz.everyAlignedToAnchor = false;
  }

  for (const bad of [0, -1, -60000, -999999]) {
    const from = 1_700_000_000_000;
    try {
      computeNextRun({ kind: "every", everyMs: bad }, from);
      fuzz.invalidEveryRejected = false;
    } catch {}
  }

  const validExprs = ["* * * * *", "0 0 * * *", "*/5 * * * *", "0 9 * * mon-fri", "30 14 1 * *", "0 0 1 1 *", "15,45 * * * *"];
  for (let i = 0; i < 200; i++) {
    const from = 1_700_000_000_000 + randInt(2_000_000_000);
    const expr = validExprs[randInt(validExprs.length)];
    const next = computeNextRun({ kind: "cron", expr }, from);
    if (next <= from) fuzz.cronMonotonic = false;
  }
  const invalidExprs = ["", "* * *", "not a cron", "99 * * * *", "* * * * * *", "a b c d e", "*/0 * * * *"];
  for (const expr of invalidExprs) {
    const from = 1_700_000_000_000;
    try {
      computeNextRun({ kind: "cron", expr }, from);
      fuzz.invalidCronRejected = false;
    } catch {}
  }

  // Broad random-schedule crash resistance across all kinds and junk.
  const kinds = ["at", "every", "cron", "bogus"];
  for (let i = 0; i < 3000; i++) {
    const from = 1_500_000_000_000 + randInt(4_000_000_000);
    const k = kinds[randInt(kinds.length)];
    let sched;
    if (k === "at") sched = { kind: "at", atMs: from + randInt(1e12) - 5e11 };
    else if (k === "every") sched = { kind: "every", everyMs: randInt(1e9) - 1e8, anchorMs: rand() < 0.5 ? from - randInt(1e10) : undefined };
    else if (k === "cron") sched = { kind: "cron", expr: (rand() < 0.5 ? validExprs[randInt(validExprs.length)] : invalidExprs[randInt(invalidExprs.length)]) };
    else sched = { kind: "bogus", junk: rand() };
    try {
      const r = computeNextRun(sched, from);
      if (typeof r !== "number" || !Number.isFinite(r)) { fuzz.noUnexpectedResult = false; fuzz.unexpectedDetail = "non-finite result for " + JSON.stringify(sched); }
    } catch (e) {
      if (k === "at" || (k === "every" && sched.everyMs > 0) || (k === "cron" && validExprs.includes(sched.expr))) {
        fuzz.noUnexpectedResult = false;
        fuzz.unexpectedDetail = "unexpected throw for " + JSON.stringify(sched) + ": " + (e && e.message);
      }
    }
  }

  results.fuzz = fuzz;
} catch (e) {
  results.error = (e && e.stack) || String(e);
}

console.log("__RESULT__" + JSON.stringify(results));
`;

interface Assertion {
  label: string;
  ok: boolean;
}
interface FuzzResult {
  atMonotonic: boolean;
  everyStrictlyFuture: boolean;
  everyAlignedToAnchor: boolean;
  invalidEveryRejected: boolean;
  cronMonotonic: boolean;
  invalidCronRejected: boolean;
  noUnexpectedResult: boolean;
  unexpectedDetail: string | null;
}
interface WorkerResult {
  assertions: Assertion[];
  fuzz: FuzzResult;
  error: string | null;
}

let tempHome = "";
let result: WorkerResult;

beforeAll(() => {
  tempHome = mkdtempSync(join(tmpdir(), "cybara-cron-store-"));
  const workerPath = join(tempHome, "worker.ts");
  writeFileSync(workerPath, WORKER_SOURCE, "utf-8");

  const proc = Bun.spawnSync([process.execPath, "run", workerPath], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      CYBARA_HOME: join(tempHome, ".cybara"),
    },
  });
  const stdout = proc.stdout.toString();
  const line = stdout.split("\n").find((l) => l.startsWith("__RESULT__"));
  if (!line) {
    throw new Error(
      `worker produced no result. exit=${proc.exitCode}\nstderr=${proc.stderr.toString()}\nstdout=${stdout}`
    );
  }
  result = JSON.parse(line.slice("__RESULT__".length)) as WorkerResult;
}, 60_000);

afterAll(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
});

describe("cron store persistence (isolated HOME)", () => {
  test("worker completed without top-level error", () => {
    expect(result.error).toBeNull();
  });

  test("all persistence assertions pass", () => {
    const failed = result.assertions.filter((a) => !a.ok).map((a) => a.label);
    expect(failed).toEqual([]);
    expect(result.assertions.length).toBeGreaterThan(30);
  });
});

describe("computeNextRun fuzz (pure)", () => {
  test("'at' schedule returns atMs when future, fromMs otherwise", () => {
    expect(result.fuzz.atMonotonic).toBe(true);
  });
  test("'every' schedule never returns a past time", () => {
    expect(result.fuzz.everyStrictlyFuture).toBe(true);
  });
  test("'every' schedule aligns to the anchor grid", () => {
    expect(result.fuzz.everyAlignedToAnchor).toBe(true);
  });
  test("non-positive interval is rejected", () => {
    expect(result.fuzz.invalidEveryRejected).toBe(true);
  });
  test("valid cron expressions return a strictly future time", () => {
    expect(result.fuzz.cronMonotonic).toBe(true);
  });
  test("invalid cron expressions are rejected", () => {
    expect(result.fuzz.invalidCronRejected).toBe(true);
  });
  test("random schedules either produce a finite result or reject invalid input", () => {
    expect(result.fuzz.unexpectedDetail).toBeNull();
    expect(result.fuzz.noUnexpectedResult).toBe(true);
  });
});
