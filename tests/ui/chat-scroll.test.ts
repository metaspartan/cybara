import { describe, expect, test } from "bun:test";
import {
  chatBottomScrollTop,
  distanceFromChatBottom,
  isChatNearBottom,
} from "../../ui/src/pages/chat/chatScroll";

describe("chat scroll position", () => {
  test("treats exact and subpixel bottom positions as pinned", () => {
    expect(isChatNearBottom({ scrollTop: 700, clientHeight: 300, scrollHeight: 1000 })).toBe(true);
    expect(isChatNearBottom({ scrollTop: 699.5, clientHeight: 300, scrollHeight: 1000 })).toBe(
      true
    );
  });

  test("detects when late content growth leaves the viewport above the bottom", () => {
    const before = { scrollTop: 700, clientHeight: 300, scrollHeight: 1000 };
    const after = { ...before, scrollHeight: 1180 };

    expect(isChatNearBottom(before)).toBe(true);
    expect(distanceFromChatBottom(after)).toBe(180);
    expect(isChatNearBottom(after)).toBe(false);
  });

  test("supports a wider threshold while a live timeline is growing", () => {
    const metrics = { scrollTop: 620, clientHeight: 300, scrollHeight: 1000 };

    expect(isChatNearBottom(metrics)).toBe(false);
    expect(isChatNearBottom(metrics, 96)).toBe(true);
  });

  test("pins late image growth directly to the final scroll position", () => {
    expect(chatBottomScrollTop({ scrollTop: 700, clientHeight: 300, scrollHeight: 1400 })).toBe(
      1100
    );
    expect(chatBottomScrollTop({ scrollTop: 0, clientHeight: 500, scrollHeight: 300 })).toBe(0);
  });
});
