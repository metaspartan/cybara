export type SetupGateDecision = "children" | "spinner" | "redirect";

export interface SetupGateInput {
  pathname: string;
  setupComplete: boolean;
  setupReady: boolean;
  cachedSetupComplete: boolean;
}

export function resolveSetupGate(input: SetupGateInput): SetupGateDecision {
  if (input.pathname === "/setup") return "children";

  if (!input.setupReady) {
    return input.cachedSetupComplete ? "children" : "spinner";
  }

  return input.setupComplete ? "children" : "redirect";
}
