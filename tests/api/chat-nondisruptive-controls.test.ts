import { afterEach, expect, test } from "bun:test";
import {
  handleChat,
  steerPendingChatMessage,
  updateSessionAgent,
  getSessionMessages,
  deleteSession,
} from "../../src/api/chat";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";
import { getRun, getRunsByRequester } from "../../src/core/subagent-registry";
import {
  handleSessionsSpawn,
  handleSessionsWait,
  resetSubagentSessionsForTests,
} from "../../src/core/tools/handlers/channel";
import { pendingChatQueues } from "../../src/api/chat-runtime-state";
import { loadPersistedSession } from "../../src/core/session-context";

const originalExecute = agentManager.execute.bind(agentManager);
const originalFetch = globalThis.fetch;
const agents: string[] = [],
  providers: string[] = [],
  sessions: string[] = [];
afterEach(async () => {
  agentManager.execute = originalExecute;
  globalThis.fetch = originalFetch;
  resetSubagentSessionsForTests();
  for (const id of sessions.splice(0)) await deleteSession(id);
  for (const id of agents.splice(0)) agentManager.delete(id);
  for (const id of providers.splice(0)) providerManager.delete(id);
});
function setup(): { first: string; second: string; session: string } {
  const provider = providerManager.create({
    provider: "openai",
    name: "Control fixture",
    api_key: "fixture",
    base_url: "https://api.openai.com/v1",
  });
  providers.push(provider.id);
  const first = agentManager.create({
    name: "Original control fixture",
    model: "control-a",
    provider_id: provider.id,
    memory_enabled: false,
  });
  const second = agentManager.create({
    name: "Next control fixture",
    model: "control-b",
    provider_id: provider.id,
    memory_enabled: false,
  });
  agents.push(first.id, second.id);
  const session = `controls-${crypto.randomUUID()}`;
  sessions.push(session);
  return { first: first.id, second: second.id, session };
}

for (const children of [0, 1, 2])
  test(`steering and agent selection preserve ${children} independently running child jobs`, async () => {
    const { first, second, session } = setup();
    const parentStarted = Promise.withResolvers<void>();
    const parentRelease = Promise.withResolvers<void>();
    const childRelease = Promise.withResolvers<void>();
    const childSignals: AbortSignal[] = [];
    const seen: string[] = [];
    let parentSignal: AbortSignal | undefined;
    let inline: string[] = [];
    agentManager.execute = (async (id, messages, options) => {
      if (options?.channel === "subagent") {
        if (options.abortSignal) childSignals.push(options.abortSignal);
        await childRelease.promise;
        return { content: "Child finished successfully", tool_calls: [] };
      }
      seen.push(id);
      if (seen.length === 1) {
        parentSignal = options?.abortSignal;
        parentStarted.resolve();
        await parentRelease.promise;
        inline = (options?.consumeSteeringMessages?.() ?? []).map((item) => item.content);
      }
      return { content: "Parent finished successfully", tool_calls: [] };
    }) as typeof agentManager.execute;
    const active = handleChat({
      agentId: first,
      sessionId: session,
      message: "Discuss the proposal",
      tools: true,
    });
    await parentStarted.promise;
    let selected = false;
    let switchPromise: ReturnType<typeof updateSessionAgent> | undefined;
    try {
      const runs = await Promise.all(
        Array.from({ length: children }, (_, index) =>
          handleSessionsSpawn(
            { task: `Independent child ${index}`, agentId: first, runTimeoutSeconds: 20 },
            {
              sessionId: session,
              agentId: first,
              allowedToolNames: ["read", "sessions_spawn", "sessions_wait"],
            }
          )
        )
      );
      for (let attempt = 0; attempt < 100 && childSignals.length < children; attempt += 1)
        await Bun.sleep(5);
      expect(childSignals).toHaveLength(children);
      const queued = await handleChat({
        agentId: first,
        sessionId: session,
        message: "Also verify the result",
        tools: true,
        queueMode: "queue",
      });
      if (!queued.pendingMessage) throw Error("Missing queued follow-up");
      const steered = await steerPendingChatMessage(session, queued.pendingMessage.id);
      expect(steered.success).toBe(true);
      expect(parentSignal?.aborted).toBe(false);
      expect(childSignals.every((signal) => !signal.aborted)).toBe(true);
      expect(runs.map((run) => getRun(run.runId)?.outcome?.status ?? "running")).toEqual(
        Array(children).fill("running")
      );
      switchPromise = updateSessionAgent(session, second).then((value) => {
        selected = true;
        return value;
      });
      await Bun.sleep(5);
      expect(selected).toBe(false);
      expect(parentSignal?.aborted).toBe(false);
      expect(childSignals.every((signal) => !signal.aborted)).toBe(true);
      parentRelease.resolve();
      const completed = await active;
      expect(completed.interrupted).not.toBe(true);
      expect(completed.stopped).not.toBe(true);
      expect(completed.message.content).toBe("Parent finished successfully");
      expect(inline).toEqual(["Also verify the result"]);
      expect(pendingChatQueues.get(session)?.length ?? 0).toBe(0);
      const changed = await switchPromise;
      expect(changed.agentId).toBe(second);
      expect(childSignals.every((signal) => !signal.aborted)).toBe(true);
      expect(runs.map((run) => getRun(run.runId)?.outcome?.status ?? "running")).toEqual(
        Array(children).fill("running")
      );
      childRelease.resolve();
      if (runs.length) {
        const waited = await handleSessionsWait(
          { runIds: runs.map((run) => run.runId), timeoutSeconds: 2 },
          { sessionId: session }
        );
        expect(waited.status).toBe("completed");
        expect(waited.runs.map((run) => run.status)).toEqual(Array(children).fill("completed"));
      }
      expect(
        getRunsByRequester(session).filter((run) => run.outcome?.status === "ok")
      ).toHaveLength(children);
      const durable = await loadPersistedSession(session);
      expect(durable?.agentId).toBe(second);
      await handleChat({
        agentId: second,
        sessionId: session,
        message: "Explain the proposal",
        tools: true,
      });
      expect(seen.at(-1)).toBe(second);
      const messages = await getSessionMessages(session);
      expect(
        messages.filter((message) => message.content === "Also verify the result")
      ).toHaveLength(1);
      expect(childSignals.every((signal) => !signal.aborted)).toBe(true);
    } finally {
      parentRelease.resolve();
      childRelease.resolve();
      await active;
      await switchPromise;
    }
  }, 15000);

test("invalid agent selection does not cancel a gated provider request", async () => {
  const { first, session } = setup();
  const started = Promise.withResolvers<void>(),
    gate = Promise.withResolvers<void>();
  let signal: AbortSignal | null | undefined;
  globalThis.fetch = (async (_url, init) => {
    signal = init?.signal;
    started.resolve();
    await gate.promise;
    return Response.json({
      id: "controlled",
      object: "chat.completion",
      model: "control-a",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content: "Completed normally" },
        },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    });
  }) as typeof fetch;
  const active = handleChat({
    agentId: first,
    sessionId: session,
    message: "Answer directly",
    tools: false,
  });
  await started.promise;
  const rejected = updateSessionAgent(session, "missing-agent").catch((error) => error as Error);
  try {
    await Bun.sleep(5);
    expect(signal?.aborted).toBe(false);
    gate.resolve();
    expect((await active).message.content).toBe("Completed normally");
    expect(((await rejected) as Error).message).toBe("Agent not found");
    expect(signal?.aborted).toBe(false);
  } finally {
    gate.resolve();
    await active;
    await rejected;
  }
});
