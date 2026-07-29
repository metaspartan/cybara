import { describe, expect, test } from "bun:test";
import { executeAgentTool } from "../../src/core/agent-tool-execution";
import type { AgentStatus } from "../../src/core/status";
import { registerToolHandler, unregisterToolHandler } from "../../src/core/tools/handlers/index";

describe("agent tool execution", () => {
  test("rejects unknown and disabled tools before execution", async () => {
    const unknown = await executeAgentTool({
      toolName: "missing_tool",
      args: {},
      allowedToolNames: new Set(["missing_tool"]),
      hookContext: {},
      broadcastStatus: () => undefined,
    });
    expect(unknown.result).toEqual({ error: "Tool not found: missing_tool" });

    const disabled = await executeAgentTool({
      toolName: "calc",
      args: { expression: "2 + 2" },
      allowedToolNames: new Set(),
      hookContext: {},
      broadcastStatus: () => undefined,
    });
    expect(disabled.result).toEqual({ error: "Tool not enabled for this agent: calc" });
  });

  test("executes allowed tools with stable status and accounting", async () => {
    const statuses: AgentStatus[] = [];
    const executionState = { nextToolCallOrder: 0, toolCallsStarted: 0, toolCalls: [] };
    const result = await executeAgentTool({
      toolName: "calc",
      args: { expression: "6 * 7" },
      allowedToolNames: new Set(["calc"]),
      hookContext: { agentId: "agent-1", sessionId: "session-1" },
      toolContext: { agentId: "agent-1", sessionId: "session-1", executionState },
      broadcastStatus: (status) => statuses.push(status),
    });

    expect(result.result).toEqual({ result: 42, expression: "6 * 7" });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(executionState.toolCallsStarted).toBe(1);
    expect(executionState.toolCalls).toEqual([
      {
        order: 0,
        name: "calc",
        args: { expression: "6 * 7" },
        result: { result: 42, expression: "6 * 7" },
        durationMs: result.durationMs,
      },
    ]);
    expect(statuses).toEqual(["tool_executing", "tool_completed"]);
  });

  test("records elapsed time for long-running tools", async () => {
    const toolName = "duration_probe";
    const executionState = { nextToolCallOrder: 0, toolCallsStarted: 0, toolCalls: [] };
    registerToolHandler(toolName, async () => {
      await Bun.sleep(30);
      return { completed: true };
    });
    try {
      const result = await executeAgentTool({
        toolName,
        args: {},
        allowedToolNames: new Set([toolName]),
        hookContext: { agentId: "agent-duration", sessionId: "session-duration" },
        toolContext: {
          agentId: "agent-duration",
          sessionId: "session-duration",
          executionState,
        },
        broadcastStatus: () => undefined,
      });

      expect(result.durationMs).toBeGreaterThanOrEqual(20);
      expect(executionState.toolCalls[0]?.durationMs).toBe(result.durationMs);
    } finally {
      unregisterToolHandler(toolName);
    }
  });

  test("blocks tool execution after the configured call budget", async () => {
    const toolName = "tool_budget_probe";
    let executions = 0;
    const executionState = { nextToolCallOrder: 0, toolCallsStarted: 0, toolCalls: [] };
    const toolContext = {
      agentId: "agent-budget",
      maxToolCalls: 1,
      executionState,
    };
    registerToolHandler(toolName, async () => {
      executions += 1;
      await Bun.sleep(10);
      return { completed: true };
    });
    try {
      const results = await Promise.all(
        Array.from({ length: 3 }, () =>
          executeAgentTool({
            toolName,
            args: {},
            allowedToolNames: new Set([toolName]),
            hookContext: { agentId: "agent-budget" },
            toolContext,
            broadcastStatus: () => undefined,
          })
        )
      );
      const resultRecords = results.map((result) =>
        result.result && typeof result.result === "object" && !Array.isArray(result.result)
          ? (result.result as Record<string, unknown>)
          : {}
      );

      expect(resultRecords.filter((result) => result.completed === true)).toHaveLength(1);
      expect(
        resultRecords.filter(
          (result) =>
            result.error ===
            "Tool call budget reached (1); return the final response without more tools."
        )
      ).toHaveLength(2);
      expect(executions).toBe(1);
      expect(executionState.toolCallsStarted).toBe(1);
    } finally {
      unregisterToolHandler(toolName);
    }
  });
});
