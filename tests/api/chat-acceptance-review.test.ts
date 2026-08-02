import { describe, expect, test } from "bun:test";
import type { AgentExecutionResult, AgentMessage } from "../../src/core/agent";
import type { AgentToolCallResult } from "../../src/core/agent-internals";
import {
  reviewAssistantAcceptance,
  shouldRunAcceptanceReview,
} from "../../src/api/chat-acceptance-review";

const originalMessages: AgentMessage[] = [
  { role: "system", content: "Work carefully." },
  {
    role: "user",
    content: "Build the requested project and test the edge cases.",
  },
];

const completedTools: AgentToolCallResult[] = [
  { name: "read", result: { content: "source" } },
  { name: "apply_patch", result: { success: true } },
  { name: "exec", result: { exitCode: 0, output: "tests passed" } },
];

function candidate(overrides: Partial<Parameters<typeof shouldRunAcceptanceReview>[0]> = {}) {
  return {
    responseContent: "Implemented the project and verified the tests pass.",
    toolResults: completedTools,
    toolsEnabled: true,
    userMessage: "Build the requested project and test the edge cases.",
    ...overrides,
  };
}

describe("chat acceptance review", () => {
  test("reviews completed mutation-heavy work", () => {
    expect(shouldRunAcceptanceReview(candidate())).toBe(true);
  });

  test("skips plans, read-only work, and small edits", () => {
    expect(shouldRunAcceptanceReview(candidate({ allowPlanOnly: true }))).toBe(false);
    expect(
      shouldRunAcceptanceReview(
        candidate({
          toolResults: [
            { name: "read", result: { content: "a" } },
            { name: "read", result: { content: "b" } },
            { name: "exec", result: { exitCode: 0 } },
          ],
        })
      )
    ).toBe(false);
    expect(
      shouldRunAcceptanceReview(
        candidate({
          toolResults: [
            { name: "apply_patch", result: { success: true } },
            { name: "exec", result: { exitCode: 0 } },
          ],
        })
      )
    ).toBe(false);
  });

  test("skips blocked and non-actionable responses", () => {
    expect(
      shouldRunAcceptanceReview(candidate({ responseContent: "I am blocked and need your input." }))
    ).toBe(false);
    expect(shouldRunAcceptanceReview(candidate({ userMessage: "What is a semaphore?" }))).toBe(
      false
    );
  });

  test("adopts a tool-backed review and combines tool history", async () => {
    const calls: Array<{
      messages: AgentMessage[];
      options: Record<string, unknown>;
    }> = [];
    const execute = async (
      _agentId: string,
      messages: AgentMessage[],
      options: Record<string, unknown>
    ): Promise<AgentExecutionResult> => {
      calls.push({ messages, options });
      return {
        content: "Corrected the boundary condition and all checks pass.",
        tool_calls: [
          { name: "exec", result: { exitCode: 1 } },
          { name: "apply_patch", result: { success: true } },
          { name: "exec", result: { exitCode: 0 } },
        ],
      };
    };

    const reviewed = await reviewAssistantAcceptance({
      ...candidate(),
      agentId: "agent-1",
      execute,
      executeOptions: { maxToolCalls: 100 },
      executionMessages: originalMessages,
    });

    expect(reviewed.reviewed).toBe(true);
    expect(reviewed.responseContent).toContain("Corrected the boundary condition");
    expect(reviewed.toolResults).toHaveLength(6);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options).toMatchObject({
      maxToolCalls: 24,
      requireToolUse: true,
      useTools: true,
    });
    expect(calls[0]?.messages.at(-1)?.content).toContain("Original request:");
  });

  test("keeps the original response when review has no successful evidence", async () => {
    const reviewed = await reviewAssistantAcceptance({
      ...candidate(),
      agentId: "agent-1",
      execute: async (): Promise<AgentExecutionResult> => ({
        content: "Looks good.",
        tool_calls: [{ name: "exec", result: { exitCode: 1 } }],
      }),
      executeOptions: {},
      executionMessages: originalMessages,
    });

    expect(reviewed.reviewed).toBe(false);
    expect(reviewed.responseContent).toBe(candidate().responseContent);
    expect(reviewed.toolResults).toEqual(completedTools);
  });

  test("keeps the original response when review execution fails", async () => {
    const reviewed = await reviewAssistantAcceptance({
      ...candidate(),
      agentId: "agent-1",
      execute: async (): Promise<AgentExecutionResult> => {
        throw new Error("provider unavailable");
      },
      executeOptions: {},
      executionMessages: originalMessages,
    });

    expect(reviewed.reviewed).toBe(false);
    expect(reviewed.responseContent).toBe(candidate().responseContent);
  });
});
