import { describe, expect, test } from "bun:test";
import {
  hasAssistantAfterLatestUser,
  loadPersistedCompletion,
} from "../../ui/src/lib/chatCompletion";

describe("chat completion refresh", () => {
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
});
