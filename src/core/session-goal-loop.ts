import type { SessionGoal } from "./session-goals";
import { config } from "./config";

export interface GoalLoopLimits {
  maxIterations: number;
  maxDurationSeconds: number;
}

const GOAL_LOOP_MAX_ITERATIONS_DEFAULT = 8;
const GOAL_LOOP_MAX_DURATION_SECONDS_DEFAULT = 1800;
export const GOAL_LOOP_STOP_REASONS = [
  "paused",
  "blocked",
  "complete",
  "cleared",
  "max_iterations",
  "max_duration",
  "done",
  "no_goal",
] as const;
export type GoalLoopStopReason = (typeof GOAL_LOOP_STOP_REASONS)[number];

export interface GoalLoopState {
  iterations: number;
  startedAtMs: number;
}

const loopState = new Map<string, GoalLoopState>();
export const GOAL_LOOP_SOURCE = "goal_loop";

export function readGoalLoopLimits(): GoalLoopLimits {
  const maxIterationsRaw = config.get<unknown>("goal_loop_max_iterations");
  const maxDurationRaw = config.get<unknown>("goal_loop_max_duration_seconds");

  const maxIterations =
    typeof maxIterationsRaw === "number" && Number.isFinite(maxIterationsRaw)
      ? Math.max(1, Math.min(50, Math.floor(maxIterationsRaw)))
      : GOAL_LOOP_MAX_ITERATIONS_DEFAULT;
  const maxDurationSeconds =
    typeof maxDurationRaw === "number" && Number.isFinite(maxDurationRaw)
      ? Math.max(30, Math.min(3600, Math.floor(maxDurationRaw)))
      : GOAL_LOOP_MAX_DURATION_SECONDS_DEFAULT;

  return { maxIterations, maxDurationSeconds };
}

export function registerGoalLoopStart(sessionId: string, nowMs = Date.now()): GoalLoopState {
  const state: GoalLoopState = { iterations: 0, startedAtMs: nowMs };
  loopState.set(sessionId, state);
  return state;
}

export function getGoalLoopState(sessionId: string): GoalLoopState | undefined {
  return loopState.get(sessionId);
}

export function bumpGoalLoopIteration(sessionId: string): number {
  const state = loopState.get(sessionId);
  if (!state) return 0;
  state.iterations += 1;
  return state.iterations;
}

export function resetGoalLoop(sessionId: string): void {
  loopState.delete(sessionId);
}

export interface GoalIterationDecision {
  schedule: boolean;
  reason: GoalLoopStopReason | "scheduled";
  prompt?: string;
}

export function decideNextGoalIteration(input: {
  goal: SessionGoal | undefined;
  state: GoalLoopState | undefined;
  limits: GoalLoopLimits;
  nowMs?: number;
}): GoalIterationDecision {
  const now = input.nowMs ?? Date.now();
  const { goal, state, limits } = input;
  if (!goal || goal.status !== "active") {
    const reason: GoalLoopStopReason = !goal
      ? "no_goal"
      : goal.status === "paused"
        ? "paused"
        : goal.status === "blocked"
          ? "blocked"
          : "complete";
    return { schedule: false, reason };
  }
  if (!state) {
    return { schedule: true, reason: "scheduled", prompt: goalIterationPrompt(goal, 1) };
  }
  if (state.iterations >= limits.maxIterations) {
    return { schedule: false, reason: "max_iterations" };
  }
  const elapsedSeconds = (now - state.startedAtMs) / 1000;
  if (elapsedSeconds > limits.maxDurationSeconds) {
    return { schedule: false, reason: "max_duration" };
  }
  return {
    schedule: true,
    reason: "scheduled",
    prompt: goalIterationPrompt(goal, state.iterations + 1),
  };
}

export function goalIterationPrompt(goal: SessionGoal, iteration: number): string {
  return [
    `[autonomous goal iteration ${iteration}]`,
    `Continue working toward the active goal: ${goal.objective}`,
    "Make concrete progress with tools. Update the goal status with /goal when done.",
    "Reply with DONE: if the goal is fully complete.",
  ].join("\n");
}

export function goalResponseSignalsDone(response: string): boolean {
  const content = response.trim();
  const donePrefix = content.match(/^done:\s*/i);
  if (donePrefix) return true;
  if (/\[done\]/i.test(content) || /<done>\s*true\s*<\/done>/i.test(content)) return true;
  return false;
}

export function isGoalIterationMessage(message: string): boolean {
  return message.trimStart().startsWith("[autonomous goal iteration");
}

export function resetGoalLoopsForTests(): void {
  loopState.clear();
}
