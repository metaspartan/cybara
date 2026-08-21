import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../../src/core/config";
import {
  decideNextGoalIteration,
  getGoalLoopState,
  goalIterationPrompt,
  goalResponseSignalBlocked,
  goalResponseSignalsDone,
  isGoalIterationMessage,
  markGoalLoopStopped,
  readGoalLoopLimits,
  recordGoalIterationOutcome,
  registerGoalLoopStart,
  reloadGoalLoopsFromStoreForTests,
  reserveGoalLoopIteration,
  resetGoalLoop,
  resetGoalLoopsForTests,
  type GoalLoopState,
} from "../../src/core/session-goal-loop";
import {
  handleSessionGoalCommand,
  pauseSessionGoal,
  sessionGoalElapsedMs,
  type SessionGoal,
} from "../../src/core/session-goals";

afterEach(() => {
  resetGoalLoopsForTests();
  config.set("goal_loop_max_iterations", null);
  config.set("goal_loop_max_duration_seconds", null);
});

function activeGoal(overrides: Partial<SessionGoal> = {}): SessionGoal {
  return {
    sessionId: "s1",
    objective: "review the repo",
    status: "active",
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    activeMs: 0,
    lastResumedAt: "2026-08-18T00:00:00.000Z",
    ...overrides,
  };
}

function loopState(overrides: Partial<GoalLoopState> = {}): GoalLoopState {
  return {
    iterations: 0,
    startedAtMs: Date.parse("2026-08-18T00:00:00.000Z"),
    consecutiveFailures: 0,
    ...overrides,
  };
}

describe("goal loop decision", () => {
  const limits = { maxIterations: 4, maxDurationSeconds: 600 };

  test("schedules the first iteration when no loop state exists", () => {
    const decision = decideNextGoalIteration({
      goal: activeGoal(),
      state: undefined,
      limits,
      nowMs: Date.parse("2026-08-18T00:00:01.000Z"),
    });
    expect(decision.schedule).toBe(true);
    expect(decision.prompt).toContain("review the repo");
    expect(decision.prompt).toContain("iteration 1");
    expect(decision.checkpoint).toBe(false);
  });

  test("schedules while active and within caps", () => {
    const state = loopState({ iterations: 2 });
    const decision = decideNextGoalIteration({
      goal: activeGoal(),
      state,
      limits,
      nowMs: Date.parse("2026-08-18T00:01:00.000Z"),
    });
    expect(decision.schedule).toBe(true);
    expect(decision.prompt).toContain("iteration 3");
    expect(decision.checkpoint).toBe(false);
  });

  test("keeps the scheduled prompt bound to the decision snapshot", () => {
    const state = loopState({ iterations: 2 });
    const decision = decideNextGoalIteration({
      goal: activeGoal(),
      state,
      limits,
      nowMs: Date.parse("2026-08-18T00:01:00.000Z"),
    });
    state.iterations += 1;
    expect(decision.schedule).toBe(true);
    if (!decision.schedule) throw new Error("Expected a scheduled goal iteration");
    expect(decision.prompt).toContain("iteration 3");
    expect(decision.prompt).not.toContain("iteration 4");
  });

  test("stops at max iterations with a checkpoint flag", () => {
    const state = loopState({ iterations: 4 });
    const decision = decideNextGoalIteration({
      goal: activeGoal(),
      state,
      limits,
      nowMs: Date.parse("2026-08-18T00:01:00.000Z"),
    });
    expect(decision).toEqual({
      schedule: false,
      reason: "max_iterations",
      checkpoint: true,
    });
  });

  test("stops past max duration with a checkpoint flag", () => {
    const state = loopState({ iterations: 1 });
    const decision = decideNextGoalIteration({
      goal: activeGoal(),
      state,
      limits,
      nowMs: Date.parse("2026-08-18T00:20:00.000Z"),
    });
    expect(decision).toEqual({
      schedule: false,
      reason: "max_duration",
      checkpoint: true,
    });
  });

  test("stops when the goal is paused, blocked, or complete", () => {
    const state = loopState();
    expect(
      decideNextGoalIteration({
        goal: activeGoal({ status: "paused" }),
        state,
        limits,
      })
    ).toEqual({ schedule: false, reason: "paused", checkpoint: false });
    expect(
      decideNextGoalIteration({
        goal: activeGoal({ status: "blocked" }),
        state,
        limits,
      })
    ).toEqual({ schedule: false, reason: "blocked", checkpoint: false });
    expect(
      decideNextGoalIteration({
        goal: activeGoal({ status: "complete" }),
        state,
        limits,
      })
    ).toEqual({ schedule: false, reason: "complete", checkpoint: false });
    expect(decideNextGoalIteration({ goal: undefined, state, limits })).toEqual({
      schedule: false,
      reason: "no_goal",
      checkpoint: false,
    });
  });

  test("respects a recorded stop reason until the loop is reset", () => {
    const registered = registerGoalLoopStart("s1");
    registered.iterations = 3;
    markGoalLoopStopped("s1", "max_iterations");
    const decision = decideNextGoalIteration({
      goal: activeGoal(),
      state: getGoalLoopState("s1"),
      limits,
    });
    expect(decision).toEqual({
      schedule: false,
      reason: "max_iterations",
      checkpoint: true,
    });
    const fresh = registerGoalLoopStart("s1");
    const active = decideNextGoalIteration({
      goal: activeGoal(),
      state: fresh,
      limits,
      nowMs: Date.parse("2026-08-18T00:01:00.000Z"),
    });
    expect(active.schedule).toBe(true);
  });

  test("stops with a checkpoint after repeated consecutive failures", () => {
    registerGoalLoopStart("s1");
    recordGoalIterationOutcome("s1", false);
    recordGoalIterationOutcome("s1", false);
    recordGoalIterationOutcome("s1", false);
    const state = getGoalLoopState("s1");
    expect(state).toBeDefined();
    const decision = decideNextGoalIteration({
      goal: activeGoal(),
      state,
      limits,
    });
    expect(decision.schedule).toBe(false);
    expect(decision.reason).toBe("error");
    expect(decision.checkpoint).toBe(true);
  });

  test("resets the failure streak on a successful iteration", () => {
    registerGoalLoopStart("s1");
    recordGoalIterationOutcome("s1", false);
    recordGoalIterationOutcome("s1", false);
    recordGoalIterationOutcome("s1", true);
    recordGoalIterationOutcome("s1", false);
    const state = getGoalLoopState("s1");
    const decision = decideNextGoalIteration({
      goal: activeGoal(),
      state,
      limits,
    });
    expect(decision.schedule).toBe(true);
    expect(state?.consecutiveFailures).toBe(1);
  });
});

describe("goal loop helpers", () => {
  test("detects DONE: and [done] markers", () => {
    expect(goalResponseSignalsDone("DONE: shipped the release")).toBe(true);
    expect(goalResponseSignalsDone("**DONE: shipped the release.**")).toBe(true);
    expect(goalResponseSignalsDone("_DONE: shipped the release._")).toBe(true);
    expect(goalResponseSignalsDone("done: finished")).toBe(true);
    expect(goalResponseSignalsDone("Worked on it [done]")).toBe(true);
    expect(goalResponseSignalsDone("<done>true</done>")).toBe(true);
    expect(goalResponseSignalsDone("Verified the release.\nDONE: all checks passed")).toBe(true);
    expect(goalResponseSignalsDone("The instructions mention DONE:\nStill working")).toBe(false);
    expect(goalResponseSignalsDone("Still working on it")).toBe(false);
  });

  test("detects BLOCKED: markers and returns the reason", () => {
    expect(goalResponseSignalBlocked("BLOCKED: need API credentials")).toBe("need API credentials");
    expect(goalResponseSignalBlocked("blocked: waiting on the user")).toBe("waiting on the user");
    expect(goalResponseSignalBlocked("Cannot proceed [blocked]")).toBe("blocked by the agent");
    expect(goalResponseSignalBlocked("Still making progress")).toBeNull();
    expect(goalResponseSignalBlocked("DONE: finished")).toBeNull();
  });

  test("goal iteration prompt includes budget and control tokens", () => {
    const prompt = goalIterationPrompt(activeGoal(), 4, {
      maxIterations: 25,
      maxDurationSeconds: 3600,
    });
    expect(prompt).toContain("[autonomous goal iteration 4]");
    expect(prompt).toContain("up to 25 iterations");
    expect(prompt).toContain("use tools only when they help");
    expect(prompt).not.toContain("progress with tools");
    expect(prompt).toContain("Reply DONE:");
    expect(prompt).toContain("Reply BLOCKED:");
  });

  test("identifies goal iteration messages", () => {
    expect(isGoalIterationMessage("[autonomous goal iteration 2] Continue")).toBe(true);
    expect(isGoalIterationMessage("review the repo")).toBe(false);
  });

  test("reads configurable limits with sane defaults", () => {
    const defaults = readGoalLoopLimits();
    expect(defaults).toEqual({ maxIterations: null, maxDurationSeconds: null });
  });

  test("defaults to an uncapped continuation loop", () => {
    config.set("goal_loop_max_iterations", null);
    config.set("goal_loop_max_duration_seconds", null);
    expect(readGoalLoopLimits()).toEqual({ maxIterations: null, maxDurationSeconds: null });
    const decision = decideNextGoalIteration({
      goal: activeGoal(),
      state: loopState({
        iterations: 50_000,
        startedAtMs: Date.parse("2020-01-01T00:00:00.000Z"),
      }),
      limits: readGoalLoopLimits(),
      nowMs: Date.parse("2026-08-18T00:00:00.000Z"),
    });
    expect(decision.schedule).toBe(true);
    if (!decision.schedule) throw new Error("Expected an uncapped goal iteration");
    expect(decision.prompt).toContain("until the goal is complete, blocked, or paused by the user");
  });

  test("keeps explicit operator safety limits", () => {
    config.set("goal_loop_max_iterations", 40);
    config.set("goal_loop_max_duration_seconds", 7200);
    expect(readGoalLoopLimits()).toEqual({ maxIterations: 40, maxDurationSeconds: 7200 });
  });

  test("persists loop progress across an in-memory reload", () => {
    registerGoalLoopStart("persisted-loop", 1000);
    recordGoalIterationOutcome("persisted-loop", false);
    reloadGoalLoopsFromStoreForTests();
    expect(getGoalLoopState("persisted-loop")).toEqual({
      iterations: 0,
      startedAtMs: 1000,
      consecutiveFailures: 1,
      lastIterationAtMs: expect.any(Number),
    });
  });

  test("loop state resets and registers", () => {
    registerGoalLoopStart("s2");
    expect(resetGoalLoop("s2")).toBeUndefined();
    expect(
      decideNextGoalIteration({
        goal: activeGoal(),
        state: undefined,
        limits: { maxIterations: 2, maxDurationSeconds: 60 },
      }).schedule
    ).toBe(true);
  });
});

describe("goal elapsed time tracking", () => {
  test("accumulates active time while active", () => {
    const goal = activeGoal({ lastResumedAt: "2026-08-18T00:00:00.000Z", activeMs: 5000 });
    const elapsed = sessionGoalElapsedMs(goal, Date.parse("2026-08-18T00:01:05.000Z"));
    expect(elapsed).toBe(70000);
  });

  test("freezes at accumulated time when paused", () => {
    const goal = activeGoal({ status: "paused", lastResumedAt: undefined, activeMs: 65000 });
    expect(sessionGoalElapsedMs(goal, Date.parse("2026-08-18T01:00:00.000Z"))).toBe(65000);
  });

  test("command transitions maintain activeMs through pause and resume", () => {
    handleSessionGoalCommand("elapsed-session", "/goal start ship the release");
    const started = getGoalForTest("elapsed-session");
    expect(started?.status).toBe("active");
    expect(started?.activeMs).toBe(0);
    expect(started?.lastResumedAt).toBeDefined();

    handleSessionGoalCommand("elapsed-session", "/goal pause waiting on CI");
    const paused = getGoalForTest("elapsed-session");
    expect(paused?.status).toBe("paused");
    expect(paused?.activeMs).toBeGreaterThanOrEqual(0);
    expect(paused?.lastResumedAt).toBeUndefined();
    const frozenElapsed = sessionGoalElapsedMs(paused!, Date.parse("2099-01-01T00:00:00.000Z"));

    handleSessionGoalCommand("elapsed-session", "/goal resume");
    const resumed = getGoalForTest("elapsed-session");
    expect(resumed?.status).toBe("active");
    expect(resumed?.activeMs).toBe(paused?.activeMs);
    expect(resumed?.lastResumedAt).toBeDefined();
    expect(sessionGoalElapsedMs(resumed!, Date.parse("2099-01-01T00:00:00.000Z"))).toBeGreaterThan(
      frozenElapsed
    );
  });

  test("/goal continue resumes a paused goal like resume", () => {
    handleSessionGoalCommand("continue-session", "/goal start refactor the router");
    handleSessionGoalCommand("continue-session", "/goal pause waiting");
    const paused = getGoalForTest("continue-session");
    expect(paused?.status).toBe("paused");
    const result = handleSessionGoalCommand("continue-session", "/goal continue");
    expect(result.handled).toBe(true);
    expect(result.action).toBe("resume");
    expect(getGoalForTest("continue-session")?.status).toBe("active");
  });

  test("resume starts a fresh iteration budget after a checkpoint", () => {
    const sessionId = "checkpoint-resume-session";
    handleSessionGoalCommand(sessionId, "/goal start verify the release");
    reserveGoalLoopIteration(sessionId);
    reserveGoalLoopIteration(sessionId);
    pauseSessionGoal(sessionId, "Loop checkpoint reached");
    markGoalLoopStopped(sessionId, "max_iterations");

    expect(getGoalLoopState(sessionId)?.iterations).toBe(2);
    handleSessionGoalCommand(sessionId, "/goal resume");
    expect(getGoalLoopState(sessionId)).toEqual({
      iterations: 0,
      startedAtMs: expect.any(Number),
      consecutiveFailures: 0,
    });
  });

  test("shorthand goal creation initializes durable loop state", () => {
    const sessionId = "shorthand-loop-session";
    handleSessionGoalCommand(sessionId, "/goal refactor the router");
    expect(getGoalLoopState(sessionId)).toEqual({
      iterations: 0,
      startedAtMs: expect.any(Number),
      consecutiveFailures: 0,
    });
  });
});

function getGoalForTest(sessionId: string): SessionGoal | undefined {
  const stored = config.get<unknown>("session_goals");
  if (!Array.isArray(stored)) return undefined;
  return stored.find(
    (entry): entry is SessionGoal =>
      !!entry &&
      typeof entry === "object" &&
      (entry as { sessionId?: unknown }).sessionId === sessionId
  );
}
