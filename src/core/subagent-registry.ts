import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { cybaraDir } from "./paths";
import { redactSecrets, redactSecretText } from "./redaction";
import { formatRecoverableToolOutputPreview } from "./tool-output-recovery";

export interface SubagentActivity {
  id: string;
  phase: "start" | "result" | "error" | "blocked";
  text: string;
  timestamp: number;
  toolName?: string;
  toolCallId?: string;
  sandboxProvider?: string;
}

export interface SubagentToolCall {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
  result: unknown;
  status?: "pending" | "executing" | "completed" | "failed";
  timeline_index?: number;
}

export interface SubagentRunDetails {
  thinking?: string;
  activities?: SubagentActivity[];
  toolCalls?: SubagentToolCall[];
}

export type SubagentRunOutcome = {
  status: "ok" | "error" | "timeout" | "killed";
  error?: string;
  result?: string;
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
  model?: string;
  workspaceDir?: string;
  runTimeoutSeconds?: number;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  outcome?: SubagentRunOutcome;
  thinking?: string;
  activities?: SubagentActivity[];
  toolCalls?: SubagentToolCall[];
  archiveAtMs?: number;
  cleanupCompletedAt?: number;
  cleanupHandled?: boolean;
  silent?: boolean;
}

interface SubagentConfig {
  archiveAfterMinutes: number;
  defaultTimeoutSeconds: number;
  persistPath: string;
}

const defaultPersistPath =
  process.env.NODE_ENV === "test"
    ? join(tmpdir(), `cybara-subagent-registry-${process.pid}.json`)
    : join(cybaraDir, "subagent-registry.json");

const DEFAULT_CONFIG: SubagentConfig = {
  archiveAfterMinutes: 60,
  defaultTimeoutSeconds: 0,
  persistPath: defaultPersistPath,
};
const SUBAGENT_RESULT_MAX_CHARS = 12_000;
const SUBAGENT_THINKING_MAX_CHARS = 24_000;
const SUBAGENT_ACTIVITY_MAX_CHARS = 4_000;
const SUBAGENT_MAX_ACTIVITIES = 300;
const SUBAGENT_MAX_TOOL_CALLS = 100;
const SUBAGENT_TOOL_VALUE_MAX_CHARS = 24_000;

function normalizeSubagentResult(
  value: unknown,
  context: { requesterSessionKey: string; runId: string }
): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = redactSecretText(value).trim();
  if (!normalized) return undefined;
  return formatRecoverableToolOutputPreview(normalized, SUBAGENT_RESULT_MAX_CHARS, {
    sessionId: context.requesterSessionKey,
    toolName: "subagent_result",
    toolCallId: context.runId,
  }).content;
}

function normalizeSubagentThinking(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = redactSecretText(value).trim();
  if (!normalized) return undefined;
  if (normalized.length <= SUBAGENT_THINKING_MAX_CHARS) return normalized;
  return `${normalized.slice(0, SUBAGENT_THINKING_MAX_CHARS)}\n\n... [thinking truncated]`;
}

function normalizeSubagentToolValue(value: unknown): unknown {
  const redacted = redactSecrets(value);
  try {
    const serialized = JSON.stringify(redacted, (_key, nested) =>
      typeof nested === "bigint" ? nested.toString() : nested
    );
    if (serialized.length <= SUBAGENT_TOOL_VALUE_MAX_CHARS) return redacted;
    return {
      truncated: true,
      preview: serialized.slice(0, SUBAGENT_TOOL_VALUE_MAX_CHARS),
    };
  } catch {
    return redactSecretText(String(value)).slice(0, SUBAGENT_TOOL_VALUE_MAX_CHARS);
  }
}

function normalizeSubagentToolResult(
  value: unknown,
  context: { requesterSessionKey: string; runId: string; toolName: string; toolCallId?: string }
): unknown {
  const redacted = redactSecrets(value);
  try {
    const serialized = JSON.stringify(redacted, (_key, nested) =>
      typeof nested === "bigint" ? nested.toString() : nested
    );
    if (serialized.length <= SUBAGENT_TOOL_VALUE_MAX_CHARS) return redacted;
    const preview = formatRecoverableToolOutputPreview(serialized, SUBAGENT_TOOL_VALUE_MAX_CHARS, {
      sessionId: context.requesterSessionKey,
      toolName: context.toolName,
      toolCallId: context.toolCallId || context.runId,
    });
    return {
      truncated: true,
      preview: preview.content,
      outputPath: preview.outputPath,
    };
  } catch {
    return redactSecretText(String(value)).slice(0, SUBAGENT_TOOL_VALUE_MAX_CHARS);
  }
}

function normalizeSubagentToolArgs(
  value: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const normalized = normalizeSubagentToolValue(value);
  if (normalized && typeof normalized === "object" && !Array.isArray(normalized)) {
    return normalized as Record<string, unknown>;
  }
  return { value: normalized };
}

function normalizeSubagentActivities(
  activities: SubagentActivity[] | undefined
): SubagentActivity[] | undefined {
  if (!activities?.length) return undefined;
  return activities.slice(-SUBAGENT_MAX_ACTIVITIES).map((activity) => ({
    ...activity,
    text: redactSecretText(activity.text).slice(0, SUBAGENT_ACTIVITY_MAX_CHARS),
  }));
}

function normalizeSubagentToolCalls(
  toolCalls: SubagentToolCall[] | undefined,
  context: { requesterSessionKey: string; runId: string }
): SubagentToolCall[] | undefined {
  if (!toolCalls?.length) return undefined;
  return toolCalls.slice(-SUBAGENT_MAX_TOOL_CALLS).map((toolCall) => ({
    ...toolCall,
    args: normalizeSubagentToolArgs(toolCall.args),
    result: normalizeSubagentToolResult(toolCall.result, {
      ...context,
      toolName: toolCall.name,
      toolCallId: toolCall.id,
    }),
  }));
}

let config: SubagentConfig = { ...DEFAULT_CONFIG };

export function configureSubagentRegistry(cfg: Partial<SubagentConfig>): void {
  config = { ...config, ...cfg };
}

const subagentRuns = new Map<string, SubagentRunRecord>();
let sweeper: ReturnType<typeof setInterval> | null = null;
let listenerStarted = false;
let restoreAttempted = false;

const lifecycleEmitter = new EventEmitter();

function persistSubagentRuns(): void {
  try {
    const dir = dirname(config.persistPath);
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

function resolveArchiveAfterMs(): number | undefined {
  const minutes = config.archiveAfterMinutes;
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return undefined;
  }
  return Math.max(1, Math.floor(minutes)) * 60_000;
}

function resolveRunTimeoutMs(runTimeoutSeconds: number | undefined): number | undefined {
  const seconds = runTimeoutSeconds ?? config.defaultTimeoutSeconds;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return undefined;
  }
  return Math.floor(seconds) * 1000;
}

function scheduleRunArchive(entry: SubagentRunRecord, endedAt: number): void {
  const archiveAfterMs = resolveArchiveAfterMs();
  entry.archiveAtMs = archiveAfterMs ? endedAt + archiveAfterMs : undefined;
  if (entry.archiveAtMs) startSweeper();
}

function startSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(() => {
    void sweepSubagentRuns();
  }, 60_000);
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

    subagentRuns.delete(runId);
    mutated = true;
    console.log(`[Subagent] Archived run ${runId} (child: ${entry.childSessionKey})`);

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

export type LifecycleEventType = "start" | "end" | "error" | "archive";

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
      scheduleRunArchive(entry, endedAt);

      if (evt.type === "error") {
        const error = typeof evt.data?.error === "string" ? evt.data.error : undefined;
        entry.outcome = { status: "error", error };
      } else {
        const result = normalizeSubagentResult(evt.data?.result, {
          requesterSessionKey: entry.requesterSessionKey,
          runId: entry.runId,
        });
        entry.outcome = { status: "ok", result };
      }

      persistSubagentRuns();

      if (entry.cleanup === "keep" && beginSubagentCleanup(evt.runId)) {
        finalizeSubagentCleanup(evt.runId, entry.cleanup);
      }
    }
  });
}

function beginSubagentCleanup(runId: string): boolean {
  const entry = subagentRuns.get(runId);
  if (!entry) return false;
  if (entry.cleanupCompletedAt) return false;
  if (entry.cleanupHandled) return false;

  entry.cleanupHandled = true;
  persistSubagentRuns();
  return true;
}

function finalizeSubagentCleanup(runId: string, cleanup: "delete" | "keep"): void {
  const entry = subagentRuns.get(runId);
  if (!entry) return;

  if (cleanup === "delete") {
    subagentRuns.delete(runId);
    persistSubagentRuns();
    console.log(`[Subagent] Deleted run ${runId} (cleanup=delete)`);
    return;
  }

  entry.cleanupCompletedAt = Date.now();
  persistSubagentRuns();
}

function restoreSubagentRunsOnce(): void {
  if (restoreAttempted) return;
  restoreAttempted = true;

  try {
    const restored = loadSubagentRegistryFromDisk();
    if (restored.size === 0) return;

    const restoredAt = Date.now();
    for (const [runId, entry] of restored.entries()) {
      if (!runId || !entry) continue;
      if (!entry.endedAt) {
        entry.endedAt = restoredAt;
        entry.outcome = {
          status: "error",
          error: "Subagent interrupted by gateway restart",
        };
        entry.cleanupHandled = true;
        entry.cleanupCompletedAt = restoredAt;
      }
      scheduleRunArchive(entry, entry.endedAt);
      if (!subagentRuns.has(runId)) {
        subagentRuns.set(runId, entry);
      }
    }

    ensureListener();
    persistSubagentRuns();

    console.log(`[Subagent] Restored ${restored.size} runs from disk`);
  } catch (err) {
    console.error("[Subagent] Failed to restore registry:", err);
  }
}

const runTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function waitForSubagentCompletion(runId: string, timeoutMs: number): Promise<void> {
  const existingTimer = runTimers.get(runId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    const entry = subagentRuns.get(runId);
    if (!entry) return;
    if (entry.endedAt) return;

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

export function registerSubagentRun(params: {
  runId?: string;
  childSessionKey: string;
  requesterSessionKey: string;
  requesterOrigin?: DeliveryContext;
  requesterDisplayKey?: string;
  task: string;
  cleanup?: "keep" | "delete";
  label?: string;
  model?: string;
  workspaceDir?: string;
  runTimeoutSeconds?: number;
  silent?: boolean;
}): SubagentRunRecord {
  const runId = params.runId || randomUUID();
  const now = Date.now();
  const timeoutMs = resolveRunTimeoutMs(params.runTimeoutSeconds);

  const run: SubagentRunRecord = {
    runId,
    childSessionKey: params.childSessionKey,
    requesterSessionKey: params.requesterSessionKey,
    requesterDisplayKey: params.requesterDisplayKey || params.requesterSessionKey,
    requesterOrigin: params.requesterOrigin,
    task: params.task,
    cleanup: params.cleanup || "keep",
    label: params.label,
    model: params.model,
    workspaceDir: params.workspaceDir,
    runTimeoutSeconds: params.runTimeoutSeconds ?? config.defaultTimeoutSeconds,
    silent: params.silent === true,
    createdAt: now,
    startedAt: now,
    cleanupHandled: false,
  };

  subagentRuns.set(runId, run);
  ensureListener();
  persistSubagentRuns();

  if (timeoutMs) {
    void waitForSubagentCompletion(runId, timeoutMs);
  }

  console.log(`[Subagent] Registered run ${runId} for child session ${params.childSessionKey}`);
  return run;
}

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

export function updateRunDetails(runId: string, details: SubagentRunDetails): boolean {
  const entry = subagentRuns.get(runId);
  if (!entry) return false;
  if (details.thinking !== undefined) {
    entry.thinking = normalizeSubagentThinking(details.thinking);
  }
  if (details.activities !== undefined) {
    entry.activities = normalizeSubagentActivities(details.activities);
  }
  if (details.toolCalls !== undefined) {
    entry.toolCalls = normalizeSubagentToolCalls(details.toolCalls, {
      requesterSessionKey: entry.requesterSessionKey,
      runId: entry.runId,
    });
  }
  persistSubagentRuns();
  return true;
}

export function markRunCompleted(
  runId: string,
  result?: string,
  details?: SubagentRunDetails
): boolean {
  const entry = subagentRuns.get(runId);
  if (!entry) return false;

  entry.endedAt = Date.now();
  const normalizedResult = normalizeSubagentResult(result, {
    requesterSessionKey: entry.requesterSessionKey,
    runId: entry.runId,
  });
  entry.outcome = { status: "ok", result: normalizedResult };
  entry.thinking = normalizeSubagentThinking(details?.thinking);
  entry.activities = normalizeSubagentActivities(details?.activities);
  entry.toolCalls = normalizeSubagentToolCalls(details?.toolCalls, {
    requesterSessionKey: entry.requesterSessionKey,
    runId: entry.runId,
  });
  persistSubagentRuns();

  const timer = runTimers.get(runId);
  if (timer) {
    clearTimeout(timer);
    runTimers.delete(runId);
  }

  emitLifecycle({
    runId,
    type: "end",
    data: { endedAt: entry.endedAt, result: normalizedResult },
  });

  return true;
}

export function markRunKilled(runId: string): boolean {
  const entry = subagentRuns.get(runId);
  if (!entry) return false;
  if (entry.endedAt && entry.outcome) return entry.outcome.status === "killed";

  entry.endedAt = Date.now();
  entry.outcome = { status: "killed" };
  scheduleRunArchive(entry, entry.endedAt);
  persistSubagentRuns();

  const timer = runTimers.get(runId);
  if (timer) {
    clearTimeout(timer);
    runTimers.delete(runId);
  }

  return true;
}

export function markRunFailed(runId: string, error: string): boolean {
  const entry = subagentRuns.get(runId);
  if (!entry) return false;

  entry.endedAt = Date.now();
  entry.outcome = { status: "error", error };
  persistSubagentRuns();

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

export function getRun(runId: string): SubagentRunRecord | undefined {
  return subagentRuns.get(runId);
}

export function getRunBySessionKey(childSessionKey: string): SubagentRunRecord | undefined {
  for (const run of subagentRuns.values()) {
    if (run.childSessionKey === childSessionKey) {
      return run;
    }
  }
  return undefined;
}

export function getRunsByRequester(requesterSessionKey: string): SubagentRunRecord[] {
  const key = requesterSessionKey.trim();
  if (!key) return [];
  return [...subagentRuns.values()].filter((r) => r.requesterSessionKey === key);
}

export function countActiveRunsForRequester(requesterSessionKey: string): number {
  const key = requesterSessionKey.trim();
  if (!key) return 0;
  return [...subagentRuns.values()].filter(
    (run) => run.requesterSessionKey === key && (!run.endedAt || run.endedAt === 0)
  ).length;
}

export function listActiveRuns(): SubagentRunRecord[] {
  return [...subagentRuns.values()].filter((r) => !r.endedAt || r.endedAt === 0);
}

export function listAllRuns(): SubagentRunRecord[] {
  return [...subagentRuns.values()];
}

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

export type ClearSubagentRunResult = "cleared" | "active" | "missing";

export function clearSubagentRun(runId: string): ClearSubagentRunResult {
  const run = subagentRuns.get(runId);
  if (!run) return "missing";
  if (!run.endedAt) return "active";
  releaseSubagentRun(runId);
  return "cleared";
}

export function clearSubagentRunsForRequester(requesterSessionKey: string): number {
  const key = requesterSessionKey.trim();
  if (!key) return 0;
  let cleared = 0;
  for (const run of [...subagentRuns.values()]) {
    if (run.requesterSessionKey !== key || !run.endedAt) continue;
    if (releaseSubagentRun(run.runId)) cleared += 1;
  }
  return cleared;
}

export function cleanupOldRuns(maxAgeMs: number = 3600000): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [runId, run] of subagentRuns.entries()) {
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

export function isSubagentSessionKey(sessionKey: string): boolean {
  return sessionKey.includes(":subagent:") || sessionKey.startsWith("subagent:");
}

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

export function generateSubagentSessionKey(agentId: string = "default"): string {
  return `agent:${agentId}:subagent:${randomUUID()}`;
}

export function initSubagentRegistry(): void {
  restoreSubagentRunsOnce();
}

export function resetSubagentRegistryForTests(): void {
  subagentRuns.clear();
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

initSubagentRegistry();
