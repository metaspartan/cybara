import { describe, expect, test } from "bun:test";
import { branchPanelPosition } from "../../ui/src/pages/chat/GitBranchSelector";

const VIEWPORT = { width: 1600, height: 1000 };
const PANEL_HEIGHT = 209;

describe("git branch panel placement", () => {
  test("drops below the trigger when there is room", () => {
    const placement = branchPanelPosition(
      { top: 200, bottom: 224, right: 900 },
      PANEL_HEIGHT,
      VIEWPORT
    );

    expect(placement.top).toBe(228);
    expect(placement.left).toBe(900 - 286);
  });

  test("flips above the trigger instead of running off the bottom of a short pane", () => {
    const trigger = { top: 864, bottom: 888, right: 900 };
    const placement = branchPanelPosition(trigger, PANEL_HEIGHT, VIEWPORT);

    expect(placement.top).toBe(trigger.top - PANEL_HEIGHT - 4);
    expect(placement.top + PANEL_HEIGHT).toBeLessThanOrEqual(trigger.top);
    expect(placement.top).toBeGreaterThanOrEqual(8);
  });

  test("keeps the panel on screen when it fits neither above nor below", () => {
    const tallPanel = 960;
    const placement = branchPanelPosition(
      { top: 120, bottom: 900, right: 900 },
      tallPanel,
      VIEWPORT
    );

    expect(placement.top).toBeGreaterThanOrEqual(8);
    expect(placement.top + tallPanel).toBeLessThanOrEqual(VIEWPORT.height);
  });

  test("never lets the panel hang off the left or right edge", () => {
    expect(
      branchPanelPosition({ top: 10, bottom: 34, right: 40 }, PANEL_HEIGHT, VIEWPORT).left
    ).toBe(8);
    expect(
      branchPanelPosition({ top: 10, bottom: 34, right: 1599 }, PANEL_HEIGHT, VIEWPORT).left
    ).toBe(VIEWPORT.width - 286 - 8);
  });
});
