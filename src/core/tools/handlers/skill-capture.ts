import { config } from "../../config";
import type { ToolContext } from "../index";

const MAX_TRACKED_CAPTURE_SESSIONS = 500;
const MIN_MUTATIONS_FOR_CAPTURE = 2;
const MIN_DISTINCT_TOOLS_FOR_CAPTURE = 3;
const MAX_CAPTURE_NUDGES = 2;

const MUTATION_TOOLS = new Set(["write", "edit", "apply_patch", "exec", "process", "execute_code"]);
const VERIFICATION_TOOLS = new Set(["exec", "process", "execute_code", "read", "browser"]);

interface CaptureState {
  distinctTools: Set<string>;
  mutations: number;
  mutationSinceLastNudge: boolean;
  loadedSkill: boolean;
  savedSkill: boolean;
  nudgeCount: number;
}

const captureStateBySession = new Map<string, CaptureState>();

function stateFor(sessionId: string | undefined): CaptureState {
  const key = sessionId || "__default__";
  const existing = captureStateBySession.get(key);
  if (existing) return existing;
  if (captureStateBySession.size >= MAX_TRACKED_CAPTURE_SESSIONS) {
    const oldest = captureStateBySession.keys().next().value;
    if (oldest !== undefined) captureStateBySession.delete(oldest);
  }
  const created: CaptureState = {
    distinctTools: new Set<string>(),
    mutations: 0,
    mutationSinceLastNudge: false,
    loadedSkill: false,
    savedSkill: false,
    nudgeCount: 0,
  };
  captureStateBySession.set(key, created);
  return created;
}

export function noteSkillLoadedForSession(context?: ToolContext): void {
  stateFor(context?.sessionId).loadedSkill = true;
}

export function noteSkillSavedForSession(context?: ToolContext): void {
  stateFor(context?.sessionId).savedSkill = true;
}

export function noteSkillCaptureOpportunity(
  toolName: string,
  context?: ToolContext
): string | null {
  if (config.get<boolean>("self_improving_skills_enabled") === false) return null;
  const state = stateFor(context?.sessionId);

  if (toolName === "skill_save") {
    state.savedSkill = true;
    return null;
  }
  if (toolName === "skill_load") {
    state.loadedSkill = true;
    return null;
  }

  state.distinctTools.add(toolName);
  if (MUTATION_TOOLS.has(toolName)) {
    state.mutations += 1;
    state.mutationSinceLastNudge = true;
  }

  if (state.savedSkill || state.loadedSkill) return null;
  if (!VERIFICATION_TOOLS.has(toolName)) return null;
  if (!state.mutationSinceLastNudge) return null;
  if (state.mutations < MIN_MUTATIONS_FOR_CAPTURE) return null;
  if (state.distinctTools.size < MIN_DISTINCT_TOOLS_FOR_CAPTURE) return null;
  if (state.nudgeCount >= MAX_CAPTURE_NUDGES) return null;

  state.nudgeCount += 1;
  state.mutationSinceLastNudge = false;
  return "Skill check: you have built and verified a multi-step workflow that no existing skill covered. If this procedure is likely to recur, call skill_save now — before your final answer — with a concise SKILL.md-style writeup (when to use it, prerequisites, and the exact steps that worked). Skip it only if this was genuinely one-off work.";
}

export function resetSkillCaptureStateForTests(): void {
  captureStateBySession.clear();
}
