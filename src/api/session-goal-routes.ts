import { applyGoalCommandSideEffects } from "./chat-runtime";
import {
  clearSessionGoal,
  getSessionGoal,
  handleSessionGoalCommand,
  type SessionGoal,
} from "../core/session-goals";
import { getGoalLoopState, type GoalLoopStopReason } from "../core/session-goal-loop";
import type { RouteHandler } from "./routes/_shared";

interface SessionGoalWithLoop extends SessionGoal {
  loop: {
    iterations: number;
    stopped_reason: GoalLoopStopReason | null;
    consecutive_failures: number;
  } | null;
}

function goalNote(body: unknown): string {
  const data = (body || {}) as { note?: unknown };
  return typeof data.note === "string" ? data.note.trim() : "";
}

function goalWithLoop(goal: SessionGoal | null | undefined): SessionGoalWithLoop | null {
  if (!goal) return null;
  const loop = getGoalLoopState(goal.sessionId);
  return {
    ...goal,
    loop: loop
      ? {
          iterations: loop.iterations,
          stopped_reason: loop.stopReason ?? null,
          consecutive_failures: loop.consecutiveFailures,
        }
      : null,
  };
}

function goalMutationResult(result: {
  handled: boolean;
  response?: string;
  goal?: SessionGoal | null;
}): { success: boolean; error?: string; goal: SessionGoalWithLoop | null; response?: string } {
  return {
    success: result.handled,
    error: result.handled ? undefined : "Session goal operation failed.",
    goal: goalWithLoop(result.goal),
    response: result.response,
  };
}

export const sessionGoalRoutes: Record<string, RouteHandler> = {
  "GET /api/sessions/:sessionId/goal": async (_body, params) => {
    const sessionId = params!.sessionId;
    return { success: true, sessionId, goal: goalWithLoop(getSessionGoal(sessionId)) };
  },
  "POST /api/sessions/:sessionId/goal": async (body, params) => {
    const sessionId = params!.sessionId;
    const data = (body || {}) as { objective?: string };
    const objective = typeof data.objective === "string" ? data.objective.trim() : "";
    if (!objective) return { success: false, error: "Goal objective is required." };
    const result = handleSessionGoalCommand(sessionId, `/goal start ${objective}`);
    applyGoalCommandSideEffects(sessionId, result.action, result.goal);
    return {
      success: result.handled,
      error: result.handled ? undefined : "Failed to set goal.",
      goal: goalWithLoop(result.goal),
      response: result.response,
    };
  },
  "POST /api/sessions/:sessionId/goal/pause": async (body, params) => {
    const sessionId = params!.sessionId;
    const note = goalNote(body);
    const result = handleSessionGoalCommand(
      sessionId,
      note ? `/goal pause waiting: ${note}` : "/goal pause"
    );
    applyGoalCommandSideEffects(sessionId, result.action, result.goal);
    return goalMutationResult(result);
  },
  "POST /api/sessions/:sessionId/goal/resume": async (body, params) => {
    const sessionId = params!.sessionId;
    const note = goalNote(body);
    const result = handleSessionGoalCommand(
      sessionId,
      note ? `/goal resume back: ${note}` : "/goal resume"
    );
    applyGoalCommandSideEffects(sessionId, result.action, result.goal);
    return goalMutationResult(result);
  },
  "POST /api/sessions/:sessionId/goal/complete": async (body, params) => {
    const sessionId = params!.sessionId;
    const note = goalNote(body);
    const result = handleSessionGoalCommand(
      sessionId,
      note ? `/goal complete done: ${note}` : "/goal complete"
    );
    applyGoalCommandSideEffects(sessionId, result.action, result.goal);
    return goalMutationResult(result);
  },
  "POST /api/sessions/:sessionId/goal/clear": async (_body, params) => {
    const sessionId = params!.sessionId;
    const cleared = clearSessionGoal(sessionId);
    applyGoalCommandSideEffects(sessionId, "clear", null);
    return { success: true, cleared, goal: null };
  },
};
