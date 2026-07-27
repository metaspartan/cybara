import { describe, expect, test } from "bun:test";
import {
  latestRecoveredAssistantContent,
  recoverRawAgentResult,
} from "../../src/cli/commands/raw-agent-recovery";

describe("raw agent recovery", () => {
  test("returns only an assistant response added after the request began", () => {
    const result = latestRecoveredAssistantContent(
      [
        { role: "user", content: "Earlier" },
        { role: "assistant", content: "Earlier answer" },
        { role: "user", content: "Continue" },
        { role: "assistant", content: [{ type: "text", text: "Finished continuation" }] },
      ],
      2
    );

    expect(result).toBe("Finished continuation");
  });

  test("does not reuse an assistant response from before the disconnected turn", () => {
    expect(
      latestRecoveredAssistantContent(
        [
          { role: "user", content: "Earlier" },
          { role: "assistant", content: "Earlier answer" },
          { role: "user", content: "Continue" },
        ],
        2
      )
    ).toBeNull();
  });

  test("does not attempt recovery without a valid history baseline", async () => {
    let fetchCount = 0;
    const result = await recoverRawAgentResult({
      baselineMessageCount: null,
      fetchAPI: async <T>(): Promise<T | null> => {
        fetchCount += 1;
        return [{ role: "assistant", content: "Earlier answer" }] as T;
      },
      sessionId: "session-without-baseline",
      waitMs: 10,
    });

    expect(result).toBeNull();
    expect(fetchCount).toBe(0);
  });
});
