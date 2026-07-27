import { createHash, randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { cybaraDir } from "../paths";

interface LockOwner {
  pid: number;
  token: string;
  createdAtMs: number;
}

export interface CronLease {
  release(): void;
}

const LOCKS_DIR = join(cybaraDir, "cron", "locks");
const OWNER_FILE = "owner.json";

function lockPath(name: string): string {
  const digest = createHash("sha256").update(name).digest("hex");
  return join(LOCKS_DIR, digest);
}

function ensureLocksDir(): void {
  mkdirSync(LOCKS_DIR, { recursive: true, mode: 0o700 });
}

function readOwner(path: string): LockOwner | null {
  try {
    const value: unknown = JSON.parse(readFileSync(join(path, OWNER_FILE), "utf8"));
    if (!value || typeof value !== "object") return null;
    const owner = value as Partial<LockOwner>;
    if (
      typeof owner.pid !== "number" ||
      typeof owner.token !== "string" ||
      typeof owner.createdAtMs !== "number"
    ) {
      return null;
    }
    return { pid: owner.pid, token: owner.token, createdAtMs: owner.createdAtMs };
  } catch {
    return null;
  }
}

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function recoverAbandonedLock(path: string): boolean {
  if (!existsSync(path)) return true;
  const owner = readOwner(path);
  if (owner && processIsAlive(owner.pid)) return false;
  if (!owner) {
    try {
      if (Date.now() - statSync(path).mtimeMs < 2_000) return false;
    } catch {
      return true;
    }
  }
  try {
    rmSync(path, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

function tryCreateLease(name: string): CronLease | null {
  ensureLocksDir();
  const path = lockPath(name);
  if (!recoverAbandonedLock(path)) return null;
  const owner: LockOwner = { pid: process.pid, token: randomUUID(), createdAtMs: Date.now() };
  try {
    mkdirSync(path, { mode: 0o700 });
    writeFileSync(join(path, OWNER_FILE), JSON.stringify(owner), { mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {}
    throw error;
  }
  let released = false;
  return {
    release(): void {
      if (released) return;
      released = true;
      if (readOwner(path)?.token !== owner.token) return;
      try {
        rmSync(path, { recursive: true, force: true });
      } catch {}
    },
  };
}

export function acquireCronLease(name: string, timeoutMs: number = 5_000): CronLease {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  do {
    const lease = tryCreateLease(name);
    if (lease) return lease;
    if (Date.now() >= deadline) break;
    Bun.sleepSync(10);
  } while (true);
  throw new Error(`Timed out acquiring cron lock: ${name}`);
}

export function tryAcquireCronLease(name: string): CronLease | null {
  return tryCreateLease(name);
}

export function cronLeaseIsHeld(name: string): boolean {
  const path = lockPath(name);
  return existsSync(path) && !recoverAbandonedLock(path);
}

export function withCronLock<T>(name: string, operation: () => T): T {
  const lease = acquireCronLease(name);
  try {
    return operation();
  } finally {
    lease.release();
  }
}
