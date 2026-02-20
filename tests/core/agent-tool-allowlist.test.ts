import { afterEach, describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";
import type { ToolDefinition } from "../../src/core/database";

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const agentId of createdAgentIds.splice(0)) {
    agentManager.delete(agentId);
  }
  for (const providerId of createdProviderIds.splice(0)) {
    providerManager.delete(providerId);
  }
});

describe("Agent tool allowlist guardrails", () => {
  test("blocks model-invoked tools that were not offered to the agent", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Allowlist Provider",
      api_key: "test-key",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);

    const calcOnlyTool: ToolDefinition = {
      name: "calc",
      description: "Evaluate math expressions",
      input_schema: {
        type: "object",
        properties: { expression: { type: "string" } },
        required: ["expression"],
      },
    };

    const agent = agentManager.create({
      name: "Allowlist Agent",
      type: "main",
      provider_id: provider.id,
      tools: [calcOnlyTool],
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);

    let completionCalls = 0;
    globalThis.fetch = (async () => {
      completionCalls += 1;
      if (completionCalls === 1) {
        return new Response(
          JSON.stringify({
            id: "resp-1",
            object: "chat.completion",
            model: "gpt-test",
            choices: [
              {
                index: 0,
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call-1",
                      type: "function",
                      function: {
                        name: "read",
                        arguments: JSON.stringify({ path: "/tmp/secret.txt" }),
                      },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          id: "resp-2",
          object: "chat.completion",
          model: "gpt-test",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "done",
              },
            },
          ],
          usage: { prompt_tokens: 6, completion_tokens: 2, total_tokens: 8 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "read my file" }],
      { useTools: true, sessionId: "allowlist-session" }
    );

    expect(result.content).toBe("done");
    expect(result.tool_calls).toBeDefined();
    expect(result.tool_calls?.[0]?.name).toBe("read");
    expect((result.tool_calls?.[0]?.result as { error?: string }).error).toContain(
      "Tool not enabled for this agent"
    );
  });

  test("enforces configured tool permissions during agentic execution", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Permission Provider",
      api_key: "test-key",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);

    const readTool: ToolDefinition = {
      name: "read",
      description: "Read files",
      input_schema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    };

    const agent = agentManager.create({
      name: "Permission Agent",
      type: "main",
      provider_id: provider.id,
      tools: [readTool],
      config: {
        tool_permissions: ["fs:write"],
        enforce_tool_permissions: true,
      },
    });
    createdAgentIds.push(agent.id);

    let completionCalls = 0;
    globalThis.fetch = (async () => {
      completionCalls += 1;
      if (completionCalls === 1) {
        return new Response(
          JSON.stringify({
            id: "resp-a",
            object: "chat.completion",
            model: "gpt-test",
            choices: [
              {
                index: 0,
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call-a",
                      type: "function",
                      function: {
                        name: "read",
                        arguments: JSON.stringify({ path: "/tmp/secret.txt" }),
                      },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          id: "resp-b",
          object: "chat.completion",
          model: "gpt-test",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "done",
              },
            },
          ],
          usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "read file" }],
      { useTools: true, sessionId: "permission-session" }
    );

    expect(result.content).toBe("done");
    expect(result.tool_calls?.[0]?.name).toBe("read");
    expect((result.tool_calls?.[0]?.result as { error?: string }).error).toContain(
      "Permission denied"
    );
  });

  test("retries with max_completion_tokens when provider rejects max_tokens", async () => {
    const provider = providerManager.create({
      provider: "openrouter",
      name: "OpenRouter Retry Provider",
      api_key: "sk-test-retry",
      base_url: "https://openrouter.ai/api/v1",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "OpenRouter Retry Agent",
      type: "main",
      provider_id: provider.id,
      model: "openai/gpt-5.2",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);
    const expectedTokenLimit =
      providerManager
        .getModels(provider.id)
        .find((entry) => entry.model_id === "openai/gpt-5.2")
        ?.max_tokens || 100000;

    const requestBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      requestBodies.push(body as Record<string, unknown>);

      if (requestBodies.length === 1) {
        return new Response(
          JSON.stringify({
            error: {
              message:
                "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
              type: "invalid_request_error",
              param: "max_tokens",
              code: "unsupported_parameter",
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          id: "resp-retry",
          object: "chat.completion",
          model: "gpt-5.2",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "705",
              },
            },
          ],
          usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "What is 37*19? only number" }],
      { useTools: false, sessionId: "openai-retry-session" }
    );

    expect(result.content).toBe("705");
    expect(requestBodies.length).toBe(2);
    expect(requestBodies[0].max_tokens).toBe(expectedTokenLimit);
    expect("max_completion_tokens" in requestBodies[0]).toBe(false);
    expect("max_tokens" in requestBodies[1]).toBe(false);
    expect(requestBodies[1].max_completion_tokens).toBe(expectedTokenLimit);
  });

  test("uses max_completion_tokens first for openai-responses providers", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "OpenAI Responses Provider",
      api_key: "sk-test-responses",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "OpenAI Responses Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-5.2",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);
    const expectedTokenLimit =
      providerManager
        .getModels(provider.id)
        .find((entry) => entry.model_id === "gpt-5.2")
        ?.max_tokens || 100000;

    const requestBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      requestBodies.push(body as Record<string, unknown>);

      return new Response(
        JSON.stringify({
          id: "resp-openai-responses",
          object: "chat.completion",
          model: "gpt-5.2",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "13",
              },
            },
          ],
          usage: { prompt_tokens: 7, completion_tokens: 1, total_tokens: 8 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "What is 9+4? only number" }],
      { useTools: false, sessionId: "openai-responses-session" }
    );

    expect(result.content).toBe("13");
    expect(requestBodies.length).toBe(1);
    expect("max_tokens" in requestBodies[0]).toBe(false);
    expect(requestBodies[0].max_completion_tokens).toBe(expectedTokenLimit);
  });

  test("preserves assistant reasoning_content in openai-compatible tool loops", async () => {
    const provider = providerManager.create({
      provider: "kimi-code",
      name: "Kimi Coding Provider",
      api_key: "kimi-test-key",
      base_url: "https://api.kimi.com/coding/v1",
    });
    createdProviderIds.push(provider.id);

    const calcTool: ToolDefinition = {
      name: "calc",
      description: "Evaluate math expressions",
      input_schema: {
        type: "object",
        properties: { expression: { type: "string" } },
        required: ["expression"],
      },
    };

    const agent = agentManager.create({
      name: "Kimi Reasoning Agent",
      type: "main",
      provider_id: provider.id,
      model: "kimi-for-coding",
      tools: [calcTool],
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);

    let completionCalls = 0;
    let loopRequestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      completionCalls += 1;
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

      if (completionCalls === 1) {
        return new Response(
          JSON.stringify({
            id: "resp-kimi-1",
            object: "chat.completion",
            model: "kimi-for-coding",
            choices: [
              {
                index: 0,
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  reasoning_content: "internal reasoning trace",
                  tool_calls: [
                    {
                      id: "call-kimi-1",
                      type: "function",
                      function: {
                        name: "calc",
                        arguments: JSON.stringify({ expression: "1+1" }),
                      },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      loopRequestBody = body;
      return new Response(
        JSON.stringify({
          id: "resp-kimi-2",
          object: "chat.completion",
          model: "kimi-for-coding",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "done",
              },
            },
          ],
          usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "calculate 1+1" }],
      { useTools: true, sessionId: "kimi-reasoning-session" }
    );

    expect(result.content).toBe("done");
    expect(completionCalls).toBe(2);
    expect(loopRequestBody).toBeDefined();

    const loopMessages = Array.isArray(loopRequestBody?.messages)
      ? (loopRequestBody.messages as Array<Record<string, unknown>>)
      : [];

    let assistantToolMessage: Record<string, unknown> | undefined;
    for (let index = loopMessages.length - 1; index >= 0; index -= 1) {
      const candidate = loopMessages[index];
      if (candidate.role === "assistant" && Array.isArray(candidate.tool_calls)) {
        assistantToolMessage = candidate;
        break;
      }
    }

    expect(assistantToolMessage).toBeDefined();
    expect(assistantToolMessage?.reasoning_content).toBe("internal reasoning trace");
  });
});
