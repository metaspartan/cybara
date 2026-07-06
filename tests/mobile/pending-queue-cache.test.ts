import { describe, expect, test } from "bun:test";
import {
  clearCachedMobileOptimisticPendingMessages,
  mergeMobilePendingMessages,
  readCachedMobileOptimisticPendingMessages,
  writeCachedMobileOptimisticPendingMessages,
} from "../../apps/mobile/src/screens/dashboardPendingQueue";
import type { MobilePendingChatMessage } from "../../apps/mobile/src/lib/api";

function makeOptimistic(
  sessionId: string,
  suffix: string,
  content: string
): MobilePendingChatMessage & { updatedAt: number } {
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

describe("mobile optimistic pending queue cache", () => {
  test("round-trips optimistic markers across remount", () => {
    const sessionId = `mobile-pending-${Date.now()}`;
    const message = makeOptimistic(sessionId, "1", "follow-up before route change");

    writeCachedMobileOptimisticPendingMessages(sessionId, [message]);

    const restored = readCachedMobileOptimisticPendingMessages(sessionId);
    expect(restored).toHaveLength(1);
    expect(restored[0]?.id).toBe(message.id);
    expect(restored[0]?.content).toBe("follow-up before route change");

    clearCachedMobileOptimisticPendingMessages(sessionId);
    expect(readCachedMobileOptimisticPendingMessages(sessionId)).toHaveLength(0);
  });

  test("drops server-acknowledged entries when mirror is rewritten with no optimistics", () => {
    const sessionId = `mobile-pending-ack-${Date.now()}`;
    const optimistic = makeOptimistic(sessionId, "1", "queued before server caught up");
    writeCachedMobileOptimisticPendingMessages(sessionId, [optimistic]);
    expect(readCachedMobileOptimisticPendingMessages(sessionId)).toHaveLength(1);

    writeCachedMobileOptimisticPendingMessages(sessionId, []);
    expect(readCachedMobileOptimisticPendingMessages(sessionId)).toHaveLength(0);

    clearCachedMobileOptimisticPendingMessages(sessionId);
  });

  test("keeps optimistic markers scoped per session", () => {
    const sessionA = `mobile-pending-A-${Date.now()}`;
    const sessionB = `mobile-pending-B-${Date.now()}`;
    writeCachedMobileOptimisticPendingMessages(sessionA, [makeOptimistic(sessionA, "A", "for A")]);
    writeCachedMobileOptimisticPendingMessages(sessionB, [makeOptimistic(sessionB, "B", "for B")]);

    expect(readCachedMobileOptimisticPendingMessages(sessionA)).toHaveLength(1);
    expect(readCachedMobileOptimisticPendingMessages(sessionB)).toHaveLength(1);
    expect(readCachedMobileOptimisticPendingMessages(sessionA)[0]?.sessionId).toBe(sessionA);
    expect(readCachedMobileOptimisticPendingMessages(sessionB)[0]?.sessionId).toBe(sessionB);

    clearCachedMobileOptimisticPendingMessages(sessionA);
    clearCachedMobileOptimisticPendingMessages(sessionB);
  });

  test("authoritative empty gateway queues can clear optimistic remount rows", () => {
    const sessionId = `mobile-pending-authoritative-${Date.now()}`;
    const optimistic = makeOptimistic(sessionId, "1", "stale after steering");

    expect(mergeMobilePendingMessages([], [optimistic], { preserveOptimistic: true })).toEqual([
      optimistic,
    ]);
    expect(mergeMobilePendingMessages([], [optimistic], { preserveOptimistic: false })).toEqual([]);
  });

  test("server pending rows replace acknowledged optimistic rows", () => {
    const sessionId = `mobile-pending-ack-merge-${Date.now()}`;
    const optimistic = makeOptimistic(sessionId, "1", "follow-up");
    const remote: MobilePendingChatMessage = {
      ...optimistic,
      id: "pending-1",
      clientPendingId: optimistic.id,
      sequence: 2,
    };

    expect(mergeMobilePendingMessages([remote], [optimistic])).toEqual([remote]);
  });
});
