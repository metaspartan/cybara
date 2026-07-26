export const CHAT_PINNED_THRESHOLD_PX = 24;
export const CHAT_FOLLOW_THRESHOLD_PX = 96;

export interface ChatScrollMetrics {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

export function distanceFromChatBottom(metrics: ChatScrollMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight);
}

export function isChatNearBottom(
  metrics: ChatScrollMetrics,
  threshold = CHAT_PINNED_THRESHOLD_PX
): boolean {
  return distanceFromChatBottom(metrics) <= threshold;
}

export function chatBottomScrollTop(metrics: ChatScrollMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.clientHeight);
}

export function shouldFollowChatBottom(
  metrics: ChatScrollMetrics,
  following: boolean,
  threshold = CHAT_FOLLOW_THRESHOLD_PX
): boolean {
  return following || isChatNearBottom(metrics, threshold);
}
