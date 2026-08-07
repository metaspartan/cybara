import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../../src/core/config";
import {
  clearSessionGoal,
  getActiveGoalContextLine,
  getSessionGoal,
  handleSessionGoalCommand,
  reloadSessionGoalsFromStoreForTests,
  resetSessionGoalsForTests,
} from "../../src/core/session-goals";

afterEach(() => {
  resetSessionGoalsForTests();
});

describe("session goal commands", () => {
  test("creates, edits, pauses, resumes, completes, and clears a session goal", () => {
    const sessionId = "goal-session";

    expect(handleSessionGoalCommand(sessionId, "/goal")).toMatchObject({
      handled: true,
      response: expect.stringContaining("No goal is set"),
    });

    expect(handleSessionGoalCommand(sessionId, "/goal review the repo")).toMatchObject({
      handled: true,
      response: "Goal started: review the repo",
    });
    expect(getSessionGoal(sessionId)?.objective).toBe("review the repo");
    expect(getActiveGoalContextLine(sessionId)).toContain("review the repo");

    expect(
      handleSessionGoalCommand(sessionId, "/goal edit review the repo and tests")
    ).toMatchObject({
      handled: true,
      response: "Goal updated: review the repo and tests",
    });
    expect(getSessionGoal(sessionId)?.objective).toBe("review the repo and tests");

    expect(handleSessionGoalCommand(sessionId, "/goal pause waiting on CI")).toMatchObject({
      handled: true,
      response: "Goal paused: review the repo and tests",
    });
    expect(getSessionGoal(sessionId)?.status).toBe("paused");
    expect(getActiveGoalContextLine(sessionId)).toBeNull();

    expect(handleSessionGoalCommand(sessionId, "/goal resume")).toMatchObject({
      handled: true,
      response: "Goal resumed: review the repo and tests",
    });
    expect(getActiveGoalContextLine(sessionId)).toContain("review the repo and tests");

    expect(handleSessionGoalCommand(sessionId, "/goal complete verified")).toMatchObject({
      handled: true,
      response: "Goal completed: review the repo and tests",
    });
    expect(getSessionGoal(sessionId)?.status).toBe("complete");

    expect(handleSessionGoalCommand(sessionId, "/goal clear")).toMatchObject({
      handled: true,
      response: "Goal cleared.",
    });
    expect(getSessionGoal(sessionId)).toBeUndefined();
  });

  test("/loop is an alias for session goal mode", () => {
    const result = handleSessionGoalCommand("loop-session", "/loop ship android screenshots");
    expect(result.handled).toBe(true);
    expect(result.response).toBe("Goal started: ship android screenshots");
    expect(getSessionGoal("loop-session")?.objective).toBe("ship android screenshots");
  });

  test("does not replace an active goal with another implicit objective", () => {
    handleSessionGoalCommand("locked-session", "/goal first objective");
    const result = handleSessionGoalCommand("locked-session", "/goal second objective");
    expect(result.response).toContain("A goal already exists");
    expect(getSessionGoal("locked-session")?.objective).toBe("first objective");
  });

  test("ignores non-goal commands", () => {
    expect(handleSessionGoalCommand("other-session", "/learn docs")).toEqual({ handled: false });
    expect(clearSessionGoal("missing")).toBe(false);
  });
});

describe("session goal persistence", () => {
  test("restores an active goal from persisted config after a restart", () => {
    resetSessionGoalsForTests();
    handleSessionGoalCommand("persist-session", "/goal start ship the release checklist");
    expect(getSessionGoal("persist-session")?.status).toBe("active");

    const persisted = config.get<unknown>("session_goals");
    expect(Array.isArray(persisted)).toBe(true);

    reloadSessionGoalsFromStoreForTests();
    const restored = getSessionGoal("persist-session");
    expect(restored?.objective).toBe("ship the release checklist");
    expect(restored?.status).toBe("active");
    expect(getActiveGoalContextLine("persist-session")).toContain("ship the release checklist");
  });

  test("a cleared goal stays cleared across a reload", () => {
    resetSessionGoalsForTests();
    handleSessionGoalCommand("clear-session", "/goal start temporary objective");
    handleSessionGoalCommand("clear-session", "/goal clear");
    reloadSessionGoalsFromStoreForTests();
    expect(getSessionGoal("clear-session")).toBeUndefined();
  });
});
