import { describe, expect, test } from "bun:test";
import {
  ACTION_AUTHORIZATION_INSTRUCTION,
  resolveActionAuthorizationInstruction,
} from "../../src/core/llm/action-authorization";
import { buildChatExecutionMessagesForAgent } from "../../src/api/chat-execution-messages";

describe("action authorization instruction", () => {
  test("fires for the frontier session's explicit go-ahead message", () => {
    const message =
      "Yea continue on pushing the frontier on the r9700 qwen3.8-27b track please kernel work and spec decode please get submissions in etc.";
    expect(resolveActionAuthorizationInstruction(message)).toBe(ACTION_AUTHORIZATION_INSTRUCTION);
  });

  test("fires for the other long session's continue message", () => {
    expect(
      resolveActionAuthorizationInstruction(
        "continue on anything else and focus on improvements now"
      )
    ).toBe(ACTION_AUTHORIZATION_INSTRUCTION);
  });

  test("fires for plain directives", () => {
    expect(resolveActionAuthorizationInstruction("go ahead and implement the fix")).toBe(
      ACTION_AUTHORIZATION_INSTRUCTION
    );
    expect(resolveActionAuthorizationInstruction("please fix the CI")).toBe(
      ACTION_AUTHORIZATION_INSTRUCTION
    );
    expect(resolveActionAuthorizationInstruction("ok make it happen")).toBe(
      ACTION_AUTHORIZATION_INSTRUCTION
    );
  });

  test("does not fire for discussion questions", () => {
    expect(
      resolveActionAuthorizationInstruction("What do you think about the current design?")
    ).toBeNull();
    expect(resolveActionAuthorizationInstruction("Should I switch agents?")).toBeNull();
    expect(resolveActionAuthorizationInstruction("Why is the build slow?")).toBeNull();
  });

  test("does not fire for goal iteration prompts", () => {
    expect(
      resolveActionAuthorizationInstruction(
        "[autonomous goal iteration 2] Continue working toward the active goal"
      )
    ).toBeNull();
  });

  test("does not fire for neutral chat", () => {
    expect(resolveActionAuthorizationInstruction("hello")).toBeNull();
    expect(resolveActionAuthorizationInstruction("")).toBeNull();
  });
});

describe("execution message injection", () => {
  test("injects the authorization instruction after the system prompt", () => {
    const messages = [
      { role: "system", content: "You are Cybara." },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "Yea continue on pushing the frontier and get submissions in" },
    ];
    const built = buildChatExecutionMessagesForAgent(messages, {
      sessionId: "auth-test",
      supportsImages: false,
      activeAgentId: "agent-1",
    });
    expect(built[0].role).toBe("system");
    expect(built.some((message) => message.content === ACTION_AUTHORIZATION_INSTRUCTION)).toBe(
      true
    );
  });

  test("does not inject for a plain question", () => {
    const messages = [
      { role: "system", content: "You are Cybara." },
      { role: "user", content: "What do you think about the plan?" },
    ];
    const built = buildChatExecutionMessagesForAgent(messages, {
      sessionId: "auth-test-2",
      supportsImages: false,
      activeAgentId: "agent-1",
    });
    expect(built.some((message) => message.content === ACTION_AUTHORIZATION_INSTRUCTION)).toBe(
      false
    );
  });
});
