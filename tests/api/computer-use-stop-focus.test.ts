import { afterEach, expect, test } from "bun:test";
import {
  beginComputerUseFocus,
  clearAllComputerUseFocus,
  listActiveComputerUseFocus,
} from "../../src/core/computer-use-focus";
import {
  stopComputerUseTrajectoryForSession,
  handleComputerUse,
} from "../../src/core/computer-use";
import { stopActiveChatTurn, handleChat, deleteSession } from "../../src/api/chat";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";

const original = agentManager.execute.bind(agentManager);
const agents: string[] = [],
  providers: string[] = [],
  sessions: string[] = [];
afterEach(async () => {
  agentManager.execute = original;
  clearAllComputerUseFocus();
  for (const id of sessions.splice(0)) await deleteSession(id);
  for (const id of agents.splice(0)) agentManager.delete(id);
  for (const id of providers.splice(0)) providerManager.delete(id);
});

test("stopping computer use clears focus without a recording and preserves another session", async () => {
  beginComputerUseFocus("parent", "fixture", "fixture");
  beginComputerUseFocus("child", "fixture", "fixture");
  expect(await stopComputerUseTrajectoryForSession("parent", "interrupted")).toBe(true);
  expect(listActiveComputerUseFocus().map((item) => item.sessionId)).toEqual(["child"]);
  expect(await stopComputerUseTrajectoryForSession("parent", "interrupted")).toBe(false);
  const stopped = await stopActiveChatTurn("child");
  expect(stopped.stopped).toBe(false);
  expect(listActiveComputerUseFocus()).toEqual([]);
});

for (const failure of [false, true])
  test(`turn finalization clears non-recorded focus on failure=${failure}`, async () => {
    const p = providerManager.create({
      name: "Focus finalization",
      provider: "openai",
      api_key: "fixture",
      base_url: "https://api.openai.com/v1",
    });
    providers.push(p.id);
    const a = agentManager.create({
      name: "Focus finalization",
      model: "fixture",
      provider_id: p.id,
      memory_enabled: false,
    });
    agents.push(a.id);
    const id = `focus-${crypto.randomUUID()}`;
    sessions.push(id);
    beginComputerUseFocus("independent", "fixture", "fixture");
    agentManager.execute = (async () => {
      beginComputerUseFocus(id, "fixture", "fixture");
      if (failure) throw Error("fixture failure");
      return { content: "A direct answer", tool_calls: [] };
    }) as typeof agentManager.execute;
    await handleChat({
      agentId: a.id,
      sessionId: id,
      message: "Discuss the question",
      tools: true,
    }).catch(() => undefined);
    expect(listActiveComputerUseFocus().map((item) => item.sessionId)).toEqual(["independent"]);
    beginComputerUseFocus(id, "fixture", "fixture");
    await deleteSession(id);
    expect(listActiveComputerUseFocus().map((item) => item.sessionId)).toEqual(["independent"]);
  });

test("an already stopped tool cannot recreate focus or invoke the driver", async () => {
  const signal = new AbortController();
  signal.abort(new Error("Stopped by user"));
  await expect(
    handleComputerUse(
      { action: "click", app: "fixture" },
      { sessionId: "cancelled", abortSignal: signal.signal }
    )
  ).rejects.toThrow("Stopped by user");
  expect(listActiveComputerUseFocus()).toEqual([]);
});

test("active Stop clears focus immediately while preserving an independent child", async () => {
  const p = providerManager.create({
    name: "Active focus stop",
    provider: "openai",
    api_key: "fixture",
    base_url: "https://api.openai.com/v1",
  });
  providers.push(p.id);
  const a = agentManager.create({
    name: "Active focus stop",
    model: "fixture",
    provider_id: p.id,
    memory_enabled: false,
  });
  agents.push(a.id);
  const id = `focus-stop-${crypto.randomUUID()}`;
  sessions.push(id);
  const started = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  let signal: AbortSignal | undefined;
  agentManager.execute = (async (_id, _messages, options) => {
    signal = options?.abortSignal;
    beginComputerUseFocus(id, "fixture", "fixture");
    started.resolve();
    await released.promise;
    return { content: "", tool_calls: [] };
  }) as typeof agentManager.execute;
  beginComputerUseFocus("child-independent", "fixture", "fixture");
  const active = handleChat({
    agentId: a.id,
    sessionId: id,
    message: "Discuss the question",
    tools: true,
  });
  await started.promise;
  try {
    const stopped = stopActiveChatTurn(id);
    released.resolve();
    expect(signal?.aborted).toBe(true);
    expect(listActiveComputerUseFocus().map((item) => item.sessionId)).toEqual([
      "child-independent",
    ]);
    expect((await stopped).stopped).toBe(true);
    await active;
    expect(listActiveComputerUseFocus().map((item) => item.sessionId)).toEqual([
      "child-independent",
    ]);
  } finally {
    released.resolve();
    await stopActiveChatTurn(id);
    await active;
  }
});
