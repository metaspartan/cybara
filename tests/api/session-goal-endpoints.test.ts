import { afterEach, describe, expect, test } from "bun:test";
import {
  clearSessionGoal,
  getActiveGoalContextLine,
  getSessionGoal,
  handleSessionGoalCommand,
  resetSessionGoalsForTests,
} from "../../src/core/session-goals";

afterEach(() => {
  resetSessionGoalsForTests();
});

describe("session goal REST contract", () => {
  test("GET returns null before any goal is set", () => {
    const sessionId = "goal-rest-none";
    expect(getSessionGoal(sessionId)).toBeUndefined();
  });

  test("start -> GET -> pause -> resume -> complete -> clear flows match the endpoint contract", () => {
    const sessionId = "goal-rest-flow";

    const started = handleSessionGoalCommand(sessionId, "/goal start refactor the runtime");
    expect(started.handled).toBe(true);
    expect(started.goal?.status).toBe("active");
    expect(getSessionGoal(sessionId)?.objective).toBe("refactor the runtime");
    expect(getActiveGoalContextLine(sessionId)).toContain("refactor the runtime");

    const paused = handleSessionGoalCommand(sessionId, "/goal pause waiting: ci");
    expect(paused.goal?.status).toBe("paused");
    expect(paused.goal?.lastStatusNote).toContain("ci");
    expect(getActiveGoalContextLine(sessionId)).toBeNull();

    const resumed = handleSessionGoalCommand(sessionId, "/goal resume back: green");
    expect(resumed.goal?.status).toBe("active");
    expect(getActiveGoalContextLine(sessionId)).toContain("refactor the runtime");

    const completed = handleSessionGoalCommand(sessionId, "/goal complete done: verified");
    expect(completed.goal?.status).toBe("complete");
    expect(getActiveGoalContextLine(sessionId)).toBeNull();

    const cleared = clearSessionGoal(sessionId);
    expect(cleared).toBe(true);
    expect(getSessionGoal(sessionId)).toBeUndefined();
  });

  test("double-start is rejected with the existing goal returned", () => {
    const sessionId = "goal-rest-double";
    handleSessionGoalCommand(sessionId, "/goal start first objective");
    const second = handleSessionGoalCommand(sessionId, "/goal start second objective");
    expect(second.handled).toBe(true);
    expect(second.response).toContain("already exists");
    expect(second.goal?.objective).toBe("first objective");
    expect(getSessionGoal(sessionId)?.objective).toBe("first objective");
  });

  test("empty objective is rejected", () => {
    const sessionId = "goal-rest-empty";
    const result = handleSessionGoalCommand(sessionId, "/goal start");
    expect(result.response).toBe("Goal objective is required.");
    expect(getSessionGoal(sessionId)).toBeUndefined();
  });

  test("status changes without an existing goal are safe no-ops", () => {
    const sessionId = "goal-rest-missing";
    const paused = handleSessionGoalCommand(sessionId, "/goal pause");
    expect(paused.handled).toBe(true);
    expect(paused.response).toContain("No goal is set");
    expect(paused.goal).toBeUndefined();
    const cleared = clearSessionGoal(sessionId);
    expect(cleared).toBe(false);
  });
});

describe("goal REST with a not-yet-persisted session", () => {
  test("GET and POST work for a fresh session id before the session exists", () => {
    const sessionId = `goal-fresh-${crypto.randomUUID()}`;
    const setResult = handleSessionGoalCommand(sessionId, "/goal start polish the dashboard");
    expect(setResult.handled).toBe(true);
    expect(getSessionGoal(sessionId)?.objective).toBe("polish the dashboard");
    expect(getActiveGoalContextLine(sessionId)).toContain("polish the dashboard");
    handleSessionGoalCommand(sessionId, "/goal clear");
    expect(getSessionGoal(sessionId)).toBeUndefined();
  });
});
