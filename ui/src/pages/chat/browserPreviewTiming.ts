export const BROWSER_PREVIEW_ACTIVE_WINDOW_MS = 4_000;
export const BROWSER_PREVIEW_ACTIVE_POLL_MS = 250;
export const BROWSER_PREVIEW_IDLE_POLL_MS = 2_500;
export const BROWSER_PREVIEW_MAX_WIDTH = 1_600;
export const BROWSER_PREVIEW_MAX_HEIGHT = 1_200;
export const BROWSER_PREVIEW_MIN_PAINT_GAP_MS = 33;
export const BROWSER_PREVIEW_RECONNECT_MAX_MS = 5_000;

export interface BrowserPreviewStreamProfile {
  quality: number;
  maxWidth: number;
  maxHeight: number;
  everyNthFrame: number;
}

export const BROWSER_PREVIEW_STREAM_PROFILE: BrowserPreviewStreamProfile = {
  quality: 82,
  maxWidth: BROWSER_PREVIEW_MAX_WIDTH,
  maxHeight: BROWSER_PREVIEW_MAX_HEIGHT,
  everyNthFrame: 1,
};

export const BROWSER_PREVIEW_THUMBNAIL_STREAM_PROFILE: BrowserPreviewStreamProfile = {
  quality: 68,
  maxWidth: 640,
  maxHeight: 480,
  everyNthFrame: 2,
};

export function browserPreviewReconnectDelay(attempt: number): number {
  const normalizedAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  return Math.min(BROWSER_PREVIEW_RECONNECT_MAX_MS, 250 * 2 ** normalizedAttempt);
}

export function browserPreviewViewport(
  width: number,
  height: number
): { width: number; height: number } {
  const sourceWidth = Math.max(320, Number.isFinite(width) ? Math.round(width) : 960);
  const sourceHeight = Math.max(320, Number.isFinite(height) ? Math.round(height) : 640);
  const scale = Math.min(
    1,
    BROWSER_PREVIEW_MAX_WIDTH / sourceWidth,
    BROWSER_PREVIEW_MAX_HEIGHT / sourceHeight
  );
  return {
    width: Math.max(320, Math.round(sourceWidth * scale)),
    height: Math.max(320, Math.round(sourceHeight * scale)),
  };
}

export function browserPreviewPollDelay(
  now: number,
  lastInteractionAt: number,
  loading: boolean
): number {
  return loading || now - lastInteractionAt <= BROWSER_PREVIEW_ACTIVE_WINDOW_MS
    ? BROWSER_PREVIEW_ACTIVE_POLL_MS
    : BROWSER_PREVIEW_IDLE_POLL_MS;
}
