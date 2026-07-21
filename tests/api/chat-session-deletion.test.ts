import { afterEach, describe, expect, test } from "bun:test";
import { deleteSession, handleChat, waitForPendingChatCompletion } from "../../src/api/chat";
import {
  activeChatTurnAbortControllers,
  pendingChatCompletions,
} from "../../src/api/chat-runtime-state";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";
import { loadPersistedSession } from "../../src/core/session-context";

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

describe("chat session deletion", () => {
  test("aborts the active turn and rejects queued waiters", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Delete Active Turn Provider",
      api_key: "sk-delete-active-turn",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "Delete Active Turn Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-delete-active-turn",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);
    const sessionId = `delete-active-turn-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    let markProviderStarted: (() => void) | undefined;
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve;
    });
    globalThis.fetch = ((_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        markProviderStarted?.();
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("deleted", "AbortError")),
          { once: true }
        );
      })) as typeof fetch;

    const activeTurn = handleChat({
      message: "Run until deleted",
      agentId: agent.id,
      sessionId,
      tools: false,
    });
    await providerStarted;
    const queued = await handleChat({
      message: "This follow-up should be cancelled",
      agentId: agent.id,
      sessionId,
      tools: false,
      queueMode: "queue",
      awaitQueuedCompletion: true,
    });
    const pendingId = queued.pendingMessage?.id || "";
    const queuedCompletion = waitForPendingChatCompletion(pendingId);
    void queuedCompletion.catch(() => undefined);
    const deleted = await deleteSession(sessionId);
    const interrupted = await activeTurn;

    expect(deleted).toBe(true);
    expect(interrupted.interrupted).toBe(true);
    await expect(queuedCompletion).rejects.toThrow("Chat session deleted");
    expect(activeChatTurnAbortControllers.has(sessionId)).toBe(false);
    expect(pendingChatCompletions.has(pendingId)).toBe(false);
    expect(await loadPersistedSession(sessionId)).toBeNull();
  });
});
