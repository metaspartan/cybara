import { afterEach, describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import { config } from "../../src/core/config";
import { providerManager } from "../../src/core/providers";

const originalFetch = globalThis.fetch;
const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];

afterEach(() => {
  config.set("tool_approval_mode", "ask");
  globalThis.fetch = originalFetch;
  for (const agentId of createdAgentIds.splice(0)) agentManager.delete(agentId);
  for (const providerId of createdProviderIds.splice(0)) providerManager.delete(providerId);
});

describe("agent provider deferred reasoning", () => {
  test("uses concise MiniMax M3 reasoning throughout deferred execution", async () => {
    config.set("tool_approval_mode", "always_allow");
    const requestBodies: Record<string, unknown>[] = [];

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const requestBody = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : {};
      requestBodies.push(requestBody);
      const requestIndex = requestBodies.length;
      if (requestIndex === 1 || requestIndex === 3) {
        return Response.json({
          id: `minimax-tool-${requestIndex}`,
          object: "chat.completion",
          model: "MiniMax-M3",
          choices: [
            {
              index: 0,
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: `minimax-calc-${requestIndex}`,
                    type: "function",
                    function: { name: "calc", arguments: '{"expression":"6*7"}' },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
        });
      }
      if (requestIndex === 2) {
        return Response.json({
          id: "minimax-deferred-promise",
          object: "chat.completion",
          model: "MiniMax-M3",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "I have enough information to build the deliverable now.",
              },
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
        });
      }
      return Response.json({
        id: "minimax-deferred-finished",
        object: "chat.completion",
        model: "MiniMax-M3",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "The deliverable is complete." },
          },
        ],
        usage: { prompt_tokens: 24, completion_tokens: 6, total_tokens: 30 },
      });
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "custom",
      name: "MiniMax M3 Deferred Provider",
      api_key: "minimax-deferred-key",
      base_url: "https://api.minimax.io/v1",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "MiniMax M3 Deferred Agent",
      type: "main",
      provider_id: provider.id,
      model: "MiniMax-M3",
      tools: ["calc"],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "Build the deliverable and verify it with the tool." }],
      { useTools: true, sessionId: "minimax-m3-deferred-session" }
    );

    expect(result.content).toBe("The deliverable is complete.");
    expect(result.tool_calls).toHaveLength(2);
    expect(requestBodies).toHaveLength(4);
    expect(requestBodies[2]?.thinking).toEqual({ type: "disabled" });
    expect(requestBodies[2]?.reasoning_split).toBe(true);
    expect(requestBodies[3]?.thinking).toEqual({ type: "disabled" });
    expect(requestBodies[3]?.reasoning_split).toBe(true);
  });
});
