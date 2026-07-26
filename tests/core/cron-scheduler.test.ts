import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCHED_PATH = join(ROOT_DIR, "src", "core", "cron", "scheduler.ts").replace(/\\/g, "/");
const STORE_PATH = join(ROOT_DIR, "src", "core", "cron", "store.ts").replace(/\\/g, "/");

const WORKER_SOURCE = `
import {
  setWakeHandler,
  setAgentHandler,
  startScheduler,
  stopScheduler,
  scheduleJob,
  runJob,
  sendWakeEvent,
  getSchedulerStatus,
  cancelJobTimer,
} from "${SCHED_PATH}";
import { createJob, getJob, loadRunLogs, listJobs } from "${STORE_PATH}";

const results = { assertions: [], error: null };
const check = (label, cond) => results.assertions.push({ label, ok: !!cond });

function base(over = {}) {
  return {
    name: "n",
    enabled: true,
    schedule: { kind: "every", everyMs: 3_600_000, anchorMs: Date.now() + 3_600_000 },
    sessionTarget: "main",
    wakeMode: "next-heartbeat",
    payload: { kind: "systemEvent", text: "hi" },
    ...over,
  };
}

async function main() {
  try {
    // Fresh scheduler has no timers.
    check("initial status not running", getSchedulerStatus().running === false);
    check("initial scheduledTimers 0", getSchedulerStatus().scheduledTimers === 0);

    // scheduleJob on an enabled far-future job registers exactly one timer.
    const j1 = createJob(base({ name: "future1" }));
    scheduleJob(j1);
    check("scheduleJob registers timer", getSchedulerStatus().scheduledTimers === 1);
    check("status running after schedule", getSchedulerStatus().running === true);

    // Re-scheduling same job replaces its timer (still 1).
    scheduleJob(getJob(j1.id));
    check("re-scheduleJob does not leak", getSchedulerStatus().scheduledTimers === 1);

    // scheduleJob on a disabled job removes/does not add a timer.
    const jd = createJob(base({ name: "disabledJob", enabled: false }));
    scheduleJob(jd);
    check("scheduleJob disabled adds no timer", getSchedulerStatus().scheduledTimers === 1);

    // cancelJobTimer true for known, false for unknown.
    check("cancelJobTimer known true", cancelJobTimer(j1.id) === true);
    check("cancelJobTimer clears it", getSchedulerStatus().scheduledTimers === 0);
    check("cancelJobTimer unknown false", cancelJobTimer("nope") === false);

    // stopScheduler clears all timers (no leak).
    scheduleJob(getJob(j1.id));
    const j2 = createJob(base({ name: "future2" }));
    scheduleJob(j2);
    check("two timers scheduled", getSchedulerStatus().scheduledTimers === 2);
    stopScheduler();
    check("stopScheduler clears all timers", getSchedulerStatus().scheduledTimers === 0);
    check("status not running after stop", getSchedulerStatus().running === false);

    // startScheduler schedules only enabled jobs. Currently enabled: future1, future2.
    startScheduler();
    const enabledCount = listJobs(false).length;
    check("startScheduler schedules enabled jobs", getSchedulerStatus().scheduledTimers === enabledCount);
    check("getSchedulerStatus activeJobs matches enabled", getSchedulerStatus().activeJobs === enabledCount);
    stopScheduler();

    // ---- runJob with injected handlers (no wall-clock waiting) ----
    let wakeCalls = [];
    setWakeHandler(async (text) => { wakeCalls.push(text); });

    // systemEvent 'every' job: runs handler, records ok log, reschedules (adds a timer).
    stopScheduler();
    const sysJob = createJob(base({ name: "sys", payload: { kind: "systemEvent", text: "wake-me" } }));
    const log1 = await runJob(sysJob.id);
    check("runJob systemEvent status ok", log1.status === "ok");
    check("runJob invoked wakeHandler", wakeCalls.length === 1 && wakeCalls[0] === "wake-me");
    check("runJob sets durationMs", typeof log1.durationMs === "number");
    check("runJob updated job lastStatus ok", getJob(sysJob.id)?.state.lastStatus === "ok");
    check("runJob recomputed nextRunAtMs", typeof getJob(sysJob.id)?.state.nextRunAtMs === "number");
    check("runJob 'every' rescheduled a timer", getSchedulerStatus().scheduledTimers >= 1);
    check("runJob appended a run log", loadRunLogs().some((l) => l.jobId === sysJob.id && l.status === "ok"));
    stopScheduler();

    // agentTurn success path.
    let agentCalls = 0;
    setAgentHandler(async (job) => { agentCalls++; return { success: true }; });
    const agJob = createJob(base({ name: "ag", schedule: { kind: "at", atMs: Date.now() + 10_000_000 }, payload: { kind: "agentTurn", message: "go" } }));
    const log2 = await runJob(agJob.id);
    check("runJob agentTurn ok", log2.status === "ok");
    check("runJob invoked agentHandler", agentCalls === 1);

    // agentTurn failure path -> error status + lastError recorded, no throw.
    setAgentHandler(async () => ({ success: false, error: "handler-failed" }));
    const agFail = createJob(base({ name: "agf", schedule: { kind: "at", atMs: Date.now() + 10_000_000 }, payload: { kind: "agentTurn", message: "go" } }));
    const log3 = await runJob(agFail.id);
    check("runJob agentTurn failure status error", log3.status === "error");
    check("runJob failure error message propagated", log3.error === "handler-failed");
    check("runJob failure sets state.lastStatus error", getJob(agFail.id)?.state.lastStatus === "error");
    check("runJob failure recorded lastError", getJob(agFail.id)?.state.lastError === "handler-failed");

    let releaseConcurrent;
    const concurrentGate = new Promise((resolve) => { releaseConcurrent = resolve; });
    let concurrentCalls = 0;
    setAgentHandler(async () => {
      concurrentCalls++;
      await concurrentGate;
      return { success: true };
    });
    const concurrentJob = createJob(base({ name: "concurrent", payload: { kind: "agentTurn", message: "once" } }));
    const concurrentOne = runJob(concurrentJob.id);
    const concurrentTwo = runJob(concurrentJob.id);
    await new Promise((resolve) => setTimeout(resolve, 10));
    check("concurrent triggers invoke handler once", concurrentCalls === 1);
    releaseConcurrent();
    const [concurrentLogOne, concurrentLogTwo] = await Promise.all([concurrentOne, concurrentTwo]);
    check("concurrent triggers share one run", concurrentLogOne.runId === concurrentLogTwo.runId);
    stopScheduler();

    // deleteAfterRun + 'at' schedule removes the job after running.
    const oneShot = createJob(base({ name: "oneshot", deleteAfterRun: true, schedule: { kind: "at", atMs: Date.now() + 10_000_000 }, payload: { kind: "systemEvent", text: "x" } }));
    await runJob(oneShot.id);
    check("deleteAfterRun removes 'at' job", getJob(oneShot.id) === null);

    // runJob on missing id throws.
    let threw = false;
    try { await runJob("does_not_exist"); } catch { threw = true; }
    check("runJob missing id throws", threw === true);

    // sendWakeEvent 'now' invokes handler; 'next-heartbeat' queues without invoking.
    wakeCalls = [];
    const nowRes = await sendWakeEvent("now-text", "now");
    check("sendWakeEvent now sent", nowRes.sent === true);
    check("sendWakeEvent now invoked handler", wakeCalls.includes("now-text"));
    const beforeQueued = wakeCalls.length;
    const hbRes = await sendWakeEvent("later-text", "next-heartbeat");
    check("sendWakeEvent next-heartbeat sent", hbRes.sent === true);
    check("sendWakeEvent next-heartbeat did not invoke handler", wakeCalls.length === beforeQueued);

    stopScheduler();
    check("final cleanup no leaked timers", getSchedulerStatus().scheduledTimers === 0);
  } catch (e) {
    results.error = (e && e.stack) || String(e);
  } finally {
    stopScheduler();
    console.log("__RESULT__" + JSON.stringify(results));
  }
}

main();
`;

interface Assertion {
  label: string;
  ok: boolean;
}
interface WorkerResult {
  assertions: Assertion[];
  error: string | null;
}

let tempHome = "";
let result: WorkerResult;

beforeAll(() => {
  tempHome = mkdtempSync(join(tmpdir(), "cybara-cron-sched-"));
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
});

afterAll(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
});

describe("cron scheduler (isolated HOME, injected handlers, no wall-clock waits)", () => {
  test("worker completed without top-level error", () => {
    expect(result.error).toBeNull();
  });

  test("all scheduler assertions pass", () => {
    const failed = result.assertions.filter((a) => !a.ok).map((a) => a.label);
    expect(failed).toEqual([]);
    expect(result.assertions.length).toBeGreaterThan(30);
  });
});
