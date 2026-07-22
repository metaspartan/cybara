export const BROWSER_PREVIEW_ACTIVE_WINDOW_MS = 4_000;
export const BROWSER_PREVIEW_ACTIVE_POLL_MS = 200;
export const BROWSER_PREVIEW_IDLE_POLL_MS = 1_500;

export function browserPreviewPollDelay(
  now: number,
  lastInteractionAt: number,
  loading: boolean
): number {
  return loading || now - lastInteractionAt <= BROWSER_PREVIEW_ACTIVE_WINDOW_MS
    ? BROWSER_PREVIEW_ACTIVE_POLL_MS
    : BROWSER_PREVIEW_IDLE_POLL_MS;
}
