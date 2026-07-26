export const SIMULATOR_PREVIEW_ACTIVE_WINDOW_MS = 4_000;
export const SIMULATOR_PREVIEW_ACTIVE_POLL_MS = 250;
export const SIMULATOR_PREVIEW_IDLE_POLL_MS = 1_500;

export function simulatorPreviewPollDelay(
  now: number,
  lastInteractionAt: number,
  lastFrameChangeAt = 0
): number {
  const lastActivityAt = Math.max(lastInteractionAt, lastFrameChangeAt);
  return now - lastActivityAt <= SIMULATOR_PREVIEW_ACTIVE_WINDOW_MS
    ? SIMULATOR_PREVIEW_ACTIVE_POLL_MS
    : SIMULATOR_PREVIEW_IDLE_POLL_MS;
}
