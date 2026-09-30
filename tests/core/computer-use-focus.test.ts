import { afterEach, describe, expect, test } from "bun:test";
import {
  beginComputerUseFocus,
  clearAllComputerUseFocus,
  detectUserInterference,
  endComputerUseFocus,
  getComputerUseFocusState,
  guardComputerUseAgainstUserInterference,
  isFocusMutatingAction,
  isUserHoldingFocus,
  listActiveComputerUseFocus,
} from "../../src/core/computer-use-focus";

const GRACE_MS = 1200;

afterEach(() => {
  clearAllComputerUseFocus();
});

describe("computer use focus mutating actions", () => {
  test("classifies focus-mutating actions as focus mutating", () => {
    for (const action of [
      "click",
      "double_click",
      "type",
      "key",
      "drag",
      "scroll",
      "focus_app",
      "capture",
    ]) {
      expect(isFocusMutatingAction(action)).toBe(true);
    }
    for (const action of ["screenshot", "list_apps", "move", "wait", "read_text"]) {
      expect(isFocusMutatingAction(action)).toBe(false);
    }
  });
});

describe("computer use user interference detection", () => {
  test("does not flag the agent's own target app staying frontmost", () => {
    beginComputerUseFocus("s1", "Safari", "Safari");
    expect(detectUserInterference("s1", "Safari", "Safari")).toBeUndefined();
    expect(getComputerUseFocusState("s1")?.interferenceAt).toBeUndefined();
  });

  test("does not flag a switch back to the pre-action baseline app", () => {
    beginComputerUseFocus("s2", "Safari", "Finder");
    pastGraceFor("s2");
    expect(detectUserInterference("s2", "Safari", "Finder")).toBeUndefined();
    expect(getComputerUseFocusState("s2")?.interferenceAt).toBeUndefined();
  });

  test("flags the user grabbing a different app after the grace window", () => {
    beginComputerUseFocus("s3", "Safari", "Safari");
    pastGraceFor("s3");
    const reason = detectUserInterference("s3", "Safari", "Slack");
    expect(reason).toBeTruthy();
    expect(reason).toContain("Slack");
    expect(reason).toContain("Safari");
    expect(getComputerUseFocusState("s3")?.interferenceAt).toBeGreaterThan(0);
  });

  test("ignores focus changes inside the immediate grace window", () => {
    beginComputerUseFocus("s4", "Safari", "Safari");
    expect(detectUserInterference("s4", "Safari", "Slack")).toBeUndefined();
  });

  test("ignores unknown sessions and empty frontmost values", () => {
    beginComputerUseFocus("s5", "Safari", "Safari");
    expect(detectUserInterference("never-started", "Safari", "Slack")).toBeUndefined();
    expect(detectUserInterference("s5", "Safari", "")).toBeUndefined();
  });
});

describe("computer use yields to the user when they take over", () => {
  test("blocks the agent step and explains why", () => {
    beginComputerUseFocus("s6", "Safari", "Safari");
    pastGraceFor("s6");
    const outcome = guardComputerUseAgainstUserInterference("s6", "Safari", "Slack");
    expect(outcome.blocked).toBe(true);
    expect(outcome.reason).toMatch(/Slack/);
  });

  test("stays yielded until the agent acts again", () => {
    beginComputerUseFocus("s7", "Safari", "Safari");
    pastGraceFor("s7");
    detectUserInterference("s7", "Safari", "Slack");
    expect(isUserHoldingFocus(getComputerUseFocusState("s7"))).toBe(true);
    beginComputerUseFocus("s7", "Safari", "Safari");
    expect(isUserHoldingFocus(getComputerUseFocusState("s7"))).toBe(false);
  });
});

describe("computer use takeover reporting", () => {
  test("lists active takeovers with the app and yield state", () => {
    beginComputerUseFocus("s8", "Safari", "Safari");
    const active = listActiveComputerUseFocus();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ sessionId: "s8", app: "Safari", yieldedToUser: false });
  });

  test("drops takeovers that have been idle past the active window", () => {
    beginComputerUseFocus("s9", "Safari", "Safari");
    const state = getComputerUseFocusState("s9");
    if (state) state.lastAgentActionAt = Date.now() - 120_000;
    expect(listActiveComputerUseFocus()).toHaveLength(0);
  });

  test("ending a takeover removes it from reporting", () => {
    beginComputerUseFocus("s10", "Safari", "Safari");
    endComputerUseFocus("s10");
    expect(listActiveComputerUseFocus()).toHaveLength(0);
    expect(getComputerUseFocusState("s10")).toBeUndefined();
  });
});

function pastGraceFor(sessionId: string): void {
  const state = getComputerUseFocusState(sessionId);
  if (state) state.lastAgentActionAt = Date.now() - GRACE_MS - 200;
}
