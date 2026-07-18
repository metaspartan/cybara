import { afterEach, describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import { config } from "../../src/core/config";
import { providerManager } from "../../src/core/providers";
import { getProviderAvailability, resetRouterForTests } from "../../src/core/router";
import { summarizeSessionTokenUsage } from "../../src/core/session-context";
import { onStatus } from "../../src/core/status";

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
  config.set("tool_approval_mode", "ask");
  config.set("router", null);
  globalThis.fetch = originalFetch;
  for (const agentId of createdAgentIds.splice(0)) {
    agentManager.delete(agentId);
  }
  for (const providerId of createdProviderIds.splice(0)) {
    providerManager.delete(providerId);
  }
  resetRouterForTests();
});

describe("Agent provider Google and compatible routing", () => {
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

  test("retries transient Google connection failures and rate limits but not quota exhaustion", async () => {
    let transientCalls = 0;
    globalThis.fetch = (async () => {
      transientCalls += 1;
      if (transientCalls === 1) throw new Error("fetch failed: ECONNRESET");
      if (transientCalls === 2) {
        return Response.json(
          { error: { message: "temporary rate limit" } },
          { status: 429, headers: { "Retry-After": "0" } }
        );
      }
      return Response.json({
        candidates: [{ content: { parts: [{ text: "google-retry-ok" }] } }],
        usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2, totalTokenCount: 9 },
      });
    }) as typeof fetch;

    const transientProvider = providerManager.create({
      provider: "google",
      name: "Google Transient Retry Provider",
      api_key: "google-transient-key",
    });
    createdProviderIds.push(transientProvider.id);
    const transientAgent = agentManager.create({
      name: "Google Transient Retry Agent",
      type: "main",
      provider_id: transientProvider.id,
      model: "gemini-3-pro-preview",
      tools: [],
    });
    createdAgentIds.push(transientAgent.id);

    const transientResult = await agentManager.execute(
      transientAgent.id,
      [{ role: "user", content: "reply briefly" }],
      { useTools: false, sessionId: "google-transient-retry-session" }
    );

    expect(transientResult.content).toBe("google-retry-ok");
    expect(transientCalls).toBe(3);

    let exhaustedCalls = 0;
    globalThis.fetch = (async () => {
      exhaustedCalls += 1;
      return Response.json(
        { error: { message: "weekly quota exceeded" } },
        { status: 429, headers: { "Retry-After": "0" } }
      );
    }) as typeof fetch;

    const exhaustedProvider = providerManager.create({
      provider: "google",
      name: "Google Exhausted Provider",
      api_key: "google-exhausted-key",
    });
    createdProviderIds.push(exhaustedProvider.id);
    const exhaustedAgent = agentManager.create({
      name: "Google Exhausted Agent",
      type: "main",
      provider_id: exhaustedProvider.id,
      model: "gemini-3-pro-preview",
      tools: [],
    });
    createdAgentIds.push(exhaustedAgent.id);

    const exhaustedResult = await agentManager.execute(
      exhaustedAgent.id,
      [{ role: "user", content: "reply briefly" }],
      { useTools: false, sessionId: "google-exhausted-session" }
    );

    expect(exhaustedResult.content.toLowerCase()).toContain("quota");
    expect(exhaustedCalls).toBe(1);
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
    expect(requestHeaders.get("User-Agent")).toMatch(/^Cybara\//);
    expect(requestHeaders.get("X-Msh-Platform")).toBe("kimi_code_cli");
    expect(requestHeaders.get("X-Msh-Device-Id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("retries transient Kimi connection failures and rate limits", async () => {
    let calls = 0;
    const recoveryStatusDetails: string[] = [];
    const unsubscribe = onStatus((status) => {
      if (status.sessionId === "kimi-transient-retry-session" && status.detail) {
        recoveryStatusDetails.push(status.detail);
      }
    });
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) throw new Error("fetch failed: ECONNRESET");
      if (calls <= 5) {
        return Response.json(
          { error: { message: "temporary rate limit" } },
          { status: 429, headers: { "Retry-After": "0" } }
        );
      }
      return Response.json({
        id: "kimi-retry-response",
        object: "chat.completion",
        model: "k3",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "kimi-retry-ok" },
          },
        ],
        usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      });
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "kimi-code-oauth",
      name: "Kimi Transient Retry Provider",
      access_token: "kimi-transient-access-token",
      expires_at: Date.now() + 3_600_000,
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "Kimi Transient Retry Agent",
      type: "main",
      provider_id: provider.id,
      model: "k3",
      tools: [],
    });
    createdAgentIds.push(agent.id);

    const result = await (async () => {
      try {
        return await agentManager.execute(agent.id, [{ role: "user", content: "reply briefly" }], {
          useTools: false,
          sessionId: "kimi-transient-retry-session",
        });
      } finally {
        unsubscribe();
      }
    })();

    expect(result.content).toBe("kimi-retry-ok");
    expect(calls).toBe(6);
    expect(recoveryStatusDetails.some((detail) => detail.startsWith("Provider "))).toBe(false);
  });

  test("does not retry Kimi plan exhaustion as a transient rate limit", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return Response.json(
        { error: { message: "weekly quota exceeded" } },
        { status: 429, headers: { "Retry-After": "0" } }
      );
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "kimi-code-oauth",
      name: "Kimi Exhausted Provider",
      access_token: "kimi-exhausted-access-token",
      expires_at: Date.now() + 3_600_000,
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "Kimi Exhausted Agent",
      type: "main",
      provider_id: provider.id,
      model: "k3",
      tools: [],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "reply briefly" }],
      { useTools: false, sessionId: "kimi-exhausted-session" }
    );

    expect(result.content.toLowerCase()).toContain("quota");
    expect(calls).toBe(1);
  });

  test("removes empty assistant records before switching to Kimi", async () => {
    let requestMessages: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      requestMessages = Array.isArray(body.messages)
        ? (body.messages as Array<Record<string, unknown>>)
        : [];
      return Response.json({
        id: "kimi-provider-switch",
        object: "chat.completion",
        model: "k3",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "continued" },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 2, total_tokens: 14 },
      });
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "kimi-code-oauth",
      name: "Kimi Provider Switch",
      access_token: "kimi-provider-switch-token",
      expires_at: Date.now() + 3_600_000,
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "Kimi Provider Switch Agent",
      type: "main",
      provider_id: provider.id,
      model: "k3",
      tools: [],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [
        { role: "user", content: "start with grok" },
        { role: "assistant", content: "" },
        { role: "user", content: "continue with kimi" },
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "call-1", name: "read", arguments: { path: "README.md" } }],
        },
        { role: "tool", content: "read result", tool_call_id: "call-1" },
        { role: "user", content: "summarize" },
      ],
      { useTools: false, sessionId: "kimi-provider-switch-session" }
    );

    expect(result.content).toBe("continued");
    expect(
      requestMessages.some((message) => message.role === "assistant" && message.content === "")
    ).toBe(false);
    expect(requestMessages).toContainEqual({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call-1",
          type: "function",
          function: { name: "read", arguments: '{"path":"README.md"}' },
        },
      ],
    });
    expect(requestMessages).toContainEqual({
      role: "tool",
      content: "read result",
      tool_call_id: "call-1",
    });
  });

  test("refreshes Kimi OAuth in place when a long tool loop crosses token expiry", async () => {
    const chatAuthorizations: string[] = [];
    let chatCalls = 0;
    let refreshCalls = 0;
    const recoveryStatusDetails: string[] = [];
    const unsubscribe = onStatus((status) => {
      if (status.sessionId === "kimi-long-loop-refresh-session" && status.detail) {
        recoveryStatusDetails.push(status.detail);
      }
    });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://auth.kimi.com/api/oauth/token") {
        refreshCalls += 1;
        return Response.json({
          access_token: "fresh-kimi-loop-token",
          refresh_token: "fresh-kimi-loop-refresh",
          expires_in: 900,
        });
      }

      chatCalls += 1;
      chatAuthorizations.push(new Headers(init?.headers).get("Authorization") || "");
      if (chatCalls === 1) {
        return Response.json({
          id: "kimi-loop-tool-response",
          object: "chat.completion",
          model: "k3",
          choices: [
            {
              index: 0,
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    id: "kimi-loop-calc",
                    type: "function",
                    function: { name: "calc", arguments: '{"expression":"6 * 7"}' },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
        });
      }
      if (chatCalls === 2) {
        return Response.json({ error: { message: "access token expired" } }, { status: 401 });
      }
      return Response.json({
        id: "kimi-loop-final-response",
        object: "chat.completion",
        model: "k3",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "The result is 42." },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
      });
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "kimi-code-oauth",
      name: "Kimi Long Loop Provider",
      access_token: "stale-kimi-loop-token",
      refresh_token: "stale-kimi-loop-refresh",
      expires_at: Date.now() + 3_600_000,
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "Kimi Long Loop Agent",
      type: "main",
      provider_id: provider.id,
      model: "k3",
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
    });
    createdAgentIds.push(agent.id);
    config.set("tool_approval_mode", "always_allow");

    const result = await (async () => {
      try {
        return await agentManager.execute(
          agent.id,
          [{ role: "user", content: "Calculate six times seven" }],
          { useTools: true, sessionId: "kimi-long-loop-refresh-session" }
        );
      } finally {
        unsubscribe();
      }
    })();

    expect(result.content).toBe("The result is 42.");
    expect(result.tool_calls).toHaveLength(1);
    expect(chatCalls).toBe(3);
    expect(refreshCalls).toBe(1);
    expect(chatAuthorizations).toEqual([
      "Bearer stale-kimi-loop-token",
      "Bearer stale-kimi-loop-token",
      "Bearer fresh-kimi-loop-token",
    ]);
    expect(recoveryStatusDetails.some((detail) => detail.startsWith("Provider "))).toBe(false);
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

  test("openai codex tool-call narration cannot replace an empty final answer", async () => {
    config.set("tool_approval_mode", "always_allow");
    const requestBodies: Array<Record<string, unknown>> = [];
    const turns = [
      [
        { type: "response.output_text.delta", delta: "I'll check that." },
        {
          type: "response.output_item.added",
          item: {
            type: "function_call",
            id: "item_calc",
            call_id: "call_calc",
            name: "calc",
            arguments: '{"expression":"2+2"}',
          },
        },
        { type: "response.completed", response: { status: "completed" } },
      ],
      [{ type: "response.completed", response: { status: "completed" } }],
      [
        { type: "response.output_text.delta", delta: "The checked result is 4." },
        { type: "response.completed", response: { status: "completed" } },
      ],
    ];

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      requestBodies.push(body);
      const events = turns[requestBodies.length - 1] ?? turns[turns.length - 1];
      const payload = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
      return new Response(payload, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "openai-codex",
      name: "OpenAI Codex Closing Response Provider",
      access_token: "codex-test-token",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "OpenAI Codex Closing Response Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-5.3-codex",
      tools: ["calc"],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "can you check what 2+2 is?" }],
      { useTools: true, sessionId: "openai-codex-closing-response-session" }
    );

    expect(result.content).toBe("The checked result is 4.");
    expect(result.content).not.toBe("I'll check that.");
    expect(result.tool_calls?.map((call) => call.name)).toContain("calc");
    expect(requestBodies).toHaveLength(3);
    expect(requestBodies[2]?.tool_choice).toBe("none");
    expect(requestBodies[2]?.tools).toBeUndefined();
    expect(JSON.stringify(requestBodies[2]?.input)).toContain("Do not call any more tools");
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
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: "rate limit reached" } }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "0" },
      });
    }) as typeof fetch;

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
    expect(calls).toBe(4);
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
