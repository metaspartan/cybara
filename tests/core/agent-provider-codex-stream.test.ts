import { afterEach, describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import {
  incompleteOpenAICodexStreamError,
  openAICodexStreamEventError,
} from "../../src/core/llm/codex-stream-errors";
import { providerManager } from "../../src/core/providers";

const originalFetch = globalThis.fetch;
const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const agentId of createdAgentIds.splice(0)) agentManager.delete(agentId);
  for (const providerId of createdProviderIds.splice(0)) providerManager.delete(providerId);
});

function eventStream(events: Array<Record<string, unknown>>): Response {
  const payload = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(payload, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function createCodexAgent(): string {
  const provider = providerManager.create({
    provider: "openai-codex",
    name: "Codex Stream Recovery Provider",
    access_token: "codex-stream-test-token",
  });
  createdProviderIds.push(provider.id);
  const agent = agentManager.create({
    name: "Codex Stream Recovery Agent",
    type: "main",
    provider_id: provider.id,
    model: "gpt-5.6-sol",
    tools: [],
  });
  createdAgentIds.push(agent.id);
  return agent.id;
}

describe("OpenAI Codex stream recovery", () => {
  test("extracts top-level and nested provider error details", () => {
    const topLevel = openAICodexStreamEventError(
      { type: "error", code: "server_error", message: "Try again" },
      "fallback",
      true
    );
    const nested = openAICodexStreamEventError(
      { type: "error", error: { code: "stream_error", message: "Connection closed" } },
      "fallback",
      true
    );
    const invalid = openAICodexStreamEventError(
      {
        type: "response.failed",
        response: { error: { code: "invalid_request_error", message: "Expected fc_ item id" } },
      },
      "fallback",
      false
    );

    expect(topLevel.message).toBe("Try again (server_error)");
    expect(topLevel.retryable).toBe(true);
    expect(nested.message).toBe("Connection closed (stream_error)");
    expect(nested.retryable).toBe(true);
    expect(invalid.message).toBe("Expected fc_ item id (invalid_request_error)");
    expect(invalid.retryable).toBe(false);
    expect(incompleteOpenAICodexStreamError().retryable).toBe(true);
  });

  test("retries transient error events and incomplete streams", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return eventStream([
          {
            type: "error",
            error: { code: "stream_error", message: "The provider stream was interrupted" },
          },
        ]);
      }
      if (calls === 2) return eventStream([]);
      return eventStream([
        { type: "response.output_text.delta", delta: "recovered" },
        { type: "response.completed", response: { status: "completed" } },
      ]);
    }) as typeof fetch;

    const result = await agentManager.execute(
      createCodexAgent(),
      [{ role: "user", content: "recover the stream" }],
      { useTools: false, sessionId: "codex-stream-recovery-session" }
    );

    expect(calls).toBe(3);
    expect(result.content).toBe("recovered");
  });

  test("retries response.incomplete without exposing partial output", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return eventStream([
          { type: "response.output_text.delta", delta: "partial" },
          {
            type: "response.incomplete",
            response: {
              status: "incomplete",
              incomplete_details: { reason: "max_output_tokens" },
            },
          },
        ]);
      }
      return eventStream([
        { type: "response.output_text.delta", delta: "complete" },
        { type: "response.completed", response: { status: "completed" } },
      ]);
    }) as typeof fetch;

    const result = await agentManager.execute(
      createCodexAgent(),
      [{ role: "user", content: "retry an incomplete response" }],
      { useTools: false, sessionId: "codex-stream-incomplete-event-session" }
    );

    expect(calls).toBe(2);
    expect(result.content).toBe("complete");
  });

  test("does not retry invalid response failures", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return eventStream([
        {
          type: "response.failed",
          response: {
            error: { code: "invalid_request_error", message: "Expected fc_ item id" },
          },
        },
      ]);
    }) as typeof fetch;

    const result = await agentManager.execute(
      createCodexAgent(),
      [{ role: "user", content: "reject invalid input" }],
      { useTools: false, sessionId: "codex-stream-invalid-session" }
    );

    expect(result.content).toContain("Expected fc_ item id");
    expect(calls).toBe(1);
  });
});
