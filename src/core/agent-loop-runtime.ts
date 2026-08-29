import {
  type AgenticLoopPolicy,
  type AgenticLoopState,
  type AgentToolCallResult,
  buildToolIterationFingerprint,
  LOOP_WARNING_BUCKET_SIZE,
} from "./agent-internals";

export type AgenticLoopLimit = "maxIterations" | "runtime";

export interface AgenticLoopRuntimeTracker {
  activeToolCount: number;
  budgetWarningLevel: number;
  checkpointWarned: boolean;
  pausedAt?: number;
  pausedMs: number;
  startedAt: number;
}

export interface LoopEvaluation {
  stop: boolean;
  message?: string;
}

const MATERIALIZATION_TOOLS = new Set(["write", "edit", "apply_patch"]);
const EVIDENCE_INSPECTION_EXCLUDED_TOOLS = new Set([...MATERIALIZATION_TOOLS, "todo"]);
const MATERIALIZATION_CHECKPOINT_ITERATIONS = 3;
const MATERIALIZATION_REQUIRED_ITERATIONS = 4;
const MATERIALIZATION_CLOSING_ITERATIONS = 8;
const INSPECTION_TOOL_ROUND_MAX_TOKENS = 2048;

export function resolveInspectionToolRoundTokenLimit(
  tokenLimit: number,
  inspectionRequired: boolean
): number {
  return inspectionRequired ? Math.min(tokenLimit, INSPECTION_TOOL_ROUND_MAX_TOKENS) : tokenLimit;
}

export function requiresRequestedDeliverableMaterialization(
  completedIterations: number,
  materialized: boolean,
  extendedEvidenceRequired = false
): boolean {
  const requiredIterations = extendedEvidenceRequired ? MATERIALIZATION_REQUIRED_ITERATIONS : 1;
  return completedIterations >= requiredIterations && !materialized;
}

export function requestedDeliverableMaterializationPrompt(
  paths: string[],
  inspectedEvidence = false
): string {
  const evidenceContext = inspectedEvidence
    ? " Prior inspection tool results are already in the conversation. The current mutation-only tool list is deliberate; use that evidence and do not claim inspection or read access was unavailable."
    : "";
  return `Write the complete evidence-backed deliverable to ${paths.join(", ")} now. Use the write tool with the exact path. Do not write a placeholder, scaffold, helper script, or promise to finish later.${evidenceContext}`;
}

export function resolveRequestedDeliverableFinalContent(
  content: string,
  paths: string[],
  materialized: boolean
): string {
  if (content.trim() || paths.length === 0 || !materialized) return content;
  return `Completed and saved the requested deliverable${paths.length === 1 ? "" : "s"}: ${paths.join(", ")}.`;
}

export function resolveRequestedDeliverableToolChoice(
  tools: Array<{ name: string }>,
  materializationRequired: boolean,
  extendedEvidenceRequired: boolean
): "auto" | "required" {
  const canMaterialize = tools.some((tool) => MATERIALIZATION_TOOLS.has(tool.name));
  return materializationRequired && !extendedEvidenceRequired && canMaterialize
    ? "required"
    : "auto";
}

export function toolsAfterMaterializationCheckpoint<T extends { name: string }>(
  tools: T[],
  completedIterations: number,
  materialized: boolean,
  extendedEvidenceRequired = false
): T[] {
  if (completedIterations >= MATERIALIZATION_CLOSING_ITERATIONS && materialized) return [];
  if (
    extendedEvidenceRequired &&
    !materialized &&
    completedIterations < MATERIALIZATION_REQUIRED_ITERATIONS
  ) {
    const inspectionTools = tools.filter(
      (tool) => !EVIDENCE_INSPECTION_EXCLUDED_TOOLS.has(tool.name)
    );
    return inspectionTools.length > 0 ? inspectionTools : tools;
  }
  if (
    !requiresRequestedDeliverableMaterialization(
      completedIterations,
      materialized,
      extendedEvidenceRequired
    )
  ) {
    return tools;
  }
  const materializationTools = tools.filter((tool) => MATERIALIZATION_TOOLS.has(tool.name));
  return materializationTools.length > 0 ? materializationTools : tools;
}

export function createAgenticLoopRuntimeTracker(now = Date.now()): AgenticLoopRuntimeTracker {
  return {
    activeToolCount: 0,
    budgetWarningLevel: 0,
    checkpointWarned: false,
    pausedMs: 0,
    startedAt: now,
  };
}

export function consumeAgenticLoopBudgetWarning(
  loopPolicy: AgenticLoopPolicy,
  completedIterations: number,
  tracker: AgenticLoopRuntimeTracker,
  now = Date.now()
): string | undefined {
  const maxIterations = loopPolicy.maxIterations;
  const remainingIterations =
    typeof maxIterations === "number"
      ? Math.max(0, maxIterations - completedIterations)
      : undefined;
  const iterationRatio =
    typeof maxIterations === "number" && maxIterations > 0
      ? completedIterations / maxIterations
      : 0;
  const runtimeRatio =
    typeof loopPolicy.maxRuntimeMs === "number" && loopPolicy.maxRuntimeMs > 0
      ? agenticLoopActiveRuntimeMs(tracker, now) / loopPolicy.maxRuntimeMs
      : 0;
  const pressure = Math.max(iterationRatio, runtimeRatio);
  const nextLevel = pressure >= 0.9 ? 2 : pressure >= 0.7 ? 1 : 0;
  if (
    nextLevel === 0 &&
    completedIterations >= MATERIALIZATION_CHECKPOINT_ITERATIONS &&
    !tracker.checkpointWarned
  ) {
    tracker.checkpointWarned = true;
    return "[AGENT CHECKPOINT: Three tool iterations are complete. If the user requested a file, artifact, or structured output, create a valid version now before further inspection. Consolidate known facts and use targeted search instead of sequential reads for long files. Continue enrichment only after the required deliverable exists.]";
  }
  if (nextLevel === 0 || nextLevel <= tracker.budgetWarningLevel) return undefined;
  tracker.budgetWarningLevel = nextLevel;
  if (nextLevel === 2) {
    const remainingLabel =
      remainingIterations === undefined
        ? "The active runtime boundary is close."
        : `${remainingIterations} tool iteration${remainingIterations === 1 ? "" : "s"} remain.`;
    return `[AGENT BUDGET WARNING: ${remainingLabel} Finish only essential tool work, then return a complete user-facing response with completed and remaining work. Do not end with a request for the user to tell you to continue.]`;
  }
  const remainingLabel =
    remainingIterations === undefined
      ? "The active runtime budget is 70% used."
      : `${remainingIterations} of ${maxIterations} tool iterations remain.`;
  return `[AGENT BUDGET: ${remainingLabel} Start consolidating the work and reserve room for a complete final response.]`;
}

export function agenticLoopClosingPrompt(
  limitReason: AgenticLoopLimit,
  loopPolicy: AgenticLoopPolicy
): string {
  const boundary =
    limitReason === "maxIterations"
      ? `${loopPolicy.maxIterations ?? "configured"} tool iterations`
      : `${formatRuntimeLimitLabel(loopPolicy.maxRuntimeMs ?? 0)} of active agent runtime`;
  return `The run reached its safety boundary after ${boundary}. Do not call more tools. Return a complete user-facing status now: summarize what was completed, report the latest verified state, and identify any unfinished work without asking the user to tell you to continue.`;
}

export function pauseAgenticLoopRuntime(
  tracker: AgenticLoopRuntimeTracker,
  now = Date.now()
): void {
  if (tracker.activeToolCount === 0) {
    tracker.pausedAt = now;
  }
  tracker.activeToolCount += 1;
}

export function resumeAgenticLoopRuntime(
  tracker: AgenticLoopRuntimeTracker,
  now = Date.now()
): void {
  if (tracker.activeToolCount <= 0) return;
  tracker.activeToolCount -= 1;
  if (tracker.activeToolCount === 0 && tracker.pausedAt !== undefined) {
    tracker.pausedMs += Math.max(0, now - tracker.pausedAt);
    tracker.pausedAt = undefined;
  }
}

export function agenticLoopActiveRuntimeMs(
  tracker: AgenticLoopRuntimeTracker,
  now = Date.now()
): number {
  const currentPauseMs =
    tracker.activeToolCount > 0 && tracker.pausedAt !== undefined
      ? Math.max(0, now - tracker.pausedAt)
      : 0;
  return Math.max(0, now - tracker.startedAt - tracker.pausedMs - currentPauseMs);
}

export function updateNoProgressLoopState(
  loopState: AgenticLoopState,
  iterationToolCalls: AgentToolCallResult[]
): number {
  if (iterationToolCalls.length === 0) {
    loopState.previousFingerprint = undefined;
    loopState.noProgressStreak = 0;
    loopState.warningBucket = -1;
    return 0;
  }
  const iterationFingerprint = buildToolIterationFingerprint(iterationToolCalls);
  if (!iterationFingerprint) {
    loopState.previousFingerprint = undefined;
    loopState.noProgressStreak = 0;
    loopState.warningBucket = -1;
    return 0;
  }
  if (iterationFingerprint === loopState.previousFingerprint) {
    loopState.noProgressStreak += 1;
  } else {
    loopState.noProgressStreak = 1;
    loopState.warningBucket = -1;
  }
  loopState.previousFingerprint = iterationFingerprint;
  return loopState.noProgressStreak;
}

export function evaluateNoProgressLoop(
  providerLabel: string,
  noProgressStreak: number,
  loopState: AgenticLoopState,
  loopPolicy: AgenticLoopPolicy
): LoopEvaluation {
  if (!loopPolicy.loopDetectionEnabled || noProgressStreak <= 0) return { stop: false };
  if (noProgressStreak >= loopPolicy.globalCircuitBreakerThreshold) {
    console.warn(
      `[Agent] ${providerLabel} tool loop global circuit breaker triggered (${noProgressStreak} repeated no-progress iterations); stopping early`
    );
    return {
      stop: true,
      message:
        "I stopped because tool calls were repeating with no progress and hit the global loop circuit breaker. Please refine the request and try again.",
    };
  }
  if (noProgressStreak >= loopPolicy.criticalThreshold) {
    console.warn(
      `[Agent] ${providerLabel} tool loop reached critical no-progress threshold (${noProgressStreak} iterations); stopping early`
    );
    return {
      stop: true,
      message:
        "I stopped because tool calls were repeating with no progress. Please refine the request and try again.",
    };
  }
  if (noProgressStreak >= loopPolicy.warningThreshold) {
    const warningBucket = Math.floor(noProgressStreak / LOOP_WARNING_BUCKET_SIZE);
    if (warningBucket > loopState.warningBucket) {
      loopState.warningBucket = warningBucket;
      console.warn(
        `[Agent] ${providerLabel} tool loop warning: ${noProgressStreak} repeated no-progress iterations`
      );
    }
  }
  return { stop: false };
}

export function resolveAgenticLoopLimit(
  loopPolicy: AgenticLoopPolicy,
  iterations: number,
  runtimeTracker: AgenticLoopRuntimeTracker,
  now = Date.now()
): AgenticLoopLimit | undefined {
  if (typeof loopPolicy.maxIterations === "number" && iterations >= loopPolicy.maxIterations) {
    return "maxIterations";
  }
  if (
    typeof loopPolicy.maxRuntimeMs === "number" &&
    agenticLoopActiveRuntimeMs(runtimeTracker, now) >= loopPolicy.maxRuntimeMs
  ) {
    return "runtime";
  }
  return undefined;
}

function formatRuntimeLimitLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "unknown";
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

export function applyAgenticLoopLimitMessage(
  providerLabel: string,
  limitReason: AgenticLoopLimit,
  loopPolicy: AgenticLoopPolicy,
  finalContent: string
): string {
  if (limitReason === "maxIterations") {
    console.log(
      `[Agent] ${providerLabel} agentic loop reached configured max iterations (${loopPolicy.maxIterations})`
    );
    return finalContent.trim()
      ? finalContent
      : `The configured tool-iteration safety boundary (${loopPolicy.maxIterations}) was reached. Completed tool work is preserved in this chat.`;
  }
  const runtimeLabel = formatRuntimeLimitLabel(loopPolicy.maxRuntimeMs ?? 0);
  console.log(
    `[Agent] ${providerLabel} agentic loop reached active runtime limit (${runtimeLabel})`
  );
  return finalContent.trim()
    ? finalContent
    : `The active agent runtime safety boundary (${runtimeLabel}) was reached. Completed tool work is preserved in this chat.`;
}
