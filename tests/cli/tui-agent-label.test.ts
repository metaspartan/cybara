import { describe, expect, test } from "bun:test";
import { formatTUIAgentLabel } from "../../src/cli-tui-agent-label";

describe("CLI TUI agent labels", () => {
  test("shows the agent and model without internal lifecycle state", () => {
    expect(
      formatTUIAgentLabel({
        id: "agent-1",
        name: "Mini",
        model: "MiniMax-M3",
      })
    ).toBe("Mini · MiniMax-M3");
  });

  test("uses stable fallbacks for incomplete agent records", () => {
    expect(formatTUIAgentLabel({ id: "agent-1" })).toBe("agent-1");
    expect(formatTUIAgentLabel({})).toBe("Unnamed agent");
  });
});
