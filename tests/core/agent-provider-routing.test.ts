import { afterEach, describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";
import { getProviderAvailability, resetRouterForTests } from "../../src/core/router";

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
  resetRouterForTests();
});

describe("Agent provider API-family routing", () => {
  test("routes anthropic-family providers through /messages and forwards system prompt", async () => {
    let requestUrl = "";
    let requestBody: Record<string, unknown> = {};
    let requestHeaders = new Headers();

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestHeaders = new Headers(init?.headers);
      requestBody = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

      return new Response(
        JSON.stringify({
          id: "msg-1",
          type: "message",
          role: "assistant",
          model: "hf:MiniMaxAI/MiniMax-M2.1",
          content: [{ type: "text", text: "anthropic-ok" }],
          usage: { input_tokens: 6, output_tokens: 2 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "synthetic",
      name: "Synthetic Routing Provider",
      api_key: "synthetic-test-key",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Synthetic Routing Agent",
      type: "main",
      provider_id: provider.id,
      model: "hf:MiniMaxAI/MiniMax-M2.1",
      system_prompt: "SYSTEM_FROM_AGENT",
      tools: [],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "hello synthetic" }],
      { useTools: false, sessionId: "synthetic-route-session" }
    );

    expect(result.content).toBe("anthropic-ok");
    expect(requestUrl.endsWith("/messages")).toBe(true);
    expect(requestHeaders.get("x-api-key")).toBe("synthetic-test-key");
    // Prompt caching transforms system into an array form with cache_control;
    // the system text must still be forwarded.
    const systemValue = requestBody.system;
    if (typeof systemValue === "string") {
      expect(systemValue).toBe("SYSTEM_FROM_AGENT");
    } else {
      expect(Array.isArray(systemValue)).toBe(true);
      expect(JSON.stringify(systemValue)).toContain("SYSTEM_FROM_AGENT");
      expect(JSON.stringify(systemValue)).toContain("cache_control");
    }
    // Messages may be in block form after cache-breakpoint injection.
    expect(requestBody.messages.length).toBeGreaterThanOrEqual(1);
    expect(requestBody.messages[0].role).toBe("user");
    expect(JSON.stringify(requestBody.messages)).toContain("hello synthetic");
    expect(requestBody.max_tokens).toBe(65536);
  });

  test("adds anthropic 1M beta header when agent model params enable context1m", async () => {
    let requestHeaders = new Headers();

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestHeaders = new Headers(init?.headers);
      return new Response(
        JSON.stringify({
          id: "msg-1m",
          type: "message",
          role: "assistant",
          model: "claude-opus-4-6",
          content: [{ type: "text", text: "context1m-ok" }],
          usage: { input_tokens: 12, output_tokens: 2 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "anthropic",
      name: "Anthropic Context1M Provider",
      api_key: "anthropic-test-key",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Anthropic Context1M Agent",
      type: "main",
      provider_id: provider.id,
      model: "claude-opus-4-6",
      tools: [],
      config: {
        model_params: {
          context1m: true,
        },
      },
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "hello context1m" }],
      { useTools: false, sessionId: "anthropic-context1m-session" }
    );

    expect(result.content).toBe("context1m-ok");
    expect(requestHeaders.get("x-api-key")).toBe("anthropic-test-key");
    expect(requestHeaders.get("anthropic-beta")).toContain("context-1m-2025-08-07");
  });

  test("anthropic loop emits matching tool_result ids even for unknown tool names", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    let requestCount = 0;

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestCount += 1;
      const requestBody = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : {};
      requestBodies.push(requestBody);

      if (requestCount === 1) {
        return new Response(
          JSON.stringify({
            id: "msg-tool-1",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-20250514",
            content: [
              { type: "text", text: "Calling a tool now." },
              {
                type: "tool_use",
                id: "toolu_calc_1",
                name: "calculate",
                input: { expression: "(389234532578 * 3.14) / 2" },
              },
            ],
            usage: { input_tokens: 20, output_tokens: 10 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (requestCount === 2) {
        return new Response(
          JSON.stringify({
            id: "msg-tool-2",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-20250514",
            content: [{ type: "text", text: "I could not run that tool, but I can still help." }],
            usage: { input_tokens: 18, output_tokens: 12 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ error: "unexpected extra request" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "anthropic",
      name: "Anthropic Tool Loop Provider",
      api_key: "anthropic-tool-loop-key",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Anthropic Tool Loop Agent",
      type: "main",
      provider_id: provider.id,
      model: "claude-sonnet-4-20250514",
      tools: [
        {
          name: "calc",
          description: "Evaluate math",
          input_schema: {
            type: "object",
            properties: {
              expression: { type: "string" },
            },
            required: ["expression"],
          },
        },
      ],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "Calculate (389234532578 * 3.14) / 2" }],
      { useTools: true, sessionId: "anthropic-tool-loop-session" }
    );

    expect(result.content).toContain("I could not run that tool");
    expect(requestCount).toBe(2);

    const firstBody = requestBodies[0] as Record<string, unknown>;
    expect(firstBody.tool_choice).toEqual({ type: "auto" });

    const secondBody = requestBodies[1] as Record<string, unknown>;
    const secondMessages = (secondBody.messages as Array<Record<string, unknown>>) || [];
    const lastMessage = secondMessages[secondMessages.length - 1] || {};
    expect(lastMessage.role).toBe("user");

    const toolResults = (lastMessage.content as Array<Record<string, unknown>>) || [];
    const toolResult = toolResults.find((entry) => entry.type === "tool_result");
    expect(toolResult).toBeDefined();
    expect(toolResult?.tool_use_id).toBe("toolu_calc_1");
    expect(typeof toolResult?.content).toBe("string");
    expect(String(toolResult?.content)).toContain("Tool not found: calculate");
  });

  test("anthropic loop truncates oversized tool results and retries with compaction on context overflow", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    let requestCount = 0;
    let sawTruncatedMarker = false;
    let sawCompactedMarker = false;

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestCount += 1;
      const requestBody = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : {};
      requestBodies.push(requestBody);

      if (requestCount === 1) {
        return new Response(
          JSON.stringify({
            id: "msg-tool-truncate-1",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-20250514",
            content: [
              { type: "text", text: "Running a big command." },
              {
                type: "tool_use",
                id: "toolu_exec_big_1",
                name: "exec",
                input: { command: "printf '%*s' 500000 '' | tr ' ' A" },
              },
            ],
            usage: { input_tokens: 64, output_tokens: 24 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (requestCount === 2) {
        const loopMessages = (requestBody.messages as Array<Record<string, unknown>>) || [];
        const lastMessage = loopMessages[loopMessages.length - 1] || {};
        const toolResults = (lastMessage.content as Array<Record<string, unknown>>) || [];
        const toolResult = toolResults.find((entry) => entry.type === "tool_result");
        const serializedToolResult = String(toolResult?.content || "");
        sawTruncatedMarker =
          serializedToolResult.includes("[truncated: output exceeded context limit]") ||
          serializedToolResult.includes("Content truncated");

        return new Response(
          JSON.stringify({
            type: "error",
            error: {
              type: "invalid_request_error",
              message: "request_too_large: Request size exceeds model context window",
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      if (requestCount === 3) {
        const serializedMessages = JSON.stringify(requestBody.messages || []);
        sawCompactedMarker = serializedMessages.includes(
          "[compacted: earlier tool output elided to free context]"
        );

        return new Response(
          JSON.stringify({
            id: "msg-tool-truncate-2",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-20250514",
            content: [{ type: "text", text: "Recovered after compaction." }],
            usage: { input_tokens: 40, output_tokens: 18 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ error: "unexpected extra request" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "anthropic",
      name: "Anthropic Overflow Guard Provider",
      api_key: "anthropic-overflow-guard-key",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Anthropic Overflow Guard Agent",
      type: "main",
      provider_id: provider.id,
      model: "claude-sonnet-4-20250514",
      tools: [
        {
          name: "exec",
          description: "Run shell commands",
          input_schema: {
            type: "object",
            properties: {
              command: { type: "string" },
            },
            required: ["command"],
          },
        },
      ],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "Run a big command and continue" }],
      { useTools: true, sessionId: "anthropic-overflow-guard-session" }
    );

    expect(result.content).toContain("Recovered after compaction");
    expect(requestCount).toBe(3);
    expect(sawTruncatedMarker).toBe(true);
    expect(sawCompactedMarker).toBe(true);
    expect(requestBodies.length).toBe(3);
  });

  test("anthropic loop respects model_params max_tool_iterations override", async () => {
    let requestCount = 0;

    globalThis.fetch = (async () => {
      requestCount += 1;
      return new Response(
        JSON.stringify({
          id: `msg-max-iter-${requestCount}`,
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-20250514",
          content: [
            {
              type: "tool_use",
              id: `toolu_max_iter_${requestCount}`,
              name: "calc",
              input: { expression: `${requestCount}+1` },
            },
          ],
          usage: { input_tokens: 10, output_tokens: 4 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "anthropic",
      name: "Anthropic Max Iteration Provider",
      api_key: "anthropic-max-iter-key",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Anthropic Max Iteration Agent",
      type: "main",
      provider_id: provider.id,
      model: "claude-sonnet-4-20250514",
      tools: [
        {
          name: "calc",
          description: "Evaluate math",
          input_schema: {
            type: "object",
            properties: {
              expression: { type: "string" },
            },
            required: ["expression"],
          },
        },
      ],
      config: {
        model_params: {
          max_tool_iterations: 3,
        },
      },
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "run until limit" }],
      { useTools: true, sessionId: "anthropic-max-iteration-session" }
    );

    expect(requestCount).toBe(4);
    expect(result.tool_calls?.length).toBe(3);
    expect(result.content).toContain("tool-iteration limit (3)");
  });

  test("anthropic loop ignores max_tool_calls alias for iteration cap", async () => {
    let requestCount = 0;

    globalThis.fetch = (async () => {
      requestCount += 1;
      if (requestCount >= 3) {
        return new Response(
          JSON.stringify({
            id: `msg-max-calls-${requestCount}`,
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-20250514",
            content: [
              {
                type: "text",
                text: "final answer",
              },
            ],
            usage: { input_tokens: 12, output_tokens: 6 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          id: `msg-max-calls-${requestCount}`,
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-20250514",
          content: [
            {
              type: "tool_use",
              id: `toolu_max_calls_${requestCount}`,
              name: "calc",
              input: { expression: `${requestCount}+2` },
            },
          ],
          usage: { input_tokens: 10, output_tokens: 4 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "anthropic",
      name: "Anthropic Max Calls Alias Provider",
      api_key: "anthropic-max-calls-key",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Anthropic Max Calls Alias Agent",
      type: "main",
      provider_id: provider.id,
      model: "claude-sonnet-4-20250514",
      tools: [
        {
          name: "calc",
          description: "Evaluate math",
          input_schema: {
            type: "object",
            properties: {
              expression: { type: "string" },
            },
            required: ["expression"],
          },
        },
      ],
      config: {
        model_params: {
          max_tool_calls: 2,
        },
      },
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "run until alias limit" }],
      { useTools: true, sessionId: "anthropic-max-calls-session" }
    );

    expect(requestCount).toBe(3);
    expect(result.tool_calls?.length).toBe(2);
    expect(result.content).toContain("final answer");
    expect(result.content).not.toContain("tool-iteration limit");
  });

  test("anthropic loop stops repeated no-progress cycles early", async () => {
    let requestCount = 0;

    globalThis.fetch = (async () => {
      requestCount += 1;
      return new Response(
        JSON.stringify({
          id: `msg-no-progress-${requestCount}`,
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-20250514",
          content: [
            {
              type: "tool_use",
              id: `toolu_no_progress_${requestCount}`,
              name: "calc",
              input: { expression: "1+1" },
            },
          ],
          usage: { input_tokens: 9, output_tokens: 3 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "anthropic",
      name: "Anthropic No Progress Provider",
      api_key: "anthropic-no-progress-key",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Anthropic No Progress Agent",
      type: "main",
      provider_id: provider.id,
      model: "claude-sonnet-4-20250514",
      tools: [
        {
          name: "calc",
          description: "Evaluate math",
          input_schema: {
            type: "object",
            properties: {
              expression: { type: "string" },
            },
            required: ["expression"],
          },
        },
      ],
      config: {
        model_params: {
          tool_loop_detection_enabled: true,
          tool_loop_warning_threshold: 2,
          tool_loop_critical_threshold: 3,
        },
      },
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "run with repeated call" }],
      { useTools: true, sessionId: "anthropic-no-progress-session" }
    );

    expect(requestCount).toBe(3);
    expect(result.tool_calls?.length).toBe(3);
    expect(result.content).toContain("repeating with no progress");
  });

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

  test("routes google providers through generateContent with x-goog-api-key and model normalization", async () => {
    let requestUrl = "";
    let requestBody: Record<string, unknown> = {};
    let requestHeaders = new Headers();

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestHeaders = new Headers(init?.headers);
      requestBody = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "google-ok" }],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 8,
            candidatesTokenCount: 3,
            totalTokenCount: 11,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "google",
      name: "Google Routing Provider",
      api_key: "AIza-test-key",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Google Routing Agent",
      type: "main",
      provider_id: provider.id,
      model: "google/gemini-3-pro",
      tools: [],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "hello google" }],
      { useTools: false, sessionId: "google-route-session" }
    );

    expect(result.content).toBe("google-ok");
    expect(requestUrl.endsWith("/models/gemini-3-pro-preview:generateContent")).toBe(true);
    expect(requestHeaders.get("x-goog-api-key")).toBe("AIza-test-key");
    expect(requestHeaders.get("Authorization")).toBeNull();

    const contents = (requestBody.contents as Array<Record<string, unknown>>) || [];
    expect(contents[0]).toEqual({
      role: "user",
      parts: [{ text: "hello google" }],
    });
  });

  test("routes OAuth-backed google providers with bearer auth headers", async () => {
    let requestHeaders = new Headers();

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestHeaders = new Headers(init?.headers);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "google-oauth-ok" }],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 7,
            candidatesTokenCount: 2,
            totalTokenCount: 9,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "antigravity",
      name: "Google OAuth Provider",
      access_token: "ya29.test-oauth-token",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Google OAuth Agent",
      type: "main",
      provider_id: provider.id,
      model: "gemini-3-pro-preview",
      tools: [],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "hello antigravity" }],
      { useTools: false, sessionId: "google-oauth-route-session" }
    );

    expect(result.content).toBe("google-oauth-ok");
    expect(requestHeaders.get("Authorization")).toBe("Bearer ya29.test-oauth-token");
    expect(requestHeaders.get("x-goog-api-key")).toBeNull();
  });

  test("applies static provider headers for openai-compatible requests", async () => {
    let requestHeaders = new Headers();

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestHeaders = new Headers(init?.headers);
      return new Response(
        JSON.stringify({
          id: "resp-2",
          object: "chat.completion",
          model: "kimi-for-coding",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "kimi-ok",
              },
            },
          ],
          usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "kimi-code",
      name: "Kimi Header Provider",
      api_key: "kimi-test-key",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Kimi Header Agent",
      type: "main",
      provider_id: provider.id,
      model: "kimi-for-coding",
      tools: [],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(agent.id, [{ role: "user", content: "hello kimi" }], {
      useTools: false,
      sessionId: "kimi-header-session",
    });

    expect(result.content).toBe("kimi-ok");
    expect(requestHeaders.get("Authorization")).toBe("Bearer kimi-test-key");
    expect(requestHeaders.get("User-Agent")).toBe("KimiCLI/0.77");
  });

  test("routes openai-codex-responses providers to codex responses endpoint", async () => {
    let requestUrl = "";
    let requestBody: Record<string, unknown> = {};
    let requestHeaders = new Headers();

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestHeaders = new Headers(init?.headers);
      requestBody = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

      return new Response(
        [
          `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "codex-ok" })}`,
          "",
          `data: ${JSON.stringify({
            type: "response.completed",
            response: {
              status: "completed",
              usage: {
                input_tokens: 5,
                output_tokens: 2,
                total_tokens: 7,
              },
            },
          })}`,
          "",
        ].join("\n"),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      );
    }) as typeof fetch;

    const tokenPayload = Buffer.from(
      JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct_test" } })
    ).toString("base64url");
    const oauthToken = `e30.${tokenPayload}.sig`;

    const provider = providerManager.create({
      provider: "openai-codex",
      name: "OpenAI Codex Responses Provider",
      access_token: oauthToken,
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "OpenAI Codex Responses Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-5.3-codex",
      tools: [],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "hello codex" }],
      { useTools: false, sessionId: "openai-codex-route-session" }
    );

    expect(result.content).toBe("codex-ok");
    expect(requestUrl.endsWith("/codex/responses")).toBe(true);
    expect(requestHeaders.get("Authorization")).toBe(`Bearer ${oauthToken}`);
    expect(requestHeaders.get("chatgpt-account-id")).toBe("acct_test");
    expect(requestHeaders.get("OpenAI-Beta")).toBe("responses=experimental");
    expect(requestBody.model).toBe("gpt-5.3-codex");
    expect(requestBody.store).toBe(false);
    expect(requestBody.stream).toBe(true);
    expect("max_tokens" in requestBody).toBe(false);
    expect("max_completion_tokens" in requestBody).toBe(false);
  });

  test("normalizes openai gpt-5.3-codex model selection to openai-codex provider", async () => {
    const seenAuthHeaders: string[] = [];
    const seenUrls: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seenUrls.push(String(input));
      seenAuthHeaders.push(headers.get("Authorization") || "");

      return new Response(
        [
          `data: ${JSON.stringify({
            type: "response.output_text.delta",
            delta: "normalized-codex-ok",
          })}`,
          "",
          `data: ${JSON.stringify({
            type: "response.completed",
            response: { status: "completed", usage: { input_tokens: 5, output_tokens: 2 } },
          })}`,
          "",
        ].join("\n"),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      );
    }) as typeof fetch;

    const openaiProvider = providerManager.create({
      provider: "openai",
      name: "OpenAI API Key Provider",
      api_key: "openai-api-key",
    });
    createdProviderIds.push(openaiProvider.id);

    const codexProvider = providerManager.create({
      provider: "openai-codex",
      name: "OpenAI Codex OAuth Provider",
      access_token: "codex-oauth-token",
    });
    createdProviderIds.push(codexProvider.id);

    const agent = agentManager.create({
      name: "OpenAI Codex Normalized Agent",
      type: "main",
      provider_id: openaiProvider.id,
      model: "gpt-5.3-codex",
      tools: [],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "normalize provider/model route" }],
      { useTools: false, sessionId: "openai-codex-normalize-session" }
    );

    expect(result.content).toBe("normalized-codex-ok");
    expect(seenUrls[0]?.endsWith("/codex/responses")).toBe(true);
    expect(seenAuthHeaders[0]).toBe("Bearer codex-oauth-token");
    expect(seenAuthHeaders).not.toContain("Bearer openai-api-key");
  });

  test("retries openai-codex model candidates when upstream returns model_not_found", async () => {
    const requestedModels: string[] = [];
    let callCount = 0;

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      callCount++;
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      requestedModels.push(String(body.model || ""));

      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            error: {
              message: "The model `gpt-5.3-codex` does not exist or you do not have access to it.",
              type: "invalid_request_error",
              code: "model_not_found",
            },
          }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(
        [
          `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "fallback-ok" })}`,
          "",
          `data: ${JSON.stringify({
            type: "response.completed",
            response: {
              status: "completed",
              usage: { input_tokens: 6, output_tokens: 2, total_tokens: 8 },
            },
          })}`,
          "",
        ].join("\n"),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      );
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "openai-codex",
      name: "OpenAI Codex Retry Provider",
      access_token: "codex-oauth-token",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "OpenAI Codex Retry Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-5.3-codex",
      tools: [],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "retry codex model" }],
      { useTools: false, sessionId: "openai-codex-retry-session" }
    );

    expect(result.content).toBe("fallback-ok");
    expect(callCount).toBe(2);
    expect(requestedModels).toEqual(["gpt-5.3-codex", "gpt-5.2-codex"]);
  });

  test("retries GPT-5.6 Codex rollout models after a 400 model-not-found response", async () => {
    const requestedModels: string[] = [];

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      requestedModels.push(String(body.model || ""));
      if (requestedModels.length === 1) {
        return new Response(
          JSON.stringify({ error: { message: "Model not found gpt-5.6-luna" } }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        [
          "data: " + JSON.stringify({ type: "response.output_text.delta", delta: "terra-ok" }),
          "",
          "data: " +
            JSON.stringify({
              type: "response.completed",
              response: {
                status: "completed",
                usage: { input_tokens: 6, output_tokens: 2, total_tokens: 8 },
              },
            }),
          "",
        ].join("\n"),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      );
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "openai-codex",
      name: "OpenAI Codex GPT-5.6 Rollout Provider",
      access_token: "codex-oauth-token",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "OpenAI Codex GPT-5.6 Rollout Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-5.6-luna",
      tools: [],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "use an available GPT-5.6 Codex model" }],
      { useTools: false, sessionId: "openai-codex-56-rollout-session" }
    );

    expect(result.content).toBe("terra-ok");
    expect(requestedModels).toEqual(["gpt-5.6-luna", "gpt-5.6-terra"]);
  });

  test("records provider cooldown when openai-codex returns 429", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "rate limit reached" } }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "7" },
      })) as typeof fetch;

    const provider = providerManager.create({
      provider: "openai-codex",
      name: "OpenAI Codex Rate Limited Provider",
      access_token: "codex-oauth-token",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "OpenAI Codex Rate Limit Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-5.3-codex",
      tools: [],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "trigger rate limit" }],
      { useTools: false, sessionId: "openai-codex-429-session" }
    );

    expect(result.content.toLowerCase()).toContain("rate limit");
    const availability = getProviderAvailability(provider.id);
    expect(availability.inCooldown).toBe(true);
    expect(availability.available).toBe(false);
  });

  test("routes ollama API family without forcing authorization header", async () => {
    let requestUrl = "";
    let requestBody: Record<string, unknown> = {};
    let requestHeaders = new Headers();

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestHeaders = new Headers(init?.headers);
      requestBody = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

      return new Response(
        JSON.stringify({
          id: "resp-ollama",
          object: "chat.completion",
          model: "llama3",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "ollama-ok",
              },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "ollama",
      name: "Ollama Routing Provider",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Ollama Routing Agent",
      type: "main",
      provider_id: provider.id,
      model: "llama3",
      tools: [],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "hello ollama" }],
      { useTools: false, sessionId: "ollama-route-session" }
    );

    expect(result.content).toBe("ollama-ok");
    expect(requestUrl.endsWith("/chat/completions")).toBe(true);
    expect(requestHeaders.get("Authorization")).toBeNull();
    expect(requestBody.max_tokens).toBe(8192);
  });

  test("executes text-form tool calls from OpenAI-compatible providers without leaking markup", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const requestBody = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : {};
      requestBodies.push(requestBody);

      if (requestBodies.length === 1) {
        return new Response(
          JSON.stringify({
            id: "resp-text-tool-1",
            object: "chat.completion",
            model: "MiniMax-M3",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: [
                    "Let me calculate that.",
                    "<function_calls>",
                    '<invoke name="calc">',
                    '<parameter name="expression">2 + 2</parameter>',
                    "</invoke>",
                    "</function_calls>",
                  ].join("\n"),
                },
              },
            ],
            usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          id: "resp-text-tool-2",
          object: "chat.completion",
          model: "MiniMax-M3",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "The result is 4.",
              },
            },
          ],
          usage: { prompt_tokens: 18, completion_tokens: 5, total_tokens: 23 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "openai",
      name: "Text Tool Fallback Provider",
      api_key: "text-tool-test-key",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Text Tool Fallback Agent",
      type: "main",
      provider_id: provider.id,
      model: "MiniMax-M3",
      tools: [
        {
          name: "calc",
          description: "Safely evaluate mathematical expressions",
          input_schema: {
            type: "object",
            properties: { expression: { type: "string" } },
            required: ["expression"],
          },
        },
      ],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "What is 2 + 2?" }],
      { useTools: true, sessionId: "text-tool-fallback-session" }
    );

    expect(result.content).toBe("The result is 4.");
    expect(result.content).not.toContain("<function_calls>");
    expect(result.tool_calls?.length).toBe(1);
    expect(result.tool_calls?.[0]?.name).toBe("calc");
    expect(result.tool_calls?.[0]?.result).toEqual({ result: 4, expression: "2 + 2" });

    expect(requestBodies.length).toBe(2);
    expect(requestBodies[0].tool_choice).toBe("auto");
    expect(requestBodies[0].reasoning_split).toBe(true);
    const secondMessages = (requestBodies[1].messages || []) as Array<Record<string, unknown>>;
    const assistantReplay = secondMessages.find(
      (entry) => entry.role === "assistant" && Array.isArray(entry.tool_calls)
    );
    const toolReplay = secondMessages.find((entry) => entry.role === "tool");
    expect(JSON.stringify(assistantReplay)).toContain("cybara-text-tool-1-1");
    expect(toolReplay?.content).toBe('{"result":4,"expression":"2 + 2"}');
    expect(JSON.stringify(secondMessages)).not.toContain("<function_calls>");
  });

  test("executes trailing JSON text tool envelopes from OpenAI-compatible providers", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const requestBody = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : {};
      requestBodies.push(requestBody);

      if (requestBodies.length === 1) {
        return new Response(
          JSON.stringify({
            id: "resp-json-text-tool-1",
            object: "chat.completion",
            model: "MiniMax-M3",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: [
                    "I'll calculate it.",
                    JSON.stringify({ name: "calc", arguments: { expression: "3 * 3" } }, null, 2),
                  ].join("\n"),
                },
              },
            ],
            usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          id: "resp-json-text-tool-2",
          object: "chat.completion",
          model: "MiniMax-M3",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "The result is 9.",
              },
            },
          ],
          usage: { prompt_tokens: 18, completion_tokens: 5, total_tokens: 23 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "openai",
      name: "Trailing JSON Tool Provider",
      api_key: "json-tool-test-key",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Trailing JSON Tool Agent",
      type: "main",
      provider_id: provider.id,
      model: "MiniMax-M3",
      tools: [
        {
          name: "calc",
          description: "Safely evaluate mathematical expressions",
          input_schema: {
            type: "object",
            properties: { expression: { type: "string" } },
            required: ["expression"],
          },
        },
      ],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "What is 3 * 3?" }],
      { useTools: true, sessionId: "trailing-json-tool-session" }
    );

    expect(result.content).toBe("The result is 9.");
    expect(result.tool_calls?.length).toBe(1);
    expect(result.tool_calls?.[0]?.name).toBe("calc");
    expect(result.tool_calls?.[0]?.result).toEqual({ result: 9, expression: "3 * 3" });

    expect(requestBodies.length).toBe(2);
    const secondMessages = (requestBodies[1].messages || []) as Array<Record<string, unknown>>;
    const assistantReplay = secondMessages.find(
      (entry) => entry.role === "assistant" && Array.isArray(entry.tool_calls)
    );
    expect(assistantReplay?.content).toBe("I'll calculate it.");
    expect(JSON.stringify(assistantReplay?.tool_calls)).toContain("cybara-text-tool-1-1");
    expect(JSON.stringify(assistantReplay?.tool_calls)).toContain('"name":"calc"');
  });

  test("executes OpenAI-compatible native tool calls with top-level name and input args", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const requestBody = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : {};
      requestBodies.push(requestBody);

      if (requestBodies.length === 1) {
        return new Response(
          JSON.stringify({
            id: "resp-native-input-tool-1",
            object: "chat.completion",
            model: "glm-5.2",
            choices: [
              {
                index: 0,
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_native_input",
                      type: "function",
                      name: "calc",
                      input: { expression: "4 + 5" },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          id: "resp-native-input-tool-2",
          object: "chat.completion",
          model: "glm-5.2",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "The result is 9.",
              },
            },
          ],
          usage: { prompt_tokens: 18, completion_tokens: 5, total_tokens: 23 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "z.ai-coding",
      name: "Native Input Tool Provider",
      api_key: "native-input-tool-test-key",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Native Input Tool Agent",
      type: "main",
      provider_id: provider.id,
      model: "glm-5.2",
      tools: [
        {
          name: "calc",
          description: "Safely evaluate mathematical expressions",
          input_schema: {
            type: "object",
            properties: { expression: { type: "string" } },
            required: ["expression"],
          },
        },
      ],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "What is 4 + 5?" }],
      { useTools: true, sessionId: "native-input-tool-session" }
    );

    expect(result.content).toBe("The result is 9.");
    expect(result.tool_calls?.[0]?.name).toBe("calc");
    expect(result.tool_calls?.[0]?.args).toEqual({ expression: "4 + 5" });
    expect(result.tool_calls?.[0]?.result).toEqual({ result: 9, expression: "4 + 5" });
  });
});
