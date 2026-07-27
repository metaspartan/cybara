import type { CronJob, CronRunLog } from "./types";
import {
  getJob,
  listJobs,
  computeNextRun,
  addRunLog,
  getRunLogs,
  removeJob,
  updateJob,
} from "./store";
import { cronLeaseIsHeld, tryAcquireCronLease } from "./file-lock";

const jobTimers = new Map<string, NodeJS.Timeout>();
const activeRuns = new Map<string, Promise<CronRunLog>>();
const EXTERNAL_RUN_RECHECK_MS = 1_000;

type WakeHandler = (text: string) => Promise<void>;
let wakeHandler: WakeHandler | null = null;

type AgentHandler = (job: CronJob) => Promise<{ success: boolean; error?: string }>;
let agentHandler: AgentHandler | null = null;

export function setWakeHandler(handler: WakeHandler): void {
  wakeHandler = handler;
}

export function setAgentHandler(handler: AgentHandler): void {
  agentHandler = handler;
}

export function startScheduler(): void {
  console.log("[Cron] Starting scheduler...");

  const jobs = listJobs(false);
  for (const job of jobs) {
    try {
      scheduleJob(job);
    } catch (error) {
      console.error(`[Cron] Unable to schedule job ${job.id}:`, error);
    }
  }

  console.log(`[Cron] Scheduled ${jobs.length} jobs`);
}

export function stopScheduler(): void {
  console.log("[Cron] Stopping scheduler...");

  for (const [jobId, timer] of jobTimers) {
    clearTimeout(timer);
    jobTimers.delete(jobId);
  }
}

export function scheduleJob(job: CronJob): void {
  const existingTimer = jobTimers.get(job.id);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  if (!job.enabled) {
    jobTimers.delete(job.id);
    return;
  }

  const now = Date.now();
  const nextRun = job.state.nextRunAtMs || computeNextRun(job.schedule, now);
  const delay = Math.max(0, nextRun - now);

  const maxDelay = 24 * 60 * 60 * 1000;
  const effectiveDelay = Math.min(delay, maxDelay);

  console.log(`[Cron] Job ${job.id} scheduled to run in ${Math.round(effectiveDelay / 1000)}s`);

  const timer = setTimeout(() => {
    runJob(job.id)
      .then((log) => {
        if (log.status === "skipped") scheduleAfterExternalRun(job.id);
      })
      .catch((err) => {
        console.error(`[Cron] Error running job ${job.id}:`, err);
      });
  }, effectiveDelay);

  jobTimers.set(job.id, timer);
}

function scheduleAfterExternalRun(jobId: string): void {
  const timer = setTimeout(() => {
    if (cronLeaseIsHeld(`run:${jobId}`)) {
      scheduleAfterExternalRun(jobId);
      return;
    }
    const job = getJob(jobId);
    if (job?.enabled && job.schedule.kind !== "at") scheduleJob(job);
    else jobTimers.delete(jobId);
  }, EXTERNAL_RUN_RECHECK_MS);
  jobTimers.set(jobId, timer);
}

async function executeJob(jobId: string): Promise<CronRunLog> {
  const job = getJob(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const startedAtMs = Date.now();

  const runLog: CronRunLog = {
    jobId,
    runId,
    startedAtMs,
    status: "running",
  };

  updateJobState(jobId, { runningAtMs: startedAtMs });

  try {
    if (job.payload.kind === "systemEvent") {
      if (wakeHandler) {
        await wakeHandler(job.payload.text);
      } else {
        console.log(`[Cron] System event: ${job.payload.text}`);
      }
    } else if (job.payload.kind === "agentTurn") {
      if (agentHandler) {
        const result = await agentHandler(job);
        if (!result.success) {
          throw new Error(result.error || "Agent execution failed");
        }
      } else {
        console.log(`[Cron] Agent turn: ${job.payload.message}`);
      }
    }

    const completedAtMs = Date.now();
    runLog.completedAtMs = completedAtMs;
    runLog.status = "ok";
    runLog.durationMs = completedAtMs - startedAtMs;

    console.log(`[Cron] Job ${jobId} completed in ${runLog.durationMs}ms`);
  } catch (error) {
    const completedAtMs = Date.now();
    runLog.completedAtMs = completedAtMs;
    runLog.status = "error";
    runLog.error = (error as Error).message;
    runLog.durationMs = completedAtMs - startedAtMs;

    console.error(`[Cron] Job ${jobId} failed:`, error);
  }

  const current = getJob(jobId);
  if (!current) {
    addRunLog(runLog);
    return runLog;
  }

  if (current.deleteAfterRun && current.schedule.kind === "at") {
    removeJob(jobId);
    jobTimers.delete(jobId);
  } else {
    const now = Date.now();
    const state = {
      lastRunAtMs: runLog.completedAtMs,
      lastStatus: runLog.status,
      lastError: runLog.error,
      lastDurationMs: runLog.durationMs,
      runningAtMs: undefined,
      nextRunAtMs: computeNextRun(current.schedule, now),
    };
    updateJobState(jobId, state);

    const updated = getJob(jobId);
    if (updated && updated.schedule.kind !== "at" && updated.enabled) {
      scheduleJob(updated);
    }
  }

  addRunLog(runLog);

  return runLog;
}

function updateJobState(jobId: string, state: CronJob["state"]): void {
  updateJob(jobId, { state });
}

export function runJob(jobId: string): Promise<CronRunLog> {
  const active = activeRuns.get(jobId);
  if (active) return active;

  const run: Promise<CronRunLog> = (async (): Promise<CronRunLog> => {
    const lease = tryAcquireCronLease(`run:${jobId}`);
    if (!lease) {
      const now = Date.now();
      return {
        jobId,
        runId: `skip_${now}_${Math.random().toString(36).slice(2, 6)}`,
        startedAtMs: now,
        completedAtMs: now,
        status: "skipped",
        error: "Job is already running in another gateway process",
        durationMs: 0,
      };
    }
    try {
      return await executeJob(jobId);
    } finally {
      lease.release();
    }
  })().finally(() => {
    if (activeRuns.get(jobId) === run) activeRuns.delete(jobId);
  });
  activeRuns.set(jobId, run);
  return run;
}

export async function sendWakeEvent(
  text: string,
  mode: "now" | "next-heartbeat" = "next-heartbeat"
): Promise<{ sent: boolean }> {
  if (mode === "now" && wakeHandler) {
    await wakeHandler(text);
    return { sent: true };
  }

  console.log(`[Cron] Wake event queued (${mode}): ${text}`);
  return { sent: true };
}

export function getSchedulerStatus(): {
  running: boolean;
  activeJobs: number;
  scheduledTimers: number;
} {
  return {
    running: jobTimers.size > 0,
    activeJobs: listJobs(false).length,
    scheduledTimers: jobTimers.size,
  };
}

export function cancelJobTimer(jobId: string): boolean {
  const timer = jobTimers.get(jobId);
  if (timer) {
    clearTimeout(timer);
    jobTimers.delete(jobId);
    return true;
  }
  return false;
}

export { getRunLogs };
