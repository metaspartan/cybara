import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const STORE_PATH = join(ROOT_DIR, "src", "core", "cron", "store.ts").replace(/\\/g, "/");
const SCHEDULER_PATH = join(ROOT_DIR, "src", "core", "cron", "scheduler.ts").replace(/\\/g, "/");

const SETUP_SOURCE = `
import { createJob } from "${STORE_PATH}";
const job = createJob({
  name: "cross-process-run",
  enabled: true,
  schedule: { kind: "at", atMs: Date.now() + 60_000 },
  sessionTarget: "main",
  wakeMode: "now",
  payload: { kind: "systemEvent", text: "once" },
});
console.log(job.id);
`;

const RUN_SOURCE = `
import { appendFileSync, readFileSync } from "fs";
import { runJob, setWakeHandler, stopScheduler } from "${SCHEDULER_PATH}";
const [jobId, readyPath, executionPath] = process.argv.slice(2);
setWakeHandler(async () => {
  appendFileSync(executionPath, process.pid + "\\n");
  await Bun.sleep(300);
});
appendFileSync(readyPath, process.pid + "\\n");
while (readFileSync(readyPath, "utf8").trim().split("\\n").filter(Boolean).length < 2) {
  await Bun.sleep(5);
}
const log = await runJob(jobId);
stopScheduler();
console.log(JSON.stringify(log));
`;

const CREATE_SOURCE = `
import { appendFileSync, readFileSync } from "fs";
import { createJob } from "${STORE_PATH}";
const [readyPath, worker, countText] = process.argv.slice(2);
const count = Number(countText);
appendFileSync(readyPath, process.pid + "\\n");
while (readFileSync(readyPath, "utf8").trim().split("\\n").filter(Boolean).length < 4) {
  await Bun.sleep(5);
}
for (let index = 0; index < count; index++) {
  createJob({
    name: worker + "-" + index,
    enabled: false,
    schedule: { kind: "every", everyMs: 60_000 },
    sessionTarget: "main",
    wakeMode: "next-heartbeat",
    payload: { kind: "systemEvent", text: "created" },
  });
}
`;

const COUNT_SOURCE = `
import { listJobs } from "${STORE_PATH}";
console.log(listJobs().length);
`;

interface RunResult {
  status: "ok" | "skipped";
}

let tempHome = "";
let sharedEnv: Record<string, string | undefined> = {};
let jobId = "";
let runResults: RunResult[] = [];
let executionCount = 0;
let finalJobCount = 0;

async function runWorker(
  scriptPath: string,
  args: string[] = []
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = Bun.spawn([process.execPath, "run", scriptPath, ...args], {
    cwd: ROOT_DIR,
    env: sharedEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

beforeAll(async () => {
  tempHome = mkdtempSync(join(tmpdir(), "cybara-cron-multiprocess-"));
  sharedEnv = {
    ...process.env,
    HOME: tempHome,
    USERPROFILE: tempHome,
    CYBARA_HOME: join(tempHome, ".cybara"),
  };
  const setupPath = join(tempHome, "setup.ts");
  const runPath = join(tempHome, "run.ts");
  const createPath = join(tempHome, "create.ts");
  const countPath = join(tempHome, "count.ts");
  const runReadyPath = join(tempHome, "run-ready.txt");
  const createReadyPath = join(tempHome, "create-ready.txt");
  const executionPath = join(tempHome, "executions.txt");
  writeFileSync(setupPath, SETUP_SOURCE);
  writeFileSync(runPath, RUN_SOURCE);
  writeFileSync(createPath, CREATE_SOURCE);
  writeFileSync(countPath, COUNT_SOURCE);
  writeFileSync(runReadyPath, "");
  writeFileSync(createReadyPath, "");
  writeFileSync(executionPath, "");

  const setup = await runWorker(setupPath);
  if (setup.exitCode !== 0) throw new Error(setup.stderr || setup.stdout);
  jobId = setup.stdout.trim().split("\n").at(-1) ?? "";

  const runs = await Promise.all([
    runWorker(runPath, [jobId, runReadyPath, executionPath]),
    runWorker(runPath, [jobId, runReadyPath, executionPath]),
  ]);
  for (const run of runs) {
    if (run.exitCode !== 0) throw new Error(run.stderr || run.stdout);
  }
  runResults = runs.map((run) => JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "{}"));
  executionCount = readFileSync(executionPath, "utf8").trim().split("\n").filter(Boolean).length;

  const creators = await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      runWorker(createPath, [createReadyPath, `worker-${index}`, "25"])
    )
  );
  for (const creator of creators) {
    if (creator.exitCode !== 0) throw new Error(creator.stderr || creator.stdout);
  }
  const count = await runWorker(countPath);
  if (count.exitCode !== 0) throw new Error(count.stderr || count.stdout);
  finalJobCount = Number(count.stdout.trim().split("\n").at(-1));
});

afterAll(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
});

describe("cron cross-process coordination", () => {
  test("executes one side effect when two gateways trigger the same job", () => {
    expect(runResults.map((result) => result.status).sort()).toEqual(["ok", "skipped"]);
    expect(executionCount).toBe(1);
  });

  test("retains every concurrent job creation", () => {
    expect(finalJobCount).toBe(101);
  });
});
