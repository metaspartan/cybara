import { afterEach, describe, expect, test } from "bun:test";
import { evalRoutes } from "../../src/api/routes/evals";
import { agentManager } from "../../src/core/agent";
import { deleteDatasetRun, getDatasetRun } from "../../src/core/agent-eval";
import { providerManager } from "../../src/core/providers";

const agentIds: string[] = [];
const providerIds: string[] = [];
const originalExecute = agentManager.execute.bind(agentManager);
const originalCallLLM = agentManager.callLLM.bind(agentManager);

function createAgent(name: string): string {
  const provider = providerManager.create({
    provider: "openai",
    name: `${name} Provider`,
    api_key: `test-${crypto.randomUUID()}`,
  });
  providerIds.push(provider.id);
  const agent = agentManager.create({
    name,
    type: "main",
    provider_id: provider.id,
    model: "gpt-5.2",
    memory_enabled: false,
  });
  agentIds.push(agent.id);
  return agent.id;
}

afterEach(() => {
  agentManager.execute = originalExecute;
  agentManager.callLLM = originalCallLLM;
  for (const agentId of agentIds.splice(0)) agentManager.delete(agentId);
  for (const providerId of providerIds.splice(0)) providerManager.delete(providerId);
});

describe("dataset prompt author route", () => {
  test("gives each prompt generation pass an independent timeout", async () => {
    const authorAgentId = createAgent("Dataset Prompt Author");
    const targetAgentId = createAgent("Dataset Target Agent");
    const signals: AbortSignal[] = [];
    let attempt = 0;

    agentManager.execute = (async (_agentId, _messages, options) => {
      attempt += 1;
      if (options?.abortSignal) signals.push(options.abortSignal);
      return {
        content: JSON.stringify({ prompts: [`Prompt ${attempt}`] }),
      };
    }) as typeof agentManager.execute;

    const handler = evalRoutes["POST /api/evals/dataset-prompts"];
    expect(handler).toBeDefined();
    const response = (await handler?.({
      agentId: authorAgentId,
      targetAgentId,
      objective: "Exercise two prompt generation passes",
      count: 2,
    })) as { success?: boolean; prompts?: string[] };

    expect(response.success).toBe(true);
    expect(response.prompts).toEqual(["Prompt 1", "Prompt 2"]);
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);
  });

  test("authors prompts and persists a run in one gateway request", async () => {
    const authorAgentId = createAgent("Durable Prompt Author");
    const targetAgentId = createAgent("Durable Target Agent");
    let executionCount = 0;
    let titleCallCount = 0;
    agentManager.callLLM = (async () => {
      titleCallCount += 1;
      return { content: "Unexpected generated title" };
    }) as typeof agentManager.callLLM;
    agentManager.execute = (async (_agentId, messages) => {
      executionCount += 1;
      const promptAuthorRequest = messages.some((message) =>
        message.content.includes("AI training and evaluation datasets")
      );
      return {
        content: promptAuthorRequest
          ? JSON.stringify({ prompts: ["Inspect package metadata and report its version."] })
          : "The package version is verified.",
      };
    }) as typeof agentManager.execute;

    const handler = evalRoutes["POST /api/evals/datasets"];
    const response = (await handler?.({
      name: "Durable one-click dataset",
      agentId: targetAgentId,
      prompts: [],
      samplesPerPrompt: 1,
      concurrency: 1,
      toolsEnabled: false,
      maxOutputTokens: 2048,
      sampleTimeoutSeconds: 30,
      promptDraft: {
        agentId: authorAgentId,
        count: 1,
        objective: "Create one package inspection task",
      },
    })) as { success?: boolean; prompts?: string[]; run?: { id: string } };

    expect(response.success).toBe(true);
    expect(response.prompts).toEqual(["Inspect package metadata and report its version."]);
    expect(response.run?.id).toBeString();
    const runId = response.run?.id || "";
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const run = getDatasetRun(runId);
      if (run && run.status !== "queued" && run.status !== "running") break;
      await Bun.sleep(10);
    }
    expect(getDatasetRun(runId)?.status).toBe("completed");
    expect(executionCount).toBeGreaterThanOrEqual(2);
    expect(titleCallCount).toBe(0);
    expect(deleteDatasetRun(runId)).toBe(true);
  });
});
