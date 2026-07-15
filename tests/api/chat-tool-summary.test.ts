import { describe, expect, test } from "bun:test";
import {
  buildToolExecutionFallbackMessage,
  classifyToolCallResult,
  requiredDirectToolForMessage,
  shouldEnforceToolUseForMessage,
  shouldPreferArtifactsForMessage,
  suppressRecoveredWebFailureActivities,
} from "../../src/api/chat-tool-summary";

describe("chat tool summary utilities", () => {
  test("classifies recoverable tool errors as failed calls", () => {
    expect(classifyToolCallResult({ output: "ok" })).toEqual({
      status: "completed",
    });
    expect(classifyToolCallResult({ error: "Text not found in file" })).toEqual({
      status: "failed",
      error: "Text not found in file",
    });
  });

  test("builds concise fallback message from tool results", () => {
    const message = buildToolExecutionFallbackMessage([
      { name: "exec", result: { output: "updated 3 files successfully" } },
      {
        name: "read",
        result: { path: "/tmp/a.ts", content: "line1\nline2\nline3" },
      },
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

  test("binds explicit desktop actions to computer use without forcing capability questions", () => {
    expect(
      requiredDirectToolForMessage(
        "Move the computer-use cursor, capture the desktop, and report the frontmost app"
      )
    ).toBe("computer_use");
    expect(requiredDirectToolForMessage("Take a screenshot of my screen")).toBe("computer_use");
    expect(requiredDirectToolForMessage("What is computer use?")).toBeUndefined();
    expect(requiredDirectToolForMessage("Explain desktop automation security")).toBeUndefined();
  });

  test("binds explicit command execution to exec without forcing explanations", () => {
    expect(
      requiredDirectToolForMessage(
        "Run exec exactly once with command sleep 30; printf CROSS_SESSION_TOOL_DONE"
      )
    ).toBe("exec");
    expect(requiredDirectToolForMessage("Execute the terminal command bun test")).toBe("exec");
    expect(requiredDirectToolForMessage("What is the exec tool?")).toBeUndefined();
    expect(requiredDirectToolForMessage("Explain how a shell command works")).toBeUndefined();
  });

  test("binds explicit outbound channel messages without forcing channel explanations", () => {
    expect(requiredDirectToolForMessage("Send a message to Carsen in Discord and say hello")).toBe(
      "message"
    );
    expect(requiredDirectToolForMessage("Post in #cybara and say hi to everyone")).toBe("message");
    expect(requiredDirectToolForMessage("Send this to @cybara_updates on Telegram")).toBe(
      "message"
    );
    expect(requiredDirectToolForMessage("Publish this in the Slack channel")).toBe("message");
    expect(requiredDirectToolForMessage("How does a Discord channel work?")).toBeUndefined();
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

  test("hides recovered web failures from the main timeline", () => {
    const activities = [
      { phase: "error", toolName: "web_fetch", text: "Fetch failed" },
      { phase: "result", toolName: "web_fetch", text: "Fetched source" },
      { phase: "error", toolName: "exec", text: "Command failed" },
    ];
    const filtered = suppressRecoveredWebFailureActivities(activities, [
      { name: "web_fetch", result: { error: "HTTP 404" } },
      { name: "web_fetch", result: { content: "Primary source text" } },
    ]);

    expect(filtered).toEqual([
      { phase: "result", toolName: "web_fetch", text: "Fetched source" },
      { phase: "error", toolName: "exec", text: "Command failed" },
    ]);
  });

  test("keeps web failures visible when no source succeeded", () => {
    const activities = [{ phase: "error", toolName: "web_search", text: "Search failed" }];
    expect(
      suppressRecoveredWebFailureActivities(activities, [
        { name: "web_search", result: { count: 0, results: [] } },
        { name: "web_fetch", result: { error: "HTTP 404" } },
      ])
    ).toEqual(activities);
  });
});
