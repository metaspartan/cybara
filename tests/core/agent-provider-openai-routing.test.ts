import { describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import { config } from "../../src/core/config";
import { providerManager } from "../../src/core/providers";
import { summarizeSessionTokenUsage } from "../../src/core/session-context";
import { createProviderRoutingFixture } from "./provider-routing.fixture";

const { createdAgentIds, createdProviderIds } = createProviderRoutingFixture();

describe("Agent provider OpenAI-compatible routing", () => {
  test("routes openai-family providers through /chat/completions and keeps system message in messages", async () => {
    let requestUrl = "";
    let requestBody: Record<string, unknown> = {};
    let requestHeaders = new Headers();

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestHeaders = new Headers(init?.headers);
      requestBody = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

      return new Response(
        JSON.stringify({
          id: "resp-1",
          object: "chat.completion",
          model: "gpt-5.2",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "openai-ok",
              },
            },
          ],
          usage: { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "openai",
      name: "OpenAI Routing Provider",
      api_key: "openai-test-key",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "OpenAI Routing Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-5.2",
      system_prompt: "OPENAI_SYSTEM",
      tools: [],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "hello openai" }],
      { useTools: false, sessionId: "openai-route-session" }
    );

    expect(result.content).toBe("openai-ok");
    expect(requestUrl.endsWith("/chat/completions")).toBe(true);
    expect(requestHeaders.get("Authorization")).toBe("Bearer openai-test-key");

    const messages = (requestBody.messages as Array<{ role: string; content: string }>) || [];
    expect(messages[0]).toEqual({ role: "system", content: "OPENAI_SYSTEM" });
    expect(messages[1]).toEqual({ role: "user", content: "hello openai" });
    expect("max_tokens" in requestBody).toBe(false);
    expect(requestBody.max_completion_tokens).toBe(100000);
  });

  test("routes z.ai coding models with provider-native thinking and completion token params", async () => {
    let requestUrl = "";
    let requestBody: Record<string, unknown> = {};

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestBody = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

      return new Response(
        JSON.stringify({
          id: "resp-zai-1",
          object: "chat.completion",
          model: "glm-5.2",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "zai-ok",
              },
            },
          ],
          usage: { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "z.ai-coding",
      name: "Zai Coding Routing Provider",
      api_key: "zai-test-key",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Zai Coding Routing Agent",
      type: "main",
      provider_id: provider.id,
      model: "glm-5.2",
      tools: [],
      config: { model_params: { reasoning_effort: "medium" } },
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(agent.id, [{ role: "user", content: "hello zai" }], {
      useTools: false,
      sessionId: "zai-route-session",
    });

    expect(result.content).toBe("zai-ok");
    expect(requestUrl).toBe("https://api.z.ai/api/coding/paas/v4/chat/completions");
    expect(requestBody.enable_thinking).toBe(true);
    expect("reasoning_effort" in requestBody).toBe(false);
    expect("max_tokens" in requestBody).toBe(false);
    expect(typeof requestBody.max_completion_tokens).toBe("number");
  });

  test("tracks every z.ai tool-loop completion in session usage", async () => {
    config.set("tool_approval_mode", "always_allow");
    const sessionId = `zai-loop-usage-${crypto.randomUUID()}`;
    let requestCount = 0;

    globalThis.fetch = (async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Response(
          JSON.stringify({
            id: "resp-zai-tool-1",
            object: "chat.completion",
            model: "glm-5.2",
            choices: [
              {
                index: 0,
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: "I will calculate that.",
                  tool_calls: [
                    {
                      id: "call-calc-1",
                      type: "function",
                      function: {
                        name: "calc",
                        arguments: '{"expression":"21*2"}',
                      },
                    },
                  ],
                },
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 3,
              total_tokens: 13,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          id: "resp-zai-tool-2",
          object: "chat.completion",
          model: "glm-5.2",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: "The result is 42." },
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "z.ai-coding",
      name: "Zai Loop Usage Provider",
      api_key: "zai-loop-usage-key",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Zai Loop Usage Agent",
      type: "main",
      provider_id: provider.id,
      model: "glm-5.2",
      tools: [
        {
          name: "calc",
          description: "Evaluate math",
          input_schema: {
            type: "object",
            properties: { expression: { type: "string" } },
            required: ["expression"],
          },
        },
      ],
      config: { model_params: { max_tool_iterations: 1 } },
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "Calculate 21 times 2" }],
      { useTools: true, sessionId }
    );

    const usage = summarizeSessionTokenUsage(sessionId);
    expect(result.content).toBe("The result is 42.");
    expect(requestCount).toBe(2);
    expect(usage.callCount).toBe(2);
    expect(usage.inputTokens).toBe(30);
    expect(usage.outputTokens).toBe(8);
    expect(usage.totalTokens).toBe(38);
  });
});
