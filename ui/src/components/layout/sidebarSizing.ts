export const MAIN_SIDEBAR_WIDTH_STORAGE_KEY = "cybara.mainSidebarWidth.v2";
export const MAIN_SIDEBAR_DEFAULT_WIDTH = 272;
export const MAIN_SIDEBAR_MIN_WIDTH = 220;
export const MAIN_SIDEBAR_MAX_WIDTH = 380;
export const MAIN_SIDEBAR_CHAT_HEIGHT_STORAGE_KEY = "cybara.mainSidebarChatHeight.v2";
export const MAIN_SIDEBAR_CHAT_HEIGHT_DEFAULT = 400;
export const MAIN_SIDEBAR_CHAT_HEIGHT_MIN = 160;
export const MAIN_SIDEBAR_CHAT_HEIGHT_MAX = 2400;
export const MAIN_SIDEBAR_CHAT_HEIGHT_MORE_OPEN_MIN = 48;
const MAIN_SIDEBAR_NAVIGATION_HEIGHT_BASE = 140;
const MAIN_SIDEBAR_NAVIGATION_HEIGHT_EXPANDED_BASE = 160;
const MAIN_SIDEBAR_NAVIGATION_ITEM_HEIGHT = 32;

export function clampMainSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return MAIN_SIDEBAR_DEFAULT_WIDTH;
  return Math.max(MAIN_SIDEBAR_MIN_WIDTH, Math.min(MAIN_SIDEBAR_MAX_WIDTH, Math.round(width)));
}

export function parseMainSidebarWidth(value: string | null): number {
  if (!value) return MAIN_SIDEBAR_DEFAULT_WIDTH;
  return clampMainSidebarWidth(Number(value));
}

export function clampMainSidebarChatHeight(height: number): number {
  if (!Number.isFinite(height)) return MAIN_SIDEBAR_CHAT_HEIGHT_DEFAULT;
  return Math.max(
    MAIN_SIDEBAR_CHAT_HEIGHT_MIN,
    Math.min(MAIN_SIDEBAR_CHAT_HEIGHT_MAX, Math.round(height))
  );
}

export function parseMainSidebarChatHeight(value: string | null): number {
  if (!value) return MAIN_SIDEBAR_CHAT_HEIGHT_DEFAULT;
  return clampMainSidebarChatHeight(Number(value));
}

export function usesAvailableMainSidebarChatHeight(configuredHeight: number): boolean {
  return clampMainSidebarChatHeight(configuredHeight) === MAIN_SIDEBAR_CHAT_HEIGHT_DEFAULT;
}

export function resolveMainSidebarChatHeight(
  configuredHeight: number,
  expandedItemCount: number
): number {
  const height = clampMainSidebarChatHeight(configuredHeight);
  const count = Math.max(0, Math.floor(expandedItemCount));
  if (count === 0) return height;
  return Math.max(MAIN_SIDEBAR_CHAT_HEIGHT_MORE_OPEN_MIN, height - count * 28 - 8);
}

export function resolveMainSidebarChatMaxHeight(expandedItemCount: number): string {
  const count = Math.max(0, Math.floor(expandedItemCount));
  const baseHeight =
    count === 0
      ? MAIN_SIDEBAR_NAVIGATION_HEIGHT_BASE
      : MAIN_SIDEBAR_NAVIGATION_HEIGHT_EXPANDED_BASE;
  const reservedHeight = baseHeight + count * MAIN_SIDEBAR_NAVIGATION_ITEM_HEIGHT;
  return `calc(100% - ${reservedHeight}px)`;
}
