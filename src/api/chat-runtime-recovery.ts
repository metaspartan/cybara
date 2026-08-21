import { resumePersistedActiveGoalLoops } from "./chat-goal-runtime";
import { restorePersistedPendingChatQueues } from "./chat-runtime";

type ChatRuntimeRecoveryScheduler = (callback: () => void, delayMs: number) => void;

let persistedChatRuntimeRecoveryStarted = false;

export function schedulePersistedChatRuntimeRecovery(
  schedule: ChatRuntimeRecoveryScheduler,
  restorePending: () => number,
  resumeGoals: () => number
): void {
  schedule(restorePending, 1200);
  schedule(resumeGoals, 5000);
}

export function startPersistedChatRuntimeRecovery(): boolean {
  if (persistedChatRuntimeRecoveryStarted) return false;
  persistedChatRuntimeRecoveryStarted = true;
  schedulePersistedChatRuntimeRecovery(
    (callback, delayMs) => {
      setTimeout(callback, delayMs);
    },
    restorePersistedPendingChatQueues,
    resumePersistedActiveGoalLoops
  );
  return true;
}
