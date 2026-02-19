import { afterEach, describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import {
  registerAgentHook,
  resetAgentHooksForTests,
  type AgentHookEvent,
} from "../../src/core/agent-hooks";
import { providerManager } from "../../src/core/providers";
import type { ToolDefinition } from "../../src/core/database";

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetAgentHooksForTests();
  for (const agentId of createdAgentIds.splice(0)) {
    agentManager.delete(agentId);
  }
  for (const providerId of createdProviderIds.splice(0)) {
    providerManager.delete(providerId);
  }
});

describe("Agent hooks", () => {
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

    expect(result.content).toContain("encountered an issue");
    const errorEvent = events.find((event) => event.type === "llm_error");
    expect(errorEvent).toBeDefined();
    if (!errorEvent || errorEvent.type !== "llm_error") return;
    expect(errorEvent.context.agentId).toBe(agent.id);
    expect(errorEvent.error).toContain("API error");
    expect(errorEvent.durationMs).toBeGreaterThanOrEqual(0);
  });
});
