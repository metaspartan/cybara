import type { LiveActivityItem } from "@/lib/chatActivities";
import { COMPUTER_FOCUS_UNAVAILABLE_ERROR } from "../../../../shared/computer-preview";

export const COMPUTER_PREVIEW_IDLE_DISMISS_MS = 45_000;

const COMPUTER_USE_TOOL_NAMES = new Set([
  "computer_use",
  "computer-use",
  "computeruse",
  "capture",
  "move",
  "click",
  "double_click",
  "right_click",
  "middle_click",
  "scroll",
  "drag",
  "type",
  "key",
  "set_value",
  "wait",
  "list_apps",
  "focus_app",
  "screenshot",
  "screen_capture",
  "desktop_screenshot",
  "capture_screen",
  "take_screenshot",
]);

export function isAgentUsingBrowser(
  activities: LiveActivityItem[],
  sessionActive: boolean
): boolean {
  if (!sessionActive) return false;
  return activities.some(
    (activity) =>
      activity.phase === "start" && (activity.toolName || "").toLowerCase().includes("browser")
  );
}

export function isAgentUsingComputer(
  activities: LiveActivityItem[],
  sessionActive: boolean
): boolean {
  if (!sessionActive) return false;
  return activities.some(
    (activity) =>
      activity.phase === "start" &&
      COMPUTER_USE_TOOL_NAMES.has((activity.toolName || "").trim().toLowerCase())
  );
}

export function computerPreviewDismissDelayMs(state: {
  active: boolean;
  available: boolean;
}): number | null {
  if (!state.available || state.active) return null;
  return COMPUTER_PREVIEW_IDLE_DISMISS_MS;
}

export function isComputerFocusUnavailableError(message: string): boolean {
  return message.trim() === COMPUTER_FOCUS_UNAVAILABLE_ERROR;
}
