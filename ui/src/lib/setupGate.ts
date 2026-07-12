export type SetupGateDecision = "children" | "spinner" | "redirect";

const SETUP_COMPLETE_KEY = "cybara.setupComplete";

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

export function readSetupComplete(): boolean {
  try {
    return localStorage.getItem(SETUP_COMPLETE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSetupComplete(done: boolean): void {
  try {
    if (done) localStorage.setItem(SETUP_COMPLETE_KEY, "1");
    else localStorage.removeItem(SETUP_COMPLETE_KEY);
  } catch {}
}

export function commitSetupComplete(
  updateQuery: (key: readonly string[], value: { complete: boolean }) => void
): void {
  updateQuery(["setup", "status"], { complete: true });
  writeSetupComplete(true);
}
