import { afterEach, describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";
import { deleteSession, handleChat, getSessionMessages } from "../../src/api/chat";

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];
const createdSessionIds: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(async () => {
  globalThis.fetch = originalFetch;
  for (const sessionId of createdSessionIds.splice(0)) await deleteSession(sessionId);
  for (const agentId of createdAgentIds.splice(0)) agentManager.delete(agentId);
  for (const providerId of createdProviderIds.splice(0)) providerManager.delete(providerId);
});

describe("handleChat per-session serialization", () => {
  test("two concurrent messages to one session do not interleave", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Serialization Provider",
      api_key: "sk-serialize",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Serialization Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-serialize",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);

    // Slow, staggered LLM responses so an unserialized implementation would
    // interleave the two turns' pushes.
    let call = 0;
    globalThis.fetch = (async () => {
      const n = ++call;
      await new Promise((r) => setTimeout(r, n === 1 ? 40 : 5));
      return new Response(
        JSON.stringify({
          id: `resp-${n}`,
          object: "chat.completion",
          model: "gpt-serialize",
          choices: [
            { index: 0, finish_reason: "stop", message: { role: "assistant", content: `reply-${n}` } },
          ],
          usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const sessionId = `serialize-${Date.now()}`;
    createdSessionIds.push(sessionId);

    // Fire both turns concurrently at the same session.
    await Promise.all([
      handleChat({ message: "first", agentId: agent.id, sessionId, tools: false }),
      handleChat({ message: "second", agentId: agent.id, sessionId, tools: false }),
    ]);

    const messages = await getSessionMessages(sessionId);
    const roles = messages.map((m) => m.role);

    // Every user message must be immediately followed by an assistant message —
    // i.e. turns are atomic, not [user, user, assistant, assistant].
    const userIdxs = roles.flatMap((r, i) => (r === "user" ? [i] : []));
    expect(userIdxs.length).toBe(2);
    for (const idx of userIdxs) {
      expect(roles[idx + 1]).toBe("assistant");
    }
  });
});
