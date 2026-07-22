export const BROWSER_PREVIEW_ACTIVE_WINDOW_MS = 6_000;
export const BROWSER_PREVIEW_ACTIVE_POLL_MS = 500;
export const BROWSER_PREVIEW_IDLE_POLL_MS = 1_200;

export function browserPreviewPollDelay(
  now: number,
  lastInteractionAt: number,
  loading: boolean
): number {
  return loading || now - lastInteractionAt <= BROWSER_PREVIEW_ACTIVE_WINDOW_MS
    ? BROWSER_PREVIEW_ACTIVE_POLL_MS
    : BROWSER_PREVIEW_IDLE_POLL_MS;
}
