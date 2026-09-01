import { describe, expect, test } from "bun:test";
import { taskMatchesScope } from "../../ui/src/pages/taskScope";

describe("task scope", () => {
  test("shows all tasks without an agent scope", () => {
    expect(taskMatchesScope({ agent_id: "agent-a" }, "", "")).toBe(true);
  });

  test("matches tasks owned by a bot or its canonical conversation", () => {
    expect(taskMatchesScope({ agent_id: "bot-a" }, "bot-a", "bot:bot-a")).toBe(true);
    expect(taskMatchesScope({ session_id: "bot:bot-a" }, "bot-a", "bot:bot-a")).toBe(true);
    expect(
      taskMatchesScope({ agent_id: "bot-b", session_id: "bot:bot-b" }, "bot-a", "bot:bot-a")
    ).toBe(false);
  });

  test("does not treat an empty session id as shared ownership", () => {
    expect(taskMatchesScope({ session_id: "" }, "bot-a", "")).toBe(false);
  });
});
