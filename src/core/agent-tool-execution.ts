import { type AgentHookContext, emitAgentHook } from "./agent-hooks";
import { extractSandboxProviderFromToolResult, formatToolActivityDetail } from "./agent-internals";
import {
  type AgenticLoopRuntimeTracker,
  pauseAgenticLoopRuntime,
  resumeAgenticLoopRuntime,
} from "./agent-loop-runtime";
import type { AgentStatus, StatusPayload } from "./status";
import { coerceToolArguments } from "./tool-argument-coercion";
import { isToolPolicyBlockedMessage, sanitizeToolErrorMessage } from "./tool-result-classification";
import {
  executeTool,
  formatMissingRequiredToolArgumentsError,
  getMissingRequiredToolArguments,
  hasTool,
} from "./tools/handlers/index";
import { noteToolActivityForTodoReminder } from "./tools/handlers/todo";
import { type ToolContext, toolSchemas } from "./tools/index";

export interface AgentToolExecutionResult {
  skipped: boolean;
  result?: unknown;
}

export interface AgentToolExecutionOptions {
  toolName: string;
  args: Record<string, unknown>;
  allowedToolNames: Set<string>;
  toolContext?: ToolContext;
  hookContext: AgentHookContext;
  runtimeTracker?: AgenticLoopRuntimeTracker;
  broadcastStatus: (
    status: AgentStatus,
    toolContext?: ToolContext,
    detail?: string,
    extra?: Partial<StatusPayload>
  ) => void;
}

export function createAgentToolCallStatusId(toolName: string): string {
  const normalizedToolName = toolName.trim().toLowerCase() || "tool";
  return `${normalizedToolName}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || "Unknown error");
}

async function executeAgentToolInternal(
  options: AgentToolExecutionOptions
): Promise<AgentToolExecutionResult> {
  const { toolName, allowedToolNames, toolContext, hookContext, broadcastStatus } = options;
  let { args } = options;
  if (!hasTool(toolName)) {
    const reason = `Tool not found: ${toolName}`;
    await emitAgentHook({
      type: "tool_blocked",
      context: hookContext,
      toolName,
      args,
      reason,
    });
    return { skipped: false, result: { error: reason } };
  }

  if (!allowedToolNames.has(toolName)) {
    const reason = `Tool not enabled for this agent: ${toolName}`;
    await emitAgentHook({
      type: "tool_blocked",
      context: hookContext,
      toolName,
      args,
      reason,
    });
    return { skipped: false, result: { error: reason } };
  }

  args = coerceToolArguments(toolName, args, toolSchemas[toolName]?.input_schema);
  const missingArgs = getMissingRequiredToolArguments(toolName, args);
  if (missingArgs.length > 0) {
    const reason = formatMissingRequiredToolArgumentsError(toolName, missingArgs);
    await emitAgentHook({
      type: "tool_blocked",
      context: hookContext,
      toolName,
      args,
      reason,
    });
    return { skipped: false, result: { error: reason } };
  }

  const hookDecision = await emitAgentHook({
    type: "tool_before",
    context: hookContext,
    toolName,
    args,
  });
  if (hookDecision?.block) {
    const reason = hookDecision.reason || `Tool blocked by hook: ${toolName}`;
    await emitAgentHook({
      type: "tool_blocked",
      context: hookContext,
      toolName,
      args,
      reason,
    });
    return { skipped: false, result: { error: reason } };
  }

  const toolCallId = createAgentToolCallStatusId(toolName);
  try {
    const startedAt = Date.now();
    if (toolContext?.executionState) toolContext.executionState.toolCallsStarted += 1;
    broadcastStatus(
      "tool_executing",
      toolContext,
      formatToolActivityDetail(toolName, args, "start"),
      {
        toolName,
        toolCallId,
        toolPhase: "start",
      }
    );
    const result = await executeTool(toolName, args, toolContext);
    const todoReminder = noteToolActivityForTodoReminder(toolName, toolContext);
    if (todoReminder && result && typeof result === "object" && !Array.isArray(result)) {
      (result as Record<string, unknown>).system_reminder = todoReminder;
    }
    broadcastStatus(
      "tool_completed",
      toolContext,
      formatToolActivityDetail(toolName, args, "result", result),
      {
        toolName,
        toolCallId,
        toolPhase: "result",
        durationMs: Date.now() - startedAt,
        sandboxProvider: extractSandboxProviderFromToolResult(result),
      }
    );
    await emitAgentHook({
      type: "tool_after",
      context: hookContext,
      toolName,
      args,
      result,
    });
    return { skipped: false, result };
  } catch (error) {
    const errorMessage = sanitizeToolErrorMessage(normalizeErrorMessage(error));
    const blocked = isToolPolicyBlockedMessage(errorMessage);
    const phase = blocked ? "blocked" : "error";
    broadcastStatus(
      blocked ? "tool_completed" : "error",
      toolContext,
      formatToolActivityDetail(toolName, args, phase, errorMessage),
      {
        toolName,
        toolCallId,
        toolPhase: phase,
      }
    );
    if (blocked) {
      await emitAgentHook({
        type: "tool_blocked",
        context: hookContext,
        toolName,
        args,
        reason: errorMessage,
      });
      return {
        skipped: false,
        result: { error: errorMessage, blocked: true },
      };
    }
    await emitAgentHook({
      type: "tool_error",
      context: hookContext,
      toolName,
      args,
      error: errorMessage,
    });
    return { skipped: false, result: { error: errorMessage } };
  }
}

export async function executeAgentTool(
  options: AgentToolExecutionOptions
): Promise<AgentToolExecutionResult> {
  if (!options.runtimeTracker) return await executeAgentToolInternal(options);
  pauseAgenticLoopRuntime(options.runtimeTracker);
  try {
    return await executeAgentToolInternal(options);
  } finally {
    resumeAgenticLoopRuntime(options.runtimeTracker);
  }
}
