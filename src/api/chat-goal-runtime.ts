import { createLogger } from "../core/logger";
import {
  bumpGoalLoopIteration,
  decideNextGoalIteration,
  getGoalLoopState,
  goalIterationPrompt,
  goalResponseSignalBlocked,
  goalResponseSignalsDone,
  GOAL_LOOP_SOURCE,
  isGoalIterationMessage,
  markGoalLoopStopped,
  readGoalLoopLimits,
  recordGoalIterationOutcome,
  registerGoalLoopStart,
  resetGoalLoop,
  type GoalLoopStopReason,
} from "../core/session-goal-loop";
import {
  getSessionGoal,
  handleSessionGoalCommand,
  pauseSessionGoal,
  type SessionGoal,
} from "../core/session-goals";
import { type ChatRequest } from "./chat-types";
import { judgeGoalProgress } from "./chat-goal-judge";
import { hasPendingChatMessages } from "./chat-pending-state";
import { chatTurnMutex, getResidentChatSession, pendingChatQueues } from "./chat-runtime-state";
import {
  enqueuePendingChatMessage,
  runChatTurnWithQueueDrain,
  schedulePendingChatDrain,
  stopActiveChatTurn,
} from "./chat-runtime";

const log = createLogger("ChatGoalLoop");
const goalJudgmentsInFlight = new Set<string>();
const goalJudgmentsRequested = new Set<string>();

export function kickOffGoalLoop(sessionId: string, goal: SessionGoal): void {
  try {
    const state = getGoalLoopState(sessionId) ?? registerGoalLoopStart(sessionId);
    const iterationPrompt = goalIterationPrompt(goal, state.iterations + 1, readGoalLoopLimits());
    bumpGoalLoopIteration(sessionId);
    const request: ChatRequest = {
      message: iterationPrompt,
      sessionId,
      source: GOAL_LOOP_SOURCE,
      queueMode: "queue",
    };
    const session = getResidentChatSession(sessionId);
    const sessionLocked = chatTurnMutex.isLocked(sessionId);
    const hasPending = hasPendingChatMessages(sessionId);
    if (session && (sessionLocked || hasPending)) {
      enqueuePendingChatMessage(request, sessionId, "queued");
      schedulePendingChatDrain(sessionId);
      return;
    }
    void runChatTurnWithQueueDrain(request, sessionId);
  } catch (error) {
    log.exception("Goal loop kickoff failed", error, { sessionId });
  }
}

function pauseGoalLoopAtCheckpoint(
  sessionId: string,
  reason: GoalLoopStopReason,
  note: string
): void {
  const goal = pauseSessionGoal(sessionId, note);
  markGoalLoopStopped(sessionId, reason);
  if (goal) {
    void stopActiveChatTurn(sessionId).catch(() => undefined);
  }
  log.info(`Goal loop paused at checkpoint: ${reason}`, { sessionId, note });
}

async function scheduleGoalIterationAfterJudgment(sessionId: string): Promise<void> {
  try {
    const goal = getSessionGoal(sessionId);
    let state = getGoalLoopState(sessionId);
    if (!goal || goal.status !== "active") {
      resetGoalLoop(sessionId);
      return;
    }
    if (!state) {
      state = registerGoalLoopStart(sessionId);
    }
    const session = getResidentChatSession(sessionId);
    const lastAssistant = session?.messages
      ? [...session.messages].reverse().find((message) => message.role === "assistant")
      : undefined;
    if (lastAssistant?.content && goalResponseSignalsDone(lastAssistant.content)) {
      handleSessionGoalCommand(sessionId, "/goal complete done");
      resetGoalLoop(sessionId);
      return;
    }
    if (lastAssistant?.content) {
      const blockedReason = goalResponseSignalBlocked(lastAssistant.content);
      if (blockedReason) {
        pauseGoalLoopAtCheckpoint(
          sessionId,
          "blocked",
          `Blocked: ${blockedReason}. Resume or send /goal resume to continue.`
        );
        return;
      }
    }
    if (hasPendingChatMessages(sessionId) || (pendingChatQueues.get(sessionId)?.length ?? 0) > 0) {
      return;
    }
    const queuedIteration = (pendingChatQueues.get(sessionId) || []).some((item) =>
      isGoalIterationMessage(item.content)
    );
    if (queuedIteration) {
      return;
    }
    if (state.consecutiveFailures === 0 && session && lastAssistant?.content) {
      const judgment = await judgeGoalProgress({
        session,
        goal,
        response: lastAssistant.content,
        iteration: state.iterations,
      });
      const currentGoal = getSessionGoal(sessionId);
      if (!currentGoal || currentGoal.status !== "active") return;
      const latestAssistant = [...session.messages]
        .reverse()
        .find((message) => message.role === "assistant");
      if (latestAssistant !== lastAssistant) {
        goalJudgmentsRequested.add(sessionId);
        return;
      }
      if ((pendingChatQueues.get(sessionId)?.length ?? 0) > 0) return;
      if (judgment.verdict === "done") {
        handleSessionGoalCommand(
          sessionId,
          `/goal complete ${judgment.reason || "Completion verified by the goal judge"}`
        );
        resetGoalLoop(sessionId);
        return;
      }
    }
    const decision = decideNextGoalIteration({
      goal,
      state,
      limits: readGoalLoopLimits(),
    });
    if (!decision.schedule) {
      if (decision.checkpoint) {
        const stopReason: GoalLoopStopReason = decision.reason;
        const checkpointNote =
          stopReason === "error"
            ? `Loop paused after repeated failures. Resume or send /goal resume to continue.`
            : `Loop checkpoint: ${state.iterations} iterations worked so far. Resume or send /goal resume to continue.`;
        pauseGoalLoopAtCheckpoint(sessionId, stopReason, checkpointNote);
      } else {
        resetGoalLoop(sessionId);
      }
      return;
    }
    const iterationPrompt = decision.prompt;
    bumpGoalLoopIteration(sessionId);
    const iterationRequest: ChatRequest = {
      message: iterationPrompt,
      sessionId,
      source: GOAL_LOOP_SOURCE,
      queueMode: "queue",
    };
    if (chatTurnMutex.isLocked(sessionId)) {
      enqueuePendingChatMessage(iterationRequest, sessionId, "queued");
      schedulePendingChatDrain(sessionId);
    } else {
      void runChatTurnWithQueueDrain(iterationRequest, sessionId);
    }
  } catch (error) {
    log.exception("Goal loop iteration scheduling failed", error, { sessionId });
  }
}

export function maybeScheduleGoalIteration(sessionId: string): void {
  if (goalJudgmentsInFlight.has(sessionId)) {
    goalJudgmentsRequested.add(sessionId);
    return;
  }
  goalJudgmentsInFlight.add(sessionId);
  void scheduleGoalIterationAfterJudgment(sessionId).finally(() => {
    goalJudgmentsInFlight.delete(sessionId);
    if (goalJudgmentsRequested.delete(sessionId)) {
      maybeScheduleGoalIteration(sessionId);
    }
  });
}
