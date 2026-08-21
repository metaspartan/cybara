import { config } from "./config";
import { registerGoalLoopStart, resetGoalLoop } from "./session-goal-loop";

export type SessionGoalStatus = "active" | "paused" | "blocked" | "complete";

export interface SessionGoal {
  sessionId: string;
  objective: string;
  status: SessionGoalStatus;
  createdAt: string;
  updatedAt: string;
  lastStatusNote?: string;
  activeMs?: number;
  lastResumedAt?: string;
}

export interface SessionGoalCommandResult {
  handled: boolean;
  response?: string;
  goal?: SessionGoal | null;
  action?: "start" | "edit" | "pause" | "resume" | "complete" | "block" | "clear" | "status";
}

const PERSISTED_GOALS_KEY = "session_goals";
const MAX_PERSISTED_GOALS = 200;
const COMPLETED_GOAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const goals = new Map<string, SessionGoal>();
let goalsLoaded = false;

function isSessionGoal(value: unknown): value is SessionGoal {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sessionId === "string" &&
    typeof candidate.objective === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

function loadGoals(): Map<string, SessionGoal> {
  if (goalsLoaded) return goals;
  goalsLoaded = true;
  try {
    const stored = config.get<unknown>(PERSISTED_GOALS_KEY);
    if (Array.isArray(stored)) {
      for (const entry of stored) {
        if (isSessionGoal(entry)) goals.set(entry.sessionId, entry);
      }
    }
  } catch {
    void 0;
  }
  return goals;
}

function persistGoals(): void {
  const cutoff = Date.now() - COMPLETED_GOAL_RETENTION_MS;
  const retained = Array.from(goals.values())
    .filter((goal) => {
      if (goal.status !== "complete") return true;
      const updated = Date.parse(goal.updatedAt);
      return !Number.isFinite(updated) || updated >= cutoff;
    })
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, MAX_PERSISTED_GOALS);
  for (const [sessionId, goal] of Array.from(goals.entries())) {
    if (!retained.includes(goal)) goals.delete(sessionId);
  }
  try {
    config.set(PERSISTED_GOALS_KEY, retained);
  } catch {
    void 0;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function cleanObjective(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 2000);
}

function formatGoal(goal: SessionGoal | undefined): string {
  if (!goal) {
    return [
      "No goal is set for this session.",
      "Use `/goal start <objective>` or `/goal <objective>` to create one.",
    ].join("\n");
  }
  const note = goal.lastStatusNote ? `\nNote: ${goal.lastStatusNote}` : "";
  return [`Goal: ${goal.objective}`, `Status: ${goal.status}${note}`].join("\n");
}

function cloneGoal(goal: SessionGoal | undefined): SessionGoal | undefined {
  return goal ? { ...goal } : undefined;
}

function setGoal(sessionId: string, objective: string): SessionGoal {
  const timestamp = nowIso();
  const goal: SessionGoal = {
    sessionId,
    objective,
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    activeMs: 0,
    lastResumedAt: timestamp,
  };
  loadGoals().set(sessionId, goal);
  persistGoals();
  return goal;
}

function updateGoal(
  sessionId: string,
  status: SessionGoalStatus,
  note?: string
): SessionGoal | undefined {
  const goal = loadGoals().get(sessionId);
  if (!goal) return undefined;
  const previousStatus = goal.status;
  const now = Date.now();
  if (previousStatus === "active" && status !== "active") {
    const resumedAt = goal.lastResumedAt ?? goal.createdAt;
    const resumedMs = Date.parse(resumedAt);
    goal.activeMs =
      (goal.activeMs ?? 0) + (Number.isFinite(resumedMs) ? Math.max(0, now - resumedMs) : 0);
    goal.lastResumedAt = undefined;
  } else if (previousStatus !== "active" && status === "active") {
    goal.lastResumedAt = new Date(now).toISOString();
  }
  goal.status = status;
  goal.updatedAt = nowIso();
  goal.lastStatusNote = note ? cleanObjective(note) : goal.lastStatusNote;
  persistGoals();
  return goal;
}

export function sessionGoalElapsedMs(goal: SessionGoal, nowMs = Date.now()): number {
  const accumulated =
    typeof goal.activeMs === "number" && Number.isFinite(goal.activeMs) ? goal.activeMs : 0;
  if (goal.status !== "active") return accumulated;
  const resumedAt = goal.lastResumedAt ?? goal.createdAt;
  const resumedMs = Date.parse(resumedAt);
  if (!Number.isFinite(resumedMs)) return accumulated;
  return accumulated + Math.max(0, nowMs - resumedMs);
}

export function getSessionGoal(sessionId: string): SessionGoal | undefined {
  return cloneGoal(loadGoals().get(sessionId));
}

export function pauseSessionGoal(sessionId: string, note: string): SessionGoal | undefined {
  return updateGoal(sessionId, "paused", note);
}

export function clearSessionGoal(sessionId: string): boolean {
  const deleted = loadGoals().delete(sessionId);
  if (deleted) persistGoals();
  return deleted;
}

export function getActiveGoalContextLine(sessionId: string): string | null {
  const goal = loadGoals().get(sessionId);
  if (!goal || goal.status !== "active") return null;
  return `Active goal: ${goal.objective} — advance it; keep it active until fully achieved; reply DONE: only after concrete verification, or BLOCKED: <reason> only when user input is required.`;
}

export function handleSessionGoalCommand(
  sessionId: string,
  message: string
): SessionGoalCommandResult {
  const trimmed = message.trimStart();
  const match = trimmed.match(/^\/(?:goal|loop)\b[ \t]*([\s\S]*)$/i);
  if (!match) return { handled: false };

  const rest = (match[1] || "").trim();
  const [rawAction = "", ...tail] = rest.split(/\s+/);
  const action = rawAction.toLowerCase();
  const args = tail.join(" ").trim();
  const current = loadGoals().get(sessionId);

  if (!rest || action === "status" || action === "show") {
    return {
      handled: true,
      response: formatGoal(current),
      goal: cloneGoal(current) || null,
      action: "status",
    };
  }

  if (["start", "set", "create"].includes(action)) {
    const objective = cleanObjective(args);
    if (!objective) {
      return { handled: true, response: "Goal objective is required." };
    }
    if (current && current.status !== "complete") {
      return {
        handled: true,
        response:
          "A goal already exists for this session. Use `/goal edit`, `/goal complete`, or `/goal clear` first.",
        goal: cloneGoal(current),
      };
    }
    const goal = setGoal(sessionId, objective);
    registerGoalLoopStart(sessionId);
    return {
      handled: true,
      response: `Goal started: ${goal.objective}`,
      goal: cloneGoal(goal),
      action: "start",
    };
  }

  if (action === "edit") {
    const objective = cleanObjective(args);
    if (!current) return { handled: true, response: "No goal is set for this session." };
    if (!objective) return { handled: true, response: "Goal objective is required." };
    current.objective = objective;
    current.status = current.status === "complete" ? "active" : current.status;
    current.updatedAt = nowIso();
    current.lastStatusNote = undefined;
    persistGoals();
    if (current.status === "active") registerGoalLoopStart(sessionId);
    return {
      handled: true,
      response: `Goal updated: ${current.objective}`,
      goal: cloneGoal(current),
      action: "edit",
    };
  }

  if (action === "pause") {
    resetGoalLoop(sessionId);
    const goal = updateGoal(sessionId, "paused", args);
    return {
      handled: true,
      response: goal ? `Goal paused: ${goal.objective}` : "No goal is set for this session.",
      goal: cloneGoal(goal),
      action: "pause",
    };
  }

  if (action === "resume" || action === "continue") {
    const goal = updateGoal(sessionId, "active", args);
    if (goal) registerGoalLoopStart(sessionId);
    return {
      handled: true,
      response: goal ? `Goal resumed: ${goal.objective}` : "No goal is set for this session.",
      goal: cloneGoal(goal),
      action: "resume",
    };
  }

  if (action === "complete" || action === "done") {
    resetGoalLoop(sessionId);
    const goal = updateGoal(sessionId, "complete", args);
    return {
      handled: true,
      response: goal ? `Goal completed: ${goal.objective}` : "No goal is set for this session.",
      goal: cloneGoal(goal),
      action: "complete",
    };
  }

  if (action === "block" || action === "blocked") {
    resetGoalLoop(sessionId);
    const goal = updateGoal(sessionId, "blocked", args);
    return {
      handled: true,
      response: goal ? `Goal blocked: ${goal.objective}` : "No goal is set for this session.",
      goal: cloneGoal(goal),
      action: "block",
    };
  }

  if (action === "clear") {
    resetGoalLoop(sessionId);
    const cleared = clearSessionGoal(sessionId);
    return {
      handled: true,
      response: cleared ? "Goal cleared." : "No goal is set for this session.",
      goal: null,
      action: "clear",
    };
  }

  const objective = cleanObjective(rest);
  if (!objective) return { handled: true, response: "Goal objective is required." };
  if (current && current.status !== "complete") {
    return {
      handled: true,
      response:
        "A goal already exists for this session. Use `/goal edit`, `/goal complete`, or `/goal clear` first.",
      goal: cloneGoal(current),
    };
  }
  const goal = setGoal(sessionId, objective);
  registerGoalLoopStart(sessionId);
  return {
    handled: true,
    response: `Goal started: ${goal.objective}`,
    goal: cloneGoal(goal),
    action: "start",
  };
}

export function resetSessionGoalsForTests(): void {
  goals.clear();
  goalsLoaded = true;
  persistGoals();
}

export function reloadSessionGoalsFromStoreForTests(): void {
  goals.clear();
  goalsLoaded = false;
  loadGoals();
}
