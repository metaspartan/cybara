import { describe, expect, test } from "bun:test";
import {
  type AgentDatasetItem,
  type AgentDatasetRun,
  createDatasetRun,
  deleteDatasetRun,
  getDatasetRun,
  listDatasetRunItems,
  recordCompletedTrajectory,
  registerDatasetItemExecutor,
  requestDatasetRunCancel,
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

describe("agent dataset generation", () => {
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

  test("finishes an active sample while cancelling queued work", async () => {
    let release: (() => void) | null = null;
    registerDatasetItemExecutor(async (activeRun, item) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { trajectoryId: createTrajectory(activeRun, item), usage: completedUsage };
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
    for (let attempt = 0; attempt < 50 && !release; attempt += 1) await Bun.sleep(2);
    expect(release).not.toBeNull();
    expect(requestDatasetRunCancel(run.id)?.cancelRequested).toBe(true);
    release?.();
    const cancelled = await waitForRun(run.id);
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.completedItems).toBe(1);
    expect(cancelled?.cancelledItems).toBe(2);
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
