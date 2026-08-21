export const RICH_MESSAGE_TAIL_COUNT = 8;
export const RICH_MESSAGE_DEFER_THRESHOLD = 60;

export function shouldDeferRichMessageContent(
  visibleIndex: number,
  visibleMessageCount: number
): boolean {
  if (visibleMessageCount <= RICH_MESSAGE_DEFER_THRESHOLD) return false;
  return visibleIndex < visibleMessageCount - RICH_MESSAGE_TAIL_COUNT;
}
