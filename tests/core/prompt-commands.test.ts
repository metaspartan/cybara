import { describe, expect, test } from "bun:test";
import { expandPromptCommand, listPromptCommands } from "../../src/core/prompt-commands";

describe("expandPromptCommand", () => {
  test("expands /learn with a URL into a standards-guided skill prompt", () => {
    const expanded = expandPromptCommand("/learn https://docs.example.com/api/quickstart");
    expect(expanded).not.toBeNull();
    expect(expanded).toContain("LEARN a new reusable skill");
    expect(expanded).toContain("https://docs.example.com/api/quickstart");
    expect(expanded).toContain("web_fetch");
    expect(expanded).toContain("skill_save");
    expect(expanded).toContain("## When to Use");
  });

  test("expands bare /learn using recent conversation context", () => {
    const expanded = expandPromptCommand("/learn");
    expect(expanded).toContain("recent conversation");
  });

  test("leaves non-command messages untouched", () => {
    expect(expandPromptCommand("how do I learn typescript?")).toBeNull();
    expect(expandPromptCommand("path is /usr/local/bin")).toBeNull();
    expect(expandPromptCommand("/unknowncmd do a thing")).toBeNull();
  });

  test("matches only a leading command token", () => {
    expect(expandPromptCommand("please /learn this")).toBeNull();
  });

  test("lists supported commands", () => {
    const commands = listPromptCommands();
    expect(commands).toContain("learn");
    expect(commands).toContain("plan");
    expect(commands).toContain("review");
    expect(commands).toContain("security");
    expect(commands).toContain("test");
    expect(commands).toContain("summarize");
  });

  test("/review targets uncommitted changes by default and accepts a target", () => {
    expect(expandPromptCommand("/review")).toContain("uncommitted changes");
    expect(expandPromptCommand("/review src/core/agent.ts")).toContain("src/core/agent.ts");
  });

  test("/security loads the authorized scanner workflow and accepts a target", () => {
    const current = expandPromptCommand("/security");
    const scoped = expandPromptCommand("/security src/api");
    expect(current).toContain("Target: the current workspace");
    expect(current).toContain("security_scan with action=scan");
    expect(current).toContain("@security-scan");
    expect(current).toContain("supports cancellation");
    expect(current).toContain("action=validate");
    expect(scoped).toContain("Target: src/api");
  });

  test("/plan asks for a plan before acting", () => {
    const expanded = expandPromptCommand("/plan add rate limiting");
    expect(expanded).toContain("Plan before acting");
    expect(expanded).toContain("add rate limiting");
  });

  test("/test and /summarize expand to guided prompts", () => {
    expect(expandPromptCommand("/test")).toContain("Run the project's tests");
    expect(expandPromptCommand("/summarize")).toContain("Summarize");
  });
});
