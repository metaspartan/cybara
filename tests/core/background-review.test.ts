import { describe, expect, test } from "bun:test";
import {
  BACKGROUND_REVIEW_TOOL_NAMES,
  maybeRunBackgroundReview,
} from "../../src/core/background-review";
import type { ToolContext } from "../../src/core/tools";

describe("background review", () => {
  test("restricts review workers to memory tools", () => {
    expect(BACKGROUND_REVIEW_TOOL_NAMES).toEqual(["memory_search", "memory_get", "memory_save"]);
  });

  test("maybeRunBackgroundReview is a no-op without sessionId", async () => {
    await expect(maybeRunBackgroundReview(undefined, "some text")).resolves.toBeUndefined();
  });

  test("maybeRunBackgroundReview skips short content", async () => {
    await expect(
      maybeRunBackgroundReview({ agentId: "test", sessionId: "s1" }, "short")
    ).resolves.toBeUndefined();
  });

  test("maybeRunBackgroundReview skips when disabled", async () => {
    await expect(
      maybeRunBackgroundReview({ agentId: "test", sessionId: "s1" }, "x".repeat(300), {
        disabled: true,
      })
    ).resolves.toBeUndefined();
  });

  test("uses the active turn model when the reviewer keeps the same agent", async () => {
    let capturedArgs: Record<string, unknown> | undefined;
    let capturedContext: ToolContext | undefined;

    await maybeRunBackgroundReview(
      {
        agentId: "codex-agent",
        sessionId: `background-model-${crypto.randomUUID()}`,
        activeModel: "gpt-5.5",
        activeProviderId: "codex-provider",
      },
      "A durable review candidate. ".repeat(20),
      {
        minIntervalMs: 0,
        spawn: async (args, context) => {
          capturedArgs = args;
          capturedContext = context;
          return {
            status: "completed",
            childSessionKey: "child",
            runId: "run",
            task: String(args.task),
          };
        },
      }
    );

    expect(capturedArgs?.agentId).toBe("codex-agent");
    expect(capturedArgs?.model).toBe("gpt-5.5");
    expect(capturedContext?.activeModel).toBe("gpt-5.5");
    expect(capturedContext?.allowedToolNames).toEqual(BACKGROUND_REVIEW_TOOL_NAMES);
  });
});
