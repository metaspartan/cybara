import { describe, expect, test } from "bun:test";
import { buildAgentChatPath, parseInitialChatRoute } from "../../ui/src/pages/chat/chatRoute";

describe("chat route state", () => {
  test("builds a fresh chat link with the selected agent", () => {
    expect(buildAgentChatPath("agent/one")).toBe("/chat?agent=agent%2Fone&fresh=1");
  });

  test("parses trimmed agent and session parameters", () => {
    expect(parseInitialChatRoute("?agent=%20agent-1%20&session=%20s1%20&fresh=1")).toEqual({
      agentId: "agent-1",
      sessionId: "s1",
      startFresh: true,
      workspaceDir: null,
    });
  });

  test("ignores empty route parameters", () => {
    expect(parseInitialChatRoute("?agent=%20&session=")).toEqual({
      agentId: null,
      sessionId: null,
      startFresh: false,
      workspaceDir: null,
    });
  });

  test("parses a workspace for a fresh workspace chat", () => {
    expect(parseInitialChatRoute("?fresh=1&workspace=%2Ftmp%2Fcybara")).toEqual({
      agentId: null,
      sessionId: null,
      startFresh: true,
      workspaceDir: "/tmp/cybara",
    });
  });
});
