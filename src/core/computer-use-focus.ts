const MUTATING_ACTIONS = new Set([
  "click",
  "double_click",
  "right_click",
  "middle_click",
  "type",
  "key",
  "set_value",
  "drag",
  "scroll",
  "focus_app",
  "capture",
]);

const ACTIVE_TTL_MS = 90_000;
const INTERFERENCE_GRACE_MS = 1_200;

export interface ComputerUseFocusState {
  sessionId: string;
  agentApp: string;
  startedAt: number;
  lastAgentActionAt: number;
  agentAppBeforeAction?: string;
  frontmostApp?: string;
  interferenceAt?: number;
  interferenceReason?: string;
  interferenceCount: number;
}

export interface ComputerUseInterferenceOutcome {
  blocked: boolean;
  reason: string | undefined;
  interferenceCount: number;
}

const focusStates = new Map<string, ComputerUseFocusState>();

export function isFocusMutatingAction(action: string): boolean {
  return MUTATING_ACTIONS.has(action);
}

function normalizeApp(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function beginComputerUseFocus(
  sessionIdValue: string,
  agentApp: string,
  frontmostApp?: string
): void {
  const sessionId = sessionIdValue.trim();
  if (!sessionId) return;
  const now = Date.now();
  const existing = focusStates.get(sessionId);
  focusStates.set(sessionId, {
    sessionId,
    agentApp: normalizeApp(agentApp) || existing?.agentApp || "",
    startedAt: existing?.startedAt ?? now,
    lastAgentActionAt: now,
    agentAppBeforeAction: normalizeApp(frontmostApp),
    frontmostApp: normalizeApp(frontmostApp) || existing?.frontmostApp,
    interferenceCount: existing?.interferenceCount ?? 0,
  });
}

export function getComputerUseFocusState(
  sessionIdValue: string
): ComputerUseFocusState | undefined {
  return focusStates.get(sessionIdValue.trim());
}

export function endComputerUseFocus(sessionIdValue: string): void {
  focusStates.delete(sessionIdValue.trim());
}

export function clearAllComputerUseFocus(): void {
  focusStates.clear();
}

export function listActiveComputerUseFocus(now = Date.now()): Array<{
  sessionId: string;
  app: string;
  startedAt: number;
  lastActionAt: number;
  yieldedToUser: boolean;
  reason: string | null;
}> {
  const active: Array<{
    sessionId: string;
    app: string;
    startedAt: number;
    lastActionAt: number;
    yieldedToUser: boolean;
    reason: string | null;
  }> = [];
  for (const [sessionId, state] of focusStates) {
    if (now - state.lastAgentActionAt > ACTIVE_TTL_MS) {
      focusStates.delete(sessionId);
      continue;
    }
    const yieldedToUser = isUserHoldingFocus(state);
    active.push({
      sessionId,
      app: state.agentApp,
      startedAt: state.startedAt,
      lastActionAt: state.lastAgentActionAt,
      yieldedToUser,
      reason: yieldedToUser ? (state.interferenceReason ?? null) : null,
    });
  }
  return active;
}

export function isUserHoldingFocus(state: ComputerUseFocusState | undefined): boolean {
  if (!state?.interferenceAt) return false;
  if (state.lastAgentActionAt > state.interferenceAt) return false;
  return Date.now() - state.interferenceAt < ACTIVE_TTL_MS;
}

export function detectUserInterference(
  sessionIdValue: string,
  targetApp: string,
  frontmostAppValue: string
): string | undefined {
  const sessionId = sessionIdValue.trim();
  const frontmost = normalizeApp(frontmostAppValue);
  if (!sessionId || !frontmost) return undefined;

  const state = focusStates.get(sessionId);
  if (!state) return undefined;

  const target = normalizeApp(targetApp);
  const observed = normalizeApp(state.frontmostApp);
  const baseline = normalizeApp(state.agentAppBeforeAction);

  if (frontmost === target || frontmost === observed || frontmost === baseline) {
    state.frontmostApp = frontmost;
    return undefined;
  }

  state.frontmostApp = frontmost;
  if (Date.now() - state.lastAgentActionAt < INTERFERENCE_GRACE_MS) return undefined;

  state.interferenceAt = Date.now();
  state.interferenceCount += 1;
  state.interferenceReason = target
    ? `User switched to ${frontmost} while Cybara was working in ${target}.`
    : `User switched to ${frontmost} while Cybara was using the computer.`;
  return state.interferenceReason;
}

export function guardComputerUseAgainstUserInterference(
  sessionIdValue: string,
  targetApp: string,
  frontmostAppValue: string
): ComputerUseInterferenceOutcome {
  const sessionId = sessionIdValue.trim();
  const reason = detectUserInterference(sessionId, targetApp, frontmostAppValue);
  const state = getComputerUseFocusState(sessionId);
  const blocked = isUserHoldingFocus(state);
  return {
    blocked,
    reason: reason ?? (blocked ? (state?.interferenceReason ?? undefined) : undefined),
    interferenceCount: state?.interferenceCount ?? 0,
  };
}
