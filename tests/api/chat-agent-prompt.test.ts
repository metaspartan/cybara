import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { activeAgentSystemPrompt } from "../../src/api/chat-agent-prompt";

const explicitToolAgent = {
  id: "agent-token-lean",
  name: "Token Lean",
  model: "MiniMax-M3",
  tools: [{ name: "read" }, { name: "browser" }],
  config: {},
  system_prompt: "",
};

describe("chat agent prompt tool mode", () => {
  test("uses a lean system prompt when a chat turn disables tools", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "cybara-chat-prompt-"));
    const prompt = await activeAgentSystemPrompt(
      explicitToolAgent,
      workspace,
      [{ role: "user", content: "Reply in one sentence." }],
      { useTools: false }
    );
    rmSync(workspace, { recursive: true, force: true });

    expect(prompt).toContain("No platform tools are enabled for this turn");
    expect(prompt).not.toContain("- read:");
    expect(prompt).not.toContain("### Browser Tool");
    expect(prompt.length).toBeLessThan(1200);
  });

  test("keeps explicit tool guidance when tools are enabled", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "cybara-chat-prompt-"));
    const prompt = await activeAgentSystemPrompt(explicitToolAgent, workspace, [
      { role: "user", content: "Inspect example.com." },
    ]);
    rmSync(workspace, { recursive: true, force: true });

    expect(prompt).toContain("- read:");
    expect(prompt).toContain("### Browser Tool");
  });

  test("loads workspace instructions into active chat prompts", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "cybara-chat-prompt-"));
    try {
      writeFileSync(join(workspace, "AGENTS.md"), "Use focused tests.", "utf8");
      const prompt = await activeAgentSystemPrompt(explicitToolAgent, workspace, [
        { role: "user", content: "Inspect the project." },
      ]);

      expect(prompt).toContain(`## ${join(workspace, "AGENTS.md")}`);
      expect(prompt).toContain("Use focused tests.");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
