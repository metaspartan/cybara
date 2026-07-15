import { afterEach, describe, expect, test } from "bun:test";
import {
  deleteSession,
  getSessionMessages,
  handleChat,
  listPendingChatMessages,
} from "../../src/api/chat";
import { agentManager } from "../../src/core/agent";
import { tables } from "../../src/core/database";
import { providerManager } from "../../src/core/providers";
import { taskScheduler } from "../../src/core/scheduler";

const agentIds: string[] = [];
const providerIds: string[] = [];
const sessionIds: string[] = [];
const taskIds: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(async () => {
  globalThis.fetch = originalFetch;
  for (const taskId of taskIds.splice(0)) taskScheduler.delete(taskId);
  for (const sessionId of sessionIds.splice(0)) await deleteSession(sessionId);
  for (const agentId of agentIds.splice(0)) agentManager.delete(agentId);
  for (const providerId of providerIds.splice(0)) providerManager.delete(providerId);
});

describe("scheduled task chat context", () => {
  test("executes in an assigned chat with its existing context and agent", async () => {
    const requests: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      requests.push(body);
      const isScheduledTurn = JSON.stringify(body.messages).includes("Scheduled action marker");
      return Response.json({
        id: `task-chat-response-${requests.length}`,
        type: "message",
        role: "assistant",
        model: "hf:MiniMaxAI/MiniMax-M2.1",
        content: [
          {
            type: "text",
            text: isScheduledTurn ? "Scheduled follow-up complete" : "Remembered baseline",
          },
        ],
        usage: { input_tokens: 12, output_tokens: 4 },
      });
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "synthetic",
      name: "Task Chat Context Provider",
      api_key: "task-chat-context-key",
    });
    providerIds.push(provider.id);
    const agent = agentManager.create({
      name: "Task Chat Context Agent",
      type: "main",
      provider_id: provider.id,
      model: "hf:MiniMaxAI/MiniMax-M2.1",
      memory_enabled: false,
      tools: [],
    });
    agentIds.push(agent.id);

    const sessionId = `task-chat-context-${crypto.randomUUID()}`;
    sessionIds.push(sessionId);
    await handleChat({
      message: "Baseline context marker",
      agentId: agent.id,
      sessionId,
      tools: false,
    });

    const task = taskScheduler.create({
      name: "Continue assigned chat",
      action: "Scheduled action marker",
      session_id: sessionId,
      enabled: false,
    });
    taskIds.push(task.id);

    expect(await taskScheduler.trigger(task.id)).toBe(true);
    const scheduledRequest = requests.find((request) =>
      JSON.stringify(request.messages).includes("Scheduled action marker")
    );
    expect(scheduledRequest).toBeDefined();
    expect(JSON.stringify(scheduledRequest?.messages)).toContain("Baseline context marker");
    expect(JSON.stringify(scheduledRequest?.messages)).toContain("Remembered baseline");

    const runs = tables.taskRuns.getByTask(task.id);
    expect(runs[0]?.status).toBe("completed");
    expect(runs[0]?.session_id).toBe(sessionId);

    const messages = (await getSessionMessages(sessionId)).filter(
      (message) => message.role !== "system"
    );
    expect(messages.map((message) => message.content)).toEqual([
      "Baseline context marker",
      "Remembered baseline",
      "Scheduled action marker",
      "Scheduled follow-up complete",
    ]);
  }, 20_000);

  test("keeps an assigned task running until its queued chat turn completes", async () => {
    let releaseActiveTurn: (() => void) | null = null;
    let markActiveTurnStarted: (() => void) | null = null;
    const activeTurnStarted = new Promise<void>((resolve) => {
      markActiveTurnStarted = resolve;
    });
    const activeTurnReleased = new Promise<void>((resolve) => {
      releaseActiveTurn = resolve;
    });

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? String(init.body) : "";
      const activeTurn = body.includes("Long active marker");
      const scheduledTurn = body.includes("Queued scheduled marker");
      if (activeTurn && !scheduledTurn) {
        markActiveTurnStarted?.();
        await activeTurnReleased;
      }
      const text = scheduledTurn
        ? "Queued scheduled turn complete"
        : activeTurn
          ? "Long active turn complete"
          : "Baseline complete";
      return Response.json({
        id: `queued-task-${crypto.randomUUID()}`,
        type: "message",
        role: "assistant",
        model: "hf:MiniMaxAI/MiniMax-M2.1",
        content: [{ type: "text", text }],
        usage: { input_tokens: 10, output_tokens: 4 },
      });
    }) as typeof fetch;

    const provider = providerManager.create({
      provider: "synthetic",
      name: "Queued Task Context Provider",
      api_key: "queued-task-context-key",
    });
    providerIds.push(provider.id);
    const agent = agentManager.create({
      name: "Queued Task Context Agent",
      type: "main",
      provider_id: provider.id,
      model: "hf:MiniMaxAI/MiniMax-M2.1",
      memory_enabled: false,
      tools: [],
    });
    agentIds.push(agent.id);

    const sessionId = `queued-task-context-${crypto.randomUUID()}`;
    sessionIds.push(sessionId);
    await handleChat({
      message: "Baseline marker",
      agentId: agent.id,
      sessionId,
      tools: false,
    });
    const activeTurn = handleChat({
      message: "Long active marker",
      agentId: agent.id,
      sessionId,
      tools: false,
    });
    await activeTurnStarted;

    const task = taskScheduler.create({
      name: "Queue into active chat",
      action: "Queued scheduled marker",
      session_id: sessionId,
      enabled: false,
    });
    taskIds.push(task.id);
    const trigger = taskScheduler.trigger(task.id);

    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (listPendingChatMessages(sessionId).length > 0) break;
      await Bun.sleep(10);
    }
    expect(listPendingChatMessages(sessionId).map((message) => message.content)).toEqual([
      "Queued scheduled marker",
    ]);
    expect(tables.taskRuns.getByTask(task.id)[0]?.status).toBe("running");

    releaseActiveTurn?.();
    await activeTurn;
    expect(await trigger).toBe(true);

    const runs = tables.taskRuns.getByTask(task.id);
    expect(runs[0]?.status).toBe("completed");
    expect(runs[0]?.result_preview).toBe("Queued scheduled turn complete");
    const messages = (await getSessionMessages(sessionId)).filter(
      (message) => message.role !== "system"
    );
    expect(messages.map((message) => message.content)).toEqual([
      "Baseline marker",
      "Baseline complete",
      "Long active marker",
      "Long active turn complete",
      "Queued scheduled marker",
      "Queued scheduled turn complete",
    ]);
  }, 20_000);
});
