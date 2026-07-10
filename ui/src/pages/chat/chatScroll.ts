export interface ChatScrollMetrics {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

export function distanceFromChatBottom(metrics: ChatScrollMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight);
}

export function isChatNearBottom(metrics: ChatScrollMetrics, threshold = 24): boolean {
  return distanceFromChatBottom(metrics) <= threshold;
}
