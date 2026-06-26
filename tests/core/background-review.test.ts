import { describe, expect, test } from "bun:test";
import { maybeRunBackgroundReview } from "../../src/core/background-review";

describe("background review", () => {
  test("maybeRunBackgroundReview is a no-op without sessionId", async () => {
    await expect(maybeRunBackgroundReview(undefined, "some text")).resolves.toBeUndefined();
  });

  test("maybeRunBackgroundReview skips short content", async () => {
    await expect(
      maybeRunBackgroundReview(
        { agentId: "test", sessionId: "s1" },
        "short"
      )
    ).resolves.toBeUndefined();
  });

  test("maybeRunBackgroundReview skips when disabled", async () => {
    await expect(
      maybeRunBackgroundReview(
        { agentId: "test", sessionId: "s1" },
        "x".repeat(300)
      )
    ).resolves.toBeUndefined();
  });
});
