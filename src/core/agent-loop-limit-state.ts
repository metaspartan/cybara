export type AgenticLoopLimitReason = "maxIterations" | "runtime";

export interface AgenticLoopLimitState {
  limitReason?: AgenticLoopLimitReason;
}

export function createAgenticLoopLimitState(): AgenticLoopLimitState {
  return {};
}

export function recordAgenticLoopLimit(
  state: AgenticLoopLimitState | undefined,
  reason: AgenticLoopLimitReason
): void {
  if (!state) return;
  state.limitReason ??= reason;
}

export function describeAgenticLoopLimit(
  state: AgenticLoopLimitState | undefined,
  maxIterations?: number
): string | undefined {
  const reason = state?.limitReason;
  if (!reason) return undefined;
  if (reason === "runtime") return "active runtime boundary";
  return `tool-iteration boundary (${maxIterations ?? "configured"})`;
}
