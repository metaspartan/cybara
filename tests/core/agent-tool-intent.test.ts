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
    expect(names).not.toContain("wallet");
    expect(names).not.toContain("browser");
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

  test("shell command requests do not advertise the code evaluator as a competing tool", () => {
    const names = namesFor("Use the exec tool to run exactly: printf cybara");
    expect(names).toContain("exec");
    expect(names).not.toContain("execute_code");
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
