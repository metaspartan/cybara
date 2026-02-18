import { afterEach, describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";

type CallLLMShape = (
  provider: unknown,
  model: string | undefined,
  messages: Array<{ role: string; content: string }>,
  tools: unknown[]
) => Promise<{ content: string; tool_calls?: Array<{ name: string; result: unknown }> }>;

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];

afterEach(() => {
  for (const agentId of createdAgentIds.splice(0)) {
    agentManager.delete(agentId);
  }
  for (const providerId of createdProviderIds.splice(0)) {
    providerManager.delete(providerId);
  }
});

describe("Agent execute system prompt handling", () => {
  test("preserves caller-provided system prompt without prepending a default", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Prompt Test Provider",
      api_key: "test-key",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Prompt Test Agent",
      provider_id: provider.id,
      system_prompt: "AGENT_LEVEL_PROMPT",
      tools: [],
      type: "main",
    });
    createdAgentIds.push(agent.id);

    let capturedMessages: Array<{ role: string; content: string }> = [];
    let capturedTools: unknown[] = [];

    const originalCallLLM = agentManager.callLLM.bind(agentManager) as CallLLMShape;
    (agentManager as unknown as { callLLM: CallLLMShape }).callLLM = async (
      _provider,
      _model,
      messages,
      tools
    ) => {
      capturedMessages = messages;
      capturedTools = tools;
      return { content: "ok" };
    };

    try {
      const result = await agentManager.execute(
        agent.id,
        [
          { role: "system", content: "SESSION_PROMPT" },
          { role: "user", content: "ping" },
        ],
        { useTools: false }
      );

      expect(result.content).toBe("ok");
      expect(capturedTools).toEqual([]);
      expect(capturedMessages).toEqual([
        { role: "system", content: "SESSION_PROMPT" },
        { role: "user", content: "ping" },
      ]);
    } finally {
      (agentManager as unknown as { callLLM: CallLLMShape }).callLLM = originalCallLLM;
    }
  });

  test("injects agent system prompt when caller messages do not include one", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Prompt Injection Provider",
      api_key: "test-key",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Prompt Injection Agent",
      provider_id: provider.id,
      system_prompt: "AGENT_ONLY_PROMPT",
      tools: [],
      type: "main",
    });
    createdAgentIds.push(agent.id);

    let capturedMessages: Array<{ role: string; content: string }> = [];

    const originalCallLLM = agentManager.callLLM.bind(agentManager) as CallLLMShape;
    (agentManager as unknown as { callLLM: CallLLMShape }).callLLM = async (
      _provider,
      _model,
      messages
    ) => {
      capturedMessages = messages;
      return { content: "ok" };
    };

    try {
      const result = await agentManager.execute(
        agent.id,
        [{ role: "user", content: "hello" }],
        { useTools: false }
      );

      expect(result.content).toBe("ok");
      expect(capturedMessages).toEqual([
        { role: "system", content: "AGENT_ONLY_PROMPT" },
        { role: "user", content: "hello" },
      ]);
    } finally {
      (agentManager as unknown as { callLLM: CallLLMShape }).callLLM = originalCallLLM;
    }
  });

  test("respects model override when provided in execution options", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Model Override Provider",
      api_key: "test-key",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Model Override Agent",
      provider_id: provider.id,
      model: "default-model",
      tools: [],
      type: "main",
    });
    createdAgentIds.push(agent.id);

    let capturedModel: string | undefined;

    const originalCallLLM = agentManager.callLLM.bind(agentManager) as CallLLMShape;
    (agentManager as unknown as { callLLM: CallLLMShape }).callLLM = async (
      _provider,
      model
    ) => {
      capturedModel = model;
      return { content: "ok" };
    };

    try {
      const result = await agentManager.execute(
        agent.id,
        [{ role: "user", content: "test override" }],
        { useTools: false, modelOverride: "  override-model  " }
      );

      expect(result.content).toBe("ok");
      expect(capturedModel).toBe("override-model");
    } finally {
      (agentManager as unknown as { callLLM: CallLLMShape }).callLLM = originalCallLLM;
    }
  });
});
