import { describe, expect, test } from "bun:test";
import {
  resolveBotBaseAgentId,
  selectableBotBaseAgents,
} from "../../ui/src/pages/chat/botAgentSelection";
import type { AgentSummary } from "../../ui/src/types";

const agents: AgentSummary[] = [
  { id: "agent-coder", name: "Coder", model: "glm-5.3" },
  { id: "bot-release", name: "Release bot", model: "MiniMax-M3", is_bot: true },
  { id: "agent-research", name: "Researcher", model: "MiniMax-M3", is_bot: false },
];

describe("bot agent selection", () => {
  test("offers configured agents without mixing existing bots into the selector", () => {
    expect(selectableBotBaseAgents(agents).map((agent) => agent.id)).toEqual([
      "agent-coder",
      "agent-research",
    ]);
  });

  test("keeps a valid choice and falls back to the first available agent", () => {
    const selectable = selectableBotBaseAgents(agents);
    expect(resolveBotBaseAgentId(selectable, "agent-research")).toBe("agent-research");
    expect(resolveBotBaseAgentId(selectable, "bot-release")).toBe("agent-coder");
    expect(resolveBotBaseAgentId([], "agent-coder")).toBe("");
  });
});
