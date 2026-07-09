import { describe, expect, test } from "bun:test";
import { activeAgentSystemPrompt } from "../../src/api/chat-agent-prompt";

const explicitToolAgent = {
  id: "agent-token-lean",
  name: "Token Lean",
  model: "MiniMax-M3",
  tools: [{ name: "read" }, { name: "wallet" }],
  config: {},
  system_prompt: "",
};

describe("chat agent prompt tool mode", () => {
  test("uses a lean system prompt when a chat turn disables tools", async () => {
    const prompt = await activeAgentSystemPrompt(
      explicitToolAgent,
      "/Users/carsen/Documents/GitHub/cybara",
      [{ role: "user", content: "Reply in one sentence." }],
      { useTools: false }
    );

    expect(prompt).toContain("No platform tools are enabled for this turn");
    expect(prompt).not.toContain("- read:");
    expect(prompt).not.toContain("### Wallet Tool");
    expect(prompt.length).toBeLessThan(1200);
  });

  test("keeps explicit tool guidance when tools are enabled", async () => {
    const prompt = await activeAgentSystemPrompt(
      explicitToolAgent,
      "/Users/carsen/Documents/GitHub/cybara",
      [{ role: "user", content: "Check wallet status." }]
    );

    expect(prompt).toContain("- read:");
    expect(prompt).toContain("### Wallet Tool");
  });
});
