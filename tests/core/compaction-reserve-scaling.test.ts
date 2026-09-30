import { describe, expect, test } from "bun:test";
import {
  compactContext,
  isContextSummaryMessage,
  shouldCompactContext,
} from "../../src/core/session-context";
import type { ChatMessage } from "../../src/api/chat-types";

function turn(index: number, words: number): ChatMessage {
  return {
    role: index % 2 === 0 ? "user" : "assistant",
    content: Array.from({ length: words }, (_, word) => `word${word}`).join(" "),
  };
}

describe("compaction reserve scales with the context window", () => {
  test("a small window does not permanently demand compaction", () => {
    const messages = Array.from({ length: 10 }, (_, index) => turn(index, 40));
    const first = shouldCompactContext(messages, undefined, undefined, 4_000);
    const summary: ChatMessage = {
      role: "system",
      content: "[Context Summary: concise checkpoint of the earlier discussion]",
    };
    const afterFirstCompaction = [...messages.slice(-4), summary];
    const second = shouldCompactContext(afterFirstCompaction, undefined, undefined, 4_000);

    expect(first.maxTokens).toBe(4_000);
    expect(second.needed).toBe(false);
  });

  test("a large window still compacts once low headroom is reached", () => {
    const messages = Array.from({ length: 40 }, (_, index) => turn(index, 6_000));
    const check = shouldCompactContext(messages, undefined, undefined, 200_000);
    expect(check.needed).toBe(true);
  });

  test("a large window with a small conversation does not compact", () => {
    const messages = Array.from({ length: 6 }, (_, index) => turn(index, 100));
    const check = shouldCompactContext(messages, undefined, undefined, 200_000);
    expect(check.needed).toBe(false);
  });

  test("a summary plus a small window stops asking for compaction once it fits", () => {
    const summary: ChatMessage = {
      role: "system",
      content: "[Context Summary: prior state]",
    };
    const check = shouldCompactContext(
      [...Array.from({ length: 6 }, (_, i) => turn(i, 10)), summary],
      undefined,
      undefined,
      4_000
    );
    expect(check.needed).toBe(false);
  });

  test("genuine overflow still compacts even when already compacted", () => {
    const summary: ChatMessage = {
      role: "system",
      content: "[Context Summary: prior state]",
    };
    const overflow = Array.from({ length: 400 }, (_, index) => turn(index, 200));
    const check = shouldCompactContext([...overflow, summary], undefined, undefined, 4_000);
    expect(check.needed).toBe(true);
  });
});

describe("compaction converges instead of re-summarizing forever", () => {
  async function simulate(window: number, turns: number) {
    const messages: ChatMessage[] = [];
    let compactions = 0;
    const percentages: number[] = [];
    for (let index = 0; index < turns; index += 1) {
      messages.push({ role: "user", content: `Turn ${index}: `.padEnd(6000, "detail ") });
      messages.push({ role: "assistant", content: `Answer ${index}: `.padEnd(6000, "response ") });
      const check = shouldCompactContext(messages, undefined, undefined, window);
      if (check.needed) {
        const result = await compactContext(messages, undefined, undefined, {
          contextWindowTokens: window,
        });
        if (result.wasCompacted) {
          messages.length = 0;
          messages.push(...result.messages);
          compactions += 1;
        }
      }
      const after = shouldCompactContext(messages, undefined, undefined, window);
      percentages.push(Math.round((after.currentTokens / window) * 100));
    }
    return { compactions, percentages, messages };
  }

  test("a small window compacts once then oscillates instead of re-summarizing every turn", async () => {
    const result = await simulate(32_000, 14);
    expect(result.compactions).toBeLessThanOrEqual(2);
    expect(Math.max(...result.percentages)).toBeLessThan(100);
  });

  test("a tiny window converges to a bounded context rather than growing without limit", async () => {
    const result = await simulate(4_000, 14);
    const tail = result.percentages.slice(-6);
    expect(Math.max(...tail)).toBeLessThan(100);
    expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(20);
  });

  test("a roomy window never compacts", async () => {
    const result = await simulate(200_000, 14);
    expect(result.compactions).toBe(0);
  });

  test("repeated compaction never nests prior checkpoints", async () => {
    const result = await simulate(4_000, 14);
    const nested = result.messages.filter(
      (message) =>
        isContextSummaryMessage(message) &&
        message.content.includes("Prior checkpoint:\nPrior checkpoint:")
    );
    expect(nested).toHaveLength(0);
  });
});
