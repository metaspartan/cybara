import { describe, expect, test } from "bun:test";
import {
  AGENT_TRANSFER_PROTOCOL,
  buildAgentTransferMessages,
  createAgentTransferEnvelope,
  findAgentTransferEnvelope,
  normalizeAgentTransferContextMode,
  parseAgentTransferEnvelope,
} from "../../src/core/agent-transfer";

function transfer(contextMode: "full" | "recent" | "summary" = "full") {
  return createAgentTransferEnvelope({
    sessionId: "session-1",
    fromAgentId: "agent-a",
    fromAgentName: "Agent A",
    toAgentId: "agent-b",
    toAgentName: "Agent B",
    reason: "Specialist ownership",
    contextMode,
    contextSummary: "Keep the requested format",
    requestedAt: "2026-07-13T00:00:00.000Z",
  });
}

describe("agent transfer", () => {
  test("parses only complete accepted transfer envelopes", () => {
    const envelope = transfer();
    expect(parseAgentTransferEnvelope(envelope)).toEqual(envelope);
    expect(parseAgentTransferEnvelope({ ...envelope, protocol: "other" })).toBeUndefined();
    expect(parseAgentTransferEnvelope({ ...envelope, toAgentId: "" })).toBeUndefined();
    expect(normalizeAgentTransferContextMode("invalid")).toBe("full");
  });

  test("finds an accepted transfer among tool results", () => {
    const envelope = transfer("recent");
    expect(
      findAgentTransferEnvelope([
        { name: "read", result: "done" },
        { name: "sessions_transfer", result: envelope },
      ])
    ).toEqual(envelope);
    expect(AGENT_TRANSFER_PROTOCOL).toBe("cybara-agent-transfer-v1");
  });

  test("shares bounded prior history and current-turn tool results", () => {
    const messages = [
      { role: "system" as const, content: "Target system prompt" },
      ...Array.from({ length: 15 }, (_, index) => ({
        role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: `message-${index}`,
      })),
    ];
    const recent = buildAgentTransferMessages(messages, transfer("recent"), {
      response: "Source agent progress",
      toolCalls: [
        { name: "read", result: { path: "src/index.ts", lines: 40 } },
        { name: "sessions_transfer", result: transfer("recent") },
      ],
    });

    expect(recent.filter((message) => message.role !== "system")).toHaveLength(12);
    expect(recent.some((message) => message.content.includes("read:"))).toBe(true);
    expect(recent.some((message) => message.content.includes("Source agent progress"))).toBe(true);
    expect(recent.some((message) => message.content.includes("sessions_transfer:"))).toBe(false);

    const summary = buildAgentTransferMessages(messages, transfer("summary"));
    expect(summary.filter((message) => message.role !== "system")).toEqual([
      { role: "user", content: "message-14" },
    ]);
  });
});
