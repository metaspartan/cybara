import { describe, expect, test } from "bun:test";
import {
  clearCachedOptimisticPendingMessages,
  isOptimisticPendingMessageId,
  readCachedOptimisticPendingMessages,
  writeCachedOptimisticPendingMessages,
} from "../../ui/src/pages/chat/pendingQueueCache";
import { mergePendingChatMessages } from "../../ui/src/pages/chat/pendingQueueState";
import type { PendingChatMessage } from "../../ui/src/lib/status-stream";

function makeOptimistic(
  sessionId: string,
  suffix: string,
  content: string
): PendingChatMessage & { updatedAt: number } {
  const now = Date.now();
  return {
    id: `optimistic-${suffix}`,
    sessionId,
    content,
    createdAt: now,
    updatedAt: now,
    mode: "queued",
    sequence: 1,
  };
}

describe("web optimistic pending queue cache", () => {
  test("round-trips optimistic markers across route changes", () => {
    const sessionId = `web-pending-${Date.now()}`;
    const message = makeOptimistic(sessionId, "1", "follow-up before route change");

    writeCachedOptimisticPendingMessages(sessionId, [message]);

    const restored = readCachedOptimisticPendingMessages(sessionId);
    expect(restored).toHaveLength(1);
    expect(restored[0]?.id).toBe(message.id);
    expect(restored[0]?.content).toBe("follow-up before route change");

    clearCachedOptimisticPendingMessages(sessionId);
    expect(readCachedOptimisticPendingMessages(sessionId)).toHaveLength(0);
  });

  test("forgets optimistic markers once server snapshot replaces them", () => {
    const sessionId = `web-pending-ack-${Date.now()}`;
    const optimistic = makeOptimistic(sessionId, "1", "queued before server caught up");
    writeCachedOptimisticPendingMessages(sessionId, [optimistic]);
    expect(readCachedOptimisticPendingMessages(sessionId)).toHaveLength(1);

    writeCachedOptimisticPendingMessages(sessionId, []);
    expect(readCachedOptimisticPendingMessages(sessionId)).toHaveLength(0);

    clearCachedOptimisticPendingMessages(sessionId);
  });

  test("does not leak server-side markers into the optimistic cache", () => {
    const sessionId = `web-pending-serveronly-${Date.now()}`;
    const now = Date.now();
    writeCachedOptimisticPendingMessages(sessionId, [
      {
        ...makeOptimistic(sessionId, "1", "client"),
        id: "server-1",
        createdAt: now,
        updatedAt: now,
        mode: "queued",
        sequence: 1,
        sessionId,
      } as unknown as PendingChatMessage & { updatedAt: number },
    ]);

    expect(readCachedOptimisticPendingMessages(sessionId)).toHaveLength(0);

    clearCachedOptimisticPendingMessages(sessionId);
  });

  test("keeps optimistic markers scoped per session", () => {
    const sessionA = `web-pending-A-${Date.now()}`;
    const sessionB = `web-pending-B-${Date.now()}`;
    writeCachedOptimisticPendingMessages(sessionA, [makeOptimistic(sessionA, "A", "for A")]);
    writeCachedOptimisticPendingMessages(sessionB, [makeOptimistic(sessionB, "B", "for B")]);

    expect(readCachedOptimisticPendingMessages(sessionA)).toHaveLength(1);
    expect(readCachedOptimisticPendingMessages(sessionB)).toHaveLength(1);
    expect(readCachedOptimisticPendingMessages(sessionA)[0]?.sessionId).toBe(sessionA);
    expect(readCachedOptimisticPendingMessages(sessionB)[0]?.sessionId).toBe(sessionB);

    clearCachedOptimisticPendingMessages(sessionA);
    clearCachedOptimisticPendingMessages(sessionB);
  });

  test("recognises optimistic id prefix", () => {
    expect(isOptimisticPendingMessageId("optimistic-1")).toBe(true);
    expect(isOptimisticPendingMessageId("server-1")).toBe(false);
    expect(isOptimisticPendingMessageId(null)).toBe(false);
  });

  test("server clientPendingId replaces matching optimistic queue marker after remount", () => {
    const sessionId = `web-pending-client-id-${Date.now()}`;
    const optimistic = makeOptimistic(sessionId, "client-1", "queued before route change");
    const server: PendingChatMessage = {
      id: "pending-server-1",
      sessionId,
      clientPendingId: optimistic.id,
      content: "queued before route change edited on server",
      createdAt: optimistic.createdAt + 5,
      updatedAt: optimistic.updatedAt + 10,
      mode: "queued",
      sequence: 1,
    };

    const merged = mergePendingChatMessages([server], [optimistic]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("pending-server-1");
    expect(merged[0]?.content).toBe("queued before route change edited on server");
  });
});
