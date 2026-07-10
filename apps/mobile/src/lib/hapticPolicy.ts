export type HapticEvent =
  | "selection"
  | "light"
  | "medium"
  | "success"
  | "warning"
  | "agent_start"
  | "agent_progress"
  | "agent_complete"
  | "message_sent";

export interface HapticPolicy {
  isEnabled: () => boolean;
  setEnabled: (enabled: boolean) => void;
  shouldRun: (event: HapticEvent, now?: number) => boolean;
}

export function createHapticPolicy(progressIntervalMs = 1400): HapticPolicy {
  let enabled = false;
  let lastProgressAt = Number.NEGATIVE_INFINITY;

  return {
    isEnabled: () => enabled,
    setEnabled: (next) => {
      enabled = next;
      if (!next) lastProgressAt = Number.NEGATIVE_INFINITY;
    },
    shouldRun: (event, now = Date.now()) => {
      if (!enabled) return false;
      if (event !== "agent_progress") return true;
      if (now - lastProgressAt < progressIntervalMs) return false;
      lastProgressAt = now;
      return true;
    },
  };
}
