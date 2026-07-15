import { afterEach, describe, expect, test } from "bun:test";
import { handleChat, deleteSession } from "../../src/api/chat";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";

const agentIds: string[] = [];
const providerIds: string[] = [];
const sessionIds: string[] = [];
const originalExecute = agentManager.execute.bind(agentManager);
const originalFetch = globalThis.fetch;

afterEach(async () => {
  agentManager.execute = originalExecute;
  globalThis.fetch = originalFetch;
  for (const sessionId of sessionIds.splice(0)) await deleteSession(sessionId);
  for (const agentId of agentIds.splice(0)) agentManager.delete(agentId);
  for (const providerId of providerIds.splice(0)) providerManager.delete(providerId);
});

describe("chat channel tool routing", () => {
  test("requires the message tool for an explicit Discord post", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Channel Routing Provider",
      api_key: "test-key",
      base_url: "https://api.openai.com/v1",
    });
    providerIds.push(provider.id);
    const agent = agentManager.create({
      name: "Channel Routing Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-channel-routing",
      memory_enabled: false,
      config: { tool_profile: "coding" },
    });
    agentIds.push(agent.id);
    const sessionId = `channel-routing-${crypto.randomUUID()}`;
    sessionIds.push(sessionId);
    const executionOptions: Array<Parameters<typeof agentManager.execute>[2]> = [];

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          id: "channel-title",
          object: "chat.completion",
          model: "gpt-channel-routing",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: "Discord Channel Greeting" },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )) as typeof fetch;

    agentManager.execute = (async (_agentId, _messages, options) => {
      executionOptions.push(options);
      return { content: "Message request handled" };
    }) as typeof agentManager.execute;

    await handleChat({
      message: "Post in #cybara on Discord and say hi to buzz, luigi, and haz",
      agentId: agent.id,
      sessionId,
      tools: true,
    });

    expect(executionOptions.length).toBeGreaterThanOrEqual(1);
    expect(executionOptions.every((options) => options?.requireToolUse === true)).toBe(true);
    expect(executionOptions.every((options) => options?.requiredToolName === "message")).toBe(true);
    expect(
      executionOptions.every(
        (options) =>
          options?.allowedToolNames === undefined || options.allowedToolNames.includes("message")
      )
    ).toBe(true);
  });
});
