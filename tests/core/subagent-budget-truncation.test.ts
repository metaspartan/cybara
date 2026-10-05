import { afterEach, describe, expect, test } from "bun:test";
import {
  handleSessionsSpawn,
  handleSessionsWait,
  resetSubagentSessionsForTests,
} from "../../src/core/tools/handlers/channel";
import { getRun, resetSubagentRegistryForTests } from "../../src/core/subagent-registry";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";
import { config } from "../../src/core/config";

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];

afterEach(() => {
  resetSubagentSessionsForTests();
  resetSubagentRegistryForTests();
  for (const id of createdAgentIds.splice(0)) agentManager.delete(id);
  for (const id of createdProviderIds.splice(0)) providerManager.delete(id);
});

function completionFor(toolCall: boolean): string {
  return JSON.stringify({
    id: crypto.randomUUID(),
    object: "chat.completion",
    created: 0,
    model: "budget-fixture",
    choices: [
      {
        index: 0,
        finish_reason: toolCall ? "tool_calls" : "stop",
        message: toolCall
          ? {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: crypto.randomUUID(),
                  type: "function",
                  function: { name: "read", arguments: JSON.stringify({ path: "a" }) },
                },
              ],
            }
          : { role: "assistant", content: "Finished early." },
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
  });
}

describe("subagent budget truncation is reported", () => {
  test("a child stopped at its iteration budget is recorded as partial, not completed", async () => {
    const originalFetch = globalThis.fetch;
    const provider = providerManager.create({
      provider: "openai",
      name: "Budget Fixture Provider",
      api_key: "sk-budget-fixture",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "Budget Fixture Agent",
      type: "main",
      provider_id: provider.id,
      model: "budget-fixture",
      memory_enabled: false,
      config: { tool_profile: "minimal" },
    });
    createdAgentIds.push(agent.id);

    let turn = 0;
    globalThis.fetch = (async () => {
      turn += 1;
      return new Response(completionFor(turn <= 6), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    try {
      const spawn = await handleSessionsSpawn({
        task: "Read many files and report each one.",
        agentId: agent.id,
        maxToolIterations: 2,
        _requesterSessionKey: "main",
      });
      expect(spawn.status).toBe("accepted");
      const runId = spawn.runId;

      const waited = await handleSessionsWait({ runIds: [runId], timeoutSeconds: 30 });
      const run = waited.runs[0];

      expect(run?.toolCallCount).toBeGreaterThan(0);
      expect(run?.limitReason).toBe("maxIterations");
      expect(run?.status).toBe("partial");
      expect(waited.status).not.toBe("timeout");
      expect(getRun(runId)?.outcome?.limitReason).toBe("maxIterations");
    } finally {
      globalThis.fetch = originalFetch;
      expect(config.getFollowUpBehaviorEnabled()).toBe(true);
    }
  }, 30_000);
});
