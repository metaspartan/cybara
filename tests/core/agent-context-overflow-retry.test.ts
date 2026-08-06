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

const WINDOW = 262144;

function providerTokenCount(text: string): number {
  return Math.ceil(text.length / 3.5);
}

function deepSeekOverflowError(messagesTokens: number, completionTokens: number): Response {
  return new Response(
    JSON.stringify({
      error: {
        message: `This model's maximum context length is ${WINDOW} tokens. However, you requested ${
          messagesTokens + completionTokens
        } tokens (${messagesTokens} in the messages, ${completionTokens} in the completion). Please reduce the length of the messages or completion.`,
        type: "invalid_request_error",
        param: null,
        code: "invalid_request_error",
      },
    }),
    { status: 400, headers: { "Content-Type": "application/json" } }
  );
}

describe("agent context overflow retry", () => {
  test("recovers a near-full-window request by clamping to the provider's own token counts", async () => {
    const provider = providerManager.create({
      provider: "deepseek",
      name: "DeepSeek Overflow Provider",
      api_key: "sk-test-overflow",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "DeepSeek Overflow Agent",
      type: "main",
      provider_id: provider.id,
      model: "deepseek-v4-flash",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);

    const hugePrompt = `Analyze this log dump:\n${"x".repeat(880000)}`;

    const requestBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      requestBodies.push(body as Record<string, unknown>);
      const messages = (body.messages ?? []) as Array<{ content?: unknown }>;
      const messagesTokens = providerTokenCount(JSON.stringify(messages));
      const completionTokens =
        typeof body.max_tokens === "number"
          ? body.max_tokens
          : typeof body.max_completion_tokens === "number"
            ? body.max_completion_tokens
            : 4096;
      if (messagesTokens + completionTokens > WINDOW) {
        return deepSeekOverflowError(messagesTokens, completionTokens);
      }
      return new Response(
        JSON.stringify({
          id: "resp-overflow-recovered",
          object: "chat.completion",
          model: "deepseek-v4-flash",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: "recovered-after-clamp" },
            },
          ],
          usage: {
            prompt_tokens: messagesTokens,
            completion_tokens: 5,
            total_tokens: messagesTokens + 5,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const result = await agentManager.execute(agent.id, [{ role: "user", content: hugePrompt }], {
      sessionId: "overflow-clamp-session",
      contextWindowTokens: WINDOW,
      maxOutputTokens: 131072,
    });

    expect(result.content).toBe("recovered-after-clamp");
    const lastBody = requestBodies.at(-1) as Record<string, unknown>;
    const lastMessages = (lastBody.messages ?? []) as Array<{ content?: unknown }>;
    const lastMessagesTokens = providerTokenCount(JSON.stringify(lastMessages));
    const lastLimit =
      typeof lastBody.max_tokens === "number"
        ? lastBody.max_tokens
        : (lastBody.max_completion_tokens as number);
    expect(lastMessagesTokens + lastLimit).toBeLessThanOrEqual(WINDOW);
  });

  test("clamps the retry limit exactly from provider-reported message tokens", async () => {
    const provider = providerManager.create({
      provider: "deepseek",
      name: "DeepSeek Exact Clamp Provider",
      api_key: "sk-test-exact-clamp",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "DeepSeek Exact Clamp Agent",
      type: "main",
      provider_id: provider.id,
      model: "deepseek-v4-flash",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);

    const reportedMessagesTokens = 881350;
    const requestBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      requestBodies.push(body as Record<string, unknown>);
      if (requestBodies.length === 1) {
        const completionTokens = typeof body.max_tokens === "number" ? body.max_tokens : 167640;
        return new Response(
          JSON.stringify({
            error: {
              message: `This model's maximum context length is 1048576 tokens. However, you requested ${
                reportedMessagesTokens + completionTokens
              } tokens (${reportedMessagesTokens} in the messages, ${completionTokens} in the completion). Please reduce the length of the messages or completion.`,
              type: "invalid_request_error",
              param: null,
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          id: "resp-exact-clamp",
          object: "chat.completion",
          model: "deepseek-v4-flash",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: "exact-clamp-ok" },
            },
          ],
          usage: { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const result = await agentManager.execute(
      agent.id,
      [{ role: "user", content: "continue the long build" }],
      {
        sessionId: "overflow-exact-clamp-session",
        contextWindowTokens: 1048576,
        maxOutputTokens: 384000,
      }
    );

    expect(result.content).toBe("exact-clamp-ok");
    expect(requestBodies.length).toBe(2);
    const retryLimit = requestBodies[1].max_tokens as number;
    expect(reportedMessagesTokens + retryLimit).toBeLessThanOrEqual(1048576);
    expect(retryLimit).toBeGreaterThan(100000);
  });
});
