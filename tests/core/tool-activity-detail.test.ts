import { describe, expect, test } from "bun:test";
import { formatToolActivityDetail } from "../../src/core/agent-internals";

describe("tool activity detail", () => {
  test("identifies the loaded skill", () => {
    expect(
      formatToolActivityDetail("skill_load", { name: "security-scan" }, "result", {
        name: "Security Scan",
      })
    ).toBe("Loaded Security Scan skill");
  });

  test("identifies plan progress and the active item", () => {
    expect(
      formatToolActivityDetail(
        "todo",
        {
          items: [
            { content: "Inspect runtime", status: "completed" },
            { content: "Verify UI", status: "in_progress" },
          ],
        },
        "result"
      )
    ).toBe("Updated plan: Verify UI in progress (1/2 complete)");
  });
});
