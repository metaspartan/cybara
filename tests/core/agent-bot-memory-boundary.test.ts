import { describe, expect, test } from "bun:test";
import { shouldInjectAutomaticMemoryRecall } from "../../src/core/agent";
import { isBotProfileConfig, withBotProfileMetadata } from "../../src/core/bot-profile";

describe("bot automatic memory boundaries", () => {
  test("requires typed bot profile metadata instead of object truthiness", () => {
    expect(isBotProfileConfig({ bot_mode: {} })).toBe(false);
    expect(isBotProfileConfig({ bot_mode: { unexpected: true } })).toBe(false);
    expect(isBotProfileConfig({ bot_mode: { title: null, hidden: "false" } })).toBe(false);
    expect(isBotProfileConfig({ bot_mode: { title: "Release coordinator" } })).toBe(true);
    expect(isBotProfileConfig(withBotProfileMetadata({}, {}))).toBe(true);
  });

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
        config: { bot_mode: {} },
      })
    ).toBe(true);
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
