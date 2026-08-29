import { describe, expect, test } from "bun:test";
import {
  buildAgentChatPath,
  buildFreshChatPath,
  buildSessionChatPath,
  parseInitialChatRoute,
} from "../../ui/src/pages/chat/chatRoute";

describe("chat route state", () => {
  test("builds a fresh chat link with the selected agent", () => {
    expect(buildAgentChatPath("agent/one")).toBe("/chat?agent=agent%2Fone&fresh=1");
  });

  test("builds a restorable bot session link", () => {
    expect(buildSessionChatPath("bot:agent/one")).toBe("/chat?session=bot%3Aagent%2Fone");
  });

  test("builds distinct fresh chat routes that retain workspace selection", () => {
    expect(buildFreshChatPath(" /tmp/cybara ", "request-one")).toBe(
      "/chat?fresh=1&request=request-one&workspace=%2Ftmp%2Fcybara"
    );
    expect(buildFreshChatPath(null, "request-two")).toBe("/chat?fresh=1&request=request-two");
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
