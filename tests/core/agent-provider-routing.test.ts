import { afterEach, describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import { config } from "../../src/core/config";
import { providerManager } from "../../src/core/providers";
import { getProviderAvailability, resetRouterForTests } from "../../src/core/router";
import { summarizeSessionTokenUsage } from "../../src/core/session-context";
import {
  createProviderAccountPool,
  resetProviderAccountPoolsForTests,
} from "../../src/core/provider-account-pool";

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
  resetProviderAccountPoolsForTests();
});

describe("Agent provider API-family routing", () => {
  test("orders automatic coding-plan accounts by tracked remaining usage", async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get("Authorization") || "";
      const usedPercent = authorization.includes("primary-usage-key") ? 88 : 24;
      return Response.json({
        data: {
          level: "pro",
          limits: [
            { type: "TOKENS_LIMIT", unit: 3, percentage: usedPercent },
            { type: "TOKENS_LIMIT", unit: 6, percentage: usedPercent },
          ],
        },
      });
    }) as typeof fetch;

    const primary = providerManager.create({
      provider: "z.ai-coding",
      name: "Primary Usage Account",
      api_key: "primary-usage-key",
    });
    const backup = providerManager.create({
      provider: "z.ai-coding",
      name: "Backup Usage Account",
      api_key: "backup-usage-key",
    });
    createdProviderIds.push(primary.id, backup.id);
    const pool = createProviderAccountPool(
      {
        name: "Usage-balanced plans",
        provider: "z.ai-coding",
        accounts: [{ providerId: primary.id }, { providerId: backup.id }],
      },
      [primary, backup]
    );

    expect(
      (await providerManager.getAccountPoolCandidates(primary.id, pool.id)).map((item) => item.id)
    ).toEqual([backup.id, primary.id]);
  });

  test("fails over to the next enabled account after quota exhaustion", async () => {
    const authorizationHeaders: string[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get("Authorization") || "";
      authorizationHeaders.push(authorization);
      if (authorization === "Bearer primary-pool-key") {
        return Response.json({ error: { message: "weekly quota exceeded" } }, { status: 429 });
      }
      return Response.json({
        id: "pool-response",
        object: "chat.completion",
        model: "gpt-5.2",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "backup-account-ok" },
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      });
    }) as typeof fetch;

    const primary = providerManager.create({
      provider: "openai",
      name: "Primary Pool Account",
      api_key: "primary-pool-key",
    });
    const backup = providerManager.create({
      provider: "openai",
      name: "Backup Pool Account",
      api_key: "backup-pool-key",
    });
    createdProviderIds.push(primary.id, backup.id);
    const pool = createProviderAccountPool(
      {
        name: "OpenAI plans",
        provider: "openai",
        accounts: [
          { providerId: primary.id, priority: 10 },
          { providerId: backup.id, priority: 20 },
        ],
      },
      [primary, backup]
    );
    const agent = agentManager.create({
      name: "Account Pool Agent",
      type: "main",
      provider_id: primary.id,
      provider_pool_id: pool.id,
      model: "gpt-5.2",
      tools: [],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "Use the available account" }],
      { useTools: false, sessionId: "provider-account-pool-session" }
    );

    expect(result.content).toBe("backup-account-ok");
    expect(authorizationHeaders).toEqual(["Bearer primary-pool-key", "Bearer backup-pool-key"]);
    expect(agentManager.get(agent.id)?.provider_id).toBe(primary.id);
    expect(agentManager.get(agent.id)?.provider_pool_id).toBe(pool.id);
  });

  test("keeps an explicitly selected account pinned even when it belongs to a pool", async () => {
    const authorizationHeaders: string[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get("Authorization") || "";
      authorizationHeaders.push(authorization);
      return Response.json({ error: { message: "weekly quota exceeded" } }, { status: 429 });
    }) as typeof fetch;

    const primary = providerManager.create({
      provider: "openai",
      name: "Pinned Pool Member",
      api_key: "pinned-pool-key",
    });
    const backup = providerManager.create({
      provider: "openai",
      name: "Unused Pool Member",
      api_key: "unused-pool-key",
    });
    createdProviderIds.push(primary.id, backup.id);
    createProviderAccountPool(
      {
        name: "Pinned behavior",
        provider: "openai",
        accounts: [{ providerId: primary.id }, { providerId: backup.id }],
      },
      [primary, backup]
    );
    const agent = agentManager.create({
      name: "Pinned Account Agent",
      type: "main",
      provider_id: primary.id,
      model: "gpt-5.2",
      tools: [],
    });
    createdAgentIds.push(agent.id);

    await agentManager.execute(agent.id, [{ role: "user", content: "Stay pinned" }], {
      useTools: false,
    });

    expect(authorizationHeaders).toEqual(["Bearer pinned-pool-key"]);
    expect(agentManager.get(agent.id)?.provider_pool_id).toBeUndefined();
  });

  test("does not replay a turn on another account after a tool starts", async () => {
    config.set("tool_approval_mode", "always_allow");
    const authorizationHeaders: string[] = [];
    let primaryCalls = 0;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get("Authorization") || "";
      authorizationHeaders.push(authorization);
      if (authorization === "Bearer primary-side-effect-key") {
        primaryCalls += 1;
        if (primaryCalls === 1) {
          return Response.json({
            id: "pool-tool-response",
            object: "chat.completion",
            model: "gpt-5.2",
            choices: [
              {
                index: 0,
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: "I will calculate that.",
                  tool_calls: [
                    {
                      id: "call-pool-calc",
                      type: "function",
                      function: {
                        name: "calc",
                        arguments: '{"expression":"6*7"}',
                      },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
          });
        }
        return Response.json({ error: { message: "weekly quota exceeded" } }, { status: 429 });
      }
      return Response.json({
        id: "unexpected-backup-response",
        object: "chat.completion",
        model: "gpt-5.2",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "backup-replayed-the-turn" },
          },
        ],
      });
    }) as typeof fetch;

    const primary = providerManager.create({
      provider: "openai",
      name: "Primary Side Effect Account",
      api_key: "primary-side-effect-key",
    });
    const backup = providerManager.create({
      provider: "openai",
      name: "Backup Side Effect Account",
      api_key: "backup-side-effect-key",
    });
    createdProviderIds.push(primary.id, backup.id);
    const pool = createProviderAccountPool(
      {
        name: "Side effect plans",
        provider: "openai",
        accounts: [
          { providerId: primary.id, priority: 10 },
          { providerId: backup.id, priority: 20 },
        ],
      },
      [primary, backup]
    );
    const agent = agentManager.create({
      name: "Side Effect Pool Agent",
      type: "main",
      provider_id: primary.id,
      provider_pool_id: pool.id,
      model: "gpt-5.2",
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

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "Calculate six times seven" }],
      {
        useTools: true,
        sessionId: `provider-side-effect-${crypto.randomUUID()}`,
      }
    );

    expect(result.content).not.toContain("backup-replayed-the-turn");
    expect(primaryCalls).toBe(2);
    expect(authorizationHeaders).toEqual([
      "Bearer primary-side-effect-key",
      "Bearer primary-side-effect-key",
    ]);
  });

  test("routes Grok OAuth through the proxy and retries connection failures and 429s", async () => {
    let requestUrl = "";
    let requestHeaders = new Headers();
    let requestBody: Record<string, unknown> = {};
    let calls = 0;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      requestUrl = String(input);
      requestHeaders = new Headers(init?.headers);
      requestBody = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (calls === 1) throw new Error("fetch failed: ECONNRESET");
      if (calls === 2) {
        return Response.json(
          { error: { message: "temporary rate limit" } },
          { status: 429, headers: { "Retry-After": "0" } }
        );
      }
      return new Response(
        [
          'data: {"type":"response.output_text.delta","delta":"grok-ok"}',
          'data: {"type":"response.completed","response":{"usage":{"input_tokens":5,"output_tokens":2,"input_tokens_details":{"cached_tokens":1}}}}',
          "data: [DONE]",
          "",
        ].join("\n\n"),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      );
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "xai-oauth",
      name: "Grok Build OAuth Provider",
      access_token: "grok-oauth-token",
      base_url: "https://api.x.ai/v1",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "Grok Build OAuth Agent",
      type: "main",
      provider_id: provider.id,
      model: "grok-4.5",
      tools: [],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "reply briefly" }],
      { useTools: false, sessionId: "grok-build-oauth-route-session" }
    );

    expect(result.content).toBe("grok-ok");
    expect(calls).toBe(3);
    expect(requestUrl).toBe("https://cli-chat-proxy.grok.com/v1/responses");
    expect(requestHeaders.get("Authorization")).toBe("Bearer grok-oauth-token");
    expect(requestHeaders.get("X-XAI-Token-Auth")).toBe("xai-grok-cli");
    expect(requestHeaders.get("x-authenticateresponse")).toBe("authenticate-response");
    expect(requestHeaders.get("x-grok-client-identifier")).toBe("cybara");
    expect(requestHeaders.get("x-grok-client-mode")).toBe("interactive");
    expect(requestHeaders.get("x-grok-model-override")).toBe("grok-4.5");
    expect(requestHeaders.get("x-grok-conv-id")).toBe("grok-build-oauth-route-session");
    expect(requestHeaders.get("x-grok-session-id")).toBe("grok-build-oauth-route-session");
    expect(requestHeaders.get("x-grok-agent-id")).toBe(agent.id);
    expect(requestHeaders.get("x-grok-req-id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(requestHeaders.get("OpenAI-Beta")).toBeNull();
    expect(requestBody.model).toBe("grok-4.5");
    expect(requestBody.stream).toBe(true);
    expect(requestBody.store).toBe(false);
    expect(Array.isArray(requestBody.input)).toBe(true);
  });

  test("does not retry Grok weekly quota exhaustion", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return Response.json(
        { error: { message: "weekly quota exceeded" } },
        { status: 429, headers: { "Retry-After": "0" } }
      );
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "xai-oauth",
      name: "Grok Exhausted OAuth Provider",
      access_token: "grok-exhausted-token",
      base_url: "https://api.x.ai/v1",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "Grok Exhausted OAuth Agent",
      type: "main",
      provider_id: provider.id,
      model: "grok-4.5",
      tools: [],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "reply briefly" }],
      { useTools: false, sessionId: "grok-exhausted-session" }
    );

    expect(result.content.toLowerCase()).toContain("quota");
    expect(calls).toBe(1);
  });

  test("refreshes Grok OAuth in place when a tool loop crosses token expiry", async () => {
    const chatAuthorizations: string[] = [];
    let chatCalls = 0;
    let refreshCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://auth.x.ai/oauth2/token") {
        refreshCalls += 1;
        return Response.json({
          access_token: "fresh-grok-loop-token",
          refresh_token: "fresh-grok-loop-refresh",
          expires_in: 3600,
        });
      }

      chatCalls += 1;
      chatAuthorizations.push(new Headers(init?.headers).get("Authorization") || "");
      if (chatCalls === 1) {
        return Response.json({
          choices: [
            {
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    id: "grok-loop-calc",
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
        choices: [
          {
            message: { role: "assistant", content: "GROK_LOOP_OK 42" },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
      });
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "xai-oauth",
      name: "Grok Long Loop OAuth Provider",
      access_token: "stale-grok-loop-token",
      refresh_token: "stale-grok-loop-refresh",
      expires_at: Date.now() + 3_600_000,
      base_url: "https://api.x.ai/v1",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "Grok Long Loop OAuth Agent",
      type: "main",
      provider_id: provider.id,
      model: "grok-4.5",
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

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "Calculate six times seven" }],
      { useTools: true, sessionId: "grok-long-loop-refresh-session" }
    );

    expect(result.content).toBe("GROK_LOOP_OK 42");
    expect(result.tool_calls).toHaveLength(1);
    expect(chatCalls).toBe(3);
    expect(refreshCalls).toBe(1);
    expect(chatAuthorizations).toEqual([
      "Bearer stale-grok-loop-token",
      "Bearer stale-grok-loop-token",
      "Bearer fresh-grok-loop-token",
    ]);
  });

  test("model router resolves provider-type routes without changing the selected agent", async () => {
    let requestUrl = "";
    let requestHeaders = new Headers();

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestHeaders = new Headers(init?.headers);
      return new Response(
        JSON.stringify({
          id: "msg-routed",
          type: "message",
          role: "assistant",
          model: "hf:MiniMaxAI/MiniMax-M2.1",
          content: [{ type: "text", text: "router-ok" }],
          usage: { input_tokens: 8, output_tokens: 2 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const originalProvider = providerManager.create({
      provider: "openai",
      name: "Original Agent Provider",
      api_key: "openai-test-key",
    });
    const routedProvider = providerManager.create({
      provider: "synthetic",
      name: "Routed Synthetic Provider",
      api_key: "synthetic-router-key",
    });
    createdProviderIds.push(originalProvider.id, routedProvider.id);

    const agent = agentManager.create({
      name: "Router Identity Agent",
      type: "main",
      provider_id: originalProvider.id,
      model: "hf:MiniMaxAI/MiniMax-M2.1",
      system_prompt: "KEEP_AGENT_IDENTITY",
      tools: [],
    });
    createdAgentIds.push(agent.id);
    config.set("router", {
      enabled: true,
      strategy: "priority",
      fallbackToAny: false,
      routes: { synthetic: { weight: 100, priority: 0, enabled: true } },
    });

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "route this request" }],
      {
        useTools: false,
        useModelRouter: true,
        sessionId: "router-provider-type-session",
      }
    );

    expect(result.content).toBe("router-ok");
    expect(requestUrl.endsWith("/messages")).toBe(true);
    expect(requestHeaders.get("x-api-key")).toBe("synthetic-router-key");
    expect(agentManager.get(agent.id)?.provider_id).toBe(originalProvider.id);
  });

  test("model router targets a named provider pool and fails over within that pool", async () => {
    const authorizationHeaders: string[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get("Authorization") || "";
      authorizationHeaders.push(authorization);
      if (authorization === "Bearer router-pool-primary") {
        return Response.json({ error: { message: "quota exhausted" } }, { status: 429 });
      }
      return Response.json({
        id: "router-pool-response",
        object: "chat.completion",
        model: "gpt-5.2",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "router-pool-ok" },
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      });
    }) as typeof fetch;

    const originalProvider = providerManager.create({
      provider: "synthetic",
      name: "Router Pool Agent Provider",
      api_key: "router-pool-agent",
    });
    const primary = providerManager.create({
      provider: "openai",
      name: "Router Pool Primary",
      api_key: "router-pool-primary",
    });
    const backup = providerManager.create({
      provider: "openai",
      name: "Router Pool Backup",
      api_key: "router-pool-backup",
    });
    createdProviderIds.push(originalProvider.id, primary.id, backup.id);
    const pool = createProviderAccountPool(
      {
        name: "Router OpenAI Pool",
        provider: "openai",
        accounts: [
          { providerId: primary.id, priority: 10 },
          { providerId: backup.id, priority: 20 },
        ],
      },
      [primary, backup]
    );
    const agent = agentManager.create({
      name: "Router Pool Agent",
      type: "main",
      provider_id: originalProvider.id,
      model: "gpt-5.2",
      tools: [],
    });
    createdAgentIds.push(agent.id);
    config.set("router", {
      enabled: true,
      strategy: "priority",
      fallbackToAny: false,
      routes: {
        [`pool:${pool.id}`]: { weight: 100, priority: 0, enabled: true },
      },
    });

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "route through the pool" }],
      { useTools: false, useModelRouter: true }
    );

    expect(result.content).toBe("router-pool-ok");
    expect(authorizationHeaders).toEqual([
      "Bearer router-pool-primary",
      "Bearer router-pool-backup",
    ]);
    expect(agentManager.get(agent.id)?.provider_id).toBe(originalProvider.id);
  });

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

  test("routes Anthropic subscription providers with OAuth bearer authentication", async () => {
    let requestUrl = "";
    let requestHeaders = new Headers();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestHeaders = new Headers(init?.headers);
      return Response.json({
        id: "msg-oauth",
        type: "message",
        role: "assistant",
        model: "claude-opus-4-8",
        content: [{ type: "text", text: "oauth-ok" }],
        usage: { input_tokens: 5, output_tokens: 2 },
      });
    }) as typeof fetch;
    const provider = providerManager.create({
      provider: "anthropic-oauth",
      name: "Anthropic Subscription Test",
      access_token: "oauth-access-token",
      refresh_token: "oauth-refresh-token",
      expires_at: Date.now() + 3_600_000,
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "Anthropic Subscription Agent",
      type: "main",
      provider_id: provider.id,
      model: "claude-opus-4-8",
      tools: [],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(agent.id, [{ role: "user", content: "hello" }], {
      useTools: false,
      sessionId: "anthropic-oauth-session",
    });

    expect(result.content).toBe("oauth-ok");
    expect(requestUrl).toBe("https://api.anthropic.com/v1/messages");
    expect(requestHeaders.get("authorization")).toBe("Bearer oauth-access-token");
    expect(requestHeaders.get("x-api-key")).toBeNull();
    expect(requestHeaders.get("anthropic-beta")).toBe("oauth-2025-04-20");
  });

  test("refreshes MiniMax Portal OAuth in place when a tool loop crosses token expiry", async () => {
    const chatAuthorizations: string[] = [];
    let chatCalls = 0;
    let refreshCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://account.minimax.io/oauth2/token") {
        refreshCalls += 1;
        return Response.json({
          access_token: "fresh-minimax-loop-token",
          refresh_token: "fresh-minimax-loop-refresh",
          expires_in: 3600,
        });
      }

      chatCalls += 1;
      chatAuthorizations.push(new Headers(init?.headers).get("Authorization") || "");
      if (chatCalls === 1) {
        return Response.json({
          id: "minimax-loop-tool-response",
          type: "message",
          role: "assistant",
          model: "MiniMax-M3",
          content: [
            {
              type: "tool_use",
              id: "minimax-loop-calc",
              name: "calc",
              input: { expression: "6 * 7" },
            },
          ],
          usage: { input_tokens: 8, output_tokens: 3 },
        });
      }
      if (chatCalls === 2) {
        return Response.json({ error: { message: "access token expired" } }, { status: 401 });
      }
      return Response.json({
        id: "minimax-loop-final-response",
        type: "message",
        role: "assistant",
        model: "MiniMax-M3",
        content: [{ type: "text", text: "MINIMAX_LOOP_OK 42" }],
        usage: { input_tokens: 12, output_tokens: 4 },
      });
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "minimax-portal",
      name: "MiniMax Portal Long Loop Provider",
      access_token: "stale-minimax-loop-token",
      refresh_token: "stale-minimax-loop-refresh",
      expires_at: Date.now() + 3_600_000,
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "MiniMax Portal Long Loop Agent",
      type: "main",
      provider_id: provider.id,
      model: "MiniMax-M3",
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

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "Calculate six times seven" }],
      { useTools: true, sessionId: "minimax-long-loop-refresh-session" }
    );

    expect(result.content).toBe("MINIMAX_LOOP_OK 42");
    expect(result.tool_calls).toHaveLength(1);
    expect(chatCalls).toBe(3);
    expect(refreshCalls).toBe(1);
    expect(chatAuthorizations).toEqual([
      "Bearer stale-minimax-loop-token",
      "Bearer stale-minimax-loop-token",
      "Bearer fresh-minimax-loop-token",
    ]);
  });

  test("retries transient MiniMax connection failures and rate limits", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) throw new Error("fetch failed: ECONNRESET");
      if (calls === 2) {
        return Response.json(
          { error: { message: "temporary rate limit" } },
          { status: 429, headers: { "Retry-After": "0" } }
        );
      }
      return Response.json({
        id: "minimax-retry-response",
        type: "message",
        role: "assistant",
        model: "MiniMax-M3",
        content: [{ type: "text", text: "minimax-retry-ok" }],
        usage: { input_tokens: 5, output_tokens: 2 },
      });
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "minimax",
      name: "MiniMax Transient Retry Provider",
      api_key: "minimax-transient-key",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "MiniMax Transient Retry Agent",
      type: "main",
      provider_id: provider.id,
      model: "MiniMax-M3",
      tools: [],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "reply briefly" }],
      { useTools: false, sessionId: "minimax-transient-retry-session" }
    );

    expect(result.content).toBe("minimax-retry-ok");
    expect(calls).toBe(3);
  });

  test("does not retry MiniMax plan exhaustion as a transient rate limit", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return Response.json(
        { error: { message: "weekly quota exceeded" } },
        { status: 429, headers: { "Retry-After": "0" } }
      );
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "minimax",
      name: "MiniMax Exhausted Provider",
      api_key: "minimax-exhausted-key",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "MiniMax Exhausted Agent",
      type: "main",
      provider_id: provider.id,
      model: "MiniMax-M3",
      tools: [],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "reply briefly" }],
      { useTools: false, sessionId: "minimax-exhausted-session" }
    );

    expect(result.content.toLowerCase()).toContain("quota");
    expect(calls).toBe(1);
  });

  test("routes Devin accounts through the native transport validation", async () => {
    let requestCount = 0;
    globalThis.fetch = (async () => {
      requestCount += 1;
      return Response.json({ error: "unexpected request" }, { status: 500 });
    }) as typeof fetch;
    const provider = providerManager.create({
      provider: "devin",
      name: "Devin Account Test",
      api_key: "cog_test",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "Devin Account Agent",
      type: "main",
      provider_id: provider.id,
      model: "default",
      tools: [],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(agent.id, [{ role: "user", content: "hello" }], {
      useTools: false,
      sessionId: "cursor-account-session",
    });

    expect(result.content).toContain("Devin requires an organization ID");
    expect(requestCount).toBe(0);
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
            content: [
              {
                type: "text",
                text: "I could not run that tool, but I can still help.",
              },
            ],
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
    config.set("tool_approval_mode", "always_allow");
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
    const requestBodies: Array<Record<string, unknown>> = [];

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestCount += 1;
      const requestBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      requestBodies.push(requestBody);
      if (!requestBody.tools) {
        return new Response(
          JSON.stringify({
            id: `msg-max-iter-closing-${requestCount}`,
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-20250514",
            content: [
              {
                type: "text",
                text: "Completed work summarized at the safety boundary.",
              },
            ],
            usage: { input_tokens: 10, output_tokens: 8 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
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

    expect(requestCount).toBe(5);
    expect(result.tool_calls?.length).toBe(3);
    expect(result.content).toBe("Completed work summarized at the safety boundary.");
    expect(JSON.stringify(requestBodies[3])).toContain("AGENT BUDGET WARNING");
    expect(requestBodies[4]?.tools).toBeUndefined();
  });

  test("anthropic loop preserves a final response returned at the iteration boundary", async () => {
    let requestCount = 0;

    globalThis.fetch = (async () => {
      requestCount += 1;
      if (requestCount === 4) {
        return new Response(
          JSON.stringify({
            id: "msg-boundary-final",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-20250514",
            content: [{ type: "text", text: "The boundary result is complete." }],
            usage: { input_tokens: 10, output_tokens: 6 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          id: `msg-boundary-${requestCount}`,
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-20250514",
          content: [
            {
              type: "tool_use",
              id: `toolu_boundary_${requestCount}`,
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
      name: "Anthropic Boundary Provider",
      api_key: "anthropic-boundary-key",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Anthropic Boundary Agent",
      type: "main",
      provider_id: provider.id,
      model: "claude-sonnet-4-20250514",
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
      config: { model_params: { max_tool_iterations: 3 } },
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "finish exactly at the boundary" }],
      { useTools: true, sessionId: "anthropic-boundary-session" }
    );

    expect(requestCount).toBe(4);
    expect(result.tool_calls?.length).toBe(3);
    expect(result.content).toBe("The boundary result is complete.");
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
