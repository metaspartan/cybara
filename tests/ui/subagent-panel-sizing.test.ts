import { describe, expect, test } from "bun:test";
import {
  clampSubagentPanelWidth,
  SUBAGENT_PANEL_DEFAULT_WIDTH,
  SUBAGENT_PANEL_MAX_WIDTH,
  SUBAGENT_PANEL_MIN_WIDTH,
} from "../../ui/src/pages/chat/subagentPanelSizing";

describe("subagent panel sizing", () => {
  test("keeps the default width within desktop bounds", () => {
    expect(clampSubagentPanelWidth(SUBAGENT_PANEL_DEFAULT_WIDTH, 1440)).toBe(
      SUBAGENT_PANEL_DEFAULT_WIDTH
    );
  });

  test("clamps drag resizing to the minimum and viewport-aware maximum", () => {
    expect(clampSubagentPanelWidth(100, 1440)).toBe(SUBAGENT_PANEL_MIN_WIDTH);
    expect(clampSubagentPanelWidth(1000, 1440)).toBe(SUBAGENT_PANEL_MAX_WIDTH);
    expect(clampSubagentPanelWidth(1000, 800)).toBe(480);
  });

  test("rounds fractional widths for stable persistence", () => {
    expect(clampSubagentPanelWidth(411.6, 1200)).toBe(412);
  });

  test("wires the persistent accessible resize handle and dedicated icon", async () => {
    const panelSource = await Bun.file("ui/src/pages/chat/SubagentPanel.tsx").text();
    const chatSource = await Bun.file("ui/src/pages/Chat.tsx").text();
    const activitySource = await Bun.file("ui/src/pages/chat/ActivityTimeline.tsx").text();

    expect(panelSource).toContain('aria-label="Resize subagent panel"');
    expect(panelSource).toContain("SUBAGENT_PANEL_WIDTH_STORAGE_KEY");
    expect(panelSource).toContain("onMouseDown={beginPanelResize}");
    expect(panelSource).toContain("<SubagentIcon");
    expect(chatSource).toContain("<SubagentIcon");
    expect(activitySource).toContain("<SubagentIcon");
    expect(panelSource).not.toContain("<Zap");
    expect(chatSource).not.toContain("<Zap");
    expect(activitySource).not.toContain("<Zap");
  });
});
