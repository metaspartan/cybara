import { describe, expect, test } from "bun:test";
import {
  CHAT_CONTENT_MIN_WIDTH,
  DIFF_PANEL_MAX_WIDTH,
  DIFF_PANEL_MIN_WIDTH,
  clampDiffPanelWidth,
} from "../../ui/src/pages/chat/chatModel";

describe("chat workspace panel sizing", () => {
  test("allows the workspace panel to grow beyond the former fixed limit", () => {
    expect(clampDiffPanelWidth(2_400, 3_200)).toBe(2_400);
  });

  test("reserves a usable chat column while using the available desktop width", () => {
    expect(clampDiffPanelWidth(4_000, 3_200)).toBe(3_200 - CHAT_CONTENT_MIN_WIDTH);
  });

  test("keeps narrow layouts usable and persisted values bounded", () => {
    expect(clampDiffPanelWidth(900, 800)).toBe(520);
    expect(clampDiffPanelWidth(100)).toBe(DIFF_PANEL_MIN_WIDTH);
    expect(clampDiffPanelWidth(20_000)).toBe(DIFF_PANEL_MAX_WIDTH);
  });
});
