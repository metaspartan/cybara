import { afterEach, describe, expect, test } from "bun:test";
import {
  deleteSession,
  getPendingChatMessageDetail,
  getSessionMessages,
  handleChat,
  listPendingChatMessages,
  steerPendingChatMessage,
  updatePendingChatMessage,
} from "../../src/api/chat";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";

const RED_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const BLUE_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const createdSessionIds: string[] = [];
const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];
let call = 0;
let holdTurn = false;
let releaseTurn: (() => void) | null = null;

function installProvider(): void {
  const provider = providerManager.create({
    provider: "openai",
    name: `Pending Image Provider ${Date.now()}`,
    api_key: "sk-pending-images",
    base_url: "https://api.openai.com/v1",
  });
  createdProviderIds.push(provider.id);
  const agent = agentManager.create({
    name: `Pending Image Agent ${Date.now()}`,
    type: "main",
    provider_id: provider.id,
    model: "gpt-pending-images",
    memory_enabled: false,
  });
  createdAgentIds.push(agent.id);

  globalThis.fetch = (async () => {
    call += 1;
    if (holdTurn) {
      const gate = Promise.withResolvers<void>();
      releaseTurn = gate.resolve;
      await gate.promise;
    }
    return Response.json({
      id: `pending-image-${call}`,
      object: "chat.completion",
      model: "gpt-pending-images",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content: `reply-${call}` },
        },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    });
  }) as unknown as typeof fetch;
}

async function beginHeldTurn(sessionId: string): Promise<void> {
  holdTurn = true;
  void handleChat({ sessionId, message: "start working", agentId: createdAgentIds[0] });
  for (let attempt = 0; attempt < 200 && !releaseTurn; attempt += 1) await Bun.sleep(5);
  if (!releaseTurn) throw new Error("Opening turn never reached the provider");
}

function endHeldTurn(): void {
  holdTurn = false;
  releaseTurn?.();
  releaseTurn = null;
}

async function queueFollowUp(
  sessionId: string,
  content: string,
  images?: Array<{ data: string; mimeType: string }>
): Promise<string> {
  const before = listPendingChatMessages(sessionId).length;
  void handleChat({ sessionId, message: content, agentId: createdAgentIds[0], images });
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const pending = listPendingChatMessages(sessionId);
    if (pending.length > before) return pending[pending.length - 1].id;
    await Bun.sleep(5);
  }
  throw new Error("Follow-up never entered the queue");
}

async function withSession(prefix: string): Promise<string> {
  installProvider();
  const sessionId = `${prefix}-${Date.now()}-${Math.floor(performance.now())}`;
  createdSessionIds.push(sessionId);
  await beginHeldTurn(sessionId);
  return sessionId;
}

afterEach(async () => {
  endHeldTurn();
  for (const sessionId of createdSessionIds.splice(0)) {
    try {
      await deleteSession(sessionId);
    } catch {
      continue;
    }
  }
  for (const id of createdAgentIds.splice(0)) agentManager.delete(id);
  for (const id of createdProviderIds.splice(0)) providerManager.delete(id);
});

describe("pending follow-up image attachments", () => {
  test("queue keeps images and reports the attachment count", async () => {
    const sessionId = await withSession("pending-images-queue");

    const pendingId = await queueFollowUp(sessionId, "describe this", [
      { data: RED_PIXEL, mimeType: "image/png" },
      { data: BLUE_PIXEL, mimeType: "image/png" },
    ]);

    const [snapshot] = listPendingChatMessages(sessionId);
    expect(snapshot?.imageCount).toBe(2);

    const detail = getPendingChatMessageDetail(sessionId, pendingId);
    expect(detail.success).toBe(true);
    expect(detail.success && detail.images).toHaveLength(2);
  });

  test("text-only edit preserves existing attachments", async () => {
    const sessionId = await withSession("pending-images-text");

    const pendingId = await queueFollowUp(sessionId, "first", [
      { data: RED_PIXEL, mimeType: "image/png" },
    ]);

    const updated = await updatePendingChatMessage(sessionId, pendingId, "second");
    expect(updated.success).toBe(true);
    expect(updated.success && updated.pendingMessage.imageCount).toBe(1);

    const detail = getPendingChatMessageDetail(sessionId, pendingId);
    expect(detail.success && detail.images).toHaveLength(1);
  });

  test("edit can attach, replace and clear images", async () => {
    const sessionId = await withSession("pending-images-edit");

    const pendingId = await queueFollowUp(sessionId, "start");

    const attached = await updatePendingChatMessage(sessionId, pendingId, "with image", [
      { data: RED_PIXEL, mimeType: "image/png" },
    ]);
    expect(attached.success && attached.pendingMessage.imageCount).toBe(1);

    const replaced = await updatePendingChatMessage(sessionId, pendingId, "two images", [
      { data: RED_PIXEL, mimeType: "image/png" },
      { data: BLUE_PIXEL, mimeType: "image/png" },
    ]);
    expect(replaced.success && replaced.pendingMessage.imageCount).toBe(2);

    const cleared = await updatePendingChatMessage(sessionId, pendingId, "no images", []);
    expect(cleared.success && cleared.pendingMessage.imageCount).toBe(0);
    expect(getPendingChatMessageDetail(sessionId, pendingId)).toMatchObject({
      success: true,
      images: [],
    });
  });

  test("edit rejects bad payloads instead of silently clearing attachments", async () => {
    const sessionId = await withSession("pending-images-invalid");

    const pendingId = await queueFollowUp(sessionId, "start");
    await updatePendingChatMessage(sessionId, pendingId, "attached", [
      { data: RED_PIXEL, mimeType: "image/png" },
    ]);

    const notAnArray = await updatePendingChatMessage(sessionId, pendingId, "x", {
      data: RED_PIXEL,
    });
    expect(notAnArray).toMatchObject({ success: false, error: expect.any(String) });

    const allUnusable = await updatePendingChatMessage(sessionId, pendingId, "y", [
      { url: "javascript:alert(1)" },
      null,
      42,
    ]);
    expect(allUnusable).toMatchObject({ success: false, error: expect.any(String) });

    const mixed = await updatePendingChatMessage(sessionId, pendingId, "z", [
      { url: "javascript:alert(1)" },
      { data: BLUE_PIXEL, mimeType: "image/png" },
    ]);
    expect(mixed.success && mixed.pendingMessage.imageCount).toBe(1);

    const detail = getPendingChatMessageDetail(sessionId, pendingId);
    expect(detail.success && detail.images).toHaveLength(1);
  });

  test("steering keeps images through the response and the materialized turn", async () => {
    const sessionId = await withSession("pending-images-steer");

    const pendingId = await queueFollowUp(sessionId, "look at this", [
      { data: RED_PIXEL, mimeType: "image/png" },
      { data: BLUE_PIXEL, mimeType: "image/png" },
    ]);

    const steered = await steerPendingChatMessage(sessionId, pendingId);
    expect(steered.success).toBe(true);
    expect(steered.success && steered.message.images).toHaveLength(2);
    expect(steered.success && steered.pendingMessages[0]?.imageCount).toBe(2);

    endHeldTurn();
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const messages = await getSessionMessages(sessionId);
      const user = messages.filter((message) => message.role === "user");
      const followUp = user.find((message) => message.images && message.images.length > 0);
      if (followUp) {
        expect(followUp.images).toHaveLength(2);
        return;
      }
      await Bun.sleep(10);
    }
    throw new Error("Steered message never arrived with its images");
  });
});
