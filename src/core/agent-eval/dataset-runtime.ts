import type { SessionTokenUsage } from "../session-context";
import {
  cancelDatasetItem,
  claimDatasetItem,
  completeDatasetItem,
  failDatasetItem,
  finalizeDatasetRun,
  getDatasetRun,
  listDatasetRuns,
  markDatasetRunRunning,
  resetInterruptedDatasetItems,
} from "./dataset-store";
import type { AgentDatasetItem, AgentDatasetRun, AgentDatasetUsage } from "./types";

export interface DatasetItemExecutionResult {
  trajectoryId: string;
  usage: SessionTokenUsage;
}

export type DatasetItemExecutor = (
  run: AgentDatasetRun,
  item: AgentDatasetItem,
  signal: AbortSignal
) => Promise<DatasetItemExecutionResult>;

const activeRuns = new Set<string>();
interface ExecutionWaiter {
  resolve: () => void;
  reject: (reason: unknown) => void;
  signal: AbortSignal;
  onAbort: () => void;
}

const executionWaiters: ExecutionWaiter[] = [];
const activeItemControllers = new Map<string, { runId: string; controller: AbortController }>();
const MAX_ACTIVE_ITEMS = 8;
let activeItems = 0;
let itemExecutor: DatasetItemExecutor | null = null;

function datasetUsage(usage: SessionTokenUsage): AgentDatasetUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    cacheHitRate: usage.cacheHitRate,
    totalTokens: usage.totalTokens,
    callCount: usage.callCount,
    durationMs: usage.durationMs,
    tokensPerSecond: usage.tokensPerSecond,
    averageFirstTokenMs: usage.firstTokenMs,
  };
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Dataset sample cancelled", "AbortError");
}

async function acquireExecutionSlot(signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortReason(signal);
  if (activeItems < MAX_ACTIVE_ITEMS) {
    activeItems += 1;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const waiter: ExecutionWaiter = {
      resolve,
      reject,
      signal,
      onAbort: () => {
        const index = executionWaiters.indexOf(waiter);
        if (index >= 0) executionWaiters.splice(index, 1);
        reject(abortReason(signal));
      },
    };
    signal.addEventListener("abort", waiter.onAbort, { once: true });
    executionWaiters.push(waiter);
  });
}

function releaseExecutionSlot(): void {
  activeItems = Math.max(0, activeItems - 1);
  while (executionWaiters.length > 0) {
    const waiter = executionWaiters.shift();
    if (!waiter) return;
    waiter.signal.removeEventListener("abort", waiter.onAbort);
    if (waiter.signal.aborted) continue;
    activeItems += 1;
    waiter.resolve();
    return;
  }
}

async function executeItem(run: AgentDatasetRun, item: AgentDatasetItem): Promise<void> {
  const controller = new AbortController();
  const timeoutMs = Math.max(10, run.sampleTimeoutSeconds * 1000);
  const timeout = setTimeout(() => {
    controller.abort(
      new DOMException(
        `Sample exceeded the ${run.sampleTimeoutSeconds}-second time limit`,
        "TimeoutError"
      )
    );
  }, timeoutMs);
  activeItemControllers.set(item.id, { runId: run.id, controller });
  let slotAcquired = false;
  try {
    await acquireExecutionSlot(controller.signal);
    slotAcquired = true;
    if (!itemExecutor) throw new Error("Dataset generation runtime is not ready");
    const result = await itemExecutor(run, item, controller.signal);
    if (controller.signal.aborted) throw abortReason(controller.signal);
    completeDatasetItem(item.id, result.trajectoryId, datasetUsage(result.usage));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Dataset item generation failed";
    if (
      getDatasetRun(run.id)?.cancelRequested ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      cancelDatasetItem(item.id, "Cancelled by user");
    } else {
      failDatasetItem(item.id, message);
    }
  } finally {
    clearTimeout(timeout);
    activeItemControllers.delete(item.id);
    if (slotAcquired) releaseExecutionSlot();
  }
}

async function runWorker(runId: string): Promise<void> {
  while (true) {
    const run = getDatasetRun(runId);
    if (!run || run.cancelRequested) return;
    const item = claimDatasetItem(runId);
    if (!item) return;
    await executeItem(run, item);
  }
}

async function executeRun(runId: string): Promise<void> {
  try {
    resetInterruptedDatasetItems(runId);
    const run = markDatasetRunRunning(runId);
    if (!run) return;
    const workers = Array.from({ length: run.concurrency }, () => runWorker(runId));
    await Promise.all(workers);
    finalizeDatasetRun(runId);
  } catch (error) {
    finalizeDatasetRun(runId, error instanceof Error ? error.message : "Dataset generation failed");
  } finally {
    activeRuns.delete(runId);
  }
}

export function registerDatasetItemExecutor(executor: DatasetItemExecutor): void {
  itemExecutor = executor;
}

export function startDatasetRun(runId: string): boolean {
  const run = getDatasetRun(runId);
  if (!run || !["queued", "running"].includes(run.status) || activeRuns.has(runId)) return false;
  activeRuns.add(runId);
  void executeRun(runId);
  return true;
}

export function resumeDatasetRuns(): number {
  let resumed = 0;
  for (const run of listDatasetRuns(200)) {
    if ((run.status === "queued" || run.status === "running") && startDatasetRun(run.id)) {
      resumed += 1;
    }
  }
  return resumed;
}

export function isDatasetRunActive(runId: string): boolean {
  return activeRuns.has(runId);
}

export function cancelDatasetRunExecutions(runId: string): number {
  let cancelled = 0;
  for (const active of activeItemControllers.values()) {
    if (active.runId !== runId || active.controller.signal.aborted) continue;
    active.controller.abort(new DOMException("Dataset run cancelled", "AbortError"));
    cancelled += 1;
  }
  return cancelled;
}
