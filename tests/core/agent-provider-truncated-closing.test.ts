import { describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import { config } from "../../src/core/config";
import { providerManager } from "../../src/core/providers";
import { createProviderRoutingFixture } from "./provider-routing.fixture";

const { createdAgentIds, createdProviderIds } = createProviderRoutingFixture();

describe("OpenAI-compatible closing reply truncation", () => {
  test("retries a closing reply that the output limit cut off with reasoning disabled", async () => {
    config.set("tool_approval_mode", "always_allow");
    const requestBodies: Record<string, unknown>[] = [];
    const completion = (
      content: string | null,
      finish: string,
      toolCalls?: Array<Record<string, unknown>>
    ) =>
      Response.json({
        id: `deepseek-${requestBodies.length}`,
        object: "chat.completion",
        model: "deepseek-flash",
        choices: [
          {
            index: 0,
            finish_reason: finish,
            message: {
              role: "assistant",
              content,
              reasoning_content: content ? null : "Thinking through the calculation at length",
              ...(toolCalls ? { tool_calls: toolCalls } : {}),
            },
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 1, total_tokens: 21 },
      });

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const requestBody = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : {};
      requestBodies.push(requestBody);
      if (requestBodies.length === 1) {
        return completion(null, "tool_calls", [
          {
            id: "calc-1",
            type: "function",
            function: { name: "calc", arguments: JSON.stringify({ expression: "6*7" }) },
          },
        ]);
      }
      if (requestBodies.length === 2) return completion("", "length");
      if (requestBodies.length === 3) return completion("The", "length");
      return completion("The verified result is 42.", "stop");
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "deepseek",
      name: "DeepSeek Truncation Provider",
      api_key: "deepseek-truncation-key",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "DeepSeek Truncation Agent",
      type: "main",
      provider_id: provider.id,
      model: "deepseek-flash",
      tools: ["calc"],
      config: { model_params: { reasoning_effort: "high" } },
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "Calculate 6*7 with the tool and report the result." }],
      { useTools: true, sessionId: "deepseek-truncation-session" }
    );

    expect(result.content).toBe("The verified result is 42.");
    expect(requestBodies).toHaveLength(4);
    expect(requestBodies[0]?.reasoning_effort).toBe("high");
    expect(requestBodies[2]?.reasoning_effort).toBe("low");
    expect(requestBodies[2]?.thinking).toEqual({ type: "enabled" });
    expect(requestBodies[3]?.thinking).toEqual({ type: "disabled" });
    expect(requestBodies[3]?.reasoning_effort).toBeUndefined();
    const lastMessages = requestBodies[3]?.messages as Array<{ role: string; content: string }>;
    expect(lastMessages.at(-1)?.content).toContain("cut off by the output token limit");
  });
});
