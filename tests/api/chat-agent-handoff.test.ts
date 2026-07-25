import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  buildAgentHandoffInstruction,
  resolveInheritedAgentAuthors,
} from "../../src/api/chat-agent-handoff";
import { buildChatExecutionMessagesForAgent } from "../../src/api/chat-execution-messages";
import { promptMatchesActiveAgent } from "../../src/api/chat-agent-prompt";
import { resolveQueuedTurnRouting } from "../../src/api/chat-pending-state";
import type { ChatMessage } from "../../src/api/chat-types";

const ROOT_DIR = join(import.meta.dirname, "..", "..");

const miniTurn: ChatMessage = {
  role: "assistant",
  content: "Here is the module layout.",
  agent_id: "agent-mini",
  agent_name: "Mini",
  model: "MiniMax-M3",
};

const transcript = (...extra: ChatMessage[]): ChatMessage[] => [
  { role: "system", content: "You are Zai." },
  { role: "user", content: "Design it." },
  miniTurn,
  ...extra,
  { role: "user", content: "Now continue." },
];

describe("mid-conversation agent handoff", () => {
  test("identifies assistant turns inherited from other agents", () => {
    expect(resolveInheritedAgentAuthors(transcript(), "agent-zai")).toEqual([
      { agentId: "agent-mini", agentName: "Mini", model: "MiniMax-M3" },
    ]);
    expect(resolveInheritedAgentAuthors(transcript(), "agent-mini")).toEqual([]);
    expect(resolveInheritedAgentAuthors(transcript(), undefined)).toEqual([]);
  });

  test("does not claim a handoff when one agent wrote every turn", () => {
    expect(buildAgentHandoffInstruction(transcript(), "agent-mini")).toBeUndefined();
    expect(
      buildAgentHandoffInstruction(
        [
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Hello" },
        ],
        "agent-zai"
      )
    ).toBeUndefined();
  });

  test("tells the incoming agent which work it inherited", () => {
    const instruction = buildAgentHandoffInstruction(transcript(), "agent-zai") || "";
    expect(instruction).toContain("Mini (MiniMax-M3)");
    expect(instruction).toContain("You are the active agent now");
    expect(instruction).toContain("Do not claim you personally produced it");
  });

  test("injects the handoff note into execution messages after the system prompt", () => {
    const messages = buildChatExecutionMessagesForAgent(transcript(), {
      activeAgentId: "agent-zai",
    });

    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toBe("You are Zai.");
    expect(messages[1]?.role).toBe("system");
    expect(messages[1]?.content).toContain("written by other agents: Mini (MiniMax-M3)");
  });

  test("leaves a single-agent conversation untouched", () => {
    const messages = buildChatExecutionMessagesForAgent(transcript(), {
      activeAgentId: "agent-mini",
    });

    expect(messages.filter((message) => message.role === "system")).toHaveLength(1);
  });

  test("defers to the tool-driven transfer instruction when one applies", () => {
    const transferred = transcript({
      role: "assistant",
      content: "Transferring.",
      agent_id: "agent-mini",
      agent_name: "Mini",
      model: "MiniMax-M3",
      agent_transfers: [
        {
          protocol: "cybara-agent-transfer-v1",
          status: "accepted",
          sessionId: "session-1",
          fromAgentId: "agent-mini",
          fromAgentName: "Mini",
          toAgentId: "agent-zai",
          toAgentName: "Zai",
          reason: "Needs a coding model",
          contextMode: "full",
          requestedAt: new Date().toISOString(),
        },
      ],
    });
    const messages = buildChatExecutionMessagesForAgent(transferred, {
      activeAgentId: "agent-zai",
    });
    const systemContents = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content);

    expect(systemContents.some((content) => content.includes("transfer from Mini to Zai"))).toBe(
      true
    );
    expect(systemContents.some((content) => content.includes("written by other agents"))).toBe(
      false
    );
  });

  test("rebuilds the system prompt when it belongs to a previous agent", () => {
    const prompt = "You are Mini.\nRuntime: agent=agent-mini | model=MiniMax-M3\n";
    expect(promptMatchesActiveAgent(prompt, "agent-mini")).toBe(true);
    expect(promptMatchesActiveAgent(prompt, "agent-zai")).toBe(false);
    expect(promptMatchesActiveAgent("You are Mini.", "agent-zai")).toBe(true);
  });

  test("routes a queued follow-up to the session's current agent, not the queued one", () => {
    expect(
      resolveQueuedTurnRouting({ agentId: "agent-zai", useModelRouter: false } as never)
    ).toEqual({ agentId: "agent-zai", useModelRouter: false });
    expect(
      resolveQueuedTurnRouting({ agentId: "agent-zai", useModelRouter: true } as never)
    ).toEqual({ agentId: "agent-zai", useModelRouter: true });

    const runtime = readFileSync(join(ROOT_DIR, "src", "api", "chat-runtime.ts"), "utf8");
    expect(runtime).toContain("...resolveQueuedTurnRouting(session),");
    expect(runtime).not.toContain("agentId: next.request.agentId,");
    expect(runtime).not.toContain("agentId: item.request.agentId,");
  });
});
