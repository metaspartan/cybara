export const MAIN_SIDEBAR_WIDTH_STORAGE_KEY = "cybara.mainSidebarWidth";
export const MAIN_SIDEBAR_DEFAULT_WIDTH = 208;
export const MAIN_SIDEBAR_MIN_WIDTH = 170;
export const MAIN_SIDEBAR_MAX_WIDTH = 320;

export function clampMainSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return MAIN_SIDEBAR_DEFAULT_WIDTH;
  return Math.max(MAIN_SIDEBAR_MIN_WIDTH, Math.min(MAIN_SIDEBAR_MAX_WIDTH, Math.round(width)));
}

export function parseMainSidebarWidth(value: string | null): number {
  if (!value) return MAIN_SIDEBAR_DEFAULT_WIDTH;
  return clampMainSidebarWidth(Number(value));
}
