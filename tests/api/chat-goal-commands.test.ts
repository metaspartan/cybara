import { afterEach, describe, expect, test } from "bun:test";
import { handleChat, deleteSession } from "../../src/api/chat";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";
import { resetSessionGoalsForTests } from "../../src/core/session-goals";

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];
const createdSessionIds: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(async () => {
  globalThis.fetch = originalFetch;
  resetSessionGoalsForTests();
  for (const sessionId of createdSessionIds.splice(0)) await deleteSession(sessionId);
  for (const agentId of createdAgentIds.splice(0)) agentManager.delete(agentId);
  for (const providerId of createdProviderIds.splice(0)) providerManager.delete(providerId);
});

function createGoalTestAgent() {
  const provider = providerManager.create({
    provider: "openai",
    name: "Goal Command Provider",
    api_key: "sk-goal-command",
    base_url: "https://api.openai.com/v1",
  });
  createdProviderIds.push(provider.id);

  const agent = agentManager.create({
    name: "Goal Command Agent",
    type: "main",
    provider_id: provider.id,
    model: "gpt-goal-command",
    memory_enabled: false,
  });
  createdAgentIds.push(agent.id);
  return agent;
}

describe("chat goal commands", () => {
  test("/goal is handled locally without calling the model", async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("{}", { status: 500 });
    }) as typeof fetch;

    const sessionId = `goal-local-${Date.now()}`;
    createdSessionIds.push(sessionId);
    const result = await handleChat({
      message: "/goal start fix CI",
      sessionId,
      tools: false,
    });

    expect(result.sessionId).toBe(sessionId);
    expect(result.message.role).toBe("assistant");
    expect(result.message.content).toBe("Goal started: fix CI");
    expect(fetchCalled).toBe(false);
  });

  test("active goals are injected into execution context without persisting as chat text", async () => {
    const agent = createGoalTestAgent();
    const requestBodies: Array<{ messages?: Array<{ role?: string; content?: string }> }> = [];
    let call = 0;

    globalThis.fetch = (async (_url, init) => {
      call += 1;
      const body = JSON.parse(String(init?.body || "{}"));
      requestBodies.push(body);
      const isTitleCall = body.messages?.some((message: { content?: string }) =>
        String(message.content || "").includes("Generate the best session title now")
      );
      return new Response(
        JSON.stringify({
          id: `goal-response-${call}`,
          object: "chat.completion",
          model: "gpt-goal-command",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: isTitleCall ? "Goal Session" : "goal-aware reply",
              },
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const sessionId = `goal-context-${Date.now()}`;
    createdSessionIds.push(sessionId);

    await handleChat({ message: "/goal finish the security audit", sessionId, tools: false });
    const result = await handleChat({
      message: "continue",
      agentId: agent.id,
      sessionId,
      tools: false,
    });

    expect(result.message.content).toBe("goal-aware reply");
    const executionBody = requestBodies.find((body) =>
      body.messages?.some((message) =>
        String(message.content || "").includes("Active goal: finish the security audit")
      )
    );
    expect(executionBody).toBeTruthy();
    expect(
      executionBody?.messages?.find((message) =>
        String(message.content || "").includes("Active goal: finish the security audit")
      )?.role
    ).toBe("system");
  });
});
