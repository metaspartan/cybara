import { afterEach, describe, expect, test } from "bun:test";
import { deleteSession, handleChat } from "../../src/api/chat";
import { agentManager } from "../../src/core/agent";
import { config } from "../../src/core/config";
import { providerManager } from "../../src/core/providers";
import { loadPersistedSession } from "../../src/core/session-context";

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];
const createdSessionIds: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(async () => {
  config.set("router", null);
  config.set("provider_plan_monitoring", null);
  globalThis.fetch = originalFetch;
  for (const sessionId of createdSessionIds.splice(0)) await deleteSession(sessionId);
  for (const agentId of createdAgentIds.splice(0)) agentManager.delete(agentId);
  for (const providerId of createdProviderIds.splice(0)) providerManager.delete(providerId);
});

describe("chat model-routing metadata", () => {
  test("persists the provider and model that routing actually executed", async () => {
    const configuredProvider = providerManager.create({
      provider: "openai",
      name: "Configured Chat Provider",
      api_key: "sk-configured-chat-provider",
      base_url: "https://api.openai.com/v1",
    });
    const routedProvider = providerManager.create({
      provider: "openai",
      name: "Routed Chat Provider",
      api_key: "sk-routed-chat-provider",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(configuredProvider.id, routedProvider.id);
    const agent = agentManager.create({
      name: "Routed Metadata Agent",
      type: "main",
      provider_id: configuredProvider.id,
      model: "gpt-configured",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);
    config.set("router", {
      enabled: true,
      strategy: "priority",
      fallbackToAny: false,
      routes: {
        [routedProvider.id]: {
          weight: 100,
          priority: 0,
          enabled: true,
          model: "gpt-routed",
        },
      },
    });
    globalThis.fetch = (async (_url, init) => {
      const request = JSON.parse(String(init?.body || "{}")) as { model?: string };
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer sk-routed-chat-provider"
      );
      expect(request.model).toBe("gpt-routed");
      return Response.json({
        id: "routed-metadata-response",
        object: "chat.completion",
        model: "gpt-routed",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "routed metadata ok" },
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      });
    }) as typeof fetch;
    const sessionId = `routed-metadata-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);

    const response = await handleChat({
      message: "route this",
      agentId: agent.id,
      sessionId,
      tools: false,
      useModelRouter: true,
    });

    expect(response.message).toMatchObject({
      content: "routed metadata ok",
      provider: "openai",
      provider_id: routedProvider.id,
      provider_name: "Routed Chat Provider",
      model: "gpt-routed",
      agent_id: agent.id,
    });
    expect((await loadPersistedSession(sessionId))?.messages.at(-1)).toMatchObject({
      role: "assistant",
      provider_id: routedProvider.id,
      provider_name: "Routed Chat Provider",
      model: "gpt-routed",
    });
  });
});
