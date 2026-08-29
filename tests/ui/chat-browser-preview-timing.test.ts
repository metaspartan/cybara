import { describe, expect, test } from "bun:test";
import {
  BROWSER_PREVIEW_ACTIVE_POLL_MS,
  BROWSER_PREVIEW_IDLE_POLL_MS,
  BROWSER_PREVIEW_MIN_PAINT_GAP_MS,
  browserPreviewPollDelay,
  browserPreviewViewport,
} from "../../ui/src/pages/chat/browserPreviewTiming";

describe("browser preview polling", () => {
  test("uses responsive active polling and low-cost idle polling", () => {
    expect(BROWSER_PREVIEW_ACTIVE_POLL_MS).toBe(250);
    expect(BROWSER_PREVIEW_IDLE_POLL_MS).toBe(2_500);
  });

  test("presents live frames at an interactive cadence", () => {
    expect(BROWSER_PREVIEW_MIN_PAINT_GAP_MS).toBe(33);
  });

  test("polls quickly while loading or recently interactive", () => {
    expect(browserPreviewPollDelay(10_000, 0, true)).toBe(BROWSER_PREVIEW_ACTIVE_POLL_MS);
    expect(browserPreviewPollDelay(10_000, 9_000, false)).toBe(BROWSER_PREVIEW_ACTIVE_POLL_MS);
  });

  test("backs off when the preview is idle", () => {
    expect(browserPreviewPollDelay(20_000, 1_000, false)).toBe(BROWSER_PREVIEW_IDLE_POLL_MS);
  });

  test("bounds high-resolution previews without changing their aspect ratio", () => {
    expect(browserPreviewViewport(2_560, 1_600)).toEqual({ width: 1_600, height: 1_000 });
    expect(browserPreviewViewport(1_200, 900)).toEqual({ width: 1_200, height: 900 });
  });
});
