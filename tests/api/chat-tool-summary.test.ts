import { describe, expect, test } from "bun:test";
import {
  buildToolExecutionFallbackMessage,
  shouldEnforceToolUseForMessage,
  shouldPreferArtifactsForMessage,
} from "../../src/api/chat-tool-summary";

describe("chat tool summary utilities", () => {
  test("builds concise fallback message from tool results", () => {
    const message = buildToolExecutionFallbackMessage([
      { name: "exec", result: { output: "updated 3 files successfully" } },
      { name: "read", result: { path: "/tmp/a.ts", content: "line1\nline2\nline3" } },
    ]);

    expect(message).toContain("Completed 2 tool calls:");
    expect(message).toContain("- `exec`:");
    expect(message).toContain("- `read`: Read /tmp/a.ts (3 lines)");
    expect(message).not.toContain("Tool: exec");
  });

  test("marks actionable engineering prompts for forced tool retry", () => {
    expect(
      shouldEnforceToolUseForMessage("continue fixing tests in this repo and update the files")
    ).toBe(true);
    expect(shouldEnforceToolUseForMessage("scan the project and run lint to fix issues")).toBe(
      true
    );
    expect(
      shouldEnforceToolUseForMessage(
        "Can you make me a small webpage for tracking reading goals in this folder?"
      )
    ).toBe(true);
    expect(shouldEnforceToolUseForMessage("Build a todo app in this workspace")).toBe(true);
  });

  test("does not force tools for greetings or capability questions", () => {
    expect(shouldEnforceToolUseForMessage("hello what can you do")).toBe(false);
    expect(shouldEnforceToolUseForMessage("thanks")).toBe(false);
    expect(shouldEnforceToolUseForMessage("How would I build an app in this workspace?")).toBe(
      false
    );
  });

  test("detects artifact-focused prompts for artifact-preferred tool execution", () => {
    expect(
      shouldPreferArtifactsForMessage("audit this codebase and create an artifact report when done")
    ).toBe(true);
    expect(
      shouldPreferArtifactsForMessage(
        "make an implementation.md.resolved and walkthrough.md.resolved"
      )
    ).toBe(true);
    expect(shouldPreferArtifactsForMessage("hello what can you do")).toBe(false);
  });
});
