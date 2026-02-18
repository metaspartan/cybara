import type { CronJob, CronRunLog } from "./types";
import {
  loadJobs,
  saveJobs,
  getJob,
  listJobs,
  computeNextRun,
  addRunLog,
  getRunLogs,
} from "./store";

const jobTimers = new Map<string, NodeJS.Timeout>();

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

  const jobs = listJobs(false); // Only enabled jobs
  for (const job of jobs) {
    scheduleJob(job);
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
    runJob(job.id).catch((err) => {
      console.error(`[Cron] Error running job ${job.id}:`, err);
    });
  }, effectiveDelay);

  jobTimers.set(job.id, timer);
}

export async function runJob(jobId: string): Promise<CronRunLog> {
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

  job.state.runningAtMs = startedAtMs;

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

    job.state.lastRunAtMs = completedAtMs;
    job.state.lastStatus = "ok";
    job.state.lastDurationMs = runLog.durationMs;
    job.state.runningAtMs = undefined;

    console.log(`[Cron] Job ${jobId} completed in ${runLog.durationMs}ms`);
  } catch (error) {
    const completedAtMs = Date.now();
    runLog.completedAtMs = completedAtMs;
    runLog.status = "error";
    runLog.error = (error as Error).message;
    runLog.durationMs = completedAtMs - startedAtMs;

    job.state.lastRunAtMs = completedAtMs;
    job.state.lastStatus = "error";
    job.state.lastError = runLog.error;
    job.state.lastDurationMs = runLog.durationMs;
    job.state.runningAtMs = undefined;

    console.error(`[Cron] Job ${jobId} failed:`, error);
  }

  if (job.deleteAfterRun && job.schedule.kind === "at") {
    const jobs = loadJobs();
    const index = jobs.findIndex((j) => j.id === jobId);
    if (index !== -1) {
      jobs.splice(index, 1);
      saveJobs(jobs);
    }
    jobTimers.delete(jobId);
  } else {
    const now = Date.now();
    job.state.nextRunAtMs = computeNextRun(job.schedule, now);

    const jobs = loadJobs();
    const index = jobs.findIndex((j) => j.id === jobId);
    if (index !== -1) {
      jobs[index] = job;
      saveJobs(jobs);
    }

    if (job.schedule.kind !== "at" && job.enabled) {
      scheduleJob(job);
    }
  }

  addRunLog(runLog);

  return runLog;
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
