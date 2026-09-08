import { describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";
import { createProviderRoutingFixture } from "./provider-routing.fixture";

const { createdAgentIds, createdProviderIds } = createProviderRoutingFixture();

const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function hasImageBlocks(body: Record<string, unknown>): boolean {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  return messages.some((message) => {
    const content = (message as { content?: unknown }).content;
    return (
      Array.isArray(content) &&
      content.some((part) => (part as { type?: string }).type === "image_url")
    );
  });
}

describe("text-only model image fallback", () => {
  test("retries without image blocks when the provider says the model only accepts text", async () => {
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      bodies.push(body);
      if (hasImageBlocks(body)) {
        return new Response(
          JSON.stringify({
            error: {
              type: "invalid_request_error",
              message:
                "Error from provider (Console Go): Upstream request failed: [400] Model only supports text input; received unsupported content type 'image_url'.",
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      return Response.json({
        id: "text-only-response",
        object: "chat.completion",
        model: "deepseek-v4-flash",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "I cannot see that image." },
          },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
      });
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "opencode-go",
      name: "OpenCode Go Text-Only Test",
      api_key: "go-test-key",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "OpenCode Go Text-Only Agent",
      type: "main",
      provider_id: provider.id,
      model: "deepseek-v4-flash",
      config: { image_input: "enabled" },
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [
        {
          role: "user",
          content: "What is in this picture?",
          images: [{ data: TINY_PNG, mimeType: "image/png" }],
        },
      ],
      { sessionId: `text-only-${crypto.randomUUID()}` }
    );

    expect(result.content).toBe("I cannot see that image.");
    expect(bodies).toHaveLength(2);
    expect(hasImageBlocks(bodies[0] as Record<string, unknown>)).toBe(true);
    expect(hasImageBlocks(bodies[1] as Record<string, unknown>)).toBe(false);
    expect(JSON.stringify(bodies[1])).toContain(
      "Image omitted: this model only accepts text input"
    );
  });

  test("strips images first when a 400 carries no message, which is how some upstreams reject them", async () => {
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      bodies.push(body);
      if (hasImageBlocks(body)) {
        return new Response(JSON.stringify({ object: "error", model: "deepseek-v4-flash" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      return Response.json({
        id: "blank-400-response",
        object: "chat.completion",
        model: "deepseek-v4-flash",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "Text only." },
          },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
      });
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "opencode-go",
      name: "OpenCode Go Blank 400 Test",
      api_key: "go-test-key",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "OpenCode Go Blank 400 Agent",
      type: "main",
      provider_id: provider.id,
      model: "deepseek-v4-flash",
      config: { image_input: "enabled" },
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [
        {
          role: "user",
          content: "What is in this picture?",
          images: [{ data: TINY_PNG, mimeType: "image/png" }],
        },
      ],
      { sessionId: `blank-400-${crypto.randomUUID()}` }
    );

    expect(result.content).toBe("Text only.");
    expect(bodies).toHaveLength(2);
    expect(hasImageBlocks(bodies[1] as Record<string, unknown>)).toBe(false);
  });

  test("does not strip images for unrelated 400 errors", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: "bad request" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "opencode-go",
      name: "OpenCode Go Unrelated 400 Test",
      api_key: "go-test-key",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "OpenCode Go Unrelated 400 Agent",
      type: "main",
      provider_id: provider.id,
      model: "deepseek-v4-flash",
      config: { image_input: "enabled" },
    });
    createdAgentIds.push(agent.id);

    const result = await agentManager.execute(
      agent.id,
      [
        {
          role: "user",
          content: "What is in this picture?",
          images: [{ data: TINY_PNG, mimeType: "image/png" }],
        },
      ],
      { sessionId: `unrelated-400-${crypto.randomUUID()}` }
    );
    expect(result.content).toContain("400");
    expect(calls).toBe(1);
  });
});
