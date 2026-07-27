import { describe, expect, test } from "bun:test";
import { buildChatExecutionMessagesForAgent } from "../../src/api/chat-execution-messages";
import type { ChatMessage } from "../../src/api/chat-types";
import { TOOL_RESULT_PROMPT_MAX_CHARS } from "../../src/core/chat-token-optimization";
import { toAnthropicHistory } from "../../src/core/llm/provider-history";

describe("chat execution tool history", () => {
  test("reconstructs persisted tool calls before their final assistant response", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Inspect the manifest." },
      {
        role: "assistant",
        content: "The package is Cybara 1.2.3.",
        tool_calls: [
          {
            id: "call_read",
            name: "read",
            args: { path: "package.json" },
            status: "completed",
            result: { name: "cybara", version: "1.2.3" },
          },
          {
            id: "call_git",
            name: "git",
            args: { command: "status" },
            status: "failed",
            error: "not a repository",
          },
        ],
      },
      { role: "user", content: "Continue." },
    ];

    expect(buildChatExecutionMessagesForAgent(messages)).toEqual([
      { role: "user", content: "Inspect the manifest." },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_read",
            name: "read",
            arguments: { path: "package.json" },
          },
          {
            id: "call_git",
            name: "git",
            arguments: { command: "status" },
          },
        ],
      },
      {
        role: "tool",
        content: '{"name":"cybara","version":"1.2.3"}',
        tool_call_id: "call_read",
      },
      {
        role: "tool",
        content: '{"error":"not a repository"}',
        tool_call_id: "call_git",
      },
      { role: "assistant", content: "The package is Cybara 1.2.3." },
      { role: "user", content: "Continue." },
    ]);
  });

  test("bounds historical tool results before sending them to another provider", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        content: "Done.",
        tool_calls: [
          {
            id: "call_large",
            name: "exec",
            args: { command: "print output" },
            status: "completed",
            result: "x".repeat(20_000),
          },
        ],
      },
    ];

    const execution = buildChatExecutionMessagesForAgent(messages);
    expect(execution[1]?.role).toBe("tool");
    expect(execution[1]?.content.length).toBeLessThan(TOOL_RESULT_PROMPT_MAX_CHARS + 360);
    expect(execution[1]?.content).toContain("truncated");
    expect(execution[2]).toEqual({ role: "assistant", content: "Done." });
  });

  test("preserves reconstructed tool history through provider serialization", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Read the package name." },
      {
        role: "assistant",
        content: "The package is Cybara.",
        tool_calls: [
          {
            id: "call_read",
            name: "read",
            args: { path: "package.json" },
            status: "completed",
            result: { name: "cybara" },
          },
        ],
      },
      { role: "user", content: "Continue." },
    ];

    const execution = buildChatExecutionMessagesForAgent(messages);
    expect(toAnthropicHistory(execution)).toEqual([
      { role: "user", content: [{ type: "text", text: "Read the package name." }] },
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_read",
            name: "read",
            input: { path: "package.json" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call_read",
            content: '{"name":"cybara"}',
          },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "The package is Cybara." }] },
      { role: "user", content: [{ type: "text", text: "Continue." }] },
    ]);
  });
});
