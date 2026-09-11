import { describe, expect, test } from "bun:test";
import {
  CybaraMobileApi,
  type MobileMessageImage,
  type MobilePendingChatMessage,
  type SessionMessageSummary,
} from "../../../apps/mobile/src/lib/api";
import { recoverMobileChatSubmission } from "../../../apps/mobile/src/lib/chat-send-recovery";

function createComposerHarness(initialDraft = "") {
  let draft = initialDraft;
  let writes = 0;
  const images: MobileMessageImage[] = [];
  const restores: Array<() => void> = [];
  return {
    draft: () => draft,
    writes: () => writes,
    images,
    restores,
    type: (value: string) => {
      draft = value;
    },
    actions: {
      offerRestore: (restore: () => void) => {
        restores.push(restore);
      },
      restoreText: (value: string) => {
        writes++;
        draft = [draft, value].filter(Boolean).join("\n\n");
      },
      restoreImages: (attachments: MobileMessageImage[]) => {
        images.push(...attachments);
      },
    },
  };
}

function createGateway(
  options: {
    messages?: SessionMessageSummary[];
    pendingMessages?: MobilePendingChatMessage[];
    sessionUnavailable?: boolean;
    pendingUnavailable?: boolean;
  } = {}
) {
  return {
    session: async () => {
      if (options.sessionUnavailable) throw new Error("Offline");
      return { id: "s1", title: null, messages: options.messages ?? [] };
    },
    pendingChatMessages: async () => {
      if (options.pendingUnavailable) throw new Error("Offline");
      return { sessionId: "s1", pendingMessages: options.pendingMessages ?? [] };
    },
  };
}

const submission = {
  sessionId: "s1",
  message: "Explain this in detail",
  images: [],
  previousMessageIds: ["old-prompt"],
  clientPendingId: null,
};

describe("mobile chat send recovery", () => {
  test("a lost response after gateway acceptance keeps the composer empty", async () => {
    const messages: SessionMessageSummary[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/api/chat" && request.method === "POST") {
          const body: unknown = await request.json();
          if (typeof body !== "object" || body === null || !("message" in body)) {
            return new Response(null, { status: 400 });
          }
          messages.push({ id: "received-prompt", role: "user", content: String(body.message) });
          return new Response("Interrupted response", { status: 502 });
        }
        if (path === "/api/sessions/s1") return Response.json({ id: "s1", messages });
        if (path === "/api/chat/sessions/s1/pending") {
          return Response.json({ sessionId: "s1", pendingMessages: [] });
        }
        return new Response(null, { status: 404 });
      },
    });
    try {
      const api = new CybaraMobileApi({
        id: "test",
        name: "Test gateway",
        baseUrl: server.url.origin,
        apiKey: "test-key",
        createdAt: "2026-09-11T00:00:00.000Z",
      });
      const composer = createComposerHarness();
      await expect(
        api.sendChat({ sessionId: submission.sessionId, message: submission.message })
      ).rejects.toThrow("502");
      await recoverMobileChatSubmission(api, submission, composer.actions);
      expect(messages).toHaveLength(1);
      expect(composer.draft()).toBe("");
      expect(composer.writes()).toBe(0);
      expect(composer.restores).toHaveLength(0);
    } finally {
      await server.stop(true);
    }
  });

  test("an unavailable gateway never restores a sent prompt automatically", async () => {
    const composer = createComposerHarness();
    await recoverMobileChatSubmission(
      createGateway({ sessionUnavailable: true, pendingUnavailable: true }),
      submission,
      composer.actions
    );
    expect(composer.draft()).toBe("");
    expect(composer.writes()).toBe(0);
    expect(composer.restores).toHaveLength(1);
  });

  test("late errors preserve the next prompt and its attachments", async () => {
    const composer = createComposerHarness("My next question");
    composer.images.push({ data: "new-image", mimeType: "image/png" });
    await recoverMobileChatSubmission(
      createGateway(),
      { ...submission, images: [{ data: "old-image", mimeType: "image/png" }] },
      composer.actions
    );
    expect(composer.draft()).toBe("My next question");
    expect(composer.images).toEqual([{ data: "new-image", mimeType: "image/png" }]);
    expect(composer.writes()).toBe(0);
  });

  test("explicit restoration preserves text typed after the recovery offer", async () => {
    const composer = createComposerHarness();
    const images = [{ data: "old-image", mimeType: "image/png" }];
    await recoverMobileChatSubmission(createGateway(), { ...submission, images }, composer.actions);
    composer.type("New draft");
    composer.restores[0]?.();
    expect(composer.draft()).toBe(`New draft\n\n${submission.message}`);
    expect(composer.images).toEqual(images);
    expect(composer.writes()).toBe(1);
  });

  test("image-only prompts can be restored explicitly without adding blank lines", async () => {
    const composer = createComposerHarness();
    const images = [{ data: "image", mimeType: "image/png" }];
    await recoverMobileChatSubmission(
      createGateway(),
      { ...submission, message: "", images },
      composer.actions
    );
    expect(composer.images).toEqual([]);
    composer.restores[0]?.();
    expect(composer.draft()).toBe("");
    expect(composer.images).toEqual(images);
  });

  test("a confirmed queue receipt prevents restoring a queued prompt", async () => {
    const composer = createComposerHarness("New draft");
    await recoverMobileChatSubmission(
      createGateway({
        sessionUnavailable: true,
        pendingMessages: [
          {
            id: "pending-1",
            sessionId: "s1",
            clientPendingId: "client-1",
            content: submission.message,
            createdAt: 1,
            updatedAt: 1,
            mode: "queued",
            sequence: 1,
          },
        ],
      }),
      { ...submission, clientPendingId: "client-1" },
      composer.actions
    );
    expect(composer.draft()).toBe("New draft");
    expect(composer.restores).toHaveLength(0);
  });

  test.each([
    { id: "old-prompt", role: "user", content: submission.message },
    { id: "reply", role: "assistant", content: submission.message },
    { id: "other-prompt", role: "user", content: "Something else" },
  ])("older or unrelated messages are not delivery receipts", async (message) => {
    const composer = createComposerHarness();
    await recoverMobileChatSubmission(
      createGateway({ messages: [message] }),
      submission,
      composer.actions
    );
    expect(composer.restores).toHaveLength(1);
    expect(composer.writes()).toBe(0);
  });

  test("a confirmed transcript receipt works when the queue endpoint is unavailable", async () => {
    const composer = createComposerHarness();
    const images = [{ data: "photo", mimeType: "image/png" }];
    await recoverMobileChatSubmission(
      createGateway({
        pendingUnavailable: true,
        messages: [{ id: "received", role: "user", content: submission.message, images }],
      }),
      { ...submission, images },
      composer.actions
    );
    expect(composer.restores).toHaveLength(0);
    expect(composer.writes()).toBe(0);
  });
});
