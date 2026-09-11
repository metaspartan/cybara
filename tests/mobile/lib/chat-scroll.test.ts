import { describe, expect, test } from "bun:test";
import { MobileChatScrollController } from "../../../apps/mobile/src/lib/chat-scroll";

function createScrollHarness() {
  let nextFrame = 0;
  let scrolls = 0;
  const callbacks = new Map<number, () => void>();
  const controller = new MobileChatScrollController(() => scrolls++, {
    request: (callback) => {
      callbacks.set(++nextFrame, callback);
      return nextFrame;
    },
    cancel: (id) => {
      callbacks.delete(id);
    },
  });
  return {
    controller,
    callbacks,
    scrolls: () => scrolls,
    flush: () => {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback();
    },
  };
}

function scrollEvent(offset: number, contentHeight = 3000, viewportHeight = 600) {
  return {
    nativeEvent: {
      contentOffset: { y: offset },
      contentSize: { height: contentHeight },
      layoutMeasurement: { height: viewportHeight },
    },
  };
}

describe("mobile chat scroll", () => {
  test("opens at the latest message and follows growing replies", () => {
    const harness = createScrollHarness();
    harness.controller.onContentSizeChange();
    harness.controller.onContentSizeChange();
    harness.flush();
    expect(harness.scrolls()).toBe(1);
    harness.controller.onContentSizeChange();
    harness.flush();
    expect(harness.scrolls()).toBe(2);
  });

  test("streaming, polling, and image layout changes never pull a reader back down", () => {
    const harness = createScrollHarness();
    harness.controller.onScrollBeginDrag();
    harness.controller.onScrollEndDrag(scrollEvent(1000));
    for (let update = 0; update < 20; update++) {
      harness.controller.onContentSizeChange();
      harness.flush();
    }
    expect(harness.scrolls()).toBe(0);
  });

  test("touching the transcript cancels a previously scheduled scroll", () => {
    const harness = createScrollHarness();
    harness.controller.onContentSizeChange();
    const pendingCallback = [...harness.callbacks.values()][0];
    harness.controller.onScrollBeginDrag();
    expect(harness.callbacks.size).toBe(0);
    pendingCallback?.();
    harness.controller.onContentSizeChange();
    harness.flush();
    expect(harness.scrolls()).toBe(0);
  });

  test("momentum pauses following until the gesture finishes near the bottom", () => {
    const harness = createScrollHarness();
    harness.controller.onScrollBeginDrag();
    harness.controller.onScrollEndDrag(scrollEvent(2380));
    harness.controller.onContentSizeChange();
    harness.controller.onScrollBeginDrag();
    harness.flush();
    expect(harness.scrolls()).toBe(0);
    harness.controller.onScrollEndDrag(scrollEvent(1000));
    harness.controller.onContentSizeChange();
    harness.flush();
    expect(harness.scrolls()).toBe(0);
  });

  test("returning to the bottom resumes following", () => {
    const harness = createScrollHarness();
    harness.controller.onScrollBeginDrag();
    harness.controller.onScrollEndDrag(scrollEvent(1000));
    harness.controller.onScrollBeginDrag();
    harness.controller.onScrollEndDrag(scrollEvent(2304));
    harness.controller.onContentSizeChange();
    harness.flush();
    expect(harness.scrolls()).toBe(1);
  });

  test("layout scroll events cannot resume following while reading", () => {
    const harness = createScrollHarness();
    harness.controller.onScrollBeginDrag();
    harness.controller.onScrollEndDrag(scrollEvent(1000));
    harness.controller.onScrollEndDrag(scrollEvent(2400));
    harness.controller.onContentSizeChange();
    harness.flush();
    expect(harness.scrolls()).toBe(0);
  });

  test("sending a prompt explicitly resumes following", () => {
    const harness = createScrollHarness();
    harness.controller.onScrollBeginDrag();
    harness.controller.onScrollEndDrag(scrollEvent(1000));
    harness.controller.followLatest();
    harness.flush();
    expect(harness.scrolls()).toBe(1);
    harness.controller.onContentSizeChange();
    harness.flush();
    expect(harness.scrolls()).toBe(2);
  });

  test.each([
    NaN,
    Infinity,
    -Infinity,
    2303,
  ])("does not follow invalid or distant offsets: %s", (offset) => {
    const harness = createScrollHarness();
    harness.controller.onScrollBeginDrag();
    harness.controller.onScrollEndDrag(scrollEvent(offset));
    harness.controller.onContentSizeChange();
    harness.flush();
    expect(harness.scrolls()).toBe(0);
  });

  test.each([
    scrollEvent(0, 0),
    scrollEvent(0, 100),
    scrollEvent(2450),
  ])("handles empty transcripts, short replies, and bottom overscroll", (event) => {
    const harness = createScrollHarness();
    harness.controller.onScrollBeginDrag();
    harness.controller.onScrollEndDrag(event);
    harness.controller.onContentSizeChange();
    harness.flush();
    expect(harness.scrolls()).toBe(1);
  });

  test("unmount cancels pending work and a new chat starts at the bottom", () => {
    const previous = createScrollHarness();
    previous.controller.onContentSizeChange();
    previous.controller.dispose();
    previous.flush();
    expect(previous.scrolls()).toBe(0);
    const next = createScrollHarness();
    next.controller.onContentSizeChange();
    next.flush();
    expect(next.scrolls()).toBe(1);
  });
});
