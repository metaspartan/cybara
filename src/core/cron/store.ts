import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { CronJob, CronJobCreate, CronJobPatch, CronStoreFile, CronRunLog } from "./types";

const CRON_DIR = join(process.env.HOME || process.env.USERPROFILE || homedir(), ".cybara", "cron");
const JOBS_FILE = join(CRON_DIR, "jobs.json");
const RUNS_FILE = join(CRON_DIR, "runs.json");
const MAX_RUN_LOGS = 100;

function ensureDir(): void {
  if (!existsSync(CRON_DIR)) {
    mkdirSync(CRON_DIR, { recursive: true });
  }
}

export function loadJobs(): CronJob[] {
  ensureDir();
  if (!existsSync(JOBS_FILE)) {
    return [];
  }
  try {
    const data = JSON.parse(readFileSync(JOBS_FILE, "utf-8")) as CronStoreFile;
    return data.jobs || [];
  } catch {
    return [];
  }
}

export function saveJobs(jobs: CronJob[]): void {
  ensureDir();
  const store: CronStoreFile = { version: 1, jobs };
  writeFileSync(JOBS_FILE, JSON.stringify(store, null, 2));
}

function generateId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createJob(input: CronJobCreate): CronJob {
  const now = Date.now();
  const job: CronJob = {
    id: generateId(),
    name: input.name || "Unnamed job",
    description: input.description,
    enabled: input.enabled ?? true,
    deleteAfterRun: input.deleteAfterRun,
    createdAtMs: now,
    updatedAtMs: now,
    schedule: input.schedule,
    sessionTarget: input.sessionTarget,
    wakeMode: input.wakeMode || "next-heartbeat",
    payload: input.payload,
    agentId: input.agentId,
    state: {
      ...input.state,
      nextRunAtMs: computeNextRun(input.schedule, now),
    },
  };

  const jobs = loadJobs();
  jobs.push(job);
  saveJobs(jobs);

  return job;
}

export function updateJob(id: string, patch: CronJobPatch): CronJob | null {
  const jobs = loadJobs();
  const index = jobs.findIndex((j) => j.id === id);
  if (index === -1) return null;

  const job = jobs[index];
  const now = Date.now();

  if (patch.name !== undefined) job.name = patch.name;
  if (patch.description !== undefined) job.description = patch.description;
  if (patch.enabled !== undefined) job.enabled = patch.enabled;
  if (patch.deleteAfterRun !== undefined) job.deleteAfterRun = patch.deleteAfterRun;
  if (patch.schedule !== undefined) {
    job.schedule = patch.schedule;
    job.state.nextRunAtMs = computeNextRun(patch.schedule, now);
  }
  if (patch.sessionTarget !== undefined) job.sessionTarget = patch.sessionTarget;
  if (patch.wakeMode !== undefined) job.wakeMode = patch.wakeMode;
  if (patch.agentId !== undefined) job.agentId = patch.agentId;

  if (patch.payload) {
    if (patch.payload.kind === "systemEvent" && job.payload.kind === "systemEvent") {
      if (patch.payload.text !== undefined) job.payload.text = patch.payload.text;
    } else if (patch.payload.kind === "agentTurn" && job.payload.kind === "agentTurn") {
      if (patch.payload.message !== undefined) job.payload.message = patch.payload.message;
      if (patch.payload.model !== undefined) job.payload.model = patch.payload.model;
      if (patch.payload.thinking !== undefined) job.payload.thinking = patch.payload.thinking;
      if (patch.payload.timeoutSeconds !== undefined)
        job.payload.timeoutSeconds = patch.payload.timeoutSeconds;
      if (patch.payload.deliver !== undefined) job.payload.deliver = patch.payload.deliver;
      if (patch.payload.channel !== undefined) job.payload.channel = patch.payload.channel;
      if (patch.payload.to !== undefined) job.payload.to = patch.payload.to;
    }
  }

  if (patch.state) {
    Object.assign(job.state, patch.state);
  }

  job.updatedAtMs = now;
  jobs[index] = job;
  saveJobs(jobs);

  return job;
}

export function removeJob(id: string): boolean {
  const jobs = loadJobs();
  const index = jobs.findIndex((j) => j.id === id);
  if (index === -1) return false;

  jobs.splice(index, 1);
  saveJobs(jobs);
  return true;
}

export function getJob(id: string): CronJob | null {
  const jobs = loadJobs();
  return jobs.find((j) => j.id === id) || null;
}

export function listJobs(includeDisabled: boolean = true): CronJob[] {
  const jobs = loadJobs();
  return includeDisabled ? jobs : jobs.filter((j) => j.enabled);
}

export function computeNextRun(schedule: CronJob["schedule"], fromMs: number = Date.now()): number {
  switch (schedule.kind) {
    case "at":
      return schedule.atMs > fromMs ? schedule.atMs : fromMs;

    case "every": {
      const anchor = schedule.anchorMs || fromMs;
      const interval = schedule.everyMs;
      if (interval <= 0) return fromMs + 60000; // Default 1 minute

      const elapsed = fromMs - anchor;
      const periods = Math.ceil(elapsed / interval);
      return anchor + periods * interval;
    }

    case "cron":
      return fromMs + 60000;

    default:
      return fromMs + 60000;
  }
}

export function loadRunLogs(): CronRunLog[] {
  ensureDir();
  if (!existsSync(RUNS_FILE)) {
    return [];
  }
  try {
    return JSON.parse(readFileSync(RUNS_FILE, "utf-8")) as CronRunLog[];
  } catch {
    return [];
  }
}

export function saveRunLogs(logs: CronRunLog[]): void {
  ensureDir();
  const trimmed = logs.slice(-MAX_RUN_LOGS);
  writeFileSync(RUNS_FILE, JSON.stringify(trimmed, null, 2));
}

export function addRunLog(log: CronRunLog): void {
  const logs = loadRunLogs();
  logs.push(log);
  saveRunLogs(logs);
}

export function getRunLogs(jobId: string, limit: number = 10): CronRunLog[] {
  const logs = loadRunLogs();
  return logs.filter((l) => l.jobId === jobId).slice(-limit);
}
