import { describe, expect, test } from "bun:test";
import {
  BROWSER_PREVIEW_ACTIVE_POLL_MS,
  BROWSER_PREVIEW_IDLE_POLL_MS,
  browserPreviewPollDelay,
} from "../../ui/src/pages/chat/browserPreviewTiming";

describe("browser preview polling", () => {
  test("uses responsive active polling and low-cost idle polling", () => {
    expect(BROWSER_PREVIEW_ACTIVE_POLL_MS).toBe(200);
    expect(BROWSER_PREVIEW_IDLE_POLL_MS).toBe(1_500);
  });

  test("polls quickly while loading or recently interactive", () => {
    expect(browserPreviewPollDelay(10_000, 0, true)).toBe(BROWSER_PREVIEW_ACTIVE_POLL_MS);
    expect(browserPreviewPollDelay(10_000, 9_000, false)).toBe(BROWSER_PREVIEW_ACTIVE_POLL_MS);
  });

  test("backs off when the preview is idle", () => {
    expect(browserPreviewPollDelay(20_000, 1_000, false)).toBe(BROWSER_PREVIEW_IDLE_POLL_MS);
  });
});
