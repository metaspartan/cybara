import type { TUIFetchAPI } from "./components/chat";

export interface TuiPreferenceCommandResult {
  handled: boolean;
  notice?: string;
  mouseScrolling?: boolean;
  scrollStep?: number;
}

interface TuiPreferenceCommandOptions {
  argument: string;
  command: string;
  fetchAPI: TUIFetchAPI;
  mouseScrolling: boolean;
  scrollStep: number;
}

function isRejectedConfigResponse(value: unknown): boolean {
  if (!value) return true;
  return (
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).success === false
  );
}

async function persistTuiPreferences(
  fetchAPI: TUIFetchAPI,
  mouseScrolling: boolean,
  scrollStep: number
): Promise<boolean> {
  const response = await fetchAPI<unknown>("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tui: { mouseScrolling, scrollStep } }),
  });
  return !isRejectedConfigResponse(response);
}

export async function runTuiPreferenceCommand(
  options: TuiPreferenceCommandOptions
): Promise<TuiPreferenceCommandResult> {
  const mode = options.argument.trim().toLowerCase();
  if (options.command === "mouse") {
    if (mode && !["on", "off", "toggle", "show"].includes(mode)) {
      return { handled: true, notice: "Usage: /mouse [on|off|toggle|show]" };
    }
    if (!mode || mode === "show") {
      return {
        handled: true,
        notice: `Mouse transcript scrolling is ${options.mouseScrolling ? "on" : "off"}.`,
      };
    }
    const enabled = mode === "on" || (mode === "toggle" && !options.mouseScrolling);
    const saved = await persistTuiPreferences(options.fetchAPI, enabled, options.scrollStep);
    if (!saved) return { handled: true, notice: "Gateway rejected the terminal preference." };
    return {
      handled: true,
      mouseScrolling: enabled,
      notice: enabled
        ? "Mouse transcript scrolling enabled. Hold Shift to select terminal text."
        : "Mouse transcript scrolling disabled.",
    };
  }

  if (options.command !== "scroll") return { handled: false };
  if (!mode || mode === "show") {
    return {
      handled: true,
      notice: `Transcript wheel step: ${options.scrollStep} message${options.scrollStep === 1 ? "" : "s"}.`,
    };
  }
  const nextStep = Number(mode);
  if (!Number.isInteger(nextStep) || nextStep < 1 || nextStep > 8) {
    return { handled: true, notice: "Usage: /scroll <1-8|show>" };
  }
  const saved = await persistTuiPreferences(options.fetchAPI, options.mouseScrolling, nextStep);
  if (!saved) return { handled: true, notice: "Gateway rejected the terminal preference." };
  return {
    handled: true,
    notice: `Transcript wheel step set to ${nextStep}.`,
    scrollStep: nextStep,
  };
}
