import { afterEach, describe, expect, test } from "bun:test";
import { deleteSession, handleChat, updateSessionAgent } from "../../src/api/chat";
import { getResidentChatSession, pendingChatQueues } from "../../src/api/chat-runtime-state";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";

const execute = agentManager.execute.bind(agentManager);
const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];
const createdSessionIds: string[] = [];

afterEach(async () => {
  agentManager.execute = execute;
  for (const sessionId of createdSessionIds.splice(0)) await deleteSession(sessionId);
  for (const agentId of createdAgentIds.splice(0)) agentManager.delete(agentId);
  for (const providerId of createdProviderIds.splice(0)) providerManager.delete(providerId);
});

async function createFixtureAgents() {
  const provider = providerManager.create({
    provider: "openai",
    name: "Instant switch fixture",
    api_key: "sk-instant-switch",
    base_url: "https://api.openai.com/v1",
  });
  createdProviderIds.push(provider.id);
  const first = agentManager.create({
    name: "Instant switch agent A",
    type: "main",
    provider_id: provider.id,
    model: "gpt-instant-switch-a",
    memory_enabled: false,
  });
  const second = agentManager.create({
    name: "Instant switch agent B",
    type: "main",
    provider_id: provider.id,
    model: "gpt-instant-switch-b",
    memory_enabled: false,
  });
  const third = agentManager.create({
    name: "Instant switch agent C",
    type: "main",
    provider_id: provider.id,
    model: "gpt-instant-switch-c",
    memory_enabled: false,
  });
  createdAgentIds.push(first.id, second.id, third.id);
  return { first, second, third };
}

describe("instant session agent switching", () => {
  test("switch resolves while a turn is active and the new agent runs on the next message", async () => {
    const { first, second } = await createFixtureAgents();
    const sessionId = `instant-switch-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);

    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const seen: string[] = [];
    agentManager.execute = (async (agentId) => {
      seen.push(agentId);
      if (seen.length === 1) {
        started.resolve();
        await gate.promise;
      }
      return { content: "reply from the active agent", tool_calls: [] };
    }) as typeof agentManager.execute;

    let activeResponse: Promise<Awaited<ReturnType<typeof handleChat>>> | undefined;
    try {
      activeResponse = handleChat({
        message: "run with the first agent",
        agentId: first.id,
        sessionId,
        tools: false,
      });
      await started.promise;

      const updated = await updateSessionAgent(sessionId, second.id);
      expect(updated.appliesNextTurn).toBe(true);
      expect(updated.agentId).toBe(second.id);
      expect(getResidentChatSession(sessionId)?.agentId).toBe(first.id);
      expect(getResidentChatSession(sessionId)?.pendingAgentId).toBe(second.id);

      gate.resolve();
      const response = await activeResponse;
      expect(response.agent?.id).toBe(first.id);
      expect(response.session_agent_id).toBe(second.id);

      const nextResponse = await handleChat({
        message: "now run with the selected agent",
        sessionId,
        tools: false,
      });
      expect(nextResponse.agent?.id).toBe(second.id);
      expect(seen).toEqual([first.id, second.id]);
      expect(getResidentChatSession(sessionId)?.agentId).toBe(second.id);
      expect(getResidentChatSession(sessionId)?.pendingAgentId).toBeUndefined();
      expect(getResidentChatSession(sessionId)?.pendingUseModelRouter).toBeUndefined();
    } finally {
      gate.resolve();
      await activeResponse;
    }
  }, 10000);

  test("idle sessions apply the switch immediately without deferral", async () => {
    const { first, second } = await createFixtureAgents();
    const sessionId = `instant-switch-idle-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);

    agentManager.execute = (async () => ({
      content: "reply from the active agent",
      tool_calls: [],
    })) as typeof agentManager.execute;

    await handleChat({
      message: "prime the session",
      agentId: first.id,
      sessionId,
      tools: false,
    });

    const updated = await updateSessionAgent(sessionId, second.id);
    expect(updated.appliesNextTurn).toBeFalsy();
    expect(getResidentChatSession(sessionId)?.agentId).toBe(second.id);
    expect(getResidentChatSession(sessionId)?.pendingAgentId).toBeUndefined();
  }, 10000);

  test("a model-router selection during an active turn applies on the next message", async () => {
    const { first, second } = await createFixtureAgents();
    const sessionId = `instant-switch-router-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);

    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const seen: string[] = [];
    agentManager.execute = (async (agentId) => {
      seen.push(agentId);
      if (seen.length === 1) {
        started.resolve();
        await gate.promise;
      }
      return { content: "router fixture reply", tool_calls: [] };
    }) as typeof agentManager.execute;

    let activeResponse: Promise<Awaited<ReturnType<typeof handleChat>>> | undefined;
    try {
      activeResponse = handleChat({
        message: "run with the router fixture",
        agentId: first.id,
        sessionId,
        tools: false,
      });
      await started.promise;

      const updated = await updateSessionAgent(sessionId, undefined, true);
      expect(updated.appliesNextTurn).toBe(true);
      expect(updated.useModelRouter).toBe(true);
      expect(getResidentChatSession(sessionId)?.agentId).toBe(first.id);
      expect(getResidentChatSession(sessionId)?.pendingUseModelRouter).toBe(true);

      gate.resolve();
      await activeResponse;

      const nextResponse = await handleChat({
        message: "router turn after the boundary",
        sessionId,
        tools: false,
      });
      expect(nextResponse.agent?.id).toBe(first.id);
      expect(getResidentChatSession(sessionId)?.useModelRouter).toBe(true);
      expect(getResidentChatSession(sessionId)?.pendingUseModelRouter).toBeUndefined();
    } finally {
      gate.resolve();
      await activeResponse;
    }
  }, 10000);

  test("an idle switch supersedes an earlier pending selection", async () => {
    const { first, second, third } = await createFixtureAgents();
    const sessionId = `instant-switch-supersede-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);

    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const seen: string[] = [];
    agentManager.execute = (async (agentId) => {
      seen.push(agentId);
      if (seen.length === 1) {
        started.resolve();
        await gate.promise;
      }
      return { content: "reply from the active agent", tool_calls: [] };
    }) as typeof agentManager.execute;

    let activeResponse: Promise<Awaited<ReturnType<typeof handleChat>>> | undefined;
    try {
      activeResponse = handleChat({
        message: "run with the first agent",
        agentId: first.id,
        sessionId,
        tools: false,
      });
      await started.promise;

      await updateSessionAgent(sessionId, second.id);
      expect(getResidentChatSession(sessionId)?.pendingAgentId).toBe(second.id);

      gate.resolve();
      await activeResponse;

      const updated = await updateSessionAgent(sessionId, third.id);
      expect(updated.appliesNextTurn).toBeFalsy();
      expect(updated.agentId).toBe(third.id);
      expect(getResidentChatSession(sessionId)?.agentId).toBe(third.id);
      expect(getResidentChatSession(sessionId)?.pendingAgentId).toBeUndefined();

      const nextResponse = await handleChat({
        message: "run with the latest selection",
        sessionId,
        tools: false,
      });
      expect(nextResponse.agent?.id).toBe(third.id);
      expect(seen).toEqual([first.id, third.id]);
    } finally {
      gate.resolve();
      await activeResponse;
    }
  }, 10000);

  test("a queued follow-up inherits the pending selection", async () => {
    const { first, second } = await createFixtureAgents();
    const sessionId = `instant-switch-queued-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);

    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const seen: string[] = [];
    agentManager.execute = (async (agentId) => {
      seen.push(agentId);
      if (seen.length === 1) {
        started.resolve();
        await gate.promise;
      }
      return { content: "reply from the active agent", tool_calls: [] };
    }) as typeof agentManager.execute;

    let activeResponse: Promise<Awaited<ReturnType<typeof handleChat>>> | undefined;
    try {
      activeResponse = handleChat({
        message: "run with the first agent",
        agentId: first.id,
        sessionId,
        tools: false,
      });
      await started.promise;

      await updateSessionAgent(sessionId, second.id);
      const queued = await handleChat({
        message: "queued follow-up",
        sessionId,
        tools: false,
        queueMode: "queue",
      });
      expect(queued.queued).toBe(true);
      expect(pendingChatQueues.get(sessionId)?.[0]?.request.agentId).toBe(second.id);

      gate.resolve();
      await activeResponse;

      for (let attempt = 0; attempt < 200 && seen.length < 2; attempt += 1) await Bun.sleep(5);
      expect(seen).toEqual([first.id, second.id]);
      expect(getResidentChatSession(sessionId)?.agentId).toBe(second.id);
    } finally {
      gate.resolve();
      await activeResponse;
    }
  }, 15000);

  test("a later selection retargets a queued follow-up that already inherited one", async () => {
    const { first, second, third } = await createFixtureAgents();
    const sessionId = `instant-switch-queued-retarget-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);

    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const seen: string[] = [];
    agentManager.execute = (async (agentId) => {
      seen.push(agentId);
      if (seen.length === 1) {
        started.resolve();
        await gate.promise;
      }
      return { content: "reply from the active agent", tool_calls: [] };
    }) as typeof agentManager.execute;

    let activeResponse: Promise<Awaited<ReturnType<typeof handleChat>>> | undefined;
    try {
      activeResponse = handleChat({
        message: "run with the first agent",
        agentId: first.id,
        sessionId,
        tools: false,
      });
      await started.promise;

      await updateSessionAgent(sessionId, second.id);
      await handleChat({
        message: "queued follow-up",
        sessionId,
        tools: false,
        queueMode: "queue",
      });
      expect(pendingChatQueues.get(sessionId)?.[0]?.request.agentId).toBe(second.id);

      await updateSessionAgent(sessionId, third.id);
      expect(pendingChatQueues.get(sessionId)?.[0]?.request.agentId).toBe(third.id);

      gate.resolve();
      await activeResponse;

      for (let attempt = 0; attempt < 300 && seen.length < 2; attempt += 1) await Bun.sleep(5);
      expect(seen).toEqual([first.id, third.id]);
      expect(getResidentChatSession(sessionId)?.agentId).toBe(third.id);
    } finally {
      gate.resolve();
      await activeResponse;
    }
  }, 15000);

  test("a steering follow-up keeps the running turn on its agent and defers the selection", async () => {
    const { first, second } = await createFixtureAgents();
    const sessionId = `instant-switch-steered-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);

    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const seen: string[] = [];
    agentManager.execute = (async (agentId) => {
      seen.push(agentId);
      if (seen.length === 1) {
        started.resolve();
        await gate.promise;
      }
      return { content: "reply from the active agent", tool_calls: [] };
    }) as typeof agentManager.execute;

    let activeResponse: Promise<Awaited<ReturnType<typeof handleChat>>> | undefined;
    try {
      activeResponse = handleChat({
        message: "run with the first agent",
        agentId: first.id,
        sessionId,
        tools: false,
      });
      await started.promise;

      await updateSessionAgent(sessionId, second.id);
      const steered = await handleChat({
        message: "steered follow-up",
        sessionId,
        tools: false,
        queueMode: "steer",
      });
      expect(steered.queued).toBe(true);
      expect(pendingChatQueues.get(sessionId)?.[0]?.request.agentId).toBe(second.id);

      gate.resolve();
      const response = await activeResponse;
      expect(response.agent?.id).toBe(first.id);
      expect(response.session_agent_id).toBe(second.id);

      for (let attempt = 0; attempt < 400 && seen.length < 2; attempt += 1) await Bun.sleep(5);
      expect(seen).toEqual([first.id, second.id]);
      expect(getResidentChatSession(sessionId)?.agentId).toBe(second.id);

      const nextResponse = await handleChat({
        message: "run after the steering",
        sessionId,
        tools: false,
      });
      expect(nextResponse.agent?.id).toBe(second.id);
      expect(seen).toEqual([first.id, second.id, second.id]);
    } finally {
      gate.resolve();
      await activeResponse;
    }
  }, 15000);
});
