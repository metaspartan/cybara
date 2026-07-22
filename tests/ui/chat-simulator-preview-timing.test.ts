import { describe, expect, test } from "bun:test";
import {
  SIMULATOR_PREVIEW_ACTIVE_POLL_MS,
  SIMULATOR_PREVIEW_IDLE_POLL_MS,
  simulatorPreviewPollDelay,
} from "../../ui/src/pages/chat/simulatorPreviewTiming";

describe("simulator preview polling", () => {
  test("polls quickly after interaction and backs off while idle", () => {
    expect(simulatorPreviewPollDelay(10_000, 9_000)).toBe(SIMULATOR_PREVIEW_ACTIVE_POLL_MS);
    expect(simulatorPreviewPollDelay(10_000, 0)).toBe(SIMULATOR_PREVIEW_IDLE_POLL_MS);
  });

  test("limits idle simulator capture load", () => {
    expect(SIMULATOR_PREVIEW_ACTIVE_POLL_MS).toBe(250);
    expect(SIMULATOR_PREVIEW_IDLE_POLL_MS).toBe(1_500);
  });
});
