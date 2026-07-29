import { statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { agentManager } from "../../agent";
import { assertReadablePath } from "../path-policy";
import type { ToolContext } from "../types";

type SecurityToolAction = "info" | "scan" | "validate";

const AGENT_SECURITY_TOOLS = [
  "read",
  "file_search",
  "grep",
  "workspace_index_search",
  "lsp_diagnostics",
  "lsp_definition",
  "lsp_references",
  "lsp_hover",
  "lsp_languages",
  "web_fetch",
  "web_search",
  "todo",
  "clarify",
];

interface SecurityToolResult {
  action: SecurityToolAction;
  engine: "active_agent";
  status: "completed" | "failed" | "interrupted" | "timed_out";
  exitCode: number;
  output: unknown;
  target?: string;
}

interface AssessmentLimits {
  maxIterations: number;
  toolBudget: number;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function activeAgentOutput(context: ToolContext): Record<string, unknown> {
  return {
    agent_id: context.agentId,
    provider_id: context.activeProviderId,
    provider_name: context.activeProviderName,
    model: context.activeModel,
  };
}

function resolveTarget(args: Record<string, unknown>, context: ToolContext): string {
  const workspace = context.workspaceDir ? resolve(context.workspaceDir) : process.cwd();
  const requested = stringValue(args.target);
  const target = requested ? resolve(workspace, requested) : workspace;
  return assertReadablePath(target, {
    workspaceRoot: workspace,
    confineToWorkspace: context.confineToWorkspace === true,
  });
}

function timeoutMs(args: Record<string, unknown>): number {
  const minutes = typeof args.timeoutMinutes === "number" ? args.timeoutMinutes : 120;
  return Math.min(Math.max(minutes, 1), 1_440) * 60_000;
}

function assessmentWorkspace(target: string): string {
  return statSync(target).isDirectory() ? target : dirname(target);
}

function assessmentLimits(
  action: SecurityToolAction,
  args: Record<string, unknown>
): AssessmentLimits {
  if (action === "validate") return { maxIterations: 12, toolBudget: 16 };
  if (args.mode === "deep") return { maxIterations: 44, toolBudget: 72 };
  if (stringArray(args.paths).length > 0) return { maxIterations: 14, toolBudget: 20 };
  return { maxIterations: 24, toolBudget: 36 };
}

function failedAssessmentReport(
  failure: unknown,
  provider: string | undefined,
  model: string | undefined,
  toolCallCount: number
): string {
  const record =
    failure && typeof failure === "object" && !Array.isArray(failure)
      ? (failure as Record<string, unknown>)
      : {};
  const category = stringValue(record.category) ?? "provider_error";
  const providerLabel = provider || "active provider";
  const modelLabel = model || "active model";
  return `The security assessment did not complete. ${providerLabel}/${modelLabel} stopped with ${category} after ${toolCallCount} read-only tool call${toolCallCount === 1 ? "" : "s"}. No incomplete finding should be presented as validated. Retry with the same active agent after the provider recovers.`;
}

function assessmentPrompt(
  action: SecurityToolAction,
  args: Record<string, unknown>,
  target: string
): string {
  const mode = args.mode === "deep" ? "deep, exhaustive, multi-pass" : "standard, focused";
  const paths = stringArray(args.paths);
  const findings = stringArray(args.findings);
  const knowledgeBases = stringArray(args.knowledgeBases);
  const { toolBudget } = assessmentLimits(action, args);
  const scope =
    paths.length > 0
      ? `Only inspect these repository-relative paths: ${paths.join(", ")}.`
      : "Inspect the authorized repository scope.";
  const validation =
    action === "validate"
      ? `Independently validate these candidate findings and reject unsupported claims:\n${findings.map((finding) => `- ${finding}`).join("\n")}`
      : "Discover concrete, exploitable security findings and validate each claim against the implementation.";
  const changeScope = [
    args.workingTree === true
      ? "Focus on working-tree changes when repository evidence exposes them."
      : "",
    stringValue(args.diff)
      ? `Use ${stringValue(args.diff)} as the requested diff base when repository evidence exposes it.`
      : "",
    stringValue(args.base)
      ? `Use ${stringValue(args.base)} as the requested base when repository evidence exposes it.`
      : "",
    stringValue(args.head)
      ? `Use ${stringValue(args.head)} as the requested head when repository evidence exposes it.`
      : "",
    knowledgeBases.length > 0
      ? `Apply these repository security documents: ${knowledgeBases.join(", ")}.`
      : "",
    stringValue(args.failOnSeverity)
      ? `Highlight whether any confirmed finding meets ${stringValue(args.failOnSeverity)} severity or higher.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  return [
    `Perform a ${mode} authorized security assessment of ${target}.`,
    scope,
    validation,
    changeScope,
    "Use the available read-only repository and research tools to gather direct evidence.",
    `Use no more than ${toolBudget} tool calls, then return the report immediately.`,
    "Do not modify files, execute commands, call security_scan, infer hidden reasoning, or report speculative findings as confirmed.",
    "For every confirmed finding, report severity, exact file and line evidence, attack path, impact, confidence, and minimal remediation.",
    "If no finding survives validation, say so and state the inspected scope and remaining test gaps.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function runAssessment(
  action: SecurityToolAction,
  args: Record<string, unknown>,
  target: string,
  context: ToolContext
): Promise<SecurityToolResult> {
  if (args.dryRun === true) {
    return {
      action,
      engine: "active_agent",
      status: "completed",
      exitCode: 0,
      target,
      output: {
        dry_run: true,
        mode: args.mode === "deep" ? "deep" : "standard",
        paths: stringArray(args.paths),
        ...activeAgentOutput(context),
      },
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  const abort = (): void => controller.abort();
  context.abortSignal?.addEventListener("abort", abort, { once: true });
  if (context.abortSignal?.aborted) controller.abort();
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs(args));

  try {
    const limits = assessmentLimits(action, args);
    const result = await agentManager.execute(
      context.agentId,
      [{ role: "user", content: assessmentPrompt(action, args, target) }],
      {
        workspaceDir: assessmentWorkspace(target),
        sessionId: context.sessionId,
        useTools: true,
        useMemory: false,
        useModelRouter: context.useModelRouter === true,
        modelOverride: context.useModelRouter === true ? undefined : context.activeModel,
        abortSignal: controller.signal,
        allowedToolNames: AGENT_SECURITY_TOOLS,
        modelParamsOverride: {
          ...context.modelParamsOverride,
          maxToolIterations: limits.maxIterations,
        },
        maxOutputTokens: 6_000,
      }
    );
    const status = result.failure ? "failed" : "completed";
    const toolCalls = result.tool_calls ?? [];
    const report =
      result.content.trim() ||
      (result.failure
        ? failedAssessmentReport(result.failure, result.provider, result.model, toolCalls.length)
        : "The active agent returned an empty security assessment.");
    return {
      action,
      engine: "active_agent",
      status,
      exitCode: status === "completed" ? 0 : 1,
      target,
      output: {
        report,
        provider: result.provider,
        provider_id: result.provider_id,
        provider_name: result.provider_name,
        model: result.model,
        tool_calls: toolCalls.map((toolCall) => ({
          name: toolCall.name,
          status: toolCall.status,
        })),
        failure: result.failure,
      },
    };
  } catch (error) {
    const status = timedOut ? "timed_out" : controller.signal.aborted ? "interrupted" : "failed";
    return {
      action,
      engine: "active_agent",
      status,
      exitCode: status === "interrupted" ? 130 : 1,
      target,
      output: {
        error: error instanceof Error ? error.message : String(error),
        ...activeAgentOutput(context),
      },
    };
  } finally {
    clearTimeout(timeout);
    context.abortSignal?.removeEventListener("abort", abort);
  }
}

export async function runSecurityScanTool(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<SecurityToolResult> {
  const action = stringValue(args.action) as SecurityToolAction | undefined;
  if (action !== "info" && action !== "scan" && action !== "validate") {
    throw new Error("Action must be info, scan, or validate.");
  }
  if (action === "validate" && stringArray(args.findings).length === 0) {
    throw new Error("At least one finding is required for validation.");
  }
  if (!context?.agentId) throw new Error("The active Cybara agent is unavailable.");
  if (action === "info") {
    return {
      action,
      engine: "active_agent",
      status: "completed",
      exitCode: 0,
      output: {
        available: true,
        engine: "active_agent",
        ...activeAgentOutput(context),
      },
    };
  }
  return await runAssessment(action, args, resolveTarget(args, context), context);
}

export async function handleSecurityScan(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<SecurityToolResult> {
  return await runSecurityScanTool(args, context);
}
