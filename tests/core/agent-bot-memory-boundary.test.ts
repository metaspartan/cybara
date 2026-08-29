import { describe, expect, test } from "bun:test";
import { shouldInjectAutomaticMemoryRecall } from "../../src/core/agent";

describe("bot automatic memory boundaries", () => {
  test("keeps global automatic recall out of persistent bot conversations", () => {
    expect(
      shouldInjectAutomaticMemoryRecall({
        memory_enabled: true,
        config: { bot_mode: { title: "Release coordinator" } },
      })
    ).toBe(false);
  });

  test("retains automatic recall for ordinary memory-enabled agents", () => {
    expect(
      shouldInjectAutomaticMemoryRecall({
        memory_enabled: true,
        config: { tool_profile: "full" },
      })
    ).toBe(true);
    expect(
      shouldInjectAutomaticMemoryRecall({
        memory_enabled: false,
        config: { tool_profile: "full" },
      })
    ).toBe(false);
  });
});
