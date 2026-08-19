import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../../src/core/config";
import {
  decideNextGoalIteration,
  goalIterationPrompt,
  goalResponseSignalsDone,
  isGoalIterationMessage,
  readGoalLoopLimits,
  registerGoalLoopStart,
  resetGoalLoop,
  resetGoalLoopsForTests,
  type GoalLoopState,
} from "../../src/core/session-goal-loop";
import {
  handleSessionGoalCommand,
  sessionGoalElapsedMs,
  type SessionGoal,
} from "../../src/core/session-goals";

afterEach(() => {
  resetGoalLoopsForTests();
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
  });

  test("schedules while active and within caps", () => {
    const state: GoalLoopState = {
      iterations: 2,
      startedAtMs: Date.parse("2026-08-18T00:00:00.000Z"),
    };
    const decision = decideNextGoalIteration({
      goal: activeGoal(),
      state,
      limits,
      nowMs: Date.parse("2026-08-18T00:01:00.000Z"),
    });
    expect(decision.schedule).toBe(true);
    expect(decision.prompt).toContain("iteration 3");
  });

  test("stops at max iterations", () => {
    const state: GoalLoopState = {
      iterations: 4,
      startedAtMs: Date.parse("2026-08-18T00:00:00.000Z"),
    };
    const decision = decideNextGoalIteration({
      goal: activeGoal(),
      state,
      limits,
      nowMs: Date.parse("2026-08-18T00:01:00.000Z"),
    });
    expect(decision).toEqual({ schedule: false, reason: "max_iterations" });
  });

  test("stops past max duration", () => {
    const state: GoalLoopState = {
      iterations: 1,
      startedAtMs: Date.parse("2026-08-18T00:00:00.000Z"),
    };
    const decision = decideNextGoalIteration({
      goal: activeGoal(),
      state,
      limits,
      nowMs: Date.parse("2026-08-18T00:20:00.000Z"),
    });
    expect(decision).toEqual({ schedule: false, reason: "max_duration" });
  });

  test("stops when the goal is paused, blocked, or complete", () => {
    const state: GoalLoopState = {
      iterations: 0,
      startedAtMs: Date.parse("2026-08-18T00:00:00.000Z"),
    };
    expect(
      decideNextGoalIteration({
        goal: activeGoal({ status: "paused" }),
        state,
        limits,
      })
    ).toEqual({ schedule: false, reason: "paused" });
    expect(
      decideNextGoalIteration({
        goal: activeGoal({ status: "blocked" }),
        state,
        limits,
      })
    ).toEqual({ schedule: false, reason: "blocked" });
    expect(
      decideNextGoalIteration({
        goal: activeGoal({ status: "complete" }),
        state,
        limits,
      })
    ).toEqual({ schedule: false, reason: "complete" });
    expect(decideNextGoalIteration({ goal: undefined, state, limits })).toEqual({
      schedule: false,
      reason: "no_goal",
    });
  });
});

describe("goal loop helpers", () => {
  test("detects DONE: and [done] markers", () => {
    expect(goalResponseSignalsDone("DONE: shipped the release")).toBe(true);
    expect(goalResponseSignalsDone("done: finished")).toBe(true);
    expect(goalResponseSignalsDone("Worked on it [done]")).toBe(true);
    expect(goalResponseSignalsDone("<done>true</done>")).toBe(true);
    expect(goalResponseSignalsDone("Still working on it")).toBe(false);
  });

  test("identifies goal iteration messages", () => {
    expect(isGoalIterationMessage("[autonomous goal iteration 2] Continue")).toBe(true);
    expect(isGoalIterationMessage("review the repo")).toBe(false);
  });

  test("reads configurable limits with sane defaults", () => {
    const defaults = readGoalLoopLimits();
    expect(defaults.maxIterations).toBeGreaterThan(0);
    expect(defaults.maxDurationSeconds).toBeGreaterThan(0);
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
