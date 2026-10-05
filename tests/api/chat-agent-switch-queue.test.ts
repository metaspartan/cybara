import { afterEach, expect, test } from "bun:test";
import {
  deleteSession,
  getSessionMessages,
  handleChat,
  updateSessionAgent,
} from "../../src/api/chat";
import { pendingChatQueues } from "../../src/api/chat-runtime-state";
import { loadPersistedPendingChatItems } from "../../src/api/chat-pending-store";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";

const execute = agentManager.execute.bind(agentManager);
const agents: string[] = [],
  providers: string[] = [],
  sessions: string[] = [];
afterEach(async () => {
  agentManager.execute = execute;
  for (const id of sessions.splice(0)) await deleteSession(id);
  for (const id of agents.splice(0)) agentManager.delete(id);
  for (const id of providers.splice(0)) providerManager.delete(id);
});

for (const router of [false, true])
  test(`turn-boundary selection retargets inherited queued requests with router=${router}`, async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Queued routing fixture",
      api_key: "fixture",
      base_url: "https://api.openai.com/v1",
    });
    providers.push(provider.id);
    const first = agentManager.create({
      name: "First queued fixture",
      model: "route-a",
      provider_id: provider.id,
      memory_enabled: false,
    });
    const second = agentManager.create({
      name: "Second queued fixture",
      model: "route-b",
      provider_id: provider.id,
      memory_enabled: false,
    });
    agents.push(first.id, second.id);
    const session = `switch-queue-${crypto.randomUUID()}`;
    sessions.push(session);
    const gate = Promise.withResolvers<void>(),
      started = Promise.withResolvers<void>();
    const seen: string[] = [];
    let signal: AbortSignal | undefined;
    agentManager.execute = (async (id, _messages, options) => {
      seen.push(id);
      if (seen.length === 1) {
        signal = options?.abortSignal;
        started.resolve();
        await gate.promise;
      }
      return { content: "A valid direct reply", tool_calls: [] };
    }) as typeof agentManager.execute;
    const active = handleChat({
      agentId: first.id,
      sessionId: session,
      message: "Discuss the question",
      tools: true,
    });
    await started.promise;
    const selected = updateSessionAgent(session, second.id, router);
    const queued = await handleChat({
      agentId: first.id,
      sessionId: session,
      message: "Explain the next question",
      tools: true,
      queueMode: "queue",
    });
    if (!queued.pendingMessage) throw Error("Missing queued request");
    try {
      expect(signal?.aborted).toBe(false);
      gate.resolve();
      await active;
      const changed = await selected;
      expect(changed.useModelRouter).toBe(router);
      const pending = pendingChatQueues.get(session)?.[0];
      if (pending) {
        expect(pending.request.agentId).toBe(router ? undefined : second.id);
        expect(pending.request.useModelRouter).toBe(router);
        expect(loadPersistedPendingChatItems(session)[0]?.request.agentId).toBe(
          router ? undefined : second.id
        );
      }
      for (let attempt = 0; attempt < 200 && seen.length < 2; attempt += 1) await Bun.sleep(5);
      if (!router) expect(seen).toEqual([first.id, second.id]);
      expect(signal?.aborted).toBe(false);
      const messages = await getSessionMessages(session);
      expect(
        messages.filter((message) => message.content === "Explain the next question")
      ).toHaveLength(1);
    } finally {
      gate.resolve();
      await active;
      await selected;
    }
  }, 10000);
