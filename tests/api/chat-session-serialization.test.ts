import { afterEach, describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";
import {
  deleteSession,
  formatProcessActivityFromToolCall,
  handleChat,
  waitForPendingChatCompletion,
  getSessionMessages,
  listPendingChatMessages,
  deletePendingChatMessage,
  reorderPendingChatMessages,
  restorePersistedPendingChatQueues,
  sendToSession,
  steerPendingChatMessage,
  stopActiveChatTurn,
  updatePendingChatMessage,
  updateSessionAgent,
} from "../../src/api/chat";
import { loadPersistedPendingChatItems } from "../../src/api/chat-pending-store";
import { pendingChatQueues } from "../../src/api/chat-runtime-state";
import { broadcastStatus, onStatusStream } from "../../src/core/status";
import { config } from "../../src/core/config";
import db from "../../src/core/database";
import { listSessionEvents } from "../../src/core/session-event-ledger";
import {
  loadPersistedSession,
  upsertPersistedSessionMessage,
} from "../../src/core/session-context";

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
  config.setFollowUpBehaviorEnabled(true);
  config.set("router", null);
  config.set("provider_plan_monitoring", null);
  globalThis.fetch = originalFetch;
  for (const sessionId of createdSessionIds.splice(0)) await deleteSession(sessionId);
  for (const agentId of createdAgentIds.splice(0)) agentManager.delete(agentId);
  for (const providerId of createdProviderIds.splice(0)) providerManager.delete(providerId);
});

describe("handleChat per-session serialization", () => {
  test("settles awaited steering consumed inside the active turn", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Inline Steering Provider",
      api_key: "sk-inline-steering",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "Inline Steering Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-inline-steering",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);
    const sessionId = `inline-steering-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    globalThis.fetch = (async () =>
      Response.json({
        id: "inline-steering-title",
        object: "chat.completion",
        model: "gpt-inline-steering",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "Inline steering" },
          },
        ],
      })) as typeof fetch;

    const originalExecute = agentManager.execute.bind(agentManager);
    let started: (() => void) | undefined;
    let continueExecution: (() => void) | undefined;
    const executionStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const executionReleased = new Promise<void>((resolve) => {
      continueExecution = resolve;
    });
    agentManager.execute = (async (_agentId, _messages, options) => {
      started?.();
      await executionReleased;
      expect(options?.consumeSteeringMessages?.().map((item) => item.content)).toEqual([
        "adjust inline",
      ]);
      return { content: "adjusted response" };
    }) as typeof agentManager.execute;

    try {
      const activeTurn = handleChat({
        message: "start work",
        agentId: agent.id,
        sessionId,
        tools: true,
      });
      await executionStarted;
      const queued = await handleChat({
        message: "adjust inline",
        agentId: agent.id,
        sessionId,
        tools: true,
        queueMode: "steer",
        awaitQueuedCompletion: true,
      });
      expect(queued.queued).toBe(true);
      const pendingId = queued.pendingMessage?.id;
      expect(pendingId).toBeString();
      const completion = waitForPendingChatCompletion(pendingId || "");
      continueExecution?.();
      const [activeResponse, steeredResponse] = await Promise.all([activeTurn, completion]);
      expect(steeredResponse.message.content).toBe("adjusted response");
      expect(steeredResponse).toEqual(activeResponse);
    } finally {
      agentManager.execute = originalExecute;
    }
  });

  test("persists a new session before the provider returns", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "First Turn Persistence Provider",
      api_key: "sk-first-turn-persistence",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "First Turn Persistence Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-first-turn-persistence",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);

    let markProviderStarted: (() => void) | undefined;
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve;
    });
    globalThis.fetch = ((_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        markProviderStarted?.();
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("stopped", "AbortError")),
          { once: true }
        );
      })) as typeof fetch;

    const sessionId = `first-turn-persistence-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    const activeTurn = handleChat({
      message: "Analyze the attached energy chart",
      agentId: agent.id,
      sessionId,
      tools: false,
    });

    await providerStarted;
    const persisted = await loadPersistedSession(sessionId);
    expect(persisted?.agentId).toBe(agent.id);
    expect(persisted?.messages.filter((message) => message.role !== "system")).toEqual([
      expect.objectContaining({
        role: "user",
        content: "Analyze the attached energy chart",
      }),
    ]);

    expect((await stopActiveChatTurn(sessionId)).stopped).toBe(true);
    const response = await activeTurn;
    expect(response.stopped).toBe(true);
  });

  test("persists and stops image turns while a vision fallback is running", async () => {
    const provider = providerManager.create({
      provider: "minimax",
      name: "Vision Fallback Persistence Provider",
      api_key: "sk-vision-fallback-persistence",
      base_url: "https://api.minimax.io/v1",
    });
    createdProviderIds.push(provider.id);
    const textAgent = agentManager.create({
      name: "Vision Fallback Text Agent",
      type: "main",
      provider_id: provider.id,
      model: "MiniMax-M2.7",
      memory_enabled: false,
    });
    const visionAgent = agentManager.create({
      name: "Vision Fallback Image Agent",
      type: "main",
      provider_id: provider.id,
      model: "MiniMax-M3",
      memory_enabled: false,
    });
    createdAgentIds.push(textAgent.id, visionAgent.id);

    let markFallbackStarted: (() => void) | undefined;
    const fallbackStarted = new Promise<void>((resolve) => {
      markFallbackStarted = resolve;
    });
    let fallbackAborted = false;
    globalThis.fetch = ((_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        markFallbackStarted?.();
        init?.signal?.addEventListener(
          "abort",
          () => {
            fallbackAborted = true;
            reject(new DOMException("stopped", "AbortError"));
          },
          { once: true }
        );
      })) as typeof fetch;

    const previousFallbackAgentId = config.get<string>("vision_fallback_agent_id");
    config.set("vision_fallback_agent_id", visionAgent.id);
    const sessionId = `vision-fallback-persistence-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    try {
      const activeTurn = handleChat({
        message: "Analyze this energy chart",
        agentId: textAgent.id,
        sessionId,
        tools: false,
        images: [
          {
            data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            mimeType: "image/png",
          },
        ],
      });

      await fallbackStarted;
      const persisted = await loadPersistedSession(sessionId);
      expect(persisted?.messages.filter((message) => message.role !== "system")).toEqual([
        expect.objectContaining({
          role: "user",
          content: "Analyze this energy chart",
        }),
      ]);
      expect((await getSessionMessages(sessionId)).map(({ role }) => role)).toEqual(["user"]);

      expect((await stopActiveChatTurn(sessionId)).stopped).toBe(true);
      const response = await activeTurn;
      expect(response.stopped).toBe(true);
      expect(fallbackAborted).toBe(true);
    } finally {
      config.set("vision_fallback_agent_id", previousFallbackAgentId ?? "");
    }
  });

  test("stopping an active turn aborts provider work and prevents a late assistant response", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Stop Provider",
      api_key: "sk-stop",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "Stop Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-stop",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);
    let providerAborted = false;
    let markProviderStarted: (() => void) | undefined;
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve;
    });
    globalThis.fetch = ((_url, init) =>
      new Promise<Response>((resolve, reject) => {
        markProviderStarted?.();
        const timer = setTimeout(
          () =>
            resolve(
              Response.json({
                choices: [
                  {
                    finish_reason: "stop",
                    message: {
                      role: "assistant",
                      content: "late response must not persist",
                    },
                  },
                ],
                usage: {
                  prompt_tokens: 2,
                  completion_tokens: 4,
                  total_tokens: 6,
                },
              })
            ),
          100
        );
        init?.signal?.addEventListener(
          "abort",
          () => {
            providerAborted = true;
            clearTimeout(timer);
            reject(new DOMException("stopped", "AbortError"));
          },
          { once: true }
        );
      })) as typeof fetch;

    const sessionId = `stop-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    const activeTurn = handleChat({
      message: "start a long response",
      agentId: agent.id,
      sessionId,
      tools: false,
    });
    await providerStarted;

    broadcastStatus({
      status: "thinking",
      timestamp: Date.now(),
      detail: "Inspecting the current request",
      sessionId,
      agentId: agent.id,
    });
    broadcastStatus({
      status: "tool_executing",
      timestamp: Date.now() + 1,
      detail: "Reading configuration",
      sessionId,
      agentId: agent.id,
      toolName: "read",
      toolCallId: "read-complete",
      toolPhase: "start",
    });
    broadcastStatus({
      status: "tool_completed",
      timestamp: Date.now() + 2,
      detail: "Read configuration",
      sessionId,
      agentId: agent.id,
      toolName: "read",
      toolCallId: "read-complete",
      toolPhase: "result",
    });
    broadcastStatus({
      status: "tool_executing",
      timestamp: Date.now() + 3,
      detail: "Searching workspace",
      sessionId,
      agentId: agent.id,
      toolName: "search",
      toolCallId: "search-stopped",
      toolPhase: "start",
    });

    expect(await stopActiveChatTurn(sessionId)).toEqual({
      success: true,
      stopped: true,
      sessionId,
    });
    const response = await activeTurn;

    expect(response.stopped).toBe(true);
    expect(response.interrupted).toBe(true);
    expect(providerAborted).toBe(true);
    const messages = await waitForVisibleSessionMessages(sessionId, 2);
    expect(messages.map((message) => message.content)).toEqual(["start a long response", ""]);
    const stoppedActivities = messages[1]?.process_activities || [];
    expect(stoppedActivities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "result",
          text: "Inspecting the current request",
          toolName: "__thought",
        }),
        expect.objectContaining({
          phase: "result",
          toolName: "read",
          toolCallId: "read-complete",
        }),
        expect.objectContaining({
          phase: "blocked",
          text: "Stopped: Searching workspace",
          toolName: "search",
          toolCallId: "search-stopped",
        }),
      ])
    );
    expect(messages.some((message) => message.content.includes("late response"))).toBe(false);
    const persisted = await loadPersistedSession(sessionId);
    const persistedStopped = persisted?.messages.find(
      (message) => message.role === "assistant" && message.content === ""
    );
    expect(persistedStopped?.process_activities).toEqual(stoppedActivities);
    expect((await stopActiveChatTurn(sessionId)).stopped).toBe(false);
  });

  test("formats complete command activity without shortening it", () => {
    const command =
      "printf 'complete command activity remains fully visible across every client surface' >/dev/null";
    expect(
      formatProcessActivityFromToolCall({
        id: "complete-command-call",
        name: "exec",
        args: { command },
        status: "completed",
      })
    ).toBe(`Ran ${command}`);
  });

  test("rejects concurrent follow-ups when queue and steer behavior is disabled", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Disabled Follow-up Provider",
      api_key: "sk-disabled-follow-up",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "Disabled Follow-up Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-disabled-follow-up",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);
    globalThis.fetch = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return new Response(
        JSON.stringify({
          id: "disabled-follow-up",
          object: "chat.completion",
          model: "gpt-disabled-follow-up",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: "first complete" },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    config.setFollowUpBehaviorEnabled(false);
    const sessionId = `disabled-follow-up-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    const firstTurn = handleChat({
      message: "start",
      agentId: agent.id,
      sessionId,
      tools: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));

    await expect(
      handleChat({
        message: "follow up",
        agentId: agent.id,
        sessionId,
        tools: false,
        queueMode: "queue",
      })
    ).rejects.toThrow("Queue and steer follow-ups are disabled");
    expect(listPendingChatMessages(sessionId)).toEqual([]);
    await firstTurn;
  });

  test("sanitizes provider reply directives when persisted chats are loaded", async () => {
    const sessionId = `persisted-reply-directive-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);

    await upsertPersistedSessionMessage(
      sessionId,
      "test-agent",
      { role: "assistant", content: "Finished.\n\n[[reply_to_current]]" },
      { stableKey: "assistant-reply" }
    );

    const persisted = await loadPersistedSession(sessionId);

    expect(persisted?.messages[0]?.content).toBe("Finished.");
  });

  test("sanitizes inline provider reply directives before returning a response", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Reply Directive Provider",
      api_key: "sk-reply-directive",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "Reply Directive Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-reply-directive",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);
    globalThis.fetch = (async () =>
      Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: "[[reply_to_current]] Answer starts here.",
            },
          },
        ],
      })) as typeof fetch;
    const sessionId = `reply-directive-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);

    const response = await handleChat({
      message: "Answer this",
      agentId: agent.id,
      sessionId,
      tools: false,
    });

    expect(response.message.content).toBe("Answer starts here.");
    expect((await loadPersistedSession(sessionId))?.messages.at(-1)?.content).toBe(
      "Answer starts here."
    );
  });

  test("orders injected subagent results after the active parent response", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Subagent Ordering Provider",
      api_key: "sk-subagent-ordering",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Subagent Ordering Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-subagent-ordering",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);

    let markFetchStarted: (() => void) | undefined;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    globalThis.fetch = (async () => {
      markFetchStarted?.();
      await new Promise((resolve) => setTimeout(resolve, 40));
      return new Response(
        JSON.stringify({
          id: "subagent-ordering",
          object: "chat.completion",
          model: "gpt-subagent-ordering",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "Parent accepted the spawn",
              },
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const sessionId = `subagent-ordering-${Date.now()}`;
    createdSessionIds.push(sessionId);
    const parentTurn = handleChat({
      message: "Spawn a child",
      agentId: agent.id,
      sessionId,
      tools: false,
    });

    await fetchStarted;
    expect(
      sendToSession(sessionId, {
        role: "assistant",
        content: "Child result delivered",
        timestamp: new Date().toISOString(),
      })
    ).toBe(true);

    await parentTurn;
    const messages = await waitForVisibleSessionMessages(sessionId, 3);
    expect(messages.map((message) => message.content)).toEqual([
      "Spawn a child",
      "Parent accepted the spawn",
      "Child result delivered",
    ]);

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const durable = await loadPersistedSession(sessionId);
      const visible = (durable?.messages || []).filter((message) => message.role !== "system");
      if (visible.length >= 3) {
        expect(visible.map((message) => message.content)).toEqual([
          "Spawn a child",
          "Parent accepted the spawn",
          "Child result delivered",
        ]);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    throw new Error("Timed out waiting for the injected subagent result to persist");
  });

  test("chat execution refreshes stale generated agent prompts before calling the model", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Prompt Refresh Provider",
      api_key: "sk-prompt-refresh",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Prompt Refresh Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-prompt-refresh",
      system_prompt: "## Tooling\n- exec: stale shell-only snapshot\n",
      tools: [{ name: "read" }],
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);

    let sentSystemPrompt = "";
    globalThis.fetch = (async (_url, init) => {
      const request = JSON.parse(String(init?.body || "{}")) as {
        messages?: Array<{ role: string; content: string }>;
      };
      sentSystemPrompt =
        request.messages?.find((message) => message.role === "system")?.content || "";
      return new Response(
        JSON.stringify({
          id: "prompt-refresh",
          object: "chat.completion",
          model: "gpt-prompt-refresh",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: "fresh prompt used" },
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const sessionId = `prompt-refresh-${Date.now()}`;
    createdSessionIds.push(sessionId);

    const response = await handleChat({
      message: "check prompt",
      agentId: agent.id,
      sessionId,
      tools: true,
    });

    expect(response.message.content).toBe("fresh prompt used");
    expect(sentSystemPrompt).toContain("## Tooling");
    expect(sentSystemPrompt).toContain("- read:");
    expect(sentSystemPrompt).not.toContain("stale shell-only snapshot");
  });

  test("existing sessions can switch active agents and retain context usage", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Switch Agent Provider",
      api_key: "sk-switch-agent",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);

    const firstAgent = agentManager.create({
      name: "Switch Agent A",
      type: "main",
      provider_id: provider.id,
      model: "gpt-switch-a",
      memory_enabled: false,
    });
    const secondAgent = agentManager.create({
      name: "Switch Agent B",
      type: "main",
      provider_id: provider.id,
      model: "gpt-switch-b",
      memory_enabled: false,
    });
    createdAgentIds.push(firstAgent.id, secondAgent.id);

    globalThis.fetch = (async (_url, init) => {
      const request = JSON.parse(String(init?.body || "{}")) as {
        model?: string;
      };
      const model = request.model || "unknown-model";
      return new Response(
        JSON.stringify({
          id: `switch-${model}`,
          object: "chat.completion",
          model,
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: `reply from ${model}` },
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const sessionId = `switch-agent-${Date.now()}`;
    createdSessionIds.push(sessionId);

    const first = await handleChat({
      message: "first",
      agentId: firstAgent.id,
      sessionId,
      tools: false,
    });
    expect(first.agent?.id).toBe(firstAgent.id);
    expect(first.message.content).toBe("reply from gpt-switch-a");

    const updated = await updateSessionAgent(sessionId, secondAgent.id);
    expect(updated.agentId).toBe(secondAgent.id);
    expect(updated.contextUsage.usedTokens).toBeGreaterThan(0);
    expect(updated.contextUsage.limitTokens).toBeGreaterThan(updated.contextUsage.usedTokens);

    const second = await handleChat({
      message: "second",
      sessionId,
      tools: false,
    });
    expect(second.agent?.id).toBe(secondAgent.id);
    expect(second.message.content).toBe("reply from gpt-switch-b");
    expect(second.contextUsage?.usedTokens).toBeGreaterThan(0);

    const persisted = await loadPersistedSession(sessionId);
    expect(persisted?.agentId).toBe(secondAgent.id);

    const routed = await updateSessionAgent(sessionId, undefined, true);
    expect(routed.agentId).toBe(secondAgent.id);
    expect(routed.useModelRouter).toBe(true);
    expect((await loadPersistedSession(sessionId))?.useModelRouter).toBe(true);

    const concrete = await updateSessionAgent(sessionId, firstAgent.id, false);
    expect(concrete.useModelRouter).toBe(false);
    expect((await loadPersistedSession(sessionId))?.useModelRouter).toBe(false);
  });

  test("transfers an active turn to another agent and persists shared ownership", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Transfer Provider",
      api_key: "sk-transfer",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);
    const firstAgent = agentManager.create({
      name: "Transfer Agent A",
      type: "main",
      provider_id: provider.id,
      model: "gpt-transfer-a",
      memory_enabled: false,
    });
    const secondAgent = agentManager.create({
      name: "Transfer Agent B",
      type: "main",
      provider_id: provider.id,
      model: "gpt-transfer-b",
      memory_enabled: false,
    });
    createdAgentIds.push(firstAgent.id, secondAgent.id);

    let transferRequested = false;
    const requestedModels: string[] = [];
    globalThis.fetch = (async (_url, init) => {
      const request = JSON.parse(String(init?.body || "{}")) as {
        model?: string;
        messages?: Array<{ content?: string }>;
      };
      const model = request.model || "unknown";
      requestedModels.push(model);
      const prompt = (request.messages || []).map((entry) => entry.content || "").join("\n");
      if (model === "gpt-transfer-a" && transferRequested) {
        return new Response(
          JSON.stringify({
            id: "transfer-tool-call",
            object: "chat.completion",
            model,
            choices: [
              {
                index: 0,
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "transfer-context-call-1",
                      type: "function",
                      function: {
                        name: "agents_list",
                        arguments: "{}",
                      },
                    },
                    {
                      id: "transfer-call-1",
                      type: "function",
                      function: {
                        name: "sessions_transfer",
                        arguments: JSON.stringify({
                          agentId: secondAgent.name,
                          reason: "The second agent owns this specialty",
                          contextMode: "full",
                          contextSummary: "Preserve the requested output format",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      const isPersistedTransferTurn = request.messages?.some(
        (entry) => entry.content === "Continue"
      );
      const content =
        model === "gpt-transfer-b"
          ? isPersistedTransferTurn
            ? prompt.includes(
                "The session transfer from Transfer Agent A to Transfer Agent B is complete"
              )
              ? "Transfer ownership context persisted."
              : "Transfer ownership context was missing."
            : prompt.includes("The active chat was transferred from Transfer Agent A") &&
                prompt.includes("agents_list:")
              ? "Transfer Agent B continued with shared context."
              : "Transfer context was missing."
          : "Transfer Agent A initial reply.";
      return new Response(
        JSON.stringify({
          id: `transfer-${model}`,
          object: "chat.completion",
          model,
          choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
          usage: { prompt_tokens: 8, completion_tokens: 5, total_tokens: 13 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const sessionId = `agent-transfer-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    await handleChat({
      message: "Start the shared task",
      agentId: firstAgent.id,
      sessionId,
      tools: false,
    });
    requestedModels.length = 0;
    transferRequested = true;

    const transferred = await handleChat({
      message: "Please let the specialist finish this",
      sessionId,
      tools: true,
    });

    expect(transferred.agent?.id).toBe(secondAgent.id);
    expect(transferred.message.content).toBe("Transfer Agent B continued with shared context.");
    expect(transferred.message.agent_transfers).toHaveLength(1);
    expect(transferred.message.agent_transfers?.[0]).toMatchObject({
      fromAgentId: firstAgent.id,
      toAgentId: secondAgent.id,
      contextMode: "full",
    });
    expect(transferred.tool_calls?.map((toolCall) => toolCall.name)).toContain("sessions_transfer");
    expect(requestedModels.filter((model) => model === "gpt-transfer-a")).toHaveLength(1);
    expect(requestedModels.filter((model) => model === "gpt-transfer-b")).toHaveLength(1);

    const persisted = await loadPersistedSession(sessionId);
    expect(persisted?.agentId).toBe(secondAgent.id);
    expect(persisted?.messages.at(-1)?.agent_transfers?.[0]?.toAgentId).toBe(secondAgent.id);

    requestedModels.length = 0;
    transferRequested = false;
    const nextTurn = await handleChat({ message: "Continue", sessionId, tools: false });
    expect(nextTurn.agent?.id).toBe(secondAgent.id);
    expect(nextTurn.message.content).toBe("Transfer ownership context persisted.");
    expect(requestedModels).toEqual(["gpt-transfer-b"]);
  });

  test("sessions get estimated token metrics when a provider omits usage", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Estimated Usage Provider",
      api_key: "sk-estimated-usage",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Estimated Usage Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-estimated-usage",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);

    globalThis.fetch = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return Response.json({
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: "Estimated usage should still be recorded for this chat session.",
            },
          },
        ],
      });
    }) as typeof fetch;

    const sessionId = `estimated-usage-${Date.now()}`;
    createdSessionIds.push(sessionId);
    const response = await handleChat({
      message: "record tokens without provider usage",
      agentId: agent.id,
      sessionId,
      tools: false,
    });
    expect(response.tokenUsage.inputTokens).toBeGreaterThan(0);
    expect(response.tokenUsage.outputTokens).toBeGreaterThan(0);
    expect(response.tokenUsage.totalTokens).toBeGreaterThan(0);
    expect(response.tokenUsage.callCount).toBe(1);
    expect(response.tokenUsage.tokensPerSecond).toBeNull();
    expect(response.tokenUsage.firstTokenMs).toBeNull();
    const metric = db
      .query(
        "SELECT metadata FROM metrics WHERE type = 'token_usage_by_session' AND key = ? ORDER BY rowid DESC LIMIT 1"
      )
      .get(sessionId) as { metadata: string };
    const metricMetadata = JSON.parse(metric.metadata) as Record<string, unknown>;
    expect(metricMetadata.estimated).toBe(true);
    expect("generationDurationMs" in metricMetadata).toBe(false);
    expect("firstTokenMs" in metricMetadata).toBe(false);

    const updated = await updateSessionAgent(sessionId, agent.id);
    expect(updated.tokenUsage?.inputTokens).toBeGreaterThan(0);
    expect(updated.tokenUsage?.outputTokens).toBeGreaterThan(0);
    expect(updated.tokenUsage?.tokensPerSecond).toBeNull();
    expect(updated.tokenUsage?.firstTokenMs).toBeNull();
  });

  test("session token metrics exclude suppressed title generation usage", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Visible Usage Provider",
      api_key: "sk-visible-usage",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Visible Usage Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-visible-usage",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);

    globalThis.fetch = (async (_url, init) => {
      const request = JSON.parse(String(init?.body || "{}")) as {
        messages?: Array<{ role: string; content: string }>;
      };
      const text = (request.messages || []).map((message) => message.content).join("\n");
      const isTitleCall = text.includes("Generate the best session title now.");
      return new Response(
        JSON.stringify({
          id: isTitleCall ? "title-usage" : "visible-usage",
          object: "chat.completion",
          model: "gpt-visible-usage",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: isTitleCall ? "Visible usage test" : "Visible chat response.",
              },
            },
          ],
          usage: isTitleCall
            ? { prompt_tokens: 300, completion_tokens: 9, total_tokens: 309 }
            : { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const response = await handleChat({
      message: "record only visible chat usage",
      agentId: agent.id,
      tools: false,
    });
    createdSessionIds.push(response.sessionId);

    expect(response.message.content).toBe("Visible chat response.");
    expect(response.tokenUsage).toMatchObject({
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
      callCount: 1,
    });
  });

  test("chat turns can override the active agent model for one turn", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Override Model Provider",
      api_key: "sk-override-model",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Override Model Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-agent-default",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);

    let sentModel = "";
    globalThis.fetch = (async (_url, init) => {
      const request = JSON.parse(String(init?.body || "{}")) as {
        model?: string;
      };
      sentModel = request.model || "";
      return new Response(
        JSON.stringify({
          id: "override-model-response",
          object: "chat.completion",
          model: sentModel,
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: `reply from ${sentModel}`,
              },
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const sessionId = `override-model-${Date.now()}`;
    createdSessionIds.push(sessionId);

    const response = await handleChat({
      message: "use override",
      agentId: agent.id,
      sessionId,
      modelOverride: "gpt-cli-override",
      tools: false,
    });

    expect(sentModel).toBe("gpt-cli-override");
    expect(response.message.content).toBe("reply from gpt-cli-override");
    expect(response.contextUsage?.limitTokens).toBeGreaterThan(0);
  });

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
    const queueHandoffVisibility: Array<Promise<boolean>> = [];
    let observeQueueHandoff = false;
    const unsubscribe = onStatusStream((event) => {
      if (event.type === "status" && typeof event.detail === "string") {
        statusDetails.push(event.detail);
      }
      if (observeQueueHandoff && event.type === "snapshot") {
        const pending = event.activeSessions
          .find((snapshot) => snapshot.sessionId === sessionId)
          ?.pendingMessages?.some((message) => message.content === "second");
        if (!pending) {
          queueHandoffVisibility.push(
            loadPersistedSession(sessionId).then((session) =>
              (session?.messages || []).some(
                (message) =>
                  message.role === "user" &&
                  message.content === "second" &&
                  typeof message.pending_chat_id === "string"
              )
            )
          );
        }
      }
    });

    const firstTurn = handleChat({
      message: "first",
      agentId: agent.id,
      sessionId,
      tools: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const secondResponse = await handleChat({
      message: "second",
      agentId: agent.id,
      sessionId,
      clientPendingId: "optimistic-second",
      tools: false,
    });
    observeQueueHandoff = true;
    expect(loadPersistedPendingChatItems(sessionId).map((item) => item.content)).toEqual([
      "second",
    ]);
    const firstResponse = await firstTurn;

    expect(firstResponse.queued).toBeUndefined();
    expect(secondResponse.queued).toBe(true);
    expect(secondResponse.pendingMessages?.map((message) => message.content)).toEqual(["second"]);
    expect(secondResponse.pendingMessage?.clientPendingId).toBe("optimistic-second");
    expect(secondResponse.pendingMessages?.[0]?.clientPendingId).toBe("optimistic-second");
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
    expect(loadPersistedPendingChatItems(sessionId)).toEqual([]);
    expect(queueHandoffVisibility.length).toBeGreaterThan(0);
    expect(await Promise.all(queueHandoffVisibility)).not.toContain(false);
    unsubscribe();
  });

  test("queued follow-up can interrupt the active turn as steering", async () => {
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
    let firstRequestAborted = false;
    globalThis.fetch = (async (_url, init) => {
      const n = ++call;
      if (n === 1 && init?.signal instanceof AbortSignal) {
        init.signal.addEventListener("abort", () => {
          firstRequestAborted = true;
        });
      }
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
    const steeringStatuses: Array<{ status: string; detail?: string }> = [];
    const unsubscribe = onStatusStream((event) => {
      if (event.type === "status") {
        steeringStatuses.push({ status: event.status, detail: event.detail });
      }
    });

    const firstTurn = handleChat({
      message: "start",
      agentId: agent.id,
      sessionId,
      tools: false,
    });
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
    expect(steered.interruptedMessage?.role).toBe("assistant");
    expect(steered.interruptedMessage?.process_activities).toEqual([
      expect.objectContaining({
        phase: "result",
        text: "Conversation steered.",
        toolName: "__steering",
      }),
    ]);
    expect(listPendingChatMessages(sessionId)).toEqual([]);

    const materializedMessages = await waitForVisibleSessionMessages(sessionId, 3);
    expect(materializedMessages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
    expect(materializedMessages[1]?.content).toBe("");
    expect(materializedMessages[2]?.content).toBe("adjust course");

    const durableSession = await loadPersistedSession(sessionId);
    const durableMessages = (durableSession?.messages || []).filter(
      (message) => message.role !== "system"
    );
    expect(durableMessages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(durableMessages[2]?.content).toBe("adjust course");

    const firstResult = await firstTurn.finally(() => unsubscribe());
    expect(firstResult.interrupted).toBe(true);
    expect(firstRequestAborted).toBe(true);
    expect(
      steeringStatuses.some(
        (entry) => entry.status === "idle" && entry.detail === "Steering to follow-up..."
      )
    ).toBe(true);
    expect(
      steeringStatuses.some(
        (entry) => entry.status === "thinking" && entry.detail === "Steering to follow-up..."
      )
    ).toBe(true);
    const messages = await waitForVisibleSessionMessages(sessionId, 4);
    expect(messages[0]?.content).toBe("start");
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[1]?.content).toBe("");
    expect(messages[2]?.content).toBe("adjust course");
    expect(messages[3]?.role).toBe("assistant");
    expect(messages[3]?.content).toBe("steer-reply-2");
    const runEvents = listSessionEvents(sessionId);
    const runStarts = runEvents.filter((event) => event.type === "run_started");
    const firstRunCompletion = runEvents.find(
      (event) => event.type === "run_completed" && event.runId === runStarts[0]?.runId
    );
    expect(new Set(runStarts.map((event) => event.runId)).size).toBeGreaterThanOrEqual(2);
    expect(firstRunCompletion?.sequence).toBeLessThan(runStarts[1]?.sequence ?? 0);
  });

  test("steering during an aborted execution drains the materialized follow-up", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Tool Steering Provider",
      api_key: "sk-tool-steering",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Tool Steering Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-tool-steering",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);

    let seedCall = 0;
    globalThis.fetch = (async () => {
      seedCall += 1;
      return new Response(
        JSON.stringify({
          id: `tool-steer-seed-${seedCall}`,
          object: "chat.completion",
          model: "gpt-tool-steering",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: `tool-steer-seed-${seedCall}`,
              },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const sessionId = `tool-steering-${Date.now()}`;
    createdSessionIds.push(sessionId);
    await handleChat({
      message: "seed",
      agentId: agent.id,
      sessionId,
      tools: false,
    });

    const originalExecute = agentManager.execute.bind(agentManager);
    let executeCall = 0;
    let firstExecutionStarted!: () => void;
    const firstExecutionReady = new Promise<void>((resolve) => {
      firstExecutionStarted = resolve;
    });
    let consumedDuringAbort: Array<{ id: string; content: string; createdAt: number }> | undefined;
    let secondExecutionMessages: Array<{ role: string; content: string }> | undefined;

    agentManager.execute = (async (_agentId, _messages, options) => {
      executeCall += 1;
      if (executeCall === 1) {
        broadcastStatus({
          status: "tool_executing",
          timestamp: Date.now(),
          detail: "Running long command before steering",
          sessionId,
          agentId: agent.id,
          toolName: "exec",
          toolCallId: "steered-exec",
          toolPhase: "start",
        });
        firstExecutionStarted();
        await new Promise<void>((resolve) => {
          if (options?.abortSignal?.aborted) {
            resolve();
            return;
          }
          options?.abortSignal?.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        consumedDuringAbort = options?.consumeSteeringMessages?.() || [];
        broadcastStatus({
          status: "tool_completed",
          timestamp: Date.now(),
          detail: "Ran long command before steering",
          sessionId,
          agentId: agent.id,
          toolName: "exec",
          toolCallId: "steered-exec",
          toolPhase: "result",
        });
        throw (
          options?.abortSignal?.reason ||
          new DOMException("Chat turn interrupted by user steering", "AbortError")
        );
      }
      secondExecutionMessages = _messages.map((message) => ({
        role: message.role,
        content: message.content,
      }));
      return { content: `tool-steer-reply-${executeCall}` };
    }) as typeof agentManager.execute;

    try {
      const firstTurn = handleChat({
        message: "start long command",
        agentId: agent.id,
        sessionId,
        tools: true,
      });

      await firstExecutionReady;

      const queued = await handleChat({
        message: "steer after command",
        agentId: agent.id,
        sessionId,
        tools: true,
        queueMode: "queue",
      });
      expect(queued.queued).toBe(true);
      const pendingId = queued.pendingMessage?.id;
      expect(typeof pendingId).toBe("string");

      const steered = await steerPendingChatMessage(sessionId, pendingId!);
      expect(steered.success).toBe(true);
      expect(steered.pendingMessages).toEqual([]);

      const firstResult = await firstTurn;
      expect(firstResult.interrupted).toBe(true);
      expect(consumedDuringAbort).toEqual([]);

      const messages = await waitForVisibleSessionMessages(sessionId, 6);
      expect(
        secondExecutionMessages?.some(
          (message) =>
            message.role === "system" &&
            message.content.includes("previous assistant turn was interrupted by user steering")
        )
      ).toBe(true);
      expect(
        [
          ...((secondExecutionMessages || []) as Array<{
            role: string;
            content: string;
          }>),
        ]
          .reverse()
          .find((message) => message.role === "user")?.content
      ).toBe("steer after command");
      expect(messages.map((message) => message.role)).toEqual([
        "user",
        "assistant",
        "user",
        "assistant",
        "user",
        "assistant",
      ]);
      expect(messages[2]?.content).toBe("start long command");
      expect(messages[3]?.content).toBe("");
      expect(messages[3]?.process_activities?.map((activity) => activity.text)).toContain(
        "Ran long command before steering"
      );
      expect(messages[3]?.process_activities?.map((activity) => activity.text)).toContain(
        "Conversation steered."
      );
      expect(messages[3]?.process_activities?.map((activity) => activity.text)).not.toContain(
        "Steering to follow-up..."
      );
      expect(messages[3]?.process_activities?.map((activity) => activity.text)).not.toContain(
        "Starting queued follow-up"
      );
      expect(messages[4]?.content).toBe("steer after command");
      expect(messages[5]?.content).toBe("tool-steer-reply-2");
      expect(messages[5]?.process_activities?.map((activity) => activity.text)).not.toContain(
        "Ran long command before steering"
      );
      expect(listPendingChatMessages(sessionId)).toEqual([]);

      const durableSession = await loadPersistedSession(sessionId);
      const durableMessages = (durableSession?.messages || []).filter(
        (message) => message.role !== "system"
      );
      expect(durableMessages.map((message) => message.role)).toEqual([
        "user",
        "assistant",
        "user",
        "assistant",
        "user",
        "assistant",
      ]);
      expect(durableMessages[3]?.process_activities?.map((activity) => activity.text)).toContain(
        "Ran long command before steering"
      );
      expect(durableMessages[4]?.content).toBe("steer after command");
    } finally {
      agentManager.execute = originalExecute;
    }
  }, 15000);

  test("steering persists observed work before route remount can reload the session", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Observed Steering Provider",
      api_key: "sk-observed-steering",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Observed Steering Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-observed-steering",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);

    let call = 0;
    globalThis.fetch = (async (_url, init) => {
      const n = ++call;
      if (n === 1) {
        await new Promise<void>((resolve) => {
          if (init?.signal instanceof AbortSignal) {
            init.signal.addEventListener("abort", () => resolve(), {
              once: true,
            });
          }
          setTimeout(resolve, 120);
        });
      } else {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return new Response(
        JSON.stringify({
          id: `observed-steer-${n}`,
          object: "chat.completion",
          model: "gpt-observed-steering",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: `observed-reply-${n}` },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const sessionId = `observed-steering-${Date.now()}`;
    createdSessionIds.push(sessionId);
    const firstTurn = handleChat({
      message: "review this repo",
      agentId: agent.id,
      sessionId,
      tools: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const queued = await handleChat({
      message: "focus on cost too",
      agentId: agent.id,
      sessionId,
      tools: false,
      queueMode: "queue",
    });
    expect(queued.queued).toBe(true);
    const pendingId = queued.pendingMessage?.id;
    expect(typeof pendingId).toBe("string");

    const observedTimestamp = Date.now();
    const steered = await steerPendingChatMessage(sessionId, pendingId!, {
      processActivities: [
        {
          id: "observed-pre-steer-tool",
          phase: "result",
          text: "Ran repo inspection before steering",
          timestamp: observedTimestamp,
          toolName: "exec",
          toolCallId: "observed-tool",
        },
      ],
    });

    expect(steered.success).toBe(true);
    expect(
      steered.interruptedMessage?.process_activities?.map((activity) => activity.text)
    ).toEqual(["Ran repo inspection before steering", "Conversation steered."]);

    const remountedMessages = await waitForVisibleSessionMessages(sessionId, 3);
    expect(remountedMessages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(remountedMessages[1]?.content).toBe("");
    expect(remountedMessages[1]?.process_activities?.map((activity) => activity.text)).toEqual([
      "Ran repo inspection before steering",
      "Conversation steered.",
    ]);
    expect(remountedMessages[2]?.content).toBe("focus on cost too");

    const durableSession = await loadPersistedSession(sessionId);
    const durableMessages = (durableSession?.messages || []).filter(
      (message) => message.role !== "system"
    );
    expect(durableMessages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(durableMessages[1]?.process_activities?.map((activity) => activity.text)).toEqual([
      "Ran repo inspection before steering",
      "Conversation steered.",
    ]);

    await firstTurn;
    const messages = await waitForVisibleSessionMessages(sessionId, 4);
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(messages[1]?.process_activities?.map((activity) => activity.text)).toContain(
      "Ran repo inspection before steering"
    );
    expect(messages[2]?.content).toBe("focus on cost too");
    expect(messages[3]?.content).toBe("observed-reply-2");
  }, 15000);

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

    await handleChat({
      message: "first",
      agentId: agent.id,
      sessionId,
      tools: false,
    });
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
    expect(loadPersistedPendingChatItems(sessionId).map((item) => item.content)).toEqual([
      "second",
    ]);
    pendingChatQueues.delete(sessionId);
    expect(listPendingChatMessages(sessionId)).toEqual([]);
    expect(restorePersistedPendingChatQueues(false)).toBeGreaterThanOrEqual(1);
    expect(listPendingChatMessages(sessionId).map((message) => message.content)).toEqual([
      "second",
    ]);
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
    expect(loadPersistedPendingChatItems(sessionId)).toEqual([]);
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

  test("pending follow-ups can be edited or deleted before they drain", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Pending Mutation Provider",
      api_key: "sk-pending-mutation",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);

    const agent = agentManager.create({
      name: "Pending Mutation Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-pending-mutation",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);

    let call = 0;
    globalThis.fetch = (async () => {
      const n = ++call;
      await new Promise((resolve) => setTimeout(resolve, n === 1 ? 60 : 5));
      return new Response(
        JSON.stringify({
          id: `pending-mutation-resp-${n}`,
          object: "chat.completion",
          model: "gpt-pending-mutation",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: `mutation-reply-${n}` },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const sessionId = `pending-mutation-${Date.now()}`;
    createdSessionIds.push(sessionId);
    const firstTurn = handleChat({
      message: "first",
      agentId: agent.id,
      sessionId,
      tools: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await handleChat({
      message: "second original",
      agentId: agent.id,
      sessionId,
      tools: false,
      queueMode: "queue",
    });
    const third = await handleChat({
      message: "third deleted",
      agentId: agent.id,
      sessionId,
      tools: false,
      queueMode: "queue",
    });

    const secondId = second.pendingMessage?.id;
    const thirdId = third.pendingMessage?.id;
    expect(typeof secondId).toBe("string");
    expect(typeof thirdId).toBe("string");

    const updated = updatePendingChatMessage(sessionId, secondId!, "second edited");
    expect(updated.success).toBe(true);
    expect(updated.pendingMessages.map((message) => message.content)).toEqual([
      "second edited",
      "third deleted",
    ]);

    const deleted = deletePendingChatMessage(sessionId, thirdId!);
    expect(deleted.success).toBe(true);
    expect(deleted.pendingMessages.map((message) => message.content)).toEqual(["second edited"]);

    await firstTurn;
    const messages = await waitForVisibleSessionMessages(sessionId, 4);
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(messages[0]?.content).toBe("first");
    expect(messages[2]?.content).toBe("second edited");
    expect(messages.map((message) => message.content)).not.toContain("second original");
    expect(messages.map((message) => message.content)).not.toContain("third deleted");
    expect(listPendingChatMessages(sessionId)).toEqual([]);
  });
});
