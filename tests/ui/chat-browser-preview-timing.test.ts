import { describe, expect, test } from "bun:test";
import {
  BROWSER_PREVIEW_ACTIVE_POLL_MS,
  BROWSER_PREVIEW_IDLE_POLL_MS,
  browserPreviewPollDelay,
} from "../../ui/src/pages/chat/browserPreviewTiming";

describe("browser preview polling", () => {
  test("polls quickly while loading or recently interactive", () => {
    expect(browserPreviewPollDelay(10_000, 0, true)).toBe(BROWSER_PREVIEW_ACTIVE_POLL_MS);
    expect(browserPreviewPollDelay(10_000, 9_000, false)).toBe(BROWSER_PREVIEW_ACTIVE_POLL_MS);
  });

  test("backs off when the preview is idle", () => {
    expect(browserPreviewPollDelay(20_000, 1_000, false)).toBe(BROWSER_PREVIEW_IDLE_POLL_MS);
  });
});
