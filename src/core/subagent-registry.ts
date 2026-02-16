// Subagent Registry - OpenClaw compatible tracking of spawned subagent runs
// Full parity with OpenClaw: persistence, lifecycle events, announce flow, sweeper

import { randomUUID } from "crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { EventEmitter } from "events";

// ============================================
// TYPES
// ============================================

export type SubagentRunOutcome = {
  status: "ok" | "error" | "timeout";
  error?: string;
};

export type DeliveryContext = {
  channel?: string;
  to?: string;
  accountId?: string;
  chatId?: string;
};

export interface SubagentRunRecord {
  runId: string;
  childSessionKey: string;
  requesterSessionKey: string;
  requesterDisplayKey: string;
  requesterOrigin?: DeliveryContext;
  task: string;
  cleanup: "keep" | "delete";
  label?: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  outcome?: SubagentRunOutcome;
  archiveAtMs?: number;
  cleanupCompletedAt?: number;
  cleanupHandled?: boolean;
}

// ============================================
// CONFIGURATION
// ============================================

interface SubagentConfig {
  archiveAfterMinutes: number;
  defaultTimeoutSeconds: number;
  persistPath: string;
}

const DEFAULT_CONFIG: SubagentConfig = {
  archiveAfterMinutes: 60,
  defaultTimeoutSeconds: 600, // 10 minutes
  persistPath: join(homedir(), ".cybara", "subagent-registry.json"),
};

let config: SubagentConfig = { ...DEFAULT_CONFIG };

export function configureSubagentRegistry(cfg: Partial<SubagentConfig>): void {
  config = { ...config, ...cfg };
}

// ============================================
// STATE
// ============================================

const subagentRuns = new Map<string, SubagentRunRecord>();
const resumedRuns = new Set<string>();
let sweeper: ReturnType<typeof setInterval> | null = null;
let listenerStarted = false;
let restoreAttempted = false;

// Event emitter for lifecycle events
const lifecycleEmitter = new EventEmitter();

// ============================================
// PERSISTENCE
// ============================================

function persistSubagentRuns(): void {
  try {
    const dir = config.persistPath.substring(0, config.persistPath.lastIndexOf("/"));
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const data = JSON.stringify(Array.from(subagentRuns.entries()), null, 2);
    writeFileSync(config.persistPath, data, "utf8");
  } catch (err) {
    console.error("[Subagent] Failed to persist registry:", err);
  }
}

function loadSubagentRegistryFromDisk(): Map<string, SubagentRunRecord> {
  try {
    if (!existsSync(config.persistPath)) {
      return new Map();
    }
    const data = readFileSync(config.persistPath, "utf8");
    const entries = JSON.parse(data) as [string, SubagentRunRecord][];
    return new Map(entries);
  } catch (err) {
    console.error("[Subagent] Failed to load registry:", err);
    return new Map();
  }
}

// ============================================
// SWEEPER (Cleanup old runs)
// ============================================

function resolveArchiveAfterMs(): number | undefined {
  const minutes = config.archiveAfterMinutes;
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return undefined;
  }
  return Math.max(1, Math.floor(minutes)) * 60_000;
}

function startSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(() => {
    void sweepSubagentRuns();
  }, 60_000);
  // Allow process to exit even if sweeper is running
  if (sweeper.unref) {
    sweeper.unref();
  }
}

function stopSweeper(): void {
  if (!sweeper) return;
  clearInterval(sweeper);
  sweeper = null;
}

async function sweepSubagentRuns(): Promise<void> {
  const now = Date.now();
  let mutated = false;

  for (const [runId, entry] of subagentRuns.entries()) {
    if (!entry.archiveAtMs || entry.archiveAtMs > now) {
      continue;
    }

    // Archive: delete from registry
    subagentRuns.delete(runId);
    mutated = true;
    console.log(`[Subagent] Archived run ${runId} (child: ${entry.childSessionKey})`);

    // Emit archive event for cleanup
    lifecycleEmitter.emit("archive", {
      runId,
      childSessionKey: entry.childSessionKey,
    });
  }

  if (mutated) {
    persistSubagentRuns();
  }

  if (subagentRuns.size === 0) {
    stopSweeper();
  }
}

// ============================================
// LIFECYCLE EVENTS
// ============================================

export type LifecycleEventType = "start" | "end" | "error" | "archive" | "announce";

export interface LifecycleEvent {
  runId: string;
  type: LifecycleEventType;
  data?: Record<string, unknown>;
}

export function onSubagentLifecycle(callback: (event: LifecycleEvent) => void): () => void {
  const handler = (data: LifecycleEvent) => callback(data);
  lifecycleEmitter.on("lifecycle", handler);
  return () => lifecycleEmitter.off("lifecycle", handler);
}

function emitLifecycle(event: LifecycleEvent): void {
  lifecycleEmitter.emit("lifecycle", event);
}

function ensureListener(): void {
  if (listenerStarted) return;
  listenerStarted = true;

  // Internal listener for run tracking updates
  lifecycleEmitter.on("lifecycle", (evt: LifecycleEvent) => {
    const entry = subagentRuns.get(evt.runId);
    if (!entry) return;

    if (evt.type === "start") {
      const startedAt = typeof evt.data?.startedAt === "number" ? evt.data.startedAt : Date.now();
      entry.startedAt = startedAt;
      persistSubagentRuns();
    }

    if (evt.type === "end" || evt.type === "error") {
      const endedAt = typeof evt.data?.endedAt === "number" ? evt.data.endedAt : Date.now();
      entry.endedAt = endedAt;

      if (evt.type === "error") {
        const error = typeof evt.data?.error === "string" ? evt.data.error : undefined;
        entry.outcome = { status: "error", error };
      } else {
        entry.outcome = { status: "ok" };
      }

      persistSubagentRuns();

      // Trigger announce flow
      if (beginSubagentCleanup(evt.runId)) {
        void runAnnounceFlow(evt.runId).then((didAnnounce) => {
          finalizeSubagentCleanup(evt.runId, entry.cleanup, didAnnounce);
        });
      }
    }
  });
}

// ============================================
// ANNOUNCE FLOW
// ============================================

async function runAnnounceFlow(runId: string): Promise<boolean> {
  const entry = subagentRuns.get(runId);
  if (!entry) return false;

  try {
    // Build summary message for requester
    const duration =
      entry.endedAt && entry.startedAt ? Math.round((entry.endedAt - entry.startedAt) / 1000) : 0;
    const status = entry.outcome?.status === "ok" ? "✅" : "❌";
    const label = entry.label || entry.task.slice(0, 50);

    const message = [
      `${status} **Subagent completed**: ${label}`,
      `Duration: ${duration}s`,
      entry.outcome?.error ? `Error: ${entry.outcome.error}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // Emit announce event for delivery
    emitLifecycle({
      runId,
      type: "announce",
      data: {
        requesterSessionKey: entry.requesterSessionKey,
        message,
        outcome: entry.outcome,
        duration,
      },
    });

    console.log(`[Subagent] Announced completion for ${runId}`);
    return true;
  } catch (err) {
    console.error(`[Subagent] Announce failed for ${runId}:`, err);
    return false;
  }
}

// ============================================
// CLEANUP COORDINATION
// ============================================

function beginSubagentCleanup(runId: string): boolean {
  const entry = subagentRuns.get(runId);
  if (!entry) return false;
  if (entry.cleanupCompletedAt) return false;
  if (entry.cleanupHandled) return false;

  entry.cleanupHandled = true;
  persistSubagentRuns();
  return true;
}

function finalizeSubagentCleanup(
  runId: string,
  cleanup: "delete" | "keep",
  didAnnounce: boolean
): void {
  const entry = subagentRuns.get(runId);
  if (!entry) return;

  if (cleanup === "delete") {
    // Immediate deletion
    subagentRuns.delete(runId);
    persistSubagentRuns();
    console.log(`[Subagent] Deleted run ${runId} (cleanup=delete)`);
    return;
  }

  if (!didAnnounce) {
    // Allow retry on next wake if announce failed
    entry.cleanupHandled = false;
    persistSubagentRuns();
    return;
  }

  entry.cleanupCompletedAt = Date.now();
  persistSubagentRuns();
}

// ============================================
// RESUME (After restart)
// ============================================

function resumeSubagentRun(runId: string): void {
  if (!runId || resumedRuns.has(runId)) return;

  const entry = subagentRuns.get(runId);
  if (!entry) return;
  if (entry.cleanupCompletedAt) return;

  // If already ended, trigger announce flow
  if (typeof entry.endedAt === "number" && entry.endedAt > 0) {
    if (beginSubagentCleanup(runId)) {
      void runAnnounceFlow(runId).then((didAnnounce) => {
        finalizeSubagentCleanup(runId, entry.cleanup, didAnnounce);
      });
    }
    resumedRuns.add(runId);
    return;
  }

  // Otherwise wait for completion
  const timeoutMs = config.defaultTimeoutSeconds * 1000;
  void waitForSubagentCompletion(runId, timeoutMs);
  resumedRuns.add(runId);
}

function restoreSubagentRunsOnce(): void {
  if (restoreAttempted) return;
  restoreAttempted = true;

  try {
    const restored = loadSubagentRegistryFromDisk();
    if (restored.size === 0) return;

    for (const [runId, entry] of restored.entries()) {
      if (!runId || !entry) continue;
      // Keep any newer in-memory entries
      if (!subagentRuns.has(runId)) {
        subagentRuns.set(runId, entry);
      }
    }

    // Resume pending work
    ensureListener();
    if ([...subagentRuns.values()].some((e) => e.archiveAtMs)) {
      startSweeper();
    }
    for (const runId of subagentRuns.keys()) {
      resumeSubagentRun(runId);
    }

    console.log(`[Subagent] Restored ${restored.size} runs from disk`);
  } catch (err) {
    console.error("[Subagent] Failed to restore registry:", err);
  }
}

// ============================================
// TIMEOUT HANDLING
// ============================================

const runTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function waitForSubagentCompletion(runId: string, timeoutMs: number): Promise<void> {
  // Clear any existing timer
  const existingTimer = runTimers.get(runId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Set timeout timer
  const timer = setTimeout(() => {
    const entry = subagentRuns.get(runId);
    if (!entry) return;
    if (entry.endedAt) return; // Already completed

    // Timeout - mark as error
    entry.endedAt = Date.now();
    entry.outcome = {
      status: "timeout",
      error: `Timed out after ${Math.round(timeoutMs / 1000)}s`,
    };
    persistSubagentRuns();

    emitLifecycle({
      runId,
      type: "error",
      data: {
        endedAt: entry.endedAt,
        error: entry.outcome.error,
      },
    });

    runTimers.delete(runId);
  }, timeoutMs);

  runTimers.set(runId, timer);
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Register a new subagent run.
 */
export function registerSubagentRun(params: {
  runId?: string;
  childSessionKey: string;
  requesterSessionKey: string;
  requesterOrigin?: DeliveryContext;
  requesterDisplayKey?: string;
  task: string;
  cleanup?: "keep" | "delete";
  label?: string;
  runTimeoutSeconds?: number;
}): SubagentRunRecord {
  const runId = params.runId || randomUUID();
  const now = Date.now();
  const archiveAfterMs = resolveArchiveAfterMs();
  const archiveAtMs = archiveAfterMs ? now + archiveAfterMs : undefined;
  const timeoutMs = (params.runTimeoutSeconds ?? config.defaultTimeoutSeconds) * 1000;

  const run: SubagentRunRecord = {
    runId,
    childSessionKey: params.childSessionKey,
    requesterSessionKey: params.requesterSessionKey,
    requesterDisplayKey: params.requesterDisplayKey || params.requesterSessionKey,
    requesterOrigin: params.requesterOrigin,
    task: params.task,
    cleanup: params.cleanup || "keep",
    label: params.label,
    createdAt: now,
    startedAt: now,
    archiveAtMs,
    cleanupHandled: false,
  };

  subagentRuns.set(runId, run);
  ensureListener();
  persistSubagentRuns();

  if (archiveAfterMs) {
    startSweeper();
  }

  // Start timeout tracking
  void waitForSubagentCompletion(runId, timeoutMs);

  console.log(`[Subagent] Registered run ${runId} for child session ${params.childSessionKey}`);
  return run;
}

/**
 * Mark a run as started (running).
 */
export function markRunStarted(runId: string): boolean {
  const entry = subagentRuns.get(runId);
  if (!entry) return false;

  entry.startedAt = Date.now();
  persistSubagentRuns();

  emitLifecycle({
    runId,
    type: "start",
    data: { startedAt: entry.startedAt },
  });

  return true;
}

/**
 * Mark a run as completed with a result.
 */
export function markRunCompleted(runId: string, result?: string): boolean {
  const entry = subagentRuns.get(runId);
  if (!entry) return false;

  entry.endedAt = Date.now();
  entry.outcome = { status: "ok" };
  persistSubagentRuns();

  // Clear timeout timer
  const timer = runTimers.get(runId);
  if (timer) {
    clearTimeout(timer);
    runTimers.delete(runId);
  }

  emitLifecycle({
    runId,
    type: "end",
    data: { endedAt: entry.endedAt, result },
  });

  return true;
}

/**
 * Mark a run as failed with an error.
 */
export function markRunFailed(runId: string, error: string): boolean {
  const entry = subagentRuns.get(runId);
  if (!entry) return false;

  entry.endedAt = Date.now();
  entry.outcome = { status: "error", error };
  persistSubagentRuns();

  // Clear timeout timer
  const timer = runTimers.get(runId);
  if (timer) {
    clearTimeout(timer);
    runTimers.delete(runId);
  }

  emitLifecycle({
    runId,
    type: "error",
    data: { endedAt: entry.endedAt, error },
  });

  return true;
}

/**
 * Get a run by ID.
 */
export function getRun(runId: string): SubagentRunRecord | undefined {
  return subagentRuns.get(runId);
}

/**
 * Get a run by child session key.
 */
export function getRunBySessionKey(childSessionKey: string): SubagentRunRecord | undefined {
  for (const run of subagentRuns.values()) {
    if (run.childSessionKey === childSessionKey) {
      return run;
    }
  }
  return undefined;
}

/**
 * Get all runs for a requester session.
 */
export function getRunsByRequester(requesterSessionKey: string): SubagentRunRecord[] {
  const key = requesterSessionKey.trim();
  if (!key) return [];
  return [...subagentRuns.values()].filter((r) => r.requesterSessionKey === key);
}

/**
 * Get all active runs.
 */
export function listActiveRuns(): SubagentRunRecord[] {
  return [...subagentRuns.values()].filter((r) => !r.endedAt || r.endedAt === 0);
}

/**
 * Get all runs (including completed).
 */
export function listAllRuns(): SubagentRunRecord[] {
  return [...subagentRuns.values()];
}

/**
 * Release/delete a run manually.
 */
export function releaseSubagentRun(runId: string): boolean {
  const timer = runTimers.get(runId);
  if (timer) {
    clearTimeout(timer);
    runTimers.delete(runId);
  }

  const didDelete = subagentRuns.delete(runId);
  if (didDelete) {
    persistSubagentRuns();
  }
  if (subagentRuns.size === 0) {
    stopSweeper();
  }
  return didDelete;
}

/**
 * Clean up old completed runs (older than maxAgeMs).
 */
export function cleanupOldRuns(maxAgeMs: number = 3600000): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [runId, run] of subagentRuns.entries()) {
    // Use endedAt (the actual field) instead of completedAt
    if (run.endedAt && now - run.endedAt > maxAgeMs) {
      subagentRuns.delete(runId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    persistSubagentRuns();
    console.log(`[Subagent] Cleaned up ${cleaned} old runs`);
  }

  return cleaned;
}

/**
 * Check if a session key is a subagent session.
 */
export function isSubagentSessionKey(sessionKey: string): boolean {
  return sessionKey.includes(":subagent:") || sessionKey.startsWith("subagent:");
}

/**
 * Parse a session key to extract agent ID.
 */
export function parseAgentSessionKey(sessionKey: string): {
  agentId?: string;
  isSubagent: boolean;
} {
  const parts = sessionKey.split(":");
  if (parts.length >= 2 && parts[0] === "agent") {
    return {
      agentId: parts[1],
      isSubagent: parts.length >= 4 && parts[2] === "subagent",
    };
  }
  return { isSubagent: isSubagentSessionKey(sessionKey) };
}

/**
 * Generate a new subagent session key.
 */
export function generateSubagentSessionKey(agentId: string = "default"): string {
  return `agent:${agentId}:subagent:${randomUUID()}`;
}

/**
 * Initialize the subagent registry (restore from disk).
 */
export function initSubagentRegistry(): void {
  restoreSubagentRunsOnce();
}

/**
 * Reset the registry (for testing).
 */
export function resetSubagentRegistryForTests(): void {
  subagentRuns.clear();
  resumedRuns.clear();
  stopSweeper();
  restoreAttempted = false;
  listenerStarted = false;

  for (const timer of runTimers.values()) {
    clearTimeout(timer);
  }
  runTimers.clear();

  lifecycleEmitter.removeAllListeners();
  persistSubagentRuns();
}

// Registry initialized on first use
initSubagentRegistry();
