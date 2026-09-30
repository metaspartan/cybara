import { beforeEach, describe, expect, test } from "bun:test";
import {
  beginComputerUseFocus,
  clearAllComputerUseFocus,
  guardComputerUseAgainstUserInterference,
  isFocusMutatingAction,
  listActiveComputerUseFocus,
} from "../../src/core/computer-use-focus";

const SESSION = "interference-session";
const GRACE_MS = 1_250;

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, GRACE_MS));
}

beforeEach(() => {
  clearAllComputerUseFocus();
});

describe("computer use user interference guard", () => {
  test("stays out of the way while the user is still on the target app", () => {
    beginComputerUseFocus(SESSION, "Finder", "Finder");
    const outcome = guardComputerUseAgainstUserInterference(SESSION, "Finder", "Finder");
    expect(outcome.blocked).toBe(false);
    expect(listActiveComputerUseFocus()[0]?.yieldedToUser).toBe(false);
  });

  test("blocks once the user moves to a different app", async () => {
    beginComputerUseFocus(SESSION, "Finder", "Finder");
    await settle();
    const outcome = guardComputerUseAgainstUserInterference(SESSION, "Finder", "Notes");
    expect(outcome.blocked).toBe(true);
    expect(outcome.reason).toContain("Notes");
    expect(outcome.reason).toContain("Finder");
  });

  test("surfaces the yielded state to clients so the banner can switch", async () => {
    beginComputerUseFocus(SESSION, "Finder", "Finder");
    await settle();
    guardComputerUseAgainstUserInterference(SESSION, "Finder", "Notes");

    const [active] = listActiveComputerUseFocus();
    expect(active?.yieldedToUser).toBe(true);
    expect(active?.reason).toContain("Notes");
  });

  test("keeps blocking across repeated actions until the user stops driving", async () => {
    beginComputerUseFocus(SESSION, "Finder", "Finder");
    await settle();
    guardComputerUseAgainstUserInterference(SESSION, "Finder", "Notes");
    const second = guardComputerUseAgainstUserInterference(SESSION, "Finder", "Notes");
    expect(second.blocked).toBe(true);
  });

  test("does not block during the grace window right after an agent action", () => {
    beginComputerUseFocus(SESSION, "Finder", "Finder");
    const outcome = guardComputerUseAgainstUserInterference(SESSION, "Finder", "Notes");
    expect(outcome.blocked).toBe(false);
  });

  test("re-checks interference on capture so long capture loops cannot run away", () => {
    expect(isFocusMutatingAction("capture")).toBe(true);
  });

  test("ignores the pre-action baseline app", () => {
    beginComputerUseFocus(SESSION, "Finder", "Safari");
    const outcome = guardComputerUseAgainstUserInterference(SESSION, "Finder", "Safari");
    expect(outcome.blocked).toBe(false);
  });
});
