import { describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";
import { createProviderRoutingFixture } from "./provider-routing.fixture";

const { createdAgentIds, createdProviderIds } = createProviderRoutingFixture();

function createMiniMaxAgent(name: string): string {
  const provider = providerManager.create({
    provider: "minimax",
    name: `${name} Provider`,
    api_key: "minimax-input-key",
  });
  createdProviderIds.push(provider.id);
  const agent = agentManager.create({
    name: `${name} Agent`,
    type: "main",
    provider_id: provider.id,
    model: "MiniMax-M3",
    tools: [],
  });
  createdAgentIds.push(agent.id);
  return agent.id;
}

describe("MiniMax provider input recovery", () => {
  test("recovers an initial 2013 context rejection", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      requestBodies.push(requestBody);
      if (requestBodies.length === 1) {
        return Response.json(
          { error: { type: "invalid_request_error", message: "invalid params, 400 (2013)" } },
          { status: 400 }
        );
      }
      return Response.json({
        id: "minimax-context-recovered",
        type: "message",
        role: "assistant",
        model: "MiniMax-M3",
        content: [{ type: "text", text: "minimax-context-recovered" }],
        usage: { input_tokens: 10, output_tokens: 2 },
      });
    }) as typeof fetch;

    const agentId = createMiniMaxAgent("MiniMax Initial Context Recovery");
    const messages = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `message-${index}`,
    }));
    const result = await agentManager.execute(agentId, messages, {
      useTools: false,
      sessionId: "minimax-initial-context-recovery-session",
    });

    expect(result.content).toBe("minimax-context-recovered");
    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[1]?.max_tokens as number).toBeLessThan(
      requestBodies[0]?.max_tokens as number
    );
    expect((requestBodies[1]?.messages as unknown[]).length).toBeLessThan(
      (requestBodies[0]?.messages as unknown[]).length
    );
  });

  test("removes corrupt image bytes before sending a request", async () => {
    let requestBody: Record<string, unknown> = {};
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      return Response.json({
        id: "minimax-corrupt-image-filtered",
        type: "message",
        role: "assistant",
        model: "MiniMax-M3",
        content: [{ type: "text", text: "minimax-image-filtered" }],
        usage: { input_tokens: 10, output_tokens: 2 },
      });
    }) as typeof fetch;

    const agentId = createMiniMaxAgent("MiniMax Corrupt Image");
    const result = await agentManager.execute(
      agentId,
      [
        {
          role: "user",
          content: "Describe the attached image.",
          images: [{ data: "bm90LWFuLWltYWdl", mimeType: "image/png" }],
        },
      ],
      {
        useTools: false,
        sessionId: "minimax-corrupt-image-session",
      }
    );

    const serializedRequest = JSON.stringify(requestBody);
    expect(result.content).toBe("minimax-image-filtered");
    expect(serializedRequest).not.toContain("bm90LWFuLWltYWdl");
    expect(serializedRequest).toContain("could not be decoded");
  });
});
