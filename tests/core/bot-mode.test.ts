import { describe, expect, test } from "bun:test";
import { botSessionId, isBotSessionId } from "../../shared/bot-mode";

describe("bot mode session identity", () => {
  test("round trips an agent id through its canonical session", () => {
    const sessionId = botSessionId("agent/one");
    expect(sessionId).toBe("bot:agent/one");
    expect(isBotSessionId(sessionId)).toBe(true);
  });

  test("rejects empty and regular session identities", () => {
    expect(() => botSessionId("  ")).toThrow("Agent id is required");
    expect(isBotSessionId("bot:")).toBe(false);
    expect(isBotSessionId("chat-one")).toBe(false);
  });
});
