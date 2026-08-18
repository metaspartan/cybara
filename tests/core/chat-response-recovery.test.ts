import { afterEach, describe, expect, test } from "bun:test";
import { agentManager } from "../../src/core/agent";
import { recoverAssistantResponse } from "../../src/api/chat-response-recovery";

const originalExecute = agentManager.execute;
let executeCallCount = 0;

afterEach(() => {
  agentManager.execute = originalExecute;
  executeCallCount = 0;
});

function stubExecute(content: string) {
  executeCallCount = 0;
  const stub: typeof agentManager.execute = async () => {
    executeCallCount += 1;
    return {
      content,
      thinking: undefined,
      tool_calls: [],
      provider: undefined,
      provider_id: undefined,
      provider_name: undefined,
      model: undefined,
      failure: undefined,
    };
  };
  agentManager.execute = stub;
}

const substantiveClaim =
  "I've implemented the full migration and verified the importer end to end. The schema now " +
  "matches the fixture, the regression suite is green, and this covers everything requested in " +
  "the current pass, so the remaining items are tracked for the next round.";

const establishedExecutionMessages = [
  { role: "system", content: "instructions" },
  { role: "user", content: "start here" },
  {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "call-1", name: "exec", arguments: { command: "true" } }],
  },
  { role: "tool", content: "ok", tool_call_id: "call-1" },
  { role: "user", content: "Review and audit this codebase." },
];

const freshExecutionMessages = [
  { role: "system", content: "instructions" },
  { role: "user", content: "Review and audit this codebase." },
];

function recoveryParams(executionMessages: unknown[]) {
  return {
    agentId: "test-agent",
    executeOptions: {},
    executionMessages,
    responseContent: substantiveClaim,
    shouldRequireToolUse: false,
    toolResults: [
      { id: "todo-1", name: "todo", result: { items: [{ step: "Review", status: "pending" }] } },
    ],
    toolsEnabled: true,
    userMessage: "Review and audit this codebase.",
  } as Parameters<typeof recoverAssistantResponse>[0];
}

describe("assistant response recovery", () => {
  test("ships a substantive response in an established conversation without retrying", async () => {
    stubExecute("unused");
    const result = await recoverAssistantResponse(recoveryParams(establishedExecutionMessages));

    expect(result.responseContent).toBe(substantiveClaim);
    expect(executeCallCount).toBe(0);
    expect(result.responseContent).not.toContain("couldn't");
  });

  test("still retries substantive claims in a fresh conversation", async () => {
    stubExecute(substantiveClaim);
    const result = await recoverAssistantResponse(recoveryParams(freshExecutionMessages));

    expect(executeCallCount).toBeGreaterThan(0);
    expect(result.responseContent).toBe(substantiveClaim);
    expect(result.responseContent).not.toContain("couldn't");
  });

  test("never replaces a substantive ending with the canned failure message", async () => {
    stubExecute(substantiveClaim);
    const result = await recoverAssistantResponse(recoveryParams(freshExecutionMessages));

    expect(result.responseContent).toBe(substantiveClaim);
    expect(result.responseContent).not.toMatch(/couldn't (?:complete|verify|finish|move beyond)/);
  });
});
