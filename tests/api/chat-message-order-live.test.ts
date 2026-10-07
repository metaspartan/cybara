import { afterEach, expect, test } from "bun:test";
import { deleteSession, handleChat } from "../../src/api/chat";
import { settlePendingChatFailure } from "../../src/api/chat-pending-failure";
import { materializePendingMessage } from "../../src/api/chat-pending-state";
import {
  getResidentChatSession,
  pendingChatQueues,
  persistChatSessionSnapshot,
  type PendingChatItem,
} from "../../src/api/chat-runtime-state";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";
import {
  loadPersistedSession,
  upsertPersistedSessionMessage,
} from "../../src/core/session-context";

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

test("a queued message that fails after later turns keeps its place on reload", async () => {
  const provider = providerManager.create({
    provider: "openai",
    name: "Ordering fixture provider",
    api_key: "fixture",
    base_url: "https://api.openai.com/v1",
  });
  providers.push(provider.id);
  const agent = agentManager.create({
    name: "Ordering fixture agent",
    model: "model-a",
    provider_id: provider.id,
    memory_enabled: false,
  });
  agents.push(agent.id);
  const sessionId = `order-live-${crypto.randomUUID()}`;
  sessions.push(sessionId);

  let turn = 0;
  agentManager.execute = (async () => {
    turn += 1;
    return { content: `reply ${turn}`, tool_calls: [] };
  }) as typeof agentManager.execute;

  await handleChat({ agentId: agent.id, sessionId, message: "first question", tools: true });

  const session = getResidentChatSession(sessionId);
  if (!session) throw new Error("Resident chat session was not created");

  const queuedItem: PendingChatItem = {
    id: `queued-${crypto.randomUUID()}`,
    sessionId,
    request: { message: "second question" },
    content: "second question",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    mode: "queued",
    sequence: 1,
    materialized: true,
  };
  pendingChatQueues.set(sessionId, [queuedItem]);
  const materialized = materializePendingMessage(session, queuedItem);
  await upsertPersistedSessionMessage(session.id, session.agentId, materialized, {
    stableKey: queuedItem.id,
  });
  await persistChatSessionSnapshot(session, materialized);

  await handleChat({ agentId: agent.id, sessionId, message: "third question", tools: true });

  await settlePendingChatFailure(session, queuedItem, new Error("upstream refused"));

  const resident = getResidentChatSession(sessionId);
  if (!resident) throw new Error("Resident chat session disappeared");
  const liveOrder = resident.messages.map((message) => message.content);

  expect(liveOrder.indexOf("second question")).toBeLessThan(
    liveOrder.findIndex((content) => content.includes("refused"))
  );

  const reloaded = await loadPersistedSession(sessionId);
  const reloadedOrder = (reloaded?.messages ?? []).map((message) => message.content);

  expect(reloadedOrder).toEqual(liveOrder);
}, 30_000);
