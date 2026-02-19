import { afterEach, describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import {
  startAgentLoop,
  getAgentLoopRun,
  cancelAgentLoopRun,
  resetAgentLoopRunsForTests,
} from "../../src/core/agent-loop";
import { providerManager } from "../../src/core/providers";

type ExecuteShape = (
  agentId: string,
  messages: Array<{ role: "user" | "assistant" | "system" | "tool"; content: string }>,
  options?: {
    useTools?: boolean;
    sessionId?: string;
    channel?: string;
    userId?: string;
    modelOverride?: string;
  }
) => Promise<{ content: string; tool_calls?: Array<{ name: string; result: unknown }> }>;

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];

async function waitForLoop(
  runId: string,
  predicate: (status: string) => boolean,
  timeoutMs = 2000
): Promise<ReturnType<typeof getAgentLoopRun>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const run = getAgentLoopRun(runId);
    if (run && predicate(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for loop ${runId}`);
}

afterEach(() => {
  for (const agentId of createdAgentIds.splice(0)) {
    agentManager.delete(agentId);
  }
  for (const providerId of createdProviderIds.splice(0)) {
    providerManager.delete(providerId);
  }
  resetAgentLoopRunsForTests();
});

function createAgentForLoop(name: string): string {
  const provider = providerManager.create({
    provider: "openai",
    name: `${name} Provider`,
    api_key: "test-key",
  });
  createdProviderIds.push(provider.id);

  const agent = agentManager.create({
    name,
    type: "main",
    provider_id: provider.id,
    model: "gpt-5-mini",
    tools: [],
  });
  createdAgentIds.push(agent.id);
  return agent.id;
}

describe("Agent loop runner", () => {
  test("marks run completed when agent returns DONE marker", async () => {
    const agentId = createAgentForLoop("Loop Done Agent");

    const originalExecute = agentManager.execute.bind(agentManager) as ExecuteShape;
    (agentManager as unknown as { execute: ExecuteShape }).execute = async () => ({
      content: "DONE: objective complete",
    });

    try {
      const run = startAgentLoop({
        agentId,
        objective: "finish objective",
        maxIterations: 4,
        useTools: false,
      });

      const completed = await waitForLoop(run.id, (status) => status === "completed");
      expect(completed?.stopReason).toBe("done");
      expect(completed?.iterationsCompleted).toBe(1);
      expect(completed?.finalResponse).toBe("objective complete");
    } finally {
      (agentManager as unknown as { execute: ExecuteShape }).execute = originalExecute;
    }
  });

  test("stops with max_iterations when done marker is never emitted", async () => {
    const agentId = createAgentForLoop("Loop Max Iter Agent");

    const originalExecute = agentManager.execute.bind(agentManager) as ExecuteShape;
    (agentManager as unknown as { execute: ExecuteShape }).execute = async () => ({
      content: "still working",
    });

    try {
      const run = startAgentLoop({
        agentId,
        objective: "keep going",
        maxIterations: 2,
        useTools: false,
      });

      const completed = await waitForLoop(run.id, (status) => status === "completed");
      expect(completed?.stopReason).toBe("max_iterations");
      expect(completed?.iterationsCompleted).toBe(2);
      expect(completed?.steps.length).toBe(2);
    } finally {
      (agentManager as unknown as { execute: ExecuteShape }).execute = originalExecute;
    }
  });

  test("supports cancellation for in-flight loop runs", async () => {
    const agentId = createAgentForLoop("Loop Cancel Agent");

    const originalExecute = agentManager.execute.bind(agentManager) as ExecuteShape;
    (agentManager as unknown as { execute: ExecuteShape }).execute = async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { content: "working..." };
    };

    try {
      const run = startAgentLoop({
        agentId,
        objective: "cancel objective",
        maxIterations: 8,
      });

      const cancelled = cancelAgentLoopRun(run.id);
      expect(cancelled).toBe(true);

      const finalRun = await waitForLoop(
        run.id,
        (status) => status === "cancelled" || status === "completed" || status === "failed",
        3000
      );
      expect(finalRun?.status).toBe("cancelled");
      expect(finalRun?.stopReason).toBe("cancelled");
    } finally {
      (agentManager as unknown as { execute: ExecuteShape }).execute = originalExecute;
    }
  });
});
