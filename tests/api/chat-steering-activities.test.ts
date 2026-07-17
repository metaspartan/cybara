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
});
