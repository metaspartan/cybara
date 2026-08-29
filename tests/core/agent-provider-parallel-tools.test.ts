import { afterEach, describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import { config } from "../../src/core/config";
import { PARALLEL_SAFE_TOOLS } from "../../src/core/llm/parallel-tools";
import { providerManager } from "../../src/core/providers";
import { toolSchemas } from "../../src/core/tools";
import { registerToolHandler, unregisterToolHandler } from "../../src/core/tools/handlers/index";

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];
const registeredToolNames: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
  config.set("tool_approval_mode", "ask");
  globalThis.fetch = originalFetch;
  for (const toolName of registeredToolNames.splice(0)) {
    unregisterToolHandler(toolName);
    PARALLEL_SAFE_TOOLS.delete(toolName);
    delete toolSchemas[toolName];
  }
  for (const agentId of createdAgentIds.splice(0)) agentManager.delete(agentId);
  for (const providerId of createdProviderIds.splice(0)) providerManager.delete(providerId);
});

describe("OpenAI-compatible parallel tools", () => {
  test("runs independent calls concurrently and preserves result order", async () => {
    config.set("tool_approval_mode", "always_allow");
    const firstTool = `parallel_probe_a_${crypto.randomUUID().replaceAll("-", "")}`;
    const secondTool = `parallel_probe_b_${crypto.randomUUID().replaceAll("-", "")}`;
    const toolNames = [firstTool, secondTool];
    let active = 0;
    let maxActive = 0;
    let requestCount = 0;

    for (const toolName of toolNames) {
      toolSchemas[toolName] = {
        name: toolName,
        description: "Return a delayed read-only probe result.",
        category: "core",
        input_schema: { type: "object", properties: {} },
        permissions: [],
      };
      registeredToolNames.push(toolName);
      PARALLEL_SAFE_TOOLS.add(toolName);
      registerToolHandler(toolName, async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Bun.sleep(30);
        active -= 1;
        return { tool: toolName };
      });
    }

    globalThis.fetch = (async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return Response.json({
          id: "parallel-tool-response",
          object: "chat.completion",
          model: "MiniMax-M3",
          choices: [
            {
              index: 0,
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: "",
                tool_calls: toolNames.map((toolName, index) => ({
                  id: `parallel-call-${index}`,
                  type: "function",
                  function: { name: toolName, arguments: "{}" },
                })),
              },
            },
          ],
          usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
        });
      }
      return Response.json({
        id: "parallel-final-response",
        object: "chat.completion",
        model: "MiniMax-M3",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "Both probes completed." },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
      });
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "custom",
      name: "Parallel Compatible Provider",
      api_key: "parallel-compatible-key",
      base_url: "https://parallel-compatible.invalid/v1",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "Parallel Compatible Agent",
      type: "main",
      provider_id: provider.id,
      model: "MiniMax-M3",
      tools: toolNames,
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "Run both independent probes." }],
      { useTools: true, sessionId: "parallel-compatible-session" }
    );

    expect(result.content).toBe("Both probes completed.");
    expect(maxActive).toBe(2);
    expect(result.tool_calls?.map((toolCall) => toolCall.name)).toEqual(toolNames);
    expect(requestCount).toBe(2);
  });
});
