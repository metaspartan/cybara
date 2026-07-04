import { afterEach, describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";
import {
  deleteSession,
  handleChat,
  getSessionMessages,
  listPendingChatMessages,
  reorderPendingChatMessages,
  steerPendingChatMessage,
} from "../../src/api/chat";
import { broadcastStatus, onStatusStream } from "../../src/core/status";

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];
const createdSessionIds: string[] = [];
const originalFetch = globalThis.fetch;

async function waitForVisibleSessionMessages(sessionId: string, expectedCount: number) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const messages = (await getSessionMessages(sessionId)).filter(
      (message) => message.role !== "system"
    );
    if (messages.length >= expectedCount) return messages;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return (await getSessionMessages(sessionId)).filter((message) => message.role !== "system");
}

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
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: `reply-${n}` },
            },
          ],
          usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const sessionId = `serialize-${Date.now()}`;
    createdSessionIds.push(sessionId);
    const statusDetails: string[] = [];
    const unsubscribe = onStatusStream((event) => {
      if (event.type === "status" && typeof event.detail === "string") {
        statusDetails.push(event.detail);
      }
    });

    const [firstResponse, secondResponse] = await Promise.all([
      handleChat({ message: "first", agentId: agent.id, sessionId, tools: false }),
      handleChat({ message: "second", agentId: agent.id, sessionId, tools: false }),
    ]).finally(() => unsubscribe());

    expect(firstResponse.queued).toBeUndefined();
    expect(secondResponse.queued).toBe(true);
    expect(secondResponse.pendingMessages?.map((message) => message.content)).toEqual(["second"]);
    expect(statusDetails).not.toContain("Queued follow-up");

    const messages = await waitForVisibleSessionMessages(sessionId, 4);
    const roles = messages.map((m) => m.role);

    const userIdxs = roles.flatMap((r, i) => (r === "user" ? [i] : []));
    expect(userIdxs.length).toBe(2);
    for (const idx of userIdxs) {
      expect(roles[idx + 1]).toBe("assistant");
    }
    expect(messages[0]?.content).toBe("first");
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[2]?.content).toBe("second");
    expect(messages[3]?.role).toBe("assistant");
    expect(listPendingChatMessages(sessionId)).toEqual([]);
  });

  test("queued follow-up can be promoted to steering", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Steering Provider",
      api_key: "sk-steering",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Steering Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-steering",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);

    let call = 0;
    globalThis.fetch = (async () => {
      const n = ++call;
      await new Promise((resolve) => setTimeout(resolve, n === 1 ? 40 : 5));
      return new Response(
        JSON.stringify({
          id: `steer-resp-${n}`,
          object: "chat.completion",
          model: "gpt-steering",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: `steer-reply-${n}` },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const sessionId = `steering-${Date.now()}`;
    createdSessionIds.push(sessionId);

    const firstTurn = handleChat({ message: "start", agentId: agent.id, sessionId, tools: false });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const queued = await handleChat({
      message: "adjust course",
      agentId: agent.id,
      sessionId,
      tools: false,
      queueMode: "queue",
    });

    expect(queued.queued).toBe(true);
    const pendingId = queued.pendingMessage?.id;
    expect(typeof pendingId).toBe("string");

    const steered = await steerPendingChatMessage(sessionId, pendingId!);
    expect(steered.success).toBe(true);
    expect(steered.pendingMessages).toEqual([]);
    expect(listPendingChatMessages(sessionId)).toEqual([]);

    const materializedMessages = await waitForVisibleSessionMessages(sessionId, 2);
    expect(materializedMessages[1]?.content).toBe("adjust course");

    await firstTurn;
    const messages = await waitForVisibleSessionMessages(sessionId, 4);
    expect(messages[0]?.content).toBe("start");
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[2]?.content).toBe("adjust course");
    expect(messages[3]?.role).toBe("assistant");
  });

  test("queue mode honors active session status even if no mutex is held", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Status Queue Provider",
      api_key: "sk-status-queue",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Status Queue Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-status-queue",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);

    let call = 0;
    globalThis.fetch = (async () => {
      const n = ++call;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return new Response(
        JSON.stringify({
          id: `status-queue-resp-${n}`,
          object: "chat.completion",
          model: "gpt-status-queue",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: `status-reply-${n}` },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const sessionId = `status-queue-${Date.now()}`;
    createdSessionIds.push(sessionId);

    await handleChat({ message: "first", agentId: agent.id, sessionId, tools: false });
    broadcastStatus({
      status: "thinking",
      timestamp: Date.now(),
      sessionId,
      agentId: agent.id,
      detail: "still working",
    });

    const queued = await handleChat({
      message: "second",
      agentId: agent.id,
      sessionId,
      tools: false,
      queueMode: "queue",
    });

    expect(queued.queued).toBe(true);
    expect(queued.pendingMessages?.map((message) => message.content)).toEqual(["second"]);
    broadcastStatus({
      status: "thinking",
      timestamp: Date.now(),
      sessionId,
      agentId: agent.id,
      detail: "still working",
    });
    expect(listPendingChatMessages(sessionId).map((message) => message.content)).toEqual([
      "second",
    ]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(listPendingChatMessages(sessionId).map((message) => message.content)).toEqual([
      "second",
    ]);
    let messages = (await getSessionMessages(sessionId)).filter(
      (message) => message.role !== "system"
    );
    expect(messages.map((message) => message.content)).not.toContain("second");

    broadcastStatus({
      status: "idle",
      timestamp: Date.now(),
      sessionId,
      agentId: agent.id,
      detail: "idle",
    });

    messages = await waitForVisibleSessionMessages(sessionId, 4);
    expect(messages[0]?.content).toBe("first");
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[2]?.content).toBe("second");
    expect(messages[3]?.role).toBe("assistant");
  });

  test("pending follow-ups can be reordered before they drain", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Reorder Queue Provider",
      api_key: "sk-reorder-queue",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Reorder Queue Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-reorder-queue",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);

    let call = 0;
    globalThis.fetch = (async () => {
      const n = ++call;
      await new Promise((resolve) => setTimeout(resolve, n === 1 ? 60 : 5));
      return new Response(
        JSON.stringify({
          id: `reorder-queue-resp-${n}`,
          object: "chat.completion",
          model: "gpt-reorder-queue",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: `reorder-reply-${n}` },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const sessionId = `reorder-queue-${Date.now()}`;
    createdSessionIds.push(sessionId);

    const firstTurn = handleChat({
      message: "first",
      agentId: agent.id,
      sessionId,
      tools: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await handleChat({
      message: "second",
      agentId: agent.id,
      sessionId,
      tools: false,
      queueMode: "queue",
    });
    const third = await handleChat({
      message: "third",
      agentId: agent.id,
      sessionId,
      tools: false,
      queueMode: "queue",
    });

    const secondId = second.pendingMessage?.id;
    const thirdId = third.pendingMessage?.id;
    expect(typeof secondId).toBe("string");
    expect(typeof thirdId).toBe("string");

    const reordered = reorderPendingChatMessages(sessionId, [thirdId!, secondId!]);
    expect(reordered.success).toBe(true);
    expect(reordered.pendingMessages.map((message) => message.content)).toEqual([
      "third",
      "second",
    ]);

    await firstTurn;
    const messages = await waitForVisibleSessionMessages(sessionId, 6);
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect([messages[0]?.content, messages[2]?.content, messages[4]?.content]).toEqual([
      "first",
      "third",
      "second",
    ]);
    expect(listPendingChatMessages(sessionId)).toEqual([]);
  });
});
