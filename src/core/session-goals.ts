export type SessionGoalStatus = "active" | "paused" | "blocked" | "complete";

export interface SessionGoal {
  sessionId: string;
  objective: string;
  status: SessionGoalStatus;
  createdAt: string;
  updatedAt: string;
  lastStatusNote?: string;
}

export interface SessionGoalCommandResult {
  handled: boolean;
  response?: string;
  goal?: SessionGoal | null;
}

const goals = new Map<string, SessionGoal>();

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
  };
  goals.set(sessionId, goal);
  return goal;
}

function updateGoal(
  sessionId: string,
  status: SessionGoalStatus,
  note?: string
): SessionGoal | undefined {
  const goal = goals.get(sessionId);
  if (!goal) return undefined;
  goal.status = status;
  goal.updatedAt = nowIso();
  goal.lastStatusNote = note ? cleanObjective(note) : goal.lastStatusNote;
  return goal;
}

export function getSessionGoal(sessionId: string): SessionGoal | undefined {
  return cloneGoal(goals.get(sessionId));
}

export function clearSessionGoal(sessionId: string): boolean {
  return goals.delete(sessionId);
}

export function getActiveGoalContextLine(sessionId: string): string | null {
  const goal = goals.get(sessionId);
  if (!goal || goal.status !== "active") return null;
  return `Active goal: ${goal.objective} - advance it or update its status with /goal.`;
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
  const current = goals.get(sessionId);

  if (!rest || action === "status" || action === "show") {
    return { handled: true, response: formatGoal(current), goal: cloneGoal(current) || null };
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
    return { handled: true, response: `Goal started: ${goal.objective}`, goal: cloneGoal(goal) };
  }

  if (action === "edit") {
    const objective = cleanObjective(args);
    if (!current) return { handled: true, response: "No goal is set for this session." };
    if (!objective) return { handled: true, response: "Goal objective is required." };
    current.objective = objective;
    current.status = current.status === "complete" ? "active" : current.status;
    current.updatedAt = nowIso();
    current.lastStatusNote = undefined;
    return {
      handled: true,
      response: `Goal updated: ${current.objective}`,
      goal: cloneGoal(current),
    };
  }

  if (action === "pause") {
    const goal = updateGoal(sessionId, "paused", args);
    return {
      handled: true,
      response: goal ? `Goal paused: ${goal.objective}` : "No goal is set for this session.",
      goal: cloneGoal(goal),
    };
  }

  if (action === "resume") {
    const goal = updateGoal(sessionId, "active", args);
    return {
      handled: true,
      response: goal ? `Goal resumed: ${goal.objective}` : "No goal is set for this session.",
      goal: cloneGoal(goal),
    };
  }

  if (action === "complete" || action === "done") {
    const goal = updateGoal(sessionId, "complete", args);
    return {
      handled: true,
      response: goal ? `Goal completed: ${goal.objective}` : "No goal is set for this session.",
      goal: cloneGoal(goal),
    };
  }

  if (action === "block" || action === "blocked") {
    const goal = updateGoal(sessionId, "blocked", args);
    return {
      handled: true,
      response: goal ? `Goal blocked: ${goal.objective}` : "No goal is set for this session.",
      goal: cloneGoal(goal),
    };
  }

  if (action === "clear") {
    const cleared = clearSessionGoal(sessionId);
    return {
      handled: true,
      response: cleared ? "Goal cleared." : "No goal is set for this session.",
      goal: null,
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
  return { handled: true, response: `Goal started: ${goal.objective}`, goal: cloneGoal(goal) };
}

export function resetSessionGoalsForTests(): void {
  goals.clear();
}
