import { afterEach, describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";

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
    expect(requestBody.system).toBe("SYSTEM_FROM_AGENT");
    expect(requestBody.messages).toEqual([{ role: "user", content: "hello synthetic" }]);
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

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "hello kimi" }],
      { useTools: false, sessionId: "kimi-header-session" }
    );

    expect(result.content).toBe("kimi-ok");
    expect(requestHeaders.get("Authorization")).toBe("Bearer kimi-test-key");
    expect(requestHeaders.get("User-Agent")).toBe("KimiCLI/0.77");
  });

  test("routes openai-codex-responses providers with max_completion_tokens", async () => {
    let requestUrl = "";
    let requestBody: Record<string, unknown> = {};
    let requestHeaders = new Headers();

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestHeaders = new Headers(init?.headers);
      requestBody = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

      return new Response(
        JSON.stringify({
          id: "resp-codex",
          object: "chat.completion",
          model: "gpt-5.3-codex",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "codex-ok",
              },
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "openai-codex",
      name: "OpenAI Codex Responses Provider",
      access_token: "codex-test-token",
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
    expect(requestUrl.endsWith("/chat/completions")).toBe(true);
    expect(requestHeaders.get("Authorization")).toBe("Bearer codex-test-token");
    expect("max_tokens" in requestBody).toBe(false);
    expect(requestBody.max_completion_tokens).toBe(100000);
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
});
