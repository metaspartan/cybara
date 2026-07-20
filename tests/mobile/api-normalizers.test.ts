import { describe, expect, test } from "bun:test";
import { normalizeAgent } from "../../apps/mobile/src/lib/api-normalizers";

describe("mobile API normalizers", () => {
  test("preserves gateway reasoning capabilities for agent controls", () => {
    const agent = normalizeAgent({
      id: "agent-1",
      name: "Research",
      reasoning_mode: "effort",
      reasoning_efforts: ["low", "high", "max"],
    });

    expect(agent.reasoning_mode).toBe("effort");
    expect(agent.reasoning_efforts).toEqual(["low", "high", "max"]);
  });

  test("filters malformed gateway reasoning capabilities", () => {
    const agent = normalizeAgent({
      id: "agent-2",
      reasoning_mode: "unsupported",
      reasoning_efforts: ["low", "unsupported", null, "xhigh"],
    });

    expect(agent.reasoning_mode).toBeUndefined();
    expect(agent.reasoning_efforts).toEqual(["low", "xhigh"]);
  });
});
