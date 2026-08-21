import { afterEach, describe, expect, test } from "bun:test";
import { deleteSession, handleChat } from "../../src/api/chat";
import { agentManager } from "../../src/core/agent";
import { MESSAGE_CONTENT_COMPACTION_NOTICE } from "../../src/core/llm/tool-transcript";
import { providerManager } from "../../src/core/providers";
import { loadPersistedSession } from "../../src/core/session-context";
import { listAllRunEvents } from "../../src/core/session-event-ledger";
import {
  getCircuitState,
  recordCircuitFailure,
  recordCircuitSuccess,
} from "../../src/core/tools/index";

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];
const createdSessionIds: string[] = [];
const originalExecute = agentManager.execute.bind(agentManager);
const originalCallLLM = agentManager.callLLM.bind(agentManager);

function createTestAgent(name: string, type: "main" | "planner" = "main"): string {
  const provider = providerManager.create({
    provider: "minimax",
    name: `${name} Provider`,
    api_key: `test-${crypto.randomUUID()}`,
    base_url: "https://api.minimax.io/v1",
  });
  createdProviderIds.push(provider.id);
  const agent = agentManager.create({
    name,
    type,
    provider_id: provider.id,
    model: "MiniMax-M3",
    memory_enabled: false,
  });
  createdAgentIds.push(agent.id);
  return agent.id;
}

afterEach(async () => {
  agentManager.execute = originalExecute;
  agentManager.callLLM = originalCallLLM;
  for (const sessionId of createdSessionIds.splice(0)) await deleteSession(sessionId);
  for (const agentId of createdAgentIds.splice(0)) agentManager.delete(agentId);
  for (const providerId of createdProviderIds.splice(0)) providerManager.delete(providerId);
});

describe("chat response recovery", () => {
  test("persists reasoning returned separately from assistant content", async () => {
    const agentId = createTestAgent("Separate Reasoning Agent");
    const sessionId = `separate-reasoning-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);

    agentManager.execute = (async () => ({
      content: "The workspace is ready.",
      thinking: "I inspected the provider response before answering.",
    })) as typeof agentManager.execute;

    const result = await handleChat({
      message: "Check the workspace.",
      agentId,
      sessionId,
      tools: false,
    });

    expect(result.message.thinking).toBe("I inspected the provider response before answering.");
    expect(result.thinking).toBe("I inspected the provider response before answering.");
    expect((await loadPersistedSession(sessionId))?.messages.at(-1)?.thinking).toBe(
      "I inspected the provider response before answering."
    );
  });

  test("attempts an interactive turn even when provider health telemetry is open", async () => {
    const agentId = createTestAgent("Recovered Provider Agent");
    const providerId = agentManager.get(agentId)?.provider_id;
    expect(typeof providerId).toBe("string");
    const circuitKey = `llm:${providerId}`;
    const sessionId = `open-provider-health-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    for (let index = 0; index < 5; index += 1) recordCircuitFailure(circuitKey);
    expect(getCircuitState(circuitKey)?.state).toBe("open");
    let callCount = 0;

    agentManager.execute = (async () => {
      callCount += 1;
      return { content: "The provider recovered and answered this turn." };
    }) as typeof agentManager.execute;

    try {
      const result = await handleChat({
        message: "Try the provider again.",
        agentId,
        sessionId,
        tools: false,
      });

      expect(callCount).toBe(1);
      expect(result.message.content).toBe("The provider recovered and answered this turn.");
      expect(getCircuitState(circuitKey)).toBeUndefined();
    } finally {
      recordCircuitSuccess(circuitKey);
    }
  });

  test("persists a neutral interrupted response before completing a failed provider run", async () => {
    const agentId = createTestAgent("Transient Provider Failure Agent");
    const sessionId = `transient-provider-failure-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);

    agentManager.execute = (async () => ({
      content: "",
      failure: { category: "overloaded", retryable: true },
    })) as typeof agentManager.execute;

    const result = await handleChat({
      message: "continue after switching agents",
      agentId,
      sessionId,
      tools: true,
    });

    expect(result.interrupted).toBe(true);
    expect(result.failure).toEqual({ category: "overloaded", retryable: true });
    expect(result.message).toMatchObject({ role: "assistant", interrupted: true });
    expect(result.message.content).toContain("interrupted before completion");
    expect(result.message.content).not.toMatch(/provider|overloaded|rate limit/i);
    const persistedMessages = (await loadPersistedSession(sessionId))?.messages || [];
    expect(persistedMessages).toHaveLength(2);
    expect(persistedMessages[0]).toMatchObject({
      role: "user",
      content: "continue after switching agents",
    });
    expect(persistedMessages[1]).toMatchObject({
      role: "assistant",
      content: result.message.content,
      interrupted: true,
      run_id: result.message.run_id,
    });
    const events = listAllRunEvents(result.message.run_id || "");
    const assistantSequence = events.find(
      (event) =>
        event.type === "message" &&
        typeof event.payload === "object" &&
        event.payload !== null &&
        "role" in event.payload &&
        event.payload.role === "assistant"
    )?.sequence;
    const completionSequence = events.find((event) => event.type === "run_completed")?.sequence;
    expect(assistantSequence).toBeNumber();
    expect(completionSequence).toBeNumber();
    expect(assistantSequence || 0).toBeLessThan(completionSequence || 0);
  });

  test("keeps completed tools when a transient provider failure ends a turn", async () => {
    const agentId = createTestAgent("Partial Provider Failure Agent");
    const sessionId = `partial-provider-failure-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);

    let executionCalls = 0;
    agentManager.execute = (async (_agentId, messages, options) => {
      executionCalls += 1;
      if (executionCalls === 1) {
        return {
          content: "",
          failure: { category: "overloaded", retryable: true },
          tool_calls: [
            {
              name: "read",
              args: { path: "/tmp/project.json" },
              result: { path: "/tmp/project.json", content: "ok" },
            },
          ],
        };
      }
      expect(options?.useTools).toBe(false);
      expect(messages.at(-1)?.content).toContain("Observed tool results:");
      return {
        content:
          "I verified that `/tmp/project.json` is readable. The original turn was interrupted before any remaining inspection finished.",
      };
    }) as typeof agentManager.execute;

    const result = await handleChat({
      message: "inspect the project",
      agentId,
      sessionId,
      tools: true,
    });

    expect(result.interrupted).toBeUndefined();
    expect(result.failure).toEqual({ category: "overloaded", retryable: true });
    expect(result.message.interrupted).toBe(true);
    expect(result.message.content).not.toContain("overloaded");
    expect(result.message.content).toContain("verified that `/tmp/project.json` is readable");
    expect(result.message.content).not.toMatch(/completed \d+ tool call/i);
    expect(result.message.tool_calls).toHaveLength(1);
    expect(executionCalls).toBe(2);
    expect((await loadPersistedSession(sessionId))?.messages.at(-1)).toMatchObject({
      role: "assistant",
      interrupted: true,
      tool_calls: [expect.objectContaining({ name: "read" })],
    });
  });

  test("never promotes tool-count diagnostics when response synthesis also fails", async () => {
    const agentId = createTestAgent("Failed Tool Response Synthesis Agent");
    const sessionId = `failed-tool-synthesis-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    let executionCalls = 0;

    agentManager.execute = (async () => {
      executionCalls += 1;
      if (executionCalls === 1) {
        return {
          content: "",
          failure: { category: "overloaded", retryable: true },
          tool_calls: [
            {
              name: "read",
              args: { path: "/tmp/project.json" },
              result: { path: "/tmp/project.json", content: "ok" },
            },
          ],
        };
      }
      return {
        content: "",
        failure: { category: "overloaded", retryable: true },
      };
    }) as typeof agentManager.execute;

    const result = await handleChat({
      message: "inspect the project",
      agentId,
      sessionId,
      tools: true,
    });

    expect(executionCalls).toBe(2);
    expect(result.message.content).toBe(
      "Response interrupted before completion. Send the message again to retry."
    );
    expect(result.message.content).not.toMatch(/completed \d+ tool call/i);
    expect(result.message.tool_calls).toHaveLength(1);
  });

  test("retries a bare completion under the action evidence contract", async () => {
    const agentId = createTestAgent("Bare Completion Recovery Agent");
    const sessionId = `bare-completion-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    const executionOptions: Array<Parameters<typeof agentManager.execute>[2]> = [];
    const executionMessages: Array<Array<{ role: string; content: string }>> = [];
    let callCount = 0;

    agentManager.execute = (async (_agentId, messages, options) => {
      callCount += 1;
      executionOptions.push(options);
      executionMessages.push(messages.map((message) => ({ ...message, images: undefined })));
      if (callCount === 1) return { content: "Completed" };
      return {
        content: "Imported the pasted data and verified that the item now contains 4 fields.",
        tool_calls: [
          {
            name: "read",
            args: { path: "/tmp/import.json" },
            result: { path: "/tmp/import.json", content: '{"fields":4}' },
          },
        ],
      };
    }) as typeof agentManager.execute;

    const result = await handleChat({
      message:
        "paste in then import and it shows up as an empty item, please stop going in circles",
      agentId,
      sessionId,
      tools: true,
    });

    expect(callCount).toBe(2);
    expect(executionOptions[0]?.requireToolUse).toBe(false);
    expect(executionOptions[1]?.requireToolUse).toBe(true);
    expect(executionMessages[1]?.at(-2)).toEqual({
      role: "assistant",
      content: "Completed",
      images: undefined,
    });
    expect(executionMessages[1]?.at(-1)?.content).toContain("without using the available tools");
    expect(result.message.content).toContain("verified that the item now contains 4 fields");
    expect(result.message.tool_calls).toHaveLength(1);
  });

  test("preserves an explicitly requested literal completion response", async () => {
    const agentId = createTestAgent("Literal Completion Agent");
    const sessionId = `literal-completion-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    let callCount = 0;

    agentManager.execute = (async () => {
      callCount += 1;
      return { content: "Completed." };
    }) as typeof agentManager.execute;

    const result = await handleChat({
      message: "Respond with exactly Completed.",
      agentId,
      sessionId,
      tools: true,
    });

    expect(callCount).toBe(1);
    expect(result.message.content).toBe("Completed.");
  });

  test("preserves a direct arithmetic response without forcing a tool retry", async () => {
    const agentId = createTestAgent("Arithmetic Response Agent");
    const sessionId = `arithmetic-response-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    let callCount = 0;

    agentManager.execute = (async () => {
      callCount += 1;
      return { content: "10" };
    }) as typeof agentManager.execute;

    const result = await handleChat({
      message: "Add 10 to your running total. What is the total now? Reply with only the number.",
      agentId,
      sessionId,
      tools: true,
    });

    expect(callCount).toBe(1);
    expect(result.message.content).toBe("10");
    expect(result.message.tool_calls).toBeUndefined();
  });

  test("reports an honest failure after bounded empty-response recovery", async () => {
    const agentId = createTestAgent("Empty Completion Agent");
    const sessionId = `empty-completion-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    const executionMessages: Array<Array<{ role: string; content: string }>> = [];
    let callCount = 0;

    agentManager.execute = (async (_agentId, messages) => {
      callCount += 1;
      executionMessages.push(
        messages.map((entry) => ({ role: entry.role, content: entry.content }))
      );
      return { content: "" };
    }) as typeof agentManager.execute;

    const result = await handleChat({
      message: "Explain why this import produced an empty item.",
      agentId,
      sessionId,
      tools: false,
    });

    expect(callCount).toBe(3);
    for (const messages of executionMessages.slice(1)) {
      expect(messages.at(-2)?.role).toBe("assistant");
      expect(messages.at(-2)?.content.trim().length).toBeGreaterThan(0);
      expect(messages.at(-1)?.role).toBe("user");
    }
    expect(result.message.content).toContain("couldn't produce a usable response");
    expect(result.message.content).not.toContain("The model returned");
  });

  test("forces a tool-backed retry for unsupported implementation claims", async () => {
    const agentId = createTestAgent("Unsupported Claim Recovery Agent");
    const sessionId = `unsupported-claim-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    const executionOptions: Array<Parameters<typeof agentManager.execute>[2]> = [];
    let callCount = 0;

    agentManager.execute = (async (_agentId, _messages, options) => {
      callCount += 1;
      executionOptions.push(options);
      if (callCount === 1) {
        return { content: "Done. I implemented the importer and all tests passed." };
      }
      return {
        content: "I fixed the importer and verified 4 focused tests pass.",
        tool_calls: [
          {
            name: "edit",
            args: { path: "/tmp/import.ts" },
            result: { filePath: "/tmp/import.ts" },
          },
          {
            name: "exec",
            args: { command: "bun test import" },
            result: { output: "4 pass", exitCode: 0 },
          },
        ],
      };
    }) as typeof agentManager.execute;

    const result = await handleChat({
      message: "Fix the importer and test it.",
      agentId,
      sessionId,
      tools: true,
    });

    expect(callCount).toBe(2);
    expect(executionOptions[1]?.requireToolUse).toBe(true);
    expect(result.message.content).toContain("verified 4 focused tests pass");
    expect(result.message.tool_calls).toHaveLength(2);
  });

  test("retries a substantive audit answer that has no tool evidence", async () => {
    const agentId = createTestAgent("Audit Evidence Recovery Agent");
    const sessionId = `audit-evidence-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    const executionOptions: Array<Parameters<typeof agentManager.execute>[2]> = [];
    let callCount = 0;

    agentManager.execute = (async (_agentId, _messages, options) => {
      callCount += 1;
      executionOptions.push(options);
      if (callCount === 1) {
        return {
          content:
            "The architecture is production ready. The provider layer is modular and the tests cover every critical path.",
        };
      }
      return {
        content: "I inspected the provider runtime and found one untested fallback branch.",
        tool_calls: [
          {
            name: "read",
            args: { path: "/tmp/provider-runtime.ts" },
            result: { path: "/tmp/provider-runtime.ts", content: "export function fallback() {}" },
          },
        ],
      };
    }) as typeof agentManager.execute;

    const result = await handleChat({
      message: "Review and audit this codebase.",
      agentId,
      sessionId,
      tools: true,
    });

    expect(callCount).toBe(2);
    expect(executionOptions[0]?.requireToolUse).toBe(false);
    expect(executionOptions[1]?.requireToolUse).toBe(true);
    expect(result.message.content).toContain("found one untested fallback branch");
    expect(result.message.tool_calls).toHaveLength(1);
  });

  test("fails closed and preserves retry tools when no evidence tool is used", async () => {
    const agentId = createTestAgent("No Evidence Recovery Agent");
    const sessionId = `no-evidence-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    let callCount = 0;

    agentManager.execute = (async () => {
      callCount += 1;
      return {
        content: "The audit is complete and the project is production ready.",
        tool_calls:
          callCount === 1
            ? []
            : [
                {
                  name: "todo",
                  args: { items: [{ step: "Audit", status: "completed" }] },
                  result: { items: [{ step: "Audit", status: "completed" }] },
                },
              ],
      };
    }) as typeof agentManager.execute;

    const result = await handleChat({
      message: "Review and audit this codebase.",
      agentId,
      sessionId,
      tools: true,
    });

    expect(callCount).toBe(3);
    expect(result.message.content).toContain("couldn't complete the requested action");
    expect(result.message.content).not.toContain("Cybara did not record");
    expect(result.message.tool_calls).toHaveLength(2);
    expect(result.message.tool_calls?.[0]?.name).toBe("todo");
  });

  test("recovers a Kimi-shaped continuation on the final bounded attempt", async () => {
    const agentId = createTestAgent("Kimi Continuation Recovery Agent");
    const sessionId = `kimi-continuation-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    const executionMessages: Array<Array<{ role: string; content: string }>> = [];
    let callCount = 0;

    agentManager.execute = (async (_agentId, messages) => {
      callCount += 1;
      executionMessages.push(
        messages.map((entry) => ({ role: entry.role, content: entry.content }))
      );
      if (callCount === 1) {
        return { content: "I'll continue the deployment now." };
      }
      if (callCount === 2) {
        return { content: "Actually, let me try using a different tool." };
      }
      return {
        content: "Inspected the deployment configuration and found the service unit is missing.",
        tool_calls: [
          {
            name: "read",
            args: { path: "/tmp/vibemail.service" },
            result: { error: "File not found" },
          },
          {
            name: "exec",
            args: { command: "ls /tmp" },
            result: { output: "vibemail", exitCode: 0 },
          },
        ],
      };
    }) as typeof agentManager.execute;

    const result = await handleChat({
      message: "Continue please",
      agentId,
      sessionId,
      tools: true,
    });

    expect(callCount).toBe(3);
    expect(executionMessages[2]?.slice(-3).map((entry) => entry.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
    expect(result.message.content).toContain("service unit is missing");
    expect(result.message.content).not.toContain("Actually, let me try");
    expect(result.message.tool_calls).toHaveLength(2);
  });

  test("continues when a model stops after promising to execute its plan", async () => {
    const agentId = createTestAgent("Unfinished Execution Recovery Agent");
    const sessionId = `unfinished-execution-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    let callCount = 0;

    agentManager.execute = (async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          content:
            "The page is blank and I have not yet patched it. Next concrete plan: fix the script, reload the browser, and verify the workflow. Executing now.",
          tool_calls: [
            {
              name: "browser",
              args: { action: "open", url: "http://127.0.0.1:7818" },
              result: { error: "SyntaxError: duplicate declaration" },
            },
          ],
        };
      }
      return {
        content: "Fixed the duplicate declaration and verified the primary workflow renders.",
        tool_calls: [
          {
            name: "edit",
            args: { path: "/tmp/app.js" },
            result: { filePath: "/tmp/app.js" },
          },
          {
            name: "browser",
            args: { action: "snapshot" },
            result: { text: "Dashboard Incidents Releases" },
          },
        ],
      };
    }) as typeof agentManager.execute;

    const result = await handleChat({
      message: "Finish and visually verify the app.",
      agentId,
      sessionId,
      tools: true,
    });

    expect(callCount).toBe(2);
    expect(result.message.content).toContain("verified the primary workflow renders");
    expect(result.message.tool_calls).toHaveLength(3);
  });

  test("continues when a model admits a required deliverable is unfinished", async () => {
    const agentId = createTestAgent("Unfinished Deliverable Recovery Agent");
    const sessionId = `unfinished-deliverable-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    const executionMessages: Array<Array<{ role: string; content: string }>> = [];
    let callCount = 0;

    agentManager.execute = (async (_agentId, messages) => {
      callCount += 1;
      executionMessages.push(messages.map(({ role, content }) => ({ role, content })));
      if (callCount === 1) {
        return {
          content: [
            "I have not yet designed or written the required output file.",
            "Remaining steps: generate the final artifact and verify it.",
            "Want me to proceed with writing it?",
          ].join("\n\n"),
          tool_calls: [
            {
              name: "read",
              args: { path: "/tmp/input.json" },
              result: { path: "/tmp/input.json", content: "ready" },
            },
          ],
        };
      }
      return {
        content: "Created the required output file and verified its contents.",
        tool_calls: [
          {
            name: "write",
            args: { path: "/tmp/output.json", content: "complete" },
            result: { filePath: "/tmp/output.json" },
          },
          {
            name: "read",
            args: { path: "/tmp/output.json" },
            result: { path: "/tmp/output.json", content: "complete" },
          },
        ],
      };
    }) as typeof agentManager.execute;

    const result = await handleChat({
      message: "Create the required output file and verify it.",
      agentId,
      sessionId,
      tools: true,
    });

    expect(callCount).toBe(2);
    expect(executionMessages[1]?.at(-1)?.content).toContain("Continue immediately");
    expect(result.message.content).toContain("verified its contents");
    expect(result.message.content).not.toContain("Want me to proceed");
    expect(result.message.tool_calls).toHaveLength(3);
  });

  test("reconciles an unfinished todo before accepting whole-task completion", async () => {
    const agentId = createTestAgent("Incomplete Plan Recovery Agent");
    const sessionId = `incomplete-plan-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    let callCount = 0;

    agentManager.execute = (async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          content: "Done. Task complete and all required work is satisfied.",
          tool_calls: [
            {
              name: "edit",
              args: { path: "/tmp/app.ts" },
              result: { filePath: "/tmp/app.ts" },
            },
            {
              name: "todo",
              args: {
                items: [
                  { content: "Implement change", status: "completed" },
                  { content: "Verify behavior", status: "in_progress" },
                ],
              },
              result: {
                items: [
                  { content: "Implement change", status: "completed" },
                  { content: "Verify behavior", status: "in_progress" },
                ],
              },
            },
          ],
        };
      }
      return {
        content: "Implemented the change and verified the focused test passes.",
        tool_calls: [
          {
            name: "exec",
            args: { command: "bun test app.test.ts" },
            result: { output: "1 pass", exitCode: 0 },
          },
          {
            name: "todo",
            args: {
              items: [
                { content: "Implement change", status: "completed" },
                { content: "Verify behavior", status: "completed" },
              ],
            },
            result: {
              items: [
                { content: "Implement change", status: "completed" },
                { content: "Verify behavior", status: "completed" },
              ],
            },
          },
        ],
      };
    }) as typeof agentManager.execute;

    const result = await handleChat({
      message: "Fix and verify the app.",
      agentId,
      sessionId,
      tools: true,
    });

    expect(callCount).toBe(2);
    expect(result.message.content).toContain("verified the focused test passes");
    expect(result.message.tool_calls).toHaveLength(4);
  });

  test("continues implementation when a newly selected agent returns only a plan", async () => {
    const firstAgentId = createTestAgent("Initial Project Agent");
    const kimiAgentId = createTestAgent("Kimi Project Agent");
    const sessionId = `switch-plan-only-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    const executionOptions: Array<Parameters<typeof agentManager.execute>[2]> = [];
    const executionAgentIds: string[] = [];
    let callCount = 0;

    agentManager.execute = (async (agentId, _messages, options) => {
      callCount += 1;
      executionAgentIds.push(agentId);
      executionOptions.push(options);
      if (callCount === 1) {
        return { content: "The existing implementation context is loaded." };
      }
      if (callCount === 2) {
        return {
          content: [
            "VibeMail - Next Phase Plan",
            "1. Backend: Add Stripe billing and subscription storage.",
            "2. Frontend: Build pricing and account management screens.",
            "3. Deployment: Configure the production service.",
          ].join("\n"),
        };
      }
      return {
        content: "Implemented the subscription schema and verified the billing tests pass.",
        tool_calls: [
          {
            name: "edit",
            args: { path: "/tmp/billing.ts" },
            result: { filePath: "/tmp/billing.ts" },
          },
          {
            name: "exec",
            args: { command: "bun test billing" },
            result: { output: "5 pass", exitCode: 0 },
          },
        ],
      };
    }) as typeof agentManager.execute;

    await handleChat({
      message: "Load the existing project context.",
      agentId: firstAgentId,
      sessionId,
      tools: true,
    });
    const result = await handleChat({
      message: "Continue improving the email platform and add paid plans.",
      agentId: kimiAgentId,
      sessionId,
      tools: true,
    });

    expect(callCount).toBe(3);
    expect(executionAgentIds).toEqual([firstAgentId, kimiAgentId, kimiAgentId]);
    expect(executionOptions[2]?.requireToolUse).toBe(true);
    expect(result.agent?.id).toBe(kimiAgentId);
    expect(result.message.content).toContain("verified the billing tests pass");
    expect(result.message.tool_calls).toHaveLength(2);
  });

  test("allows a planner agent to return a plan without an execution retry", async () => {
    const agentId = createTestAgent("Planning Agent", "planner");
    const sessionId = `planner-response-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    let callCount = 0;

    agentManager.execute = (async () => {
      callCount += 1;
      return {
        content: [
          "Implementation Plan",
          "1. Add billing routes and subscription storage.",
          "2. Build pricing and account management screens.",
          "3. Configure and verify the production deployment.",
        ].join("\n"),
      };
    }) as typeof agentManager.execute;

    const result = await handleChat({
      message: "Continue improving the email platform and add paid plans.",
      agentId,
      sessionId,
      tools: true,
    });

    expect(callCount).toBe(1);
    expect(result.message.content).toContain("Implementation Plan");
  });

  test("does not accept failed tool execution as completion evidence", async () => {
    const agentId = createTestAgent("Failed Evidence Recovery Agent");
    const sessionId = `failed-evidence-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    let callCount = 0;

    agentManager.execute = (async () => {
      callCount += 1;
      return {
        content: "All tests passed and the build is green.",
        tool_calls: [
          {
            name: "exec",
            args: { command: "bun test" },
            result: { output: "2 failed", exitCode: 1 },
          },
        ],
      };
    }) as typeof agentManager.execute;

    const result = await handleChat({
      message: "Run the tests and tell me whether they pass.",
      agentId,
      sessionId,
      tools: true,
    });

    expect(callCount).toBe(3);
    expect(result.message.content).toContain("couldn't verify the requested result");
    expect(result.message.content).not.toContain("Cybara did not record");
    expect(result.message.tool_calls?.[0]?.status).toBe("failed");
  });

  test("renders the actual structured clarification instead of an invisible asked status", async () => {
    const agentId = createTestAgent("Visible Clarification Agent");
    const sessionId = `visible-clarification-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    let callCount = 0;

    agentManager.execute = (async () => {
      callCount += 1;
      return {
        content: "Asked.",
        tool_calls: [
          {
            name: "clarify",
            args: { question: "Which data source should I use?" },
            result: {
              awaiting: "user",
              question: "Which data source should I use?",
              options: [
                { label: "API", description: "Official endpoint" },
                { label: "Files", description: "Checked-in data" },
              ],
            },
          },
        ],
      };
    }) as typeof agentManager.execute;

    const result = await handleChat({
      message: "Make the data source configurable.",
      agentId,
      sessionId,
      tools: true,
    });

    expect(callCount).toBe(1);
    expect(result.message.content).toContain("Which data source should I use?");
    expect(result.message.content).toContain("**API**");
    expect(result.message.content).not.toBe("Asked.");
  });

  test("continues after a provider echoes an internal compaction marker", async () => {
    const agentId = createTestAgent("Compaction Continuation Agent");
    const sessionId = `compaction-continuation-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    const executionMessages: Array<Array<{ role: string; content: string }>> = [];
    let callCount = 0;

    agentManager.execute = (async (_agentId, messages) => {
      callCount += 1;
      executionMessages.push(messages.map(({ role, content }) => ({ role, content })));
      if (callCount === 1) {
        return {
          content: MESSAGE_CONTENT_COMPACTION_NOTICE,
          tool_calls: [
            {
              name: "read",
              args: { path: "/tmp/project.json" },
              result: { path: "/tmp/project.json", content: "ready" },
            },
          ],
        };
      }
      return {
        content: "Continued after compaction and verified the project state.",
      };
    }) as typeof agentManager.execute;

    const result = await handleChat({
      message: "continue",
      agentId,
      sessionId,
      tools: true,
    });

    expect(callCount).toBe(2);
    expect(executionMessages[1]?.at(-1)?.content).toContain(
      "Earlier context was compacted successfully"
    );
    expect(JSON.stringify(executionMessages[1])).not.toContain(MESSAGE_CONTENT_COMPACTION_NOTICE);
    expect(result.message.content).toBe(
      "Continued after compaction and verified the project state."
    );
    expect(result.message.content).not.toContain("[compacted:");
    expect(result.message.tool_calls).toHaveLength(1);
    expect((await loadPersistedSession(sessionId))?.messages.at(-1)?.content).toBe(
      result.message.content
    );
  });
});
