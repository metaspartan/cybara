import { describe, expect, test } from "bun:test";
import {
  applyAnthropicCacheControl,
  type AnthropicCacheRequest,
} from "../../src/core/prompt-cache";

function blockHasCacheControl(block: unknown): boolean {
  return JSON.stringify(block).includes("cache_control");
}

describe("applyAnthropicCacheControl", () => {
  test("disabled strategy returns the input unchanged", () => {
    const request: AnthropicCacheRequest = {
      system: "You are helpful.",
      messages: [{ role: "user", content: "hi" }],
    };
    const result = applyAnthropicCacheControl(request, { strategy: "disabled" });
    expect(result).toBe(request);
  });

  test("returns input unchanged when there are no messages", () => {
    const request: AnthropicCacheRequest = {
      system: "system",
      messages: [],
    };
    const result = applyAnthropicCacheControl(request);
    expect(result.messages).toEqual([]);
  });

  test("places a breakpoint on the system prompt and last message (system_and_last)", () => {
    const request: AnthropicCacheRequest = {
      system: "You are helpful.",
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "second" },
      ],
    };
    const result = applyAnthropicCacheControl(request, { strategy: "system_and_last" });

    // System becomes array form with cache_control on the last block.
    expect(Array.isArray(result.system)).toBe(true);
    const systemBlocks = result.system as Array<{ cache_control?: unknown }>;
    expect(blockHasCacheControl(systemBlocks[systemBlocks.length - 1])).toBe(true);

    // Only the final message should carry a breakpoint.
    const cached = result.messages.filter((m) => {
      const blocks = m.content as Array<{ cache_control?: unknown }>;
      return blocks.some((b) => b.cache_control);
    });
    expect(cached.length).toBe(1);
    const lastBlocks = cached[0].content as Array<{ text?: string }>;
    expect(JSON.stringify(lastBlocks)).toContain("second");
  });

  test("marks up to 3 trailing messages with system_and_3", () => {
    const request: AnthropicCacheRequest = {
      system: "system",
      messages: [
        { role: "user", content: "1" },
        { role: "assistant", content: "2" },
        { role: "user", content: "3" },
        { role: "assistant", content: "4" },
        { role: "user", content: "5" },
      ],
    };
    const result = applyAnthropicCacheControl(request, { strategy: "system_and_3" });
    const cached = result.messages.filter((m) => {
      const blocks = m.content as Array<{ cache_control?: unknown }>;
      return blocks.some((b) => b.cache_control);
    });
    // 3 trailing messages cached (5, 4, 3) + 1 system breakpoint = 4 total.
    expect(cached.length).toBe(3);
  });

  test("never exceeds the 4-breakpoint cap", () => {
    const request: AnthropicCacheRequest = {
      system: "system",
      messages: Array.from({ length: 8 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `msg ${i}`,
      })),
    };
    const result = applyAnthropicCacheControl(request, { strategy: "system_and_3" });
    let totalBreakpoints = 0;
    const systemBlocks = result.system as Array<{ cache_control?: unknown }> | undefined;
    if (Array.isArray(systemBlocks)) {
      totalBreakpoints += systemBlocks.filter((b) => b.cache_control).length;
    }
    for (const m of result.messages) {
      const blocks = m.content as Array<{ cache_control?: unknown }>;
      totalBreakpoints += blocks.filter((b) => b.cache_control).length;
    }
    expect(totalBreakpoints).toBeLessThanOrEqual(4);
  });

  test("does not stack a second breakpoint on an already-marked block", () => {
    const request: AnthropicCacheRequest = {
      system: [{ type: "text", text: "system", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "hi" }],
    };
    const result = applyAnthropicCacheControl(request);
    const systemBlocks = result.system as Array<{ cache_control?: unknown }>;
    // Still exactly one breakpoint on system, not two.
    expect(systemBlocks.filter((b) => b.cache_control).length).toBe(1);
  });

  test("respects a custom ttl", () => {
    const request: AnthropicCacheRequest = {
      system: "system",
      messages: [{ role: "user", content: "hi" }],
    };
    const result = applyAnthropicCacheControl(request, { ttl: "5m" });
    const systemBlocks = result.system as Array<{ cache_control?: { ttl?: string } }>;
    expect(systemBlocks[systemBlocks.length - 1].cache_control?.ttl).toBe("5m");
  });

  test("does not mutate the input request", () => {
    const request: AnthropicCacheRequest = {
      system: "system",
      messages: [{ role: "user", content: "hi" }],
    };
    const snapshot = JSON.stringify(request);
    applyAnthropicCacheControl(request);
    expect(JSON.stringify(request)).toBe(snapshot);
  });
});
