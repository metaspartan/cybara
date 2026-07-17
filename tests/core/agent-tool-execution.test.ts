import { describe, expect, test } from "bun:test";
import { executeAgentTool } from "../../src/core/agent-tool-execution";
import type { AgentStatus } from "../../src/core/status";

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
    const executionState = { toolCallsStarted: 0 };
    const result = await executeAgentTool({
      toolName: "calc",
      args: { expression: "6 * 7" },
      allowedToolNames: new Set(["calc"]),
      hookContext: { agentId: "agent-1", sessionId: "session-1" },
      toolContext: { agentId: "agent-1", sessionId: "session-1", executionState },
      broadcastStatus: (status) => statuses.push(status),
    });

    expect(result.result).toEqual({ result: 42, expression: "6 * 7" });
    expect(executionState.toolCallsStarted).toBe(1);
    expect(statuses).toEqual(["tool_executing", "tool_completed"]);
  });
});
