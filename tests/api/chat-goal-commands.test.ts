import { afterEach, describe, expect, test } from "bun:test";
import { handleChat, deleteSession } from "../../src/api/chat";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";
import { resetSessionGoalsForTests } from "../../src/core/session-goals";

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];
const createdSessionIds: string[] = [];
const originalExecute = agentManager.execute.bind(agentManager);
const originalCallLLM = agentManager.callLLM.bind(agentManager);

afterEach(async () => {
  agentManager.execute = originalExecute as typeof agentManager.execute;
  agentManager.callLLM = originalCallLLM as typeof agentManager.callLLM;
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
    let executeCalled = false;
    agentManager.execute = (async () => {
      executeCalled = true;
      throw new Error("goal command should not execute the model");
    }) as typeof agentManager.execute;

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
    expect(executeCalled).toBe(false);
  });

  test("active goals are injected into execution context without persisting as chat text", async () => {
    const agent = createGoalTestAgent();
    const executionBatches: Array<Array<{ role: string; content: string }>> = [];

    agentManager.execute = (async (_agentId, messages) => {
      executionBatches.push(messages.map((message) => ({ ...message })));
      return { content: "goal-aware reply" };
    }) as typeof agentManager.execute;
    agentManager.callLLM = (async () => ({
      content: "Goal Session",
    })) as typeof agentManager.callLLM;

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
    const executionMessages = executionBatches.find((batch) =>
      batch.some((message) =>
        String(message.content || "").includes("Active goal: finish the security audit")
      )
    );
    expect(executionMessages).toBeTruthy();
    expect(
      executionMessages?.find((message) =>
        String(message.content || "").includes("Active goal: finish the security audit")
      )?.role
    ).toBe("system");
  });
});
