import { afterEach, describe, expect, test } from "bun:test";
import {
  buildChatExecutionMessagesForAgent,
  deleteSession,
  getSessionMessages,
  handleChat,
  type ChatMessage,
} from "../../src/api/chat";
import { agentManager } from "../../src/core/agent";
import { config } from "../../src/core/config";
import { providerManager } from "../../src/core/providers";
import { resetGoalLoopsForTests } from "../../src/core/session-goal-loop";
import { handleSessionGoalCommand, resetSessionGoalsForTests } from "../../src/core/session-goals";

const createdSessionIds: string[] = [];
const agentIds: string[] = [];
const providerIds: string[] = [];
const originalExecute = agentManager.execute.bind(agentManager);

async function waitFor(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

afterEach(async () => {
  agentManager.execute = originalExecute;
  resetSessionGoalsForTests();
  resetGoalLoopsForTests();
  config.set("goal_loop_max_iterations", 1);
  config.set("goal_loop_max_duration_seconds", 60);
  for (const agentId of agentIds.splice(0)) agentManager.delete(agentId);
  for (const providerId of providerIds.splice(0)) providerManager.delete(providerId);
  for (const sessionId of createdSessionIds.splice(0)) await deleteSession(sessionId);
});

describe("chat goal commands", () => {
  test("/goal is handled locally and injects the goal into execution context", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Goal Kickoff Provider",
      api_key: "test-key",
      base_url: "https://api.openai.com/v1",
    });
    providerIds.push(provider.id);
    const agent = agentManager.create({
      name: "Goal Kickoff Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-goal-kickoff",
      memory_enabled: false,
    });
    agentIds.push(agent.id);
    const sessionId = `goal-local-${Date.now()}`;
    createdSessionIds.push(sessionId);
    config.set("goal_loop_max_iterations", 1);

    const result = await handleChat({
      message: "/goal start fix CI",
      sessionId,
      agentId: agent.id,
      tools: false,
    });

    expect(result.sessionId).toBe(sessionId);
    expect(result.message.role).toBe("assistant");
    expect(result.message.content).toBe("Goal started: fix CI");
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
          "You have the user's explicit go-ahead to act on this request. Do not stop to ask permission, present a plan awaiting approval, or end with 'want me to...' / 'say the word'. Execute the requested work directly with tools, run checks, and deliver results. Continue until the work is done or you are concretely blocked; if blocked, report exactly what blocked you and what you tried.",
      },
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

  test("steering excludes the abandoned turn from provider context", () => {
    const chatMessages: ChatMessage[] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Keep this earlier context." },
      { role: "assistant", content: "Earlier context acknowledged." },
      { role: "user", content: "Run the abandoned command." },
      {
        role: "assistant",
        content: "",
        process_activities: [
          {
            id: "steered",
            phase: "result",
            text: "Conversation steered.",
            timestamp: 2,
            toolName: "__steering",
          },
        ],
      },
      { role: "user", content: "Reply with the new answer only." },
    ];

    const executionMessages = buildChatExecutionMessagesForAgent(chatMessages, {
      materializedSteeringTurn: true,
    });

    expect(executionMessages.map((message) => message.content)).toEqual([
      "You are a helpful assistant.",
      "The previous assistant turn was interrupted by user steering. Treat the latest user message as the active instruction. Do not continue abandoned earlier work unless the latest user message explicitly asks for it.",
      "Keep this earlier context.",
      "Earlier context acknowledged.",
      "Reply with the new answer only.",
    ]);
    expect(chatMessages).toHaveLength(6);
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

  test("text-only execution uses persisted image analysis without resending pixels", () => {
    const executionMessages = buildChatExecutionMessagesForAgent(
      [
        {
          role: "user",
          content: "What is shown?",
          images: [{ data: "abc123", mimeType: "image/png" }],
          image_context: "A capybara with an orange and a robotic leg.",
        },
      ],
      { supportsImages: false }
    );
    expect(executionMessages).toEqual([
      {
        role: "user",
        content:
          "What is shown?\n\n[Attached image analysis]\nA capybara with an orange and a robotic leg.",
      },
    ]);
  });
});
