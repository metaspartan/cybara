import { afterEach, describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";
import {
  deleteSession,
  handleChat,
  getSessionMessages,
  listPendingChatMessages,
  deletePendingChatMessage,
  reorderPendingChatMessages,
  sendToSession,
  steerPendingChatMessage,
  stopActiveChatTurn,
  updatePendingChatMessage,
  updateSessionAgent,
} from "../../src/api/chat";
import { broadcastStatus, onStatusStream } from "../../src/core/status";
import { config } from "../../src/core/config";
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
  globalThis.fetch = originalFetch;
  for (const sessionId of createdSessionIds.splice(0)) await deleteSession(sessionId);
  for (const agentId of createdAgentIds.splice(0)) agentManager.delete(agentId);
  for (const providerId of createdProviderIds.splice(0)) providerManager.delete(providerId);
});

describe("handleChat per-session serialization", () => {
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

    expect(stopActiveChatTurn(sessionId).stopped).toBe(true);
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

      expect(stopActiveChatTurn(sessionId).stopped).toBe(true);
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

    expect(stopActiveChatTurn(sessionId)).toEqual({
      success: true,
      stopped: true,
      sessionId,
    });
    const response = await activeTurn;

    expect(response.stopped).toBe(true);
    expect(response.interrupted).toBe(true);
    expect(providerAborted).toBe(true);
    const messages = await waitForVisibleSessionMessages(sessionId, 1);
    expect(messages.map((message) => message.content)).toEqual(["start a long response"]);
    expect(messages.some((message) => message.content.includes("late response"))).toBe(false);
    expect(stopActiveChatTurn(sessionId).stopped).toBe(false);
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
      return new Response(
        JSON.stringify({
          id: "estimated-usage",
          object: "chat.completion",
          model: "gpt-estimated-usage",
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
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
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
    expect(response.tokenUsage.tokensPerSecond).toBeGreaterThan(0);

    const updated = await updateSessionAgent(sessionId, agent.id);
    expect(updated.tokenUsage?.inputTokens).toBeGreaterThan(0);
    expect(updated.tokenUsage?.outputTokens).toBeGreaterThan(0);
    expect(updated.tokenUsage?.tokensPerSecond).toBeGreaterThan(0);
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
    const unsubscribe = onStatusStream((event) => {
      if (event.type === "status" && typeof event.detail === "string") {
        statusDetails.push(event.detail);
      }
    });

    const [firstResponse, secondResponse] = await Promise.all([
      handleChat({
        message: "first",
        agentId: agent.id,
        sessionId,
        tools: false,
      }),
      handleChat({
        message: "second",
        agentId: agent.id,
        sessionId,
        clientPendingId: "optimistic-second",
        tools: false,
      }),
    ]).finally(() => unsubscribe());

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
    expect(steered.interruptedMessage?.process_activities).toEqual([]);
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
    ).toBe(false);
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
    ).toEqual(["Ran repo inspection before steering"]);

    const remountedMessages = await waitForVisibleSessionMessages(sessionId, 3);
    expect(remountedMessages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(remountedMessages[1]?.content).toBe("");
    expect(remountedMessages[1]?.process_activities?.map((activity) => activity.text)).toEqual([
      "Ran repo inspection before steering",
    ]);
    expect(remountedMessages[2]?.content).toBe("focus on cost too");

    const durableSession = await loadPersistedSession(sessionId);
    const durableMessages = (durableSession?.messages || []).filter(
      (message) => message.role !== "system"
    );
    expect(durableMessages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(durableMessages[1]?.process_activities?.map((activity) => activity.text)).toEqual([
      "Ran repo inspection before steering",
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
