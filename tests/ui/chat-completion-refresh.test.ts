import { describe, expect, test } from "bun:test";
import {
  hasAssistantAfterLatestUser,
  loadLatestTranscript,
  loadPersistedCompletion,
  loadPersistedPendingTurns,
} from "../../ui/src/lib/chatCompletion";

describe("chat completion refresh", () => {
  test("loads a newly persisted user turn without waiting for an assistant response", async () => {
    const snapshot = { messagesList: [{ role: "user" }] };
    let calls = 0;
    const result = await loadLatestTranscript(async () => {
      calls += 1;
      return snapshot;
    });

    expect(result).toEqual(snapshot);
    expect(calls).toBe(1);
  });

  test("requires an assistant turn after the latest user message", () => {
    expect(hasAssistantAfterLatestUser([{ role: "user" }])).toBe(false);
    expect(
      hasAssistantAfterLatestUser([{ role: "user" }, { role: "assistant" }, { role: "user" }])
    ).toBe(false);
    expect(hasAssistantAfterLatestUser([{ role: "user" }, { role: "assistant" }])).toBe(true);
  });

  test("retries stale snapshots until the completed turn is persisted", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const result = await loadPersistedCompletion(
      async () => {
        calls += 1;
        return calls < 3
          ? { messagesList: [{ role: "user" }] }
          : { messagesList: [{ role: "user" }, { role: "assistant" }] };
      },
      {
        delaysMs: [0, 10, 20],
        sleep: async (delayMs) => {
          sleeps.push(delayMs);
        },
      }
    );

    expect(calls).toBe(3);
    expect(sleeps).toEqual([10, 20]);
    expect(result?.messagesList?.at(-1)?.role).toBe("assistant");
  });

  test("returns null when persistence never exposes the final assistant turn", async () => {
    const result = await loadPersistedCompletion(
      async () => ({ messagesList: [{ role: "user" }] }),
      { delaysMs: [0, 0], sleep: async () => {} }
    );

    expect(result).toBeNull();
  });

  test("retries transient session load failures", async () => {
    let calls = 0;
    const result = await loadPersistedCompletion(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("temporary load failure");
        return { messagesList: [{ role: "user" }, { role: "assistant" }] };
      },
      { delaysMs: [0, 0, 0], sleep: async () => {} }
    );

    expect(calls).toBe(3);
    expect(result?.messagesList?.at(-1)?.role).toBe("assistant");
  });

  test("loads a queued user turn before its assistant response exists", async () => {
    let calls = 0;
    const result = await loadPersistedPendingTurns(
      async () => {
        calls += 1;
        return calls < 2
          ? { messagesList: [{ role: "assistant" }] }
          : {
              messagesList: [
                { role: "assistant" },
                { role: "user", pending_chat_id: "pending-queued-turn" },
              ],
            };
      },
      ["pending-queued-turn"],
      { delaysMs: [0, 0], sleep: async () => {} }
    );

    expect(calls).toBe(2);
    expect(result?.messagesList?.at(-1)).toEqual({
      role: "user",
      pending_chat_id: "pending-queued-turn",
    });
  });

  test("does not accept a stale transcript containing a different queued turn", async () => {
    const result = await loadPersistedPendingTurns(
      async () => ({
        messagesList: [{ role: "user", pending_chat_id: "different-pending-turn" }],
      }),
      ["pending-queued-turn"],
      { delaysMs: [0, 0], sleep: async () => {} }
    );

    expect(result).toBeNull();
  });
});
