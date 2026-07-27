import type { SessionTokenUsage } from "../session-context";
import {
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
  item: AgentDatasetItem
) => Promise<DatasetItemExecutionResult>;

const activeRuns = new Set<string>();
const executionWaiters: Array<() => void> = [];
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

async function acquireExecutionSlot(): Promise<void> {
  if (activeItems < MAX_ACTIVE_ITEMS) {
    activeItems += 1;
    return;
  }
  await new Promise<void>((resolve) => executionWaiters.push(resolve));
  activeItems += 1;
}

function releaseExecutionSlot(): void {
  activeItems = Math.max(0, activeItems - 1);
  executionWaiters.shift()?.();
}

async function executeItem(run: AgentDatasetRun, item: AgentDatasetItem): Promise<void> {
  await acquireExecutionSlot();
  try {
    if (!itemExecutor) throw new Error("Dataset generation runtime is not ready");
    const result = await itemExecutor(run, item);
    completeDatasetItem(item.id, result.trajectoryId, datasetUsage(result.usage));
  } catch (error) {
    failDatasetItem(
      item.id,
      error instanceof Error ? error.message : "Dataset item generation failed"
    );
  } finally {
    releaseExecutionSlot();
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
