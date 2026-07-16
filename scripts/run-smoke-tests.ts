interface SmokeTestJob {
  name: string;
  paths: string[];
}

interface SmokeTestResult {
  name: string;
  exitCode: number;
  durationMs: number;
}

const jobs: SmokeTestJob[] = [
  { name: "core", paths: ["tests/core"] },
  { name: "cli", paths: ["tests/cli"] },
  {
    name: "e2e",
    paths: [
      "tests/e2e/security-auth-smoke.test.ts",
      "tests/e2e/chat-logs-metrics-smoke.test.ts",
      "tests/e2e/terminal-smoke.test.ts",
      "tests/e2e/nearby-transfer-smoke.test.ts",
    ],
  },
  { name: "runtime", paths: ["tests/runtime"] },
  { name: "mobile", paths: ["tests/mobile"] },
  { name: "ui", paths: ["tests/ui"] },
  { name: "tauri", paths: ["tests/tauri"] },
  {
    name: "api",
    paths: [
      "tests/api/security.test.ts",
      "tests/api/browser-routes-mocked.test.ts",
      "tests/api/channel-security-routes-mocked.test.ts",
    ],
  },
];

function smokeWorkerCount(): number {
  const configured = Number.parseInt(process.env.CYBARA_SMOKE_WORKERS ?? "", 10);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.min(jobs.length, configured);
  }
  return Math.min(jobs.length, Math.max(2, Math.min(4, navigator.hardwareConcurrency || 2)));
}

async function runJob(job: SmokeTestJob): Promise<SmokeTestResult> {
  const startedAt = performance.now();
  const child = Bun.spawn(
    [process.execPath, "run", "scripts/run-tests-isolated.ts", ...job.paths],
    {
      cwd: process.cwd(),
      env: process.env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }
  );
  return {
    name: job.name,
    exitCode: await child.exited,
    durationMs: performance.now() - startedAt,
  };
}

async function runJobs(workerCount: number): Promise<SmokeTestResult[]> {
  const pending = [...jobs];
  const results: SmokeTestResult[] = [];
  const workers = Array.from({ length: workerCount }, async () => {
    while (pending.length > 0) {
      const job = pending.shift();
      if (!job) return;
      const result = await runJob(job);
      results.push(result);
    }
  });
  await Promise.all(workers);
  return results;
}

const results = await runJobs(smokeWorkerCount());
for (const result of results) {
  const seconds = (result.durationMs / 1000).toFixed(1);
  const status = result.exitCode === 0 ? "passed" : `failed (${result.exitCode})`;
  console.log(`[smoke] ${result.name} ${status} in ${seconds}s`);
}
if (results.some((result) => result.exitCode !== 0)) {
  process.exitCode = 1;
}
