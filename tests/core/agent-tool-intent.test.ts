import { describe, expect, test } from "bun:test";
import {
  selectBuiltinToolNamesForIntent,
  selectBuiltinToolsForIntent,
} from "../../src/core/agent-tool-intent";
import { estimateTokens } from "../../src/core/session-context";
import { getToolSchemasForLLM } from "../../src/core/tools/index";

function namesFor(content: string): string[] {
  return [...selectBuiltinToolNamesForIntent([{ role: "user", content }])].sort();
}

describe("implicit builtin tool intent selection", () => {
  test("does not advertise platform tools for simple chat", () => {
    expect(namesFor("hello, how are you?")).toEqual([]);
  });

  test("selects coding tools for repository review requests", () => {
    const names = namesFor("review this repo and fix the TypeScript tests");
    expect(names).toEqual(expect.arrayContaining(["read", "grep", "exec", "git", "todo"]));
    expect(names).toEqual(expect.arrayContaining(["write", "edit", "apply_patch"]));
    expect(names).not.toContain("wallet");
    expect(names).not.toContain("browser");
  });

  test("selects file mutation tools for natural app-building requests", () => {
    for (const prompt of [
      "Can you make me a small webpage for tracking reading goals in this folder?",
      "Build a todo app in this workspace",
      "Develop a small project in this directory",
      "Scaffold a website here in the workspace",
    ]) {
      const names = namesFor(prompt);
      expect(names).toEqual(
        expect.arrayContaining(["read", "write", "edit", "apply_patch", "exec"])
      );
    }
  });

  test("keeps explanatory app-building questions read-only", () => {
    const names = namesFor("How would I build an app in this workspace?");
    expect(names).toContain("read");
    expect(names).not.toContain("write");
    expect(names).not.toContain("edit");
    expect(names).not.toContain("apply_patch");
  });

  test("keeps read-only repository prompts lean", () => {
    const names = namesFor("use tools to read package.json and review repo token usage");
    expect(names).toEqual(expect.arrayContaining(["read", "grep", "exec", "git", "todo"]));
    expect(names).not.toContain("write");
    expect(names).not.toContain("edit");
    expect(names).not.toContain("apply_patch");
    expect(names).not.toContain("weather");
    expect(names).not.toContain("clipboard");
  });

  test("selects browser tools for current web lookup requests", () => {
    const names = namesFor("search the latest docs and fetch the GitHub page");
    expect(names).toEqual(expect.arrayContaining(["web_search", "web_fetch", "browser"]));
    expect(names).not.toContain("wallet");
  });

  test("selects computer-use aliases only for desktop automation", () => {
    const names = namesFor("take a screenshot of my desktop and click the Chrome window");
    expect(names).toEqual(expect.arrayContaining(["computer_use", "screenshot", "click"]));
    expect(names).not.toContain("wallet");
  });

  test("selects subagent tools for plural subagent delegation requests", () => {
    const names = namesFor("Use subagents in parallel to review the mobile chat and report back");
    expect(names).toEqual(
      expect.arrayContaining([
        "sessions_spawn",
        "sessions_wait",
        "sessions_list",
        "sessions_history",
        "todo",
      ])
    );
  });

  test("shell command requests do not advertise the code evaluator as a competing tool", () => {
    const names = namesFor("Use the exec tool to run exactly: printf cybara");
    expect(names).toContain("exec");
    expect(names).not.toContain("execute_code");
  });

  test("token accounting prompts do not advertise wallet tools", () => {
    const names = namesFor(
      "review the repo token usage, input tokens, output tokens, and context metrics"
    );
    expect(names).toEqual(expect.arrayContaining(["read", "grep", "exec"]));
    expect(names).not.toContain("write");
    expect(names).not.toContain("wallet");
  });

  test("crypto token actions still advertise wallet tools", () => {
    expect(namesFor("show my wallet balance and token prices")).toContain("wallet");
    expect(namesFor("send 1 USDC token on Solana")).toContain("wallet");
    expect(namesFor("get a Jupiter quote to swap tokens")).toContain("wallet");
  });

  test("cuts default tool schema payload by an order of magnitude for simple chat", () => {
    const allTools = getToolSchemasForLLM();
    const selected = selectBuiltinToolsForIntent(allTools, [{ role: "user", content: "hello" }]);
    const allTokens = estimateTokens(JSON.stringify(allTools));
    const selectedTokens = estimateTokens(JSON.stringify(selected));
    expect(selected).toHaveLength(0);
    expect(allTokens).toBeGreaterThan(10_000);
    expect(selectedTokens).toBeLessThan(allTokens / 20);
  });
});
