import { describe, expect, test } from "bun:test";
import { buildSystemPrompt } from "../../src/core/system-prompt";
import { executeTool } from "../../src/core/tools/handlers/index";

describe("system prompt reliability guidance", () => {
  const prompt = buildSystemPrompt({
    modelDisplay: "test-model",
    tools: ["read", "write", "exec", "web_search"],
    workspaceDir: "/tmp",
  });

  test("includes grounding + verification guidance", () => {
    expect(prompt).toContain("Grounding & Accuracy");
    expect(prompt).toContain("Never answer these from memory");
    expect(prompt).toContain("Before finalizing");
  });

  test("includes act-now (no promises) rule", () => {
    expect(prompt).toContain("Act, don't promise");
  });

  test("includes parallel tool-call guidance", () => {
    expect(prompt).toContain("Parallel tool calls");
  });
});

describe("required-argument validation in executeTool", () => {
  test("rejects a call missing a required argument with a self-correct hint", async () => {
    await expect(executeTool("read", {})).rejects.toThrow(/Missing required argument.*path/i);
  });

  test("rejects a required argument that is an empty string", async () => {
    await expect(executeTool("read", { path: "   " })).rejects.toThrow(/Missing required argument/i);
  });
});
