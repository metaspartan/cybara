import { describe, expect, test } from "bun:test";
import { latestRecoveredAssistantContent } from "../../src/cli/commands/raw-agent-recovery";

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
});
