import { afterEach, describe, expect, test } from "bun:test";
import { deleteSession, handleChat } from "../../src/api/chat";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";
import { broadcastStatus } from "../../src/core/status";
import { waitForVisibleSessionMessages } from "./chat-session-test-helpers";

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

describe("chat interruption persistence", () => {
  test("external abort preserves in-progress activities as an interrupted assistant turn", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "External Abort Provider",
      api_key: "sk-external-abort",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "External Abort Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-external-abort",
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
          () => reject(new DOMException("client disconnected", "AbortError")),
          { once: true }
        );
      })) as typeof fetch;

    const sessionId = `external-abort-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    const controller = new AbortController();
    const activeTurn = handleChat({
      message: "inspect the workspace",
      agentId: agent.id,
      sessionId,
      tools: false,
      abortSignal: controller.signal,
    });
    await providerStarted;

    broadcastStatus({
      status: "tool_executing",
      timestamp: Date.now(),
      detail: "Reading workspace",
      sessionId,
      agentId: agent.id,
      toolName: "read",
      toolCallId: "read-interrupted",
      toolPhase: "start",
    });
    controller.abort(new DOMException("client disconnected", "AbortError"));
    const response = await activeTurn;

    expect(response.interrupted).toBe(true);
    expect(response.stopped).toBeUndefined();
    expect(response.message.interrupted).toBe(true);
    expect(response.message.tool_calls).toEqual([
      expect.objectContaining({
        id: "read-interrupted",
        status: "failed",
        error: "Interrupted: Reading workspace",
      }),
    ]);
    const messages = await waitForVisibleSessionMessages(sessionId, 2);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[1]?.interrupted).toBe(true);
    expect(messages[1]?.process_activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "blocked",
          text: "Interrupted: Reading workspace",
          toolCallId: "read-interrupted",
        }),
      ])
    );
  });
});
