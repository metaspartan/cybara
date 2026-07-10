import { describe, expect, test } from "bun:test";
import { buildSystemPrompt } from "../../src/core/system-prompt";

describe("system prompt identity", () => {
  test("never uses the agent's config name as the assistant identity", () => {
    const prompt = buildSystemPrompt({
      agentData: { name: "ZZUniqueAgentLabel" },
      modelDisplay: "MiniMax-M3",
      tools: ["read", "write"],
      workspaceDir: "/tmp",
    });
    // The agent name is an internal label; it must not become "You are <name>".
    expect(prompt).not.toContain("You are ZZUniqueAgentLabel");
  });

  test("defaults the identity to the Cybara brand", () => {
    const prompt = buildSystemPrompt({
      modelDisplay: "MiniMax-M3",
      tools: ["read"],
      workspaceDir: "/tmp",
    });
    expect(prompt).toContain("You are Cybara");
  });

  test("reflects the provided model in the prompt", () => {
    const prompt = buildSystemPrompt({
      modelDisplay: "MiniMax-M3",
      tools: ["read"],
      workspaceDir: "/tmp",
    });
    expect(prompt).toContain("MiniMax-M3");
  });

  test("prefers the session-bound embedded browser when browser tools are enabled", () => {
    const prompt = buildSystemPrompt({
      modelDisplay: "MiniMax-M3",
      tools: ["browser"],
      workspaceDir: "/tmp",
    });
    expect(prompt).toContain("Use the session-bound embedded browser");
    expect(prompt).toContain("Do not use openVisual, visual:true, or headless:false");
    expect(prompt).toContain("close it only when explicitly requested");
    expect(prompt).not.toContain("ALWAYS close the browser");
  });
});
