export const SUBAGENT_PANEL_DEFAULT_WIDTH = 320;
export const SUBAGENT_PANEL_MIN_WIDTH = 280;
export const SUBAGENT_PANEL_MAX_WIDTH = 720;
export const SUBAGENT_PANEL_WIDTH_STORAGE_KEY = "cybara.chat.subagentPanelWidth";

export function clampSubagentPanelWidth(width: number, viewportWidth: number): number {
  const viewportMax = Math.max(
    SUBAGENT_PANEL_MIN_WIDTH,
    Math.min(SUBAGENT_PANEL_MAX_WIDTH, Math.floor(viewportWidth * 0.6))
  );
  return Math.min(viewportMax, Math.max(SUBAGENT_PANEL_MIN_WIDTH, Math.round(width)));
}
