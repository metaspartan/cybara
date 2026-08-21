import { afterEach, describe, expect, test } from "bun:test";
import {
  buildChatExecutionMessagesForAgent,
  deleteSession,
  enqueuePendingChatMessage,
  getSessionMessages,
  handleChat,
  listPendingChatMessages,
  type ChatMessage,
} from "../../src/api/chat";
import { removePendingChatQueueItem } from "../../src/api/chat-pending-state";
import { getResidentChatSession, pendingChatQueues } from "../../src/api/chat-runtime-state";
import { agentManager } from "../../src/core/agent";
import { config } from "../../src/core/config";
import { providerManager } from "../../src/core/providers";
import {
  getGoalLoopState,
  GOAL_LOOP_SOURCE,
  resetGoalLoopsForTests,
} from "../../src/core/session-goal-loop";
import {
  getSessionGoal,
  handleSessionGoalCommand,
  resetSessionGoalsForTests,
} from "../../src/core/session-goals";

const createdSessionIds: string[] = [];
const agentIds: string[] = [];
const providerIds: string[] = [];
const originalExecute = agentManager.execute.bind(agentManager);
const originalCallLLM = agentManager.callLLM.bind(agentManager);

async function waitFor(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

afterEach(async () => {
  agentManager.execute = originalExecute;
  agentManager.callLLM = originalCallLLM;
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
    agentManager.execute = async () => ({
      content:
        "The goal kickoff retained its selected agent and created a durable session with the requested execution context. The verification is complete and no additional work remains.\nDONE: kickoff verified",
    });

    const result = await handleChat({
      message: "/goal start fix CI",
      sessionId,
      agentId: agent.id,
      tools: false,
      source: "dataset_generation",
    });

    expect(result.sessionId).toBe(sessionId);
    expect(result.message.role).toBe("assistant");
    expect(result.message.content).toBe("Goal started: fix CI");
    await waitFor(() => getSessionGoal(sessionId)?.status === "complete");
  });

  test("persists goal commands and preserves the selected workspace across reloads", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Goal Persistence Provider",
      api_key: "test-key",
      base_url: "https://api.openai.com/v1",
    });
    providerIds.push(provider.id);
    const agent = agentManager.create({
      name: "Goal Persistence Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-goal-persistence",
      memory_enabled: false,
    });
    agentIds.push(agent.id);
    const sessionId = `goal-persistence-${Date.now()}`;
    createdSessionIds.push(sessionId);
    const workspaceDir = process.cwd();

    agentManager.execute = async () => ({
      content:
        "The goal command and acknowledgement were persisted in the session while the selected workspace and agent remained attached to the autonomous turn. The verification is complete and no additional work remains.\nDONE: persistence verified",
    });

    const result = await handleChat({
      message: "/goal start verify command persistence",
      sessionId,
      agentId: agent.id,
      workspaceDir,
      tools: false,
      source: "dataset_generation",
    });

    expect(result.workspaceDir).toBe(workspaceDir);
    await waitFor(() => getSessionGoal(sessionId)?.status === "complete");
    const persistedMessages = await getSessionMessages(sessionId);
    expect(persistedMessages.map((message) => message.content)).toContain(
      "/goal start verify command persistence"
    );
    expect(persistedMessages.map((message) => message.content)).toContain(
      "Goal started: verify command persistence"
    );
    expect(getResidentChatSession(sessionId)?.workspaceDir).toBe(workspaceDir);
    expect(getResidentChatSession(sessionId)?.agentId).toBe(agent.id);
  });

  test("hides autonomous pending turns and replaces them when a user follows up", () => {
    const sessionId = `goal-pending-${Date.now()}`;
    createdSessionIds.push(sessionId);
    enqueuePendingChatMessage(
      {
        message: "[autonomous goal iteration 2]\nContinue working",
        sessionId,
        source: GOAL_LOOP_SOURCE,
      },
      sessionId,
      "queued"
    );

    expect(listPendingChatMessages(sessionId)).toEqual([]);
    expect(pendingChatQueues.get(sessionId)).toHaveLength(1);

    enqueuePendingChatMessage(
      { message: "Use the exact test counts in the report", sessionId },
      sessionId,
      "queued"
    );

    expect(listPendingChatMessages(sessionId).map((item) => item.content)).toEqual([
      "Use the exact test counts in the report",
    ]);
    expect(pendingChatQueues.get(sessionId)?.map((item) => item.content)).toEqual([
      "Use the exact test counts in the report",
    ]);
    for (const item of pendingChatQueues.get(sessionId) || []) {
      removePendingChatQueueItem(sessionId, item.id);
    }
  });

  test("pauses after three resolved provider failures instead of burning the full budget", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Goal Failure Provider",
      api_key: "test-key",
      base_url: "https://api.openai.com/v1",
    });
    providerIds.push(provider.id);
    const agent = agentManager.create({
      name: "Goal Failure Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-goal-failure",
      memory_enabled: false,
    });
    agentIds.push(agent.id);
    const sessionId = `goal-failure-${Date.now()}`;
    createdSessionIds.push(sessionId);
    config.set("goal_loop_max_iterations", 25);

    agentManager.execute = async () => ({
      content: "",
      failure: { category: "overloaded", retryable: true },
    });

    await handleChat({
      message: "/goal start finish the provider-backed task",
      sessionId,
      agentId: agent.id,
      tools: false,
      source: "dataset_generation",
    });

    await waitFor(() => getSessionGoal(sessionId)?.status === "paused");
    expect(getGoalLoopState(sessionId)?.consecutiveFailures).toBe(3);
    expect(getGoalLoopState(sessionId)?.stopReason).toBe("error");
    expect(getSessionGoal(sessionId)?.lastStatusNote).toContain("repeated failures");
  });

  test("runs exactly the configured number of autonomous iterations", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Goal Iteration Limit Provider",
      api_key: "test-key",
      base_url: "https://api.openai.com/v1",
    });
    providerIds.push(provider.id);
    const agent = agentManager.create({
      name: "Goal Iteration Limit Agent",
      type: "main",
      provider_id: provider.id,
      model: "gpt-goal-iteration-limit",
      memory_enabled: false,
    });
    agentIds.push(agent.id);
    const sessionId = `goal-iteration-limit-${Date.now()}`;
    createdSessionIds.push(sessionId);
    config.set("goal_loop_max_iterations", 2);
    const iterationPrompts: string[] = [];

    agentManager.callLLM = (async () => ({
      content: '{"verdict":"continue","reason":"checkpoint not reached"}',
    })) as typeof agentManager.callLLM;
    agentManager.execute = (async (_agentId, messages) => {
      const prompt = messages.at(-1)?.content || "";
      if (prompt.startsWith("[autonomous goal iteration")) iterationPrompts.push(prompt);
      return {
        content:
          "Progress remains intentionally partial at this checkpoint. The loop should continue to the next configured turn without claiming completion, stopping, or requesting user input. More bounded work remains.",
      };
    }) as typeof agentManager.execute;

    await handleChat({
      message: "/goal start exercise the exact iteration limit",
      sessionId,
      agentId: agent.id,
      tools: false,
      source: "dataset_generation",
    });

    await waitFor(() => getSessionGoal(sessionId)?.status === "paused");
    expect(iterationPrompts).toHaveLength(2);
    expect(iterationPrompts[0]).toContain("[autonomous goal iteration 1]");
    expect(iterationPrompts[1]).toContain("[autonomous goal iteration 2]");
    expect(getGoalLoopState(sessionId)?.iterations).toBe(2);
    expect(getGoalLoopState(sessionId)?.stopReason).toBe("max_iterations");
    expect(pendingChatQueues.get(sessionId) || []).toHaveLength(0);
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
          "Active goal: finish the security audit — advance it; keep it active until fully achieved; reply DONE: only after concrete verification, or BLOCKED: <reason> only when user input is required.",
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
          "Active goal: audit cross-client chat parity — advance it; keep it active until fully achieved; reply DONE: only after concrete verification, or BLOCKED: <reason> only when user input is required.",
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
