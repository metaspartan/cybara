import type { SessionGoal } from "./session-goals";
import { config } from "./config";

export interface GoalLoopLimits {
  maxIterations: number;
  maxDurationSeconds: number;
}

const GOAL_LOOP_MAX_ITERATIONS_DEFAULT = 25;
const GOAL_LOOP_MAX_DURATION_SECONDS_DEFAULT = 3600;
const GOAL_LOOP_MAX_CONSECUTIVE_FAILURES = 3;
const LOOP_STATE_PERSIST_KEY = "session_goal_loop_state";
const MAX_PERSISTED_LOOP_STATES = 200;
export const GOAL_LOOP_STOP_REASONS = [
  "paused",
  "blocked",
  "complete",
  "cleared",
  "max_iterations",
  "max_duration",
  "done",
  "no_goal",
  "error",
] as const;
export type GoalLoopStopReason = (typeof GOAL_LOOP_STOP_REASONS)[number];

export interface GoalLoopState {
  iterations: number;
  startedAtMs: number;
  stopReason?: GoalLoopStopReason;
  consecutiveFailures: number;
  lastIterationAtMs?: number;
}

interface PersistedLoopState {
  sessionId: string;
  iterations: number;
  startedAtMs: number;
  stopReason?: GoalLoopStopReason;
  consecutiveFailures: number;
  lastIterationAtMs?: number;
}

const loopState = new Map<string, GoalLoopState>();
let loopStateLoaded = false;
export const GOAL_LOOP_SOURCE = "goal_loop";

export function isGoalLoopCheckpointReason(reason: GoalLoopStopReason | "scheduled"): boolean {
  return reason === "max_iterations" || reason === "max_duration";
}

function isPersistedLoopState(value: unknown): value is PersistedLoopState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sessionId === "string" &&
    typeof candidate.iterations === "number" &&
    typeof candidate.startedAtMs === "number" &&
    Number.isFinite(candidate.iterations) &&
    Number.isFinite(candidate.startedAtMs) &&
    candidate.iterations >= 0 &&
    (candidate.stopReason === undefined ||
      (typeof candidate.stopReason === "string" &&
        GOAL_LOOP_STOP_REASONS.includes(candidate.stopReason as GoalLoopStopReason)))
  );
}

function loadPersistedStates(): Map<string, GoalLoopState> {
  if (loopStateLoaded) return loopState;
  loopStateLoaded = true;
  try {
    const stored = config.get<unknown>(LOOP_STATE_PERSIST_KEY);
    if (Array.isArray(stored)) {
      for (const entry of stored) {
        if (!isPersistedLoopState(entry)) continue;
        const state: GoalLoopState = {
          iterations: entry.iterations,
          startedAtMs: entry.startedAtMs,
          stopReason: entry.stopReason,
          consecutiveFailures:
            typeof entry.consecutiveFailures === "number" ? entry.consecutiveFailures : 0,
          lastIterationAtMs: entry.lastIterationAtMs,
        };
        loopState.set(entry.sessionId, state);
      }
    }
  } catch {
    void 0;
  }
  return loopState;
}

function persistLoopState(): void {
  const retained = Array.from(loopState.entries())
    .map(
      ([sessionId, state]): PersistedLoopState => ({
        sessionId,
        iterations: state.iterations,
        startedAtMs: state.startedAtMs,
        stopReason: state.stopReason,
        consecutiveFailures: state.consecutiveFailures,
        lastIterationAtMs: state.lastIterationAtMs,
      })
    )
    .sort((a, b) => (b.lastIterationAtMs ?? b.startedAtMs) - (a.lastIterationAtMs ?? a.startedAtMs))
    .slice(0, MAX_PERSISTED_LOOP_STATES);
  try {
    config.set(LOOP_STATE_PERSIST_KEY, retained);
  } catch {
    void 0;
  }
}

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
  const state: GoalLoopState = {
    iterations: 0,
    startedAtMs: nowMs,
    consecutiveFailures: 0,
  };
  loadPersistedStates().set(sessionId, state);
  persistLoopState();
  return state;
}

export function getGoalLoopState(sessionId: string): GoalLoopState | undefined {
  return loadPersistedStates().get(sessionId);
}

export function bumpGoalLoopIteration(sessionId: string): number {
  const state = loadPersistedStates().get(sessionId);
  if (!state) return 0;
  state.iterations += 1;
  state.stopReason = undefined;
  state.lastIterationAtMs = Date.now();
  persistLoopState();
  return state.iterations;
}

export function markGoalLoopStopped(sessionId: string, reason: GoalLoopStopReason): void {
  const state = loadPersistedStates().get(sessionId);
  if (!state) return;
  state.stopReason = reason;
  persistLoopState();
}

export function recordGoalIterationOutcome(sessionId: string, ok: boolean): void {
  const state = loadPersistedStates().get(sessionId);
  if (!state) return;
  if (ok) {
    state.consecutiveFailures = 0;
  } else {
    state.consecutiveFailures += 1;
    state.lastIterationAtMs = Date.now();
  }
  persistLoopState();
}

export function resetGoalLoop(sessionId: string): void {
  loadPersistedStates().delete(sessionId);
  persistLoopState();
}

export type GoalIterationDecision =
  | {
      schedule: true;
      reason: "scheduled";
      prompt: string;
      checkpoint: false;
    }
  | {
      schedule: false;
      reason: GoalLoopStopReason;
      checkpoint: boolean;
    };

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
    return { schedule: false, reason, checkpoint: false };
  }
  if (!state) {
    return {
      schedule: true,
      reason: "scheduled",
      checkpoint: false,
      prompt: goalIterationPrompt(goal, 1, limits),
    };
  }
  if (state.stopReason && state.stopReason !== "cleared") {
    return {
      schedule: false,
      reason: state.stopReason,
      checkpoint: isGoalLoopCheckpointReason(state.stopReason),
    };
  }
  if (state.consecutiveFailures >= GOAL_LOOP_MAX_CONSECUTIVE_FAILURES) {
    return { schedule: false, reason: "error", checkpoint: true };
  }
  if (state.iterations >= limits.maxIterations) {
    return { schedule: false, reason: "max_iterations", checkpoint: true };
  }
  const elapsedSeconds = (now - state.startedAtMs) / 1000;
  if (elapsedSeconds > limits.maxDurationSeconds) {
    return { schedule: false, reason: "max_duration", checkpoint: true };
  }
  return {
    schedule: true,
    reason: "scheduled",
    checkpoint: false,
    prompt: goalIterationPrompt(goal, state.iterations + 1, limits),
  };
}

export function goalIterationPrompt(
  goal: SessionGoal,
  iteration: number,
  limits?: GoalLoopLimits
): string {
  const budgetLine = limits
    ? `This run may continue for up to ${limits.maxIterations} iterations before the loop pauses for a checkpoint.`
    : "The loop continues automatically after each turn.";
  return [
    `[autonomous goal iteration ${iteration}]`,
    `Continue working toward the active goal: ${goal.objective}`,
    "Make concrete progress this turn and use tools only when they help advance or verify the goal.",
    budgetLine,
    "Reply DONE: when the goal is fully complete.",
    "Reply BLOCKED: <reason> if you cannot make further progress without user input.",
  ].join("\n");
}

export function goalResponseSignalsDone(response: string): boolean {
  const content = response.trim();
  const donePrefix = content.match(/^done:\s*/i);
  if (donePrefix) return true;
  const finalLine = content.split(/\r?\n/).at(-1)?.trim() || "";
  if (/^done:\s*/i.test(finalLine)) return true;
  if (/\[done\]/i.test(content) || /<done>\s*true\s*<\/done>/i.test(content)) return true;
  return false;
}

export function goalResponseSignalBlocked(response: string): string | null {
  const content = response.trim();
  const blockedPrefix = content.match(/^blocked:\s*([\s\S]*)$/i);
  if (blockedPrefix) return blockedPrefix[1]?.trim() || "blocked by the agent";
  if (/\[blocked\]/i.test(content)) return "blocked by the agent";
  return null;
}

export function isGoalIterationMessage(message: string): boolean {
  return message.trimStart().startsWith("[autonomous goal iteration");
}

export function resetGoalLoopsForTests(): void {
  loopStateLoaded = true;
  loopState.clear();
  try {
    config.set(LOOP_STATE_PERSIST_KEY, []);
  } catch {
    void 0;
  }
}

export function reloadGoalLoopsFromStoreForTests(): void {
  loopState.clear();
  loopStateLoaded = false;
  loadPersistedStates();
}
