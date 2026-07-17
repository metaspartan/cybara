import { describe, expect, test } from "bun:test";
import { DeepLinkAttemptTracker } from "../../apps/mobile/src/lib/deepLinkAttempts";

describe("mobile deep-link attempts", () => {
  test("allows a failed connection URL to be retried", () => {
    const tracker = new DeepLinkAttemptTracker();

    expect(tracker.begin("cybara://connect/profile")).toBe(true);
    tracker.finish("cybara://connect/profile");
    expect(tracker.begin("cybara://connect/profile")).toBe(true);
  });

  test("deduplicates active and completed connection URLs", () => {
    const tracker = new DeepLinkAttemptTracker();

    expect(tracker.begin("cybara://connect/profile")).toBe(true);
    expect(tracker.begin("cybara://connect/profile")).toBe(false);
    tracker.complete("cybara://connect/profile");
    tracker.finish("cybara://connect/profile");
    expect(tracker.begin("cybara://connect/profile")).toBe(false);
  });
});
