import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import type { CronJob, CronJobCreate, CronJobPatch, CronStoreFile, CronRunLog } from "./types";
import { nextCronRun } from "./cron-expr";

const CRON_DIR = join(process.env.HOME || process.env.USERPROFILE || homedir(), ".cybara", "cron");
const JOBS_FILE = join(CRON_DIR, "jobs.json");
const RUNS_FILE = join(CRON_DIR, "runs.json");
const MAX_RUN_LOGS = 100;

function ensureDir(): void {
  if (!existsSync(CRON_DIR)) {
    mkdirSync(CRON_DIR, { recursive: true, mode: 0o700 });
  }
}

export function loadJobs(): CronJob[] {
  ensureDir();
  const store = readJsonWithBackup(JOBS_FILE, isCronStoreFile);
  return store?.jobs ?? [];
}

function readJsonWithBackup<T>(
  filePath: string,
  validate: (value: unknown) => value is T
): T | null {
  for (const candidate of [filePath, `${filePath}.bak`]) {
    if (!existsSync(candidate)) continue;
    try {
      const value: unknown = JSON.parse(readFileSync(candidate, "utf-8"));
      if (validate(value)) return value;
    } catch {
      continue;
    }
  }
  return null;
}

function isCronStoreFile(value: unknown): value is CronStoreFile {
  if (!value || typeof value !== "object") return false;
  return Array.isArray((value as { jobs?: unknown }).jobs);
}

function isCronRunLogs(value: unknown): value is CronRunLog[] {
  return Array.isArray(value);
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  ensureDir();
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    if (existsSync(filePath)) {
      try {
        JSON.parse(readFileSync(filePath, "utf-8"));
        copyFileSync(filePath, `${filePath}.bak`);
      } catch {
        void 0;
      }
    }
    writeFileSync(tempPath, JSON.stringify(value, null, 2), { mode: 0o600 });
    renameSync(tempPath, filePath);
  } finally {
    if (existsSync(tempPath)) unlinkSync(tempPath);
  }
}

export function saveJobs(jobs: CronJob[]): void {
  const store: CronStoreFile = { version: 1, jobs };
  writeJsonAtomic(JOBS_FILE, store);
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
      if (!Number.isFinite(interval) || interval <= 0) {
        throw new Error("Interval schedule must be greater than zero");
      }

      const elapsed = fromMs - anchor;
      if (elapsed < 0) return anchor;
      const periods = Math.floor(elapsed / interval) + 1;
      return anchor + periods * interval;
    }

    case "cron":
      return nextCronRun(schedule.expr, fromMs, schedule.tz);

    default:
      throw new Error("Unsupported cron schedule");
  }
}

export function loadRunLogs(): CronRunLog[] {
  ensureDir();
  return readJsonWithBackup(RUNS_FILE, isCronRunLogs) ?? [];
}

export function saveRunLogs(logs: CronRunLog[]): void {
  const trimmed = logs.slice(-MAX_RUN_LOGS);
  writeJsonAtomic(RUNS_FILE, trimmed);
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
