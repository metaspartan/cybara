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
});
