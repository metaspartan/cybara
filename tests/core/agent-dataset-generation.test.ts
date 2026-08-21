import { describe, expect, test } from "bun:test";
import {
  type AgentDatasetItem,
  type AgentDatasetRun,
  cancelDatasetItem,
  cancelDatasetRunExecutions,
  claimDatasetItem,
  completeDatasetItem,
  createDatasetRun,
  deleteDatasetRun,
  failDatasetItem,
  finalizeDatasetRun,
  getDatasetRun,
  listDatasetRunItems,
  markDatasetRunRunning,
  recordCompletedTrajectory,
  registerDatasetItemExecutor,
  resetInterruptedDatasetItems,
  requestDatasetRunCancel,
  retryDatasetRun,
  startDatasetRun,
} from "../../src/core/agent-eval";

async function waitForRun(runId: string): Promise<ReturnType<typeof getDatasetRun>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const run = getDatasetRun(runId);
    if (run && run.status !== "queued" && run.status !== "running") return run;
    await Bun.sleep(10);
  }
  return getDatasetRun(runId);
}

const completedUsage = {
  inputTokens: 100,
  outputTokens: 20,
  cachedInputTokens: 50,
  cacheWriteTokens: 5,
  cacheHitRate: 50,
  totalTokens: 120,
  callCount: 1,
  durationMs: 200,
  tokensPerSecond: 100,
  firstTokenMs: 40,
  source: "metrics" as const,
};

function createTrajectory(run: AgentDatasetRun, item: AgentDatasetItem): string {
  const trajectory = recordCompletedTrajectory({
    sessionId: item.sessionId,
    agentId: run.agentId,
    provider: run.provider,
    model: run.model,
    messages: [
      { role: "user", content: item.prompt },
      { role: "assistant", content: `Answer ${item.sampleIndex + 1}` },
    ],
  });
  if (!trajectory) throw new Error("Trajectory was not created");
  return trajectory.id;
}

describe.serial("agent dataset generation", () => {
  test("runs prompt samples concurrently and aggregates durable usage", async () => {
    const sessionIds: string[] = [];
    registerDatasetItemExecutor(async (run, item) => {
      sessionIds.push(item.sessionId);
      return {
        trajectoryId: createTrajectory(run, item),
        usage: completedUsage,
      };
    });
    const run = createDatasetRun({
      name: "Research samples",
      agentId: "teacher-agent",
      provider: "teacher-provider",
      model: "teacher-model",
      prompts: ["Prompt one", "Prompt two"],
      samplesPerPrompt: 2,
      concurrency: 2,
      toolsEnabled: true,
    });

    expect(startDatasetRun(run.id)).toBe(true);
    const completed = await waitForRun(run.id);
    expect(completed?.status).toBe("completed");
    expect(completed?.completedItems).toBe(4);
    expect(completed?.usage).toMatchObject({
      inputTokens: 400,
      outputTokens: 80,
      cachedInputTokens: 200,
      totalTokens: 480,
      callCount: 4,
      cacheHitRate: 50,
      averageFirstTokenMs: 40,
    });
    expect(
      listDatasetRunItems(run.id)
        .map((item) => item.trajectoryId)
        .every(Boolean)
    ).toBe(true);
    expect(new Set(sessionIds).size).toBe(4);
    expect(deleteDatasetRun(run.id)).toBe(true);
  });

  test("cancels queued samples without discarding completed work", () => {
    const run = createDatasetRun({
      name: "Cancelled samples",
      agentId: "teacher-agent",
      prompts: ["One", "Two", "Three"],
      samplesPerPrompt: 1,
      concurrency: 1,
      toolsEnabled: false,
    });
    const cancelled = requestDatasetRunCancel(run.id);
    expect(cancelled?.cancelRequested).toBe(true);
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.cancelledItems).toBe(3);
    expect(listDatasetRunItems(run.id).every((item) => item.status === "cancelled")).toBe(true);
    expect(deleteDatasetRun(run.id)).toBe(true);
  });

  test("recovers interrupted items as cancelled after a persisted cancel request", () => {
    const run = createDatasetRun({
      name: "Interrupted cancellation",
      agentId: "teacher-agent",
      prompts: ["Running", "Queued"],
      samplesPerPrompt: 1,
      concurrency: 1,
      toolsEnabled: false,
    });
    expect(markDatasetRunRunning(run.id)?.status).toBe("running");
    expect(claimDatasetItem(run.id)?.status).toBe("running");
    expect(requestDatasetRunCancel(run.id)?.cancelRequested).toBe(true);

    expect(resetInterruptedDatasetItems(run.id)).toBe(1);
    const items = listDatasetRunItems(run.id);
    expect(items.every((item) => item.status === "cancelled")).toBe(true);
    expect(items.every((item) => item.completedAt !== null)).toBe(true);
    expect(cancelDatasetRunExecutions(run.id)).toBe(0);
    expect(finalizeDatasetRun(run.id)?.status).toBe("cancelled");
    expect(deleteDatasetRun(run.id)).toBe(true);
  });

  test("keeps cancelled items terminal when worker results arrive late", () => {
    const run = createDatasetRun({
      name: "Cancellation race",
      agentId: "teacher-agent",
      prompts: ["Running"],
      samplesPerPrompt: 1,
      concurrency: 1,
      toolsEnabled: false,
    });
    expect(markDatasetRunRunning(run.id)?.status).toBe("running");
    const item = claimDatasetItem(run.id);
    expect(item?.status).toBe("running");
    if (!item) throw new Error("Dataset item was not claimed");
    const trajectoryId = createTrajectory(run, item);

    expect(requestDatasetRunCancel(run.id)?.cancelRequested).toBe(true);
    expect(cancelDatasetItem(item.id, "Cancelled by user")?.status).toBe("cancelled");
    expect(completeDatasetItem(item.id, trajectoryId, completedUsage)).toBeNull();
    expect(failDatasetItem(item.id, "Late provider error")).toBeNull();

    const cancelled = listDatasetRunItems(run.id)[0];
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.error).toBe("Cancelled by user");
    expect(cancelled?.trajectoryId).toBeNull();
    expect(cancelled?.usage.totalTokens).toBe(0);
    expect(finalizeDatasetRun(run.id)?.status).toBe("cancelled");
    expect(deleteDatasetRun(run.id)).toBe(true);
  });

  test("runs separate agents concurrently", async () => {
    let activeItems = 0;
    let maximumActiveItems = 0;
    registerDatasetItemExecutor(async (run, item) => {
      activeItems += 1;
      maximumActiveItems = Math.max(maximumActiveItems, activeItems);
      await Bun.sleep(25);
      activeItems -= 1;
      return { trajectoryId: createTrajectory(run, item), usage: completedUsage };
    });
    const first = createDatasetRun({
      name: "First teacher",
      agentId: "teacher-one",
      prompts: ["First prompt"],
      samplesPerPrompt: 1,
      concurrency: 1,
      toolsEnabled: true,
    });
    const second = createDatasetRun({
      name: "Second teacher",
      agentId: "teacher-two",
      prompts: ["Second prompt"],
      samplesPerPrompt: 1,
      concurrency: 1,
      toolsEnabled: true,
    });

    expect(startDatasetRun(first.id)).toBe(true);
    expect(startDatasetRun(second.id)).toBe(true);
    expect((await waitForRun(first.id))?.status).toBe("completed");
    expect((await waitForRun(second.id))?.status).toBe("completed");
    expect(maximumActiveItems).toBe(2);
    expect(deleteDatasetRun(first.id)).toBe(true);
    expect(deleteDatasetRun(second.id)).toBe(true);
  });

  test("aborts an active sample while cancelling queued work", async () => {
    let started = false;
    registerDatasetItemExecutor(async (_activeRun, _item, signal) => {
      started = true;
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
      throw new Error("unreachable");
    });
    const run = createDatasetRun({
      name: "Cancel active teacher",
      agentId: "teacher-agent",
      prompts: ["One", "Two", "Three"],
      samplesPerPrompt: 1,
      concurrency: 1,
      toolsEnabled: true,
    });

    expect(startDatasetRun(run.id)).toBe(true);
    for (let attempt = 0; attempt < 50 && !started; attempt += 1) await Bun.sleep(2);
    expect(started).toBe(true);
    expect(requestDatasetRunCancel(run.id)?.cancelRequested).toBe(true);
    expect(retryDatasetRun(run.id)).toBeNull();
    expect(cancelDatasetRunExecutions(run.id)).toBe(1);
    const cancelled = await waitForRun(run.id);
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.completedItems).toBe(0);
    expect(cancelled?.cancelledItems).toBe(3);
    expect(deleteDatasetRun(run.id)).toBe(true);
  });

  test("fails a sample that exceeds its configured time limit", async () => {
    registerDatasetItemExecutor(async (_run, _item, signal) => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
      throw new Error("unreachable");
    });
    const run = createDatasetRun({
      name: "Bounded teacher",
      agentId: "teacher-agent",
      prompts: ["Slow prompt"],
      samplesPerPrompt: 1,
      concurrency: 1,
      toolsEnabled: true,
      sampleTimeoutSeconds: 0.02,
    });

    expect(startDatasetRun(run.id)).toBe(true);
    const failed = await waitForRun(run.id);
    expect(failed?.status).toBe("error");
    expect(failed?.failedItems).toBe(1);
    expect(listDatasetRunItems(run.id)[0]?.error).toContain("time limit");
    expect(deleteDatasetRun(run.id)).toBe(true);
  });

  test("retries only incomplete samples and preserves completed work", async () => {
    let attempts = 0;
    registerDatasetItemExecutor(async (activeRun, item) => {
      attempts += 1;
      if (item.prompt === "Retry" && attempts === 2) throw new Error("temporary failure");
      return { trajectoryId: createTrajectory(activeRun, item), usage: completedUsage };
    });
    const run = createDatasetRun({
      name: "Retry teacher",
      agentId: "teacher-agent",
      prompts: ["Keep", "Retry"],
      samplesPerPrompt: 1,
      concurrency: 1,
      toolsEnabled: false,
    });

    expect(startDatasetRun(run.id)).toBe(true);
    const first = await waitForRun(run.id);
    expect(first?.completedItems).toBe(1);
    expect(first?.failedItems).toBe(1);
    const firstItems = listDatasetRunItems(run.id);
    const completedItem = firstItems.find((item) => item.status === "completed");
    const failedItem = firstItems.find((item) => item.status === "error");
    const queuedRetry = retryDatasetRun(run.id);
    expect(queuedRetry?.status).toBe("queued");
    expect(queuedRetry?.startedAt).toBeNull();
    const retryItems = listDatasetRunItems(run.id);
    expect(retryItems.find((item) => item.id === completedItem?.id)?.sessionId).toBe(
      completedItem?.sessionId
    );
    expect(retryItems.find((item) => item.id === failedItem?.id)?.sessionId).not.toBe(
      failedItem?.sessionId
    );
    expect(startDatasetRun(run.id)).toBe(true);
    const retried = await waitForRun(run.id);
    expect(retried?.status).toBe("completed");
    expect(retried?.completedItems).toBe(2);
    expect(attempts).toBe(3);
    expect(deleteDatasetRun(run.id)).toBe(true);
  });

  test("does not delete queued or running runs", () => {
    const run = createDatasetRun({
      name: "Protected teacher",
      agentId: "teacher-agent",
      prompts: ["One"],
      samplesPerPrompt: 1,
      concurrency: 1,
      toolsEnabled: false,
    });
    expect(deleteDatasetRun(run.id)).toBe(false);
    expect(requestDatasetRunCancel(run.id)?.status).toBe("cancelled");
    expect(deleteDatasetRun(run.id)).toBe(true);
  });
});
