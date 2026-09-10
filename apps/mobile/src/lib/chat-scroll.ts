import { CHAT_FOLLOW_THRESHOLD_PX, isChatNearBottom } from "cybara-shared/chat-scroll-follow";

interface ChatScrollEvent {
  nativeEvent: {
    contentOffset: { y: number };
    contentSize: { height: number };
    layoutMeasurement: { height: number };
  };
}

interface ChatScrollScheduler {
  request: (callback: () => void) => number;
  cancel: (id: number) => void;
}

export class MobileChatScrollController {
  private following = true;
  private interacting = false;
  private frame: number | null = null;

  constructor(
    private scrollToEnd: () => void,
    private scheduler: ChatScrollScheduler
  ) {}

  private cancelPendingScroll(): void {
    if (this.frame === null) return;
    this.scheduler.cancel(this.frame);
    this.frame = null;
  }

  readonly onContentSizeChange = (): void => {
    if (!this.following || this.interacting || this.frame !== null) return;
    this.frame = this.scheduler.request(() => {
      this.frame = null;
      if (this.following && !this.interacting) this.scrollToEnd();
    });
  };

  readonly onScrollBeginDrag = (): void => {
    this.interacting = true;
    this.following = false;
    this.cancelPendingScroll();
  };

  readonly onScrollEndDrag = ({ nativeEvent }: ChatScrollEvent): void => {
    if (!this.interacting) return;
    const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
    this.interacting = false;
    this.following =
      [contentOffset.y, contentSize.height, layoutMeasurement.height].every(Number.isFinite) &&
      isChatNearBottom(
        {
          scrollTop: contentOffset.y,
          scrollHeight: contentSize.height,
          clientHeight: layoutMeasurement.height,
        },
        CHAT_FOLLOW_THRESHOLD_PX
      );
  };

  readonly followLatest = (): void => {
    this.interacting = false;
    this.following = true;
    this.onContentSizeChange();
  };

  readonly dispose = (): void => {
    this.cancelPendingScroll();
  };
}
