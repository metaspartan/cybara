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
    expect(listPromptCommands()).toContain("learn");
  });
});
