import { afterEach, describe, expect, test } from "bun:test";
import {
  buildChatExecutionMessagesForAgent,
  deleteSession,
  getSessionMessages,
  handleChat,
  type ChatMessage,
} from "../../src/api/chat";
import { handleSessionGoalCommand, resetSessionGoalsForTests } from "../../src/core/session-goals";

const createdSessionIds: string[] = [];

afterEach(async () => {
  resetSessionGoalsForTests();
  for (const sessionId of createdSessionIds.splice(0)) await deleteSession(sessionId);
});

describe("chat goal commands", () => {
  test("/goal is handled locally without persisting chat text", async () => {
    const sessionId = `goal-local-${Date.now()}`;
    createdSessionIds.push(sessionId);

    const result = await handleChat({
      message: "/goal start fix CI",
      sessionId,
      tools: false,
    });

    expect(result.sessionId).toBe(sessionId);
    expect(result.message.role).toBe("assistant");
    expect(result.message.content).toBe("Goal started: fix CI");
    expect(await getSessionMessages(sessionId)).toEqual([]);
  });

  test("active goals are injected into execution context without mutating chat messages", () => {
    const sessionId = `goal-context-${Date.now()}`;
    const goalResult = handleSessionGoalCommand(sessionId, "/goal finish the security audit");
    const chatMessages: ChatMessage[] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "continue" },
    ];

    const executionMessages = buildChatExecutionMessagesForAgent(chatMessages, { sessionId });

    expect(goalResult.response).toBe("Goal started: finish the security audit");
    expect(executionMessages).toEqual([
      { role: "system", content: "You are a helpful assistant." },
      {
        role: "system",
        content:
          "Active goal: finish the security audit - advance it or update its status with /goal.",
      },
      { role: "user", content: "continue" },
    ]);
    expect(chatMessages).toEqual([
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "continue" },
    ]);
  });

  test("steering turns add the interrupt instruction without mutating chat messages", () => {
    const chatMessages: ChatMessage[] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "new direction" },
    ];

    const executionMessages = buildChatExecutionMessagesForAgent(chatMessages, {
      materializedSteeringTurn: true,
    });

    expect(executionMessages).toEqual([
      { role: "system", content: "You are a helpful assistant." },
      {
        role: "system",
        content:
          "The previous assistant turn was interrupted by user steering. Treat the latest user message as the active instruction. Do not continue abandoned earlier work unless the latest user message explicitly asks for it.",
      },
      { role: "user", content: "new direction" },
    ]);
    expect(chatMessages).toEqual([
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "new direction" },
    ]);
  });

  test("goal and steering context preserve media and deterministic instruction order", () => {
    const sessionId = `goal-steer-media-${Date.now()}`;
    handleSessionGoalCommand(sessionId, "/goal audit cross-client chat parity");
    const chatMessages: ChatMessage[] = [
      { role: "system", content: "You are a helpful assistant." },
      {
        role: "user",
        content: "review this screenshot",
        images: ["data:image/png;base64,abc123"],
      },
    ];

    const executionMessages = buildChatExecutionMessagesForAgent(chatMessages, {
      sessionId,
      materializedSteeringTurn: true,
    });

    expect(executionMessages).toEqual([
      { role: "system", content: "You are a helpful assistant." },
      {
        role: "system",
        content:
          "The previous assistant turn was interrupted by user steering. Treat the latest user message as the active instruction. Do not continue abandoned earlier work unless the latest user message explicitly asks for it.",
      },
      {
        role: "system",
        content:
          "Active goal: audit cross-client chat parity - advance it or update its status with /goal.",
      },
      {
        role: "user",
        content: "review this screenshot",
        images: ["data:image/png;base64,abc123"],
      },
    ]);
    expect(chatMessages).toEqual([
      { role: "system", content: "You are a helpful assistant." },
      {
        role: "user",
        content: "review this screenshot",
        images: ["data:image/png;base64,abc123"],
      },
    ]);
  });
});
