import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "fs";
import {
  buildMemoryFlushMessages,
  compactChatContentForPrompt,
  compactMessagesForPrompt,
  formatToolResultPromptBlock,
  TOOL_RESULT_FINAL_PROMPT_MAX_CHARS,
  TOOL_RESULT_PROMPT_MAX_CHARS,
} from "../../src/core/chat-token-optimization";
import { buildChatExecutionMessagesForAgent, type ChatMessage } from "../../src/api/chat";

describe("chat token optimization", () => {
  test("caps string tool results before model-facing summary prompts", () => {
    const output = "line\n".repeat(10_000);
    const block = formatToolResultPromptBlock("exec", output, {
      sessionId: "test-session-token-optimization",
      toolCallId: "call-1",
    });
    expect(block).toContain("Tool: exec");
    expect(block).toContain("[truncated: omitted ");
    expect(block).toContain("Full output saved to:");
    expect(block.length).toBeLessThan(TOOL_RESULT_PROMPT_MAX_CHARS + 360);
    const savedPath = block.match(/Full output saved to: (.+)/)?.[1]?.trim();
    expect(savedPath).toBeTruthy();
    expect(existsSync(savedPath!)).toBe(true);
    expect(readFileSync(savedPath!, "utf8")).toBe(output);
    rmSync(savedPath!, { force: true });

    const finalBlock = formatToolResultPromptBlock("exec", output, {
      maxChars: TOOL_RESULT_FINAL_PROMPT_MAX_CHARS,
      sessionId: "test-session-token-optimization",
      toolCallId: "call-2",
    });
    expect(finalBlock.length).toBeLessThan(TOOL_RESULT_FINAL_PROMPT_MAX_CHARS + 360);
    const finalSavedPath = finalBlock.match(/Full output saved to: (.+)/)?.[1]?.trim();
    if (finalSavedPath) rmSync(finalSavedPath, { force: true });
  });

  test("compacts historical tool output dumps without changing normal assistant text", () => {
    const dump = `Here are the results from the tool execution:

Tool: file_search
Result: ${JSON.stringify({ files: Array.from({ length: 5000 }, (_, index) => `src/${index}.ts`) })}`;
    const compacted = compactChatContentForPrompt({ role: "assistant", content: dump });
    expect(compacted).toContain("Previous tool output omitted");
    expect(compacted).toContain("file_search");
    expect(compacted.length).toBeLessThan(240);

    const normal = "Here is the review you asked for. ".repeat(200);
    expect(compactChatContentForPrompt({ role: "assistant", content: normal })).toBe(normal);
  });

  test("builds execution and memory flush prompts from compacted history", () => {
    const hugeToolDump = `Here are the results from the tool execution:

Tool: grep
Result: ${"match\\n".repeat(20_000)}`;
    const messages: ChatMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "search repo" },
      { role: "assistant", content: hugeToolDump },
      { role: "user", content: "continue" },
    ];

    const executionMessages = buildChatExecutionMessagesForAgent(messages);
    expect(executionMessages[2]?.content).toContain("Previous tool output omitted");
    expect(executionMessages[2]?.content.length).toBeLessThan(240);

    const flushMessages = buildMemoryFlushMessages(messages, "flush memories");
    expect(flushMessages[2]?.content).toContain("Previous tool output omitted");
    expect(flushMessages.at(-1)).toEqual({ role: "user", content: "flush memories" });

    const compacted = compactMessagesForPrompt(messages);
    expect(compacted[2]?.content).toBe(executionMessages[2]?.content);
  });
});
