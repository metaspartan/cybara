import { afterEach, describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import {
  registerAgentHook,
  resetAgentHooksForTests,
  type AgentHookEvent,
} from "../../src/core/agent-hooks";
import { providerManager } from "../../src/core/providers";
import type { ToolDefinition } from "../../src/core/database";
import { deleteSession, handleChat } from "../../src/api/chat";

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];
const createdSessionIds: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(async () => {
  globalThis.fetch = originalFetch;
  resetAgentHooksForTests();
  for (const sessionId of createdSessionIds.splice(0)) {
    await deleteSession(sessionId);
  }
  for (const agentId of createdAgentIds.splice(0)) {
    agentManager.delete(agentId);
  }
  for (const providerId of createdProviderIds.splice(0)) {
    providerManager.delete(providerId);
  }
});

describe("Agent hooks", () => {
  test("long-running tools do not consume the active agent runtime budget", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Long Tool Runtime Provider",
      api_key: "sk-long-tool-runtime",
      base_url: "https://api.openai.com/v1",
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
      name: "Long Tool Runtime Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-long-tool-runtime",
      memory_enabled: false,
      tools: [calcTool],
      config: { model_params: { max_agentic_runtime_ms: 40 } },
    });
    createdAgentIds.push(agent.id);

    registerAgentHook(async (event) => {
      if (event.type === "tool_before") {
        await Bun.sleep(80);
      }
    });

    let requestCount = 0;
    globalThis.fetch = (async () => {
      requestCount += 1;
      const message =
        requestCount === 1
          ? {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call-long-tool-runtime",
                  type: "function",
                  function: { name: "calc", arguments: '{"expression":"20+22"}' },
                },
              ],
            }
          : { role: "assistant", content: "The completed result is 42." };
      return new Response(
        JSON.stringify({
          id: `resp-long-tool-runtime-${requestCount}`,
          object: "chat.completion",
          model: "gpt-long-tool-runtime",
          choices: [
            { index: 0, finish_reason: requestCount === 1 ? "tool_calls" : "stop", message },
          ],
          usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "Calculate 20 plus 22 and report the result" }],
      { useTools: true, sessionId: "long-tool-runtime-session" }
    );

    expect(requestCount).toBe(2);
    expect(result.content).toBe("The completed result is 42.");
    expect(result.tool_calls).toHaveLength(1);
  });

  test("emits llm request and response lifecycle events", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Hooks Provider",
      api_key: "sk-hooks",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Hooks Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-hooks",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);

    const events: AgentHookEvent[] = [];
    registerAgentHook((event) => {
      events.push(event);
    });

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          id: "resp-hooks",
          object: "chat.completion",
          model: "gpt-hooks",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: "hooked response" },
            },
          ],
          usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )) as typeof fetch;

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "hello hooks" }],
      { useTools: false, sessionId: "hook-session", channel: "chat", userId: "user-1" }
    );

    expect(result.content).toBe("hooked response");

    const requestEvent = events.find((event) => event.type === "llm_request");
    expect(requestEvent).toBeDefined();
    if (!requestEvent || requestEvent.type !== "llm_request") return;
    expect(requestEvent.context.agentId).toBe(agent.id);
    expect(requestEvent.context.provider).toBe("openai");
    expect(requestEvent.context.model).toBe("gpt-hooks");
    expect(requestEvent.context.sessionId).toBe("hook-session");
    expect(requestEvent.context.channel).toBe("chat");
    expect(requestEvent.context.userId).toBe("user-1");
    expect(requestEvent.messages.length).toBe(2);
    expect(requestEvent.toolNames.length).toBe(0);

    const responseEvent = events.find((event) => event.type === "llm_response");
    expect(responseEvent).toBeDefined();
    if (!responseEvent || responseEvent.type !== "llm_response") return;
    expect(responseEvent.content).toBe("hooked response");
    expect(responseEvent.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("emits tool lifecycle events and supports hook-based blocking", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Hooks Tool Provider",
      api_key: "sk-hooks-tool",
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
      name: "Hooks Tool Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-hooks-tool",
      tools: [readTool],
    });
    createdAgentIds.push(agent.id);

    let completionCalls = 0;
    globalThis.fetch = (async () => {
      completionCalls += 1;
      if (completionCalls === 1) {
        return new Response(
          JSON.stringify({
            id: "resp-tool-1",
            object: "chat.completion",
            model: "gpt-hooks-tool",
            choices: [
              {
                index: 0,
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "tool-1",
                      type: "function",
                      function: {
                        name: "read",
                        arguments: JSON.stringify({ path: "/tmp/test.txt" }),
                      },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          id: "resp-tool-2",
          object: "chat.completion",
          model: "gpt-hooks-tool",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: "done" },
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const events: AgentHookEvent[] = [];
    registerAgentHook((event) => {
      events.push(event);
      if (event.type === "tool_before" && event.toolName === "read") {
        return { block: true, reason: "blocked by policy hook" };
      }
    });

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "read test file" }],
      { useTools: true, sessionId: "hook-tool-session" }
    );

    expect(result.content).toBe("done");
    expect(result.tool_calls?.[0]?.name).toBe("read");
    expect((result.tool_calls?.[0]?.result as { error?: string }).error).toContain(
      "blocked by policy hook"
    );

    const beforeEvent = events.find((event) => event.type === "tool_before");
    expect(beforeEvent).toBeDefined();
    const blockedEvent = events.find((event) => event.type === "tool_blocked");
    expect(blockedEvent).toBeDefined();
    const afterEvent = events.find((event) => event.type === "tool_after");
    expect(afterEvent).toBeUndefined();
  });

  test("emits llm_error when provider call fails", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Hooks Error Provider",
      api_key: "sk-hooks-error",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Hooks Error Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-hooks-error",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);

    const events: AgentHookEvent[] = [];
    registerAgentHook((event) => {
      events.push(event);
    });

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "provider down" } }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "this should fail" }],
      { useTools: false, sessionId: "hook-error-session" }
    );

    // The friendly-error mapper now surfaces the real cause instead of a
    // blank apology: a 500 with an OpenAI-style error body becomes a server
    // error message carrying the provider's detail.
    expect(result.content.toLowerCase()).toContain("server error");
    expect(result.content).toContain("provider down");
    const errorEvent = events.find((event) => event.type === "llm_error");
    expect(errorEvent).toBeDefined();
    if (!errorEvent || errorEvent.type !== "llm_error") return;
    expect(errorEvent.context.agentId).toBe(agent.id);
    expect(errorEvent.error).toContain("API error");
    expect(errorEvent.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("emits message lifecycle events for chat runtime", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Hooks Chat Provider",
      api_key: "sk-hooks-chat",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Hooks Chat Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-hooks-chat",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);

    const events: AgentHookEvent[] = [];
    registerAgentHook((event) => {
      events.push(event);
    });

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          id: "resp-chat-hooks",
          object: "chat.completion",
          model: "gpt-hooks-chat",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: "chat hooks ok" },
            },
          ],
          usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )) as typeof fetch;

    const sessionId = `chat-hooks-${Date.now()}`;
    createdSessionIds.push(sessionId);

    const result = await handleChat({
      message: "hello from channel",
      agentId: agent.id,
      sessionId,
      channel: "discord",
      userId: "user-42",
      source: "channel:discord",
      tools: false,
    });

    expect(result.message.content).toBe("chat hooks ok");

    const receivedEvent = events.find((event) => event.type === "message:received");
    expect(receivedEvent).toBeDefined();
    if (!receivedEvent || receivedEvent.type !== "message:received") return;
    expect(receivedEvent.context.agentId).toBe(agent.id);
    expect(receivedEvent.context.sessionId).toBe(sessionId);
    expect(receivedEvent.context.channel).toBe("discord");
    expect(receivedEvent.context.userId).toBe("user-42");
    expect(receivedEvent.message).toBe("hello from channel");

    const sentEvent = events.find((event) => event.type === "message:sent");
    expect(sentEvent).toBeDefined();
    if (!sentEvent || sentEvent.type !== "message:sent") return;
    expect(sentEvent.context.agentId).toBe(agent.id);
    expect(sentEvent.context.sessionId).toBe(sessionId);
    expect(sentEvent.message).toBe("chat hooks ok");
  });
});
