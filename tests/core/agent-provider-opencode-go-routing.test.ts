import { describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";
import { createProviderRoutingFixture } from "./provider-routing.fixture";

const { createdAgentIds, createdProviderIds } = createProviderRoutingFixture();

const calcTool = {
  name: "calc",
  description: "Evaluate arithmetic",
  input_schema: {
    type: "object",
    properties: { expression: { type: "string" } },
    required: ["expression"],
  },
};

describe("OpenCode Go provider routing", () => {
  test("keeps forced tool requests compatible with Console Go models", async () => {
    let requestUrl = "";
    let requestBody: Record<string, unknown> = {};
    let requestHeaders = new Headers();

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestHeaders = new Headers(init?.headers);
      requestBody = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      return Response.json({
        id: "go-deepseek-response",
        object: "chat.completion",
        model: "deepseek-v4-pro",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "Ready." },
          },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
      });
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "opencode-go",
      name: "OpenCode Go OpenAI Test",
      api_key: "go-test-key",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "OpenCode Go DeepSeek Test",
      type: "main",
      provider_id: provider.id,
      model: "deepseek-v4-pro",
      tools: [calcTool],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "Calculate something" }],
      {
        useTools: true,
        requireToolUse: true,
        requiredToolName: "calc",
        sessionId: `opencode-go-openai-${crypto.randomUUID()}`,
      }
    );

    expect(result.content).toBe("Ready.");
    expect(requestUrl).toBe("https://opencode.ai/zen/go/v1/chat/completions");
    expect(requestHeaders.get("Authorization")).toBe("Bearer go-test-key");
    expect(requestBody.tool_choice).toBe("auto");
  });

  test("routes Anthropic-dialect models through messages with API-key auth", async () => {
    let requestUrl = "";
    let requestBody: Record<string, unknown> = {};
    let requestHeaders = new Headers();

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestHeaders = new Headers(init?.headers);
      requestBody = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      return Response.json({
        id: "go-minimax-response",
        type: "message",
        role: "assistant",
        model: "minimax-m3",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "MiniMax ready." }],
        usage: { input_tokens: 9, output_tokens: 3 },
      });
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "opencode-go",
      name: "OpenCode Go Anthropic Test",
      api_key: "go-test-key",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "OpenCode Go MiniMax Test",
      type: "main",
      provider_id: provider.id,
      model: "minimax-m3",
      tools: [calcTool],
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "Calculate something" }],
      {
        useTools: true,
        requireToolUse: true,
        requiredToolName: "calc",
        sessionId: `opencode-go-anthropic-${crypto.randomUUID()}`,
      }
    );

    expect(result.content).toBe("MiniMax ready.");
    expect(requestUrl).toBe("https://opencode.ai/zen/go/v1/messages");
    expect(requestHeaders.get("x-api-key")).toBe("go-test-key");
    expect(requestHeaders.get("Authorization")).toBeNull();
    expect(requestBody.tool_choice).toEqual({ type: "auto" });
  });
});
