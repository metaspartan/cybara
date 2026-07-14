import {
  LOOP_WARNING_BUCKET_SIZE,
  buildToolIterationFingerprint,
  type AgentToolCallResult,
  type AgenticLoopPolicy,
  type AgenticLoopState,
} from "./agent-internals";

export type AgenticLoopLimit = "maxIterations" | "runtime";

export interface AgenticLoopRuntimeTracker {
  activeToolCount: number;
  pausedAt?: number;
  pausedMs: number;
  startedAt: number;
}

export interface LoopEvaluation {
  stop: boolean;
  message?: string;
}

export function createAgenticLoopRuntimeTracker(now = Date.now()): AgenticLoopRuntimeTracker {
  return {
    activeToolCount: 0,
    pausedMs: 0,
    startedAt: now,
  };
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
      : `I reached the configured tool-iteration limit (${loopPolicy.maxIterations}) for this turn. Ask me to continue and I'll resume from here.`;
  }
  const runtimeLabel = formatRuntimeLimitLabel(loopPolicy.maxRuntimeMs ?? 0);
  console.log(
    `[Agent] ${providerLabel} agentic loop reached active runtime limit (${runtimeLabel})`
  );
  return finalContent.trim()
    ? finalContent
    : `I reached the active agent runtime limit (${runtimeLabel}) for this turn. Ask me to continue and I'll resume from here.`;
}
