import { describe, expect, test } from "bun:test";
import {
  pendingChatDrainRetryDelay,
  selectResidentChatSessionEvictions,
  type ResidentChatSessionRecord,
} from "../../src/api/chat-runtime-stability";

function record(
  id: string,
  options: Partial<Omit<ResidentChatSessionRecord, "id">> = {}
): ResidentChatSessionRecord {
  return {
    id,
    persisted: true,
    estimatedChars: 100,
    lastAccessedAt: 0,
    protected: false,
    ...options,
  };
}

describe("chat runtime stability", () => {
  test("backs off pending drains while a turn or external status is active", () => {
    expect(pendingChatDrainRetryDelay(true, false)).toBe(100);
    expect(pendingChatDrainRetryDelay(true, true)).toBe(100);
    expect(pendingChatDrainRetryDelay(false, true)).toBe(500);
    expect(pendingChatDrainRetryDelay(false, false)).toBeNull();
  });

  test("evicts least recently used persisted sessions to meet count limits", () => {
    const evictions = selectResidentChatSessionEvictions(
      [
        record("oldest", { lastAccessedAt: 1 }),
        record("middle", { lastAccessedAt: 2 }),
        record("newest", { lastAccessedAt: 3 }),
      ],
      { maxSessions: 2, maxEstimatedChars: 10_000 }
    );

    expect(evictions).toEqual(["oldest"]);
  });

  test("keeps active and unsaved sessions while enforcing the memory budget", () => {
    const evictions = selectResidentChatSessionEvictions(
      [
        record("active", { estimatedChars: 500, lastAccessedAt: 1, protected: true }),
        record("unsaved", {
          estimatedChars: 500,
          lastAccessedAt: 2,
          persisted: false,
        }),
        record("idle-old", { estimatedChars: 500, lastAccessedAt: 3 }),
        record("idle-new", { estimatedChars: 500, lastAccessedAt: 4 }),
      ],
      { maxSessions: 2, maxEstimatedChars: 1_000 }
    );

    expect(evictions).toEqual(["idle-old", "idle-new"]);
  });
});
