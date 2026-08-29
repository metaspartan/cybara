import { afterEach, describe, expect, test } from "bun:test";
import { deleteSession, handleChat, updateSessionAgent } from "../../src/api/chat";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";
import { loadPersistedSession } from "../../src/core/session-context";

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];
const createdSessionIds: string[] = [];

afterEach(async () => {
  for (const sessionId of createdSessionIds.splice(0)) await deleteSession(sessionId);
  for (const agentId of createdAgentIds.splice(0)) agentManager.delete(agentId);
  for (const providerId of createdProviderIds.splice(0)) providerManager.delete(providerId);
});

describe("chat session agent races", () => {
  test("active responses preserve a newer session agent selection", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Concurrent Switch Provider",
      api_key: "sk-concurrent-switch",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);
    const firstAgent = agentManager.create({
      name: "Concurrent Switch Agent A",
      type: "main",
      provider_id: provider.id,
      model: "gpt-concurrent-switch-a",
      memory_enabled: false,
    });
    const secondAgent = agentManager.create({
      name: "Concurrent Switch Agent B",
      type: "main",
      provider_id: provider.id,
      model: "gpt-concurrent-switch-b",
      memory_enabled: false,
    });
    createdAgentIds.push(firstAgent.id, secondAgent.id);
    const sessionId = `concurrent-switch-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);

    let signalExecutionStarted: (() => void) | undefined;
    let releaseExecution: (() => void) | undefined;
    const executionStarted = new Promise<void>((resolve) => {
      signalExecutionStarted = resolve;
    });
    const executionReleased = new Promise<void>((resolve) => {
      releaseExecution = resolve;
    });
    const originalExecute = agentManager.execute.bind(agentManager);
    agentManager.execute = (async (agentId) => {
      expect(agentId).toBe(firstAgent.id);
      signalExecutionStarted?.();
      await executionReleased;
      return { content: "response from the original agent" };
    }) as typeof agentManager.execute;

    try {
      const activeResponse = handleChat({
        message: "start with the first agent",
        agentId: firstAgent.id,
        sessionId,
        tools: false,
      });
      await executionStarted;
      const updated = await updateSessionAgent(sessionId, secondAgent.id);
      expect(updated.agentId).toBe(secondAgent.id);
      releaseExecution?.();
      const response = await activeResponse;

      expect(response.agent?.id).toBe(firstAgent.id);
      expect(response.session_agent_id).toBe(secondAgent.id);
      expect((await loadPersistedSession(sessionId))?.agentId).toBe(secondAgent.id);
    } finally {
      agentManager.execute = originalExecute;
      releaseExecution?.();
    }
  });
});
