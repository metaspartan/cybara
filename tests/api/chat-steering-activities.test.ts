import { describe, expect, test } from "bun:test";
import { materializeInterruptedAssistantBeforeSteering } from "../../src/api/chat-steering-activities";
import type { InMemoryChatSession } from "../../src/api/chat-runtime-state";

function createSession(): InMemoryChatSession {
  const timestamp = new Date().toISOString();
  return {
    id: "steering-attribution-session",
    agentId: "agent-1",
    title: null,
    messages: [
      { role: "user", content: "original", timestamp },
      {
        role: "user",
        content: "unrelated pending steer",
        timestamp,
        _pendingSteeringId: "pending-other",
      },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
    persisted: false,
  };
}

describe("chat steering activity attribution", () => {
  test("does not materialize against an unrelated pending steer without an id", () => {
    const session = createSession();
    const before = structuredClone(session.messages);

    const result = materializeInterruptedAssistantBeforeSteering(session);

    expect(result).toBeUndefined();
    expect(session.messages).toEqual(before);
  });

  test("materializes only the pending steer with the exact id", () => {
    const session = createSession();

    const result = materializeInterruptedAssistantBeforeSteering(session, undefined, {
      pendingSteeringId: "pending-other",
    });

    expect(result?._pendingSteeringId).toBe("pending-other");
    expect(session.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(result?.process_activities?.map((activity) => activity.text)).toEqual([
      "Conversation steered.",
    ]);
  });

  test("does not let a future restored timestamp inflate interrupted work duration", () => {
    const session = createSession();
    const now = Date.now();
    session.messages[1]!.timestamp = new Date(now + 6 * 60 * 60 * 1000).toISOString();

    const result = materializeInterruptedAssistantBeforeSteering(
      session,
      [
        {
          id: "real-work",
          phase: "result",
          text: "Read the project",
          timestamp: now - 8_000,
          toolName: "read",
        },
      ],
      { pendingSteeringId: "pending-other" }
    );

    expect(Date.parse(result?.timestamp || "")).toBeLessThanOrEqual(Date.now());
    expect(result?.worked_duration_ms).toBeGreaterThanOrEqual(7_900);
    expect(result?.worked_duration_ms).toBeLessThan(9_000);
  });
});
