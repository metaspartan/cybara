import { afterEach, describe, expect, test } from "bun:test";
import {
  beginComputerUseFocus,
  clearAllComputerUseFocus,
  detectUserInterference,
  endComputerUseFocus,
  getComputerUseFocusState,
  guardComputerUseAgainstUserInterference,
  isUserHoldingFocus,
  listActiveComputerUseFocus,
} from "../../src/core/computer-use-focus";

const GRACE_MS = 1200;

afterEach(() => {
  clearAllComputerUseFocus();
});

function pastGraceFor(sessionId: string): void {
  const state = getComputerUseFocusState(sessionId);
  if (!state) return;
  state.lastAgentActionAt = Date.now() - GRACE_MS - 500;
}

describe("computer use takeover yields to the user", () => {
  test("user app switching during a run blocks the agent step", () => {
    beginComputerUseFocus("t1", "Safari", "Safari");
    pastGraceFor("t1");

    const outcome = guardComputerUseAgainstUserInterference("t1", "Safari", "Slack");

    expect(outcome.blocked).toBe(true);
    expect(outcome.reason).toBeDefined();
  });

  test("repeated user interference keeps blocking across many steps", () => {
    beginComputerUseFocus("t2", "Safari", "Safari");

    for (let index = 0; index < 25; index += 1) {
      pastGraceFor("t2");
      const frontmost = index % 2 === 0 ? "Slack" : "Mail";
      expect(guardComputerUseAgainstUserInterference("t2", "Safari", frontmost).blocked).toBe(true);
    }
  });

  test("interference is still recorded for observability", () => {
    beginComputerUseFocus("t3", "Safari", "Safari");
    pastGraceFor("t3");
    guardComputerUseAgainstUserInterference("t3", "Safari", "Slack");

    const state = getComputerUseFocusState("t3");
    expect(state?.interferenceCount).toBe(1);
    expect(state?.frontmostApp).toBe("Slack");
  });

  test("the agent acting again clears the user-held state", () => {
    beginComputerUseFocus("t4", "Safari", "Safari");
    pastGraceFor("t4");
    guardComputerUseAgainstUserInterference("t4", "Safari", "Slack");
    expect(isUserHoldingFocus(getComputerUseFocusState("t4"))).toBe(true);
    beginComputerUseFocus("t4", "Safari", "Safari");
    expect(isUserHoldingFocus(getComputerUseFocusState("t4"))).toBe(false);
  });
});

describe("computer use takeover reporting", () => {
  test("reports the session as yielded once the user grabs another app", () => {
    beginComputerUseFocus("t5", "Safari", "Safari");
    pastGraceFor("t5");
    guardComputerUseAgainstUserInterference("t5", "Safari", "Slack");

    const active = listActiveComputerUseFocus();
    expect(active).toHaveLength(1);
    expect(active[0]?.yieldedToUser).toBe(true);
    expect(active[0]?.reason).toContain("Slack");
    expect(active[0]?.sessionId).toBe("t5");
  });

  test("takeover state is isolated per session", () => {
    beginComputerUseFocus("t6", "Safari", "Safari");
    beginComputerUseFocus("t7", "Chrome", "Chrome");

    endComputerUseFocus("t6");

    const active = listActiveComputerUseFocus();
    expect(active).toHaveLength(1);
    expect(active[0]?.sessionId).toBe("t7");
  });

  test("detection still ignores the agent's own target app staying frontmost", () => {
    beginComputerUseFocus("t8", "Safari", "Safari");
    pastGraceFor("t8");
    expect(detectUserInterference("t8", "Safari", "Safari")).toBeUndefined();
  });
});
