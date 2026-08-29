import { afterEach, describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import {
  registerAgentHook,
  resetAgentHooksForTests,
  type AgentHookEvent,
} from "../../src/core/agent-hooks";
import { coerceToolArguments } from "../../src/core/tool-argument-coercion";
import { providerManager } from "../../src/core/providers";
import type { ToolDefinition } from "../../src/core/database";

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetAgentHooksForTests();
  for (const agentId of createdAgentIds.splice(0)) agentManager.delete(agentId);
  for (const providerId of createdProviderIds.splice(0)) providerManager.delete(providerId);
});

function createOpenAiToolAgent(tool: ToolDefinition) {
  const provider = providerManager.create({
    provider: "openai",
    name: `Tool Robustness Provider ${crypto.randomUUID()}`,
    api_key: "sk-tool-robustness",
    base_url: "https://api.openai.com/v1",
  });
  createdProviderIds.push(provider.id);

  const agent = agentManager.create({
    name: `Tool Robustness Agent ${crypto.randomUUID()}`,
    type: "main",
    provider_id: provider.id,
    model: "gpt-tool-robustness",
    tools: [tool],
    memory_enabled: false,
  });
  createdAgentIds.push(agent.id);
  return agent;
}

describe("tool dispatch robustness", () => {
  test("continues after a tool-backed response promises execution on the next turn", async () => {
    const grepTool: ToolDefinition = {
      name: "grep",
      description: "Search files",
      input_schema: {
        type: "object",
        properties: { pattern: { type: "string" } },
        required: ["pattern"],
      },
    };
    const agent = createOpenAiToolAgent(grepTool);
    const requestedPatterns: string[] = [];
    registerAgentHook((event) => {
      if (event.type !== "tool_before" || event.toolName !== "grep") return undefined;
      const pattern = typeof event.args.pattern === "string" ? event.args.pattern : "";
      requestedPatterns.push(pattern);
      return { block: true, reason: "blocked by test" };
    });

    const responses = [
      {
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "inspect-call",
              type: "function",
              function: { name: "grep", arguments: JSON.stringify({ pattern: "schema" }) },
            },
          ],
        },
      },
      {
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: "Ready to proceed — implementing the migration next.",
        },
      },
      {
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "implementation-call",
              type: "function",
              function: { name: "grep", arguments: JSON.stringify({ pattern: "migration" }) },
            },
          ],
        },
      },
      {
        finish_reason: "stop",
        message: { role: "assistant", content: "Migration implemented and verified." },
      },
    ];
    let call = 0;
    globalThis.fetch = (async () => {
      const choice = responses[call];
      call += 1;
      if (!choice) throw new Error("Unexpected provider call");
      return new Response(
        JSON.stringify({
          id: `deferred-${call}`,
          object: "chat.completion",
          model: "gpt-tool-robustness",
          choices: [{ index: 0, ...choice }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "Implement the schema migration and verify it." }],
      { useTools: true, sessionId: `deferred-continuation-${crypto.randomUUID()}` }
    );

    expect(result.content).toBe("Migration implemented and verified.");
    expect(result.tool_calls).toHaveLength(2);
    expect(requestedPatterns).toEqual(["schema", "migration"]);
    expect(call).toBe(4);
  });

  test("coerces schema-shaped tool arguments before dispatch", () => {
    const normalized = coerceToolArguments(
      "example",
      {
        limit: "5",
        ratio: "0.25",
        recursive: "false",
        paths: "src/index.ts",
        env: '{"NODE_ENV":"test"}',
        invalidInteger: "2.5",
      },
      {
        type: "object",
        properties: {
          limit: { type: "integer" },
          ratio: { type: "number" },
          recursive: { type: "boolean" },
          paths: { type: "array", items: { type: "string" } },
          env: { type: "object" },
          invalidInteger: { type: "integer" },
        },
      }
    );

    expect(normalized).toMatchObject({
      limit: 5,
      ratio: 0.25,
      recursive: false,
      paths: ["src/index.ts"],
      env: { NODE_ENV: "test" },
      invalidInteger: "2.5",
    });
  });

  test("passes coerced tool arguments to agent hooks", async () => {
    const grepTool: ToolDefinition = {
      name: "grep",
      description: "Search files",
      input_schema: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          maxResults: { type: "number" },
          caseSensitive: { type: "boolean" },
        },
        required: ["pattern"],
      },
    };
    const agent = createOpenAiToolAgent(grepTool);
    let capturedArgs: Record<string, unknown> | undefined;
    registerAgentHook((event) => {
      if (event.type !== "tool_before" || event.toolName !== "grep") return undefined;
      capturedArgs = event.args;
      return { block: true, reason: "blocked by test" };
    });

    let call = 0;
    globalThis.fetch = (async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({
            id: "resp-tool-coerce-1",
            object: "chat.completion",
            model: "gpt-tool-robustness",
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
                        name: "grep",
                        arguments: JSON.stringify({
                          pattern: "tool",
                          maxResults: "3",
                          caseSensitive: "false",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          id: "resp-tool-coerce-2",
          object: "chat.completion",
          model: "gpt-tool-robustness",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: "DONE" },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "search with typed args" }],
      { useTools: true, sessionId: `tool-coerce-${crypto.randomUUID()}` }
    );

    expect(result.content).toBe("DONE");
    expect(capturedArgs).toMatchObject({ pattern: "tool", maxResults: 3, caseSensitive: false });
  });

  test("classifies sensitive read denials as blocked instead of tool errors", async () => {
    const readTool: ToolDefinition = {
      name: "read",
      description: "Read files",
      input_schema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    };
    const agent = createOpenAiToolAgent(readTool);
    const events: AgentHookEvent[] = [];
    registerAgentHook((event) => {
      events.push(event);
    });

    let call = 0;
    globalThis.fetch = (async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({
            id: "resp-tool-blocked-1",
            object: "chat.completion",
            model: "gpt-tool-robustness",
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
                        arguments: JSON.stringify({ path: ".env.example" }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          id: "resp-tool-blocked-2",
          object: "chat.completion",
          model: "gpt-tool-robustness",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: "DENIAL-HANDLED" },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "read .env.example" }],
      {
        useTools: true,
        sessionId: `tool-blocked-${crypto.randomUUID()}`,
        workspaceDir: process.cwd(),
      }
    );

    expect(result.content).toBe("DENIAL-HANDLED");
    expect(result.tool_calls?.[0]?.result).toMatchObject({ blocked: true });
    expect(events.some((event) => event.type === "tool_blocked" && event.toolName === "read")).toBe(
      true
    );
    expect(events.some((event) => event.type === "tool_error" && event.toolName === "read")).toBe(
      false
    );
  });
});
