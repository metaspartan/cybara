import { afterEach, describe, expect, test } from "bun:test";
import { deleteSession, handleChat } from "../../src/api/chat";
import {
  awaitSpawnedSubagentResults,
  unresolvedSpawnRunIds,
} from "../../src/api/chat-subagent-completion";
import { agentManager } from "../../src/core/agent";
import type { AgentToolCallResult } from "../../src/core/agent-internals";
import { providerManager } from "../../src/core/providers";
import {
  getRun,
  markRunCompleted,
  registerSubagentRun,
  releaseSubagentRun,
} from "../../src/core/subagent-registry";
import { getActiveSessionRunId } from "../../src/core/session-event-ledger";
import { onStatusStream } from "../../src/core/status";

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];
const createdSessionIds: string[] = [];
const createdRunIds: string[] = [];
const originalExecute = agentManager.execute.bind(agentManager);

afterEach(async () => {
  agentManager.execute = originalExecute;
  for (const sessionId of createdSessionIds.splice(0)) await deleteSession(sessionId);
  for (const runId of createdRunIds.splice(0)) releaseSubagentRun(runId);
  for (const agentId of createdAgentIds.splice(0)) agentManager.delete(agentId);
  for (const providerId of createdProviderIds.splice(0)) providerManager.delete(providerId);
});

function spawnToolCall(runId: string): AgentToolCallResult {
  return {
    id: `spawn-${runId}`,
    name: "sessions_spawn",
    args: { task: "inspect lifecycle" },
    result: {
      status: "accepted",
      childSessionKey: `agent:child:subagent:${runId}`,
      runId,
      task: "inspect lifecycle",
    },
  };
}

function todoToolCall(status: "in_progress" | "completed"): AgentToolCallResult {
  return {
    id: `todo-${status}`,
    name: "todo",
    args: {
      items: [{ content: "Inspect delegated lifecycle", status, priority: "high" }],
    },
    result: {
      items: [{ content: "Inspect delegated lifecycle", status, priority: "high" }],
      summary: {
        total: 1,
        pending: 0,
        inProgress: status === "in_progress" ? 1 : 0,
        completed: status === "completed" ? 1 : 0,
        cancelled: 0,
      },
    },
  };
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("chat subagent completion", () => {
  test("identifies accepted runs that do not have a terminal wait result", () => {
    const pending = spawnToolCall("run-pending");
    const completedWait: AgentToolCallResult = {
      id: "wait-completed",
      name: "sessions_wait",
      args: { runIds: ["run-completed"] },
      result: {
        status: "completed",
        pendingRunIds: [],
        runs: [{ runId: "run-completed", status: "completed" }],
      },
    };

    expect(unresolvedSpawnRunIds([spawnToolCall("run-completed"), pending, completedWait])).toEqual(
      ["run-pending"]
    );
  });

  test("waits for a delegated run and returns a synthesis-ready tool result", async () => {
    const sessionId = `subagent-await-${crypto.randomUUID()}`;
    const run = registerSubagentRun({
      childSessionKey: `agent:child:subagent:${crypto.randomUUID()}`,
      requesterSessionKey: sessionId,
      task: "inspect lifecycle",
      cleanup: "delete",
    });
    createdRunIds.push(run.runId);
    const waitingCounts: number[] = [];
    const waiting = awaitSpawnedSubagentResults({
      abortSignal: new AbortController().signal,
      agentId: "parent-agent",
      sessionId,
      toolResults: [spawnToolCall(run.runId)],
      onWaiting: (count) => waitingCounts.push(count),
    });

    setTimeout(() => markRunCompleted(run.runId, "CHILD_RESULT=ready"), 20);
    const result = await waiting;

    expect(waitingCounts).toEqual([1]);
    expect(result?.name).toBe("sessions_wait");
    expect(result?.result).toEqual(
      expect.objectContaining({
        status: "completed",
        pendingRunIds: [],
        runs: [expect.objectContaining({ result: "CHILD_RESULT=ready", status: "completed" })],
      })
    );
    expect(getRun(run.runId)).toBeUndefined();
  });

  test("keeps the chat active until its child finishes and synthesizes the child result", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Automatic Subagent Wait Provider",
      api_key: "automatic-subagent-wait-key",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "Automatic Subagent Wait Agent",
      type: "main",
      provider_id: provider.id,
      model: "glm-5.3",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);
    const sessionId = `automatic-subagent-wait-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    const run = registerSubagentRun({
      childSessionKey: `agent:child:subagent:${crypto.randomUUID()}`,
      requesterSessionKey: sessionId,
      task: "inspect lifecycle",
    });
    createdRunIds.push(run.runId);
    const statusDetails: string[] = [];
    const unsubscribe = onStatusStream((event) => {
      if (event.type === "status" && event.sessionId === sessionId && event.detail) {
        statusDetails.push(event.detail);
      }
    });
    let executionCount = 0;
    agentManager.execute = (async (_agentId, messages, options) => {
      executionCount += 1;
      if (executionCount === 1) {
        return {
          content: "I started the delegated task.",
          tool_calls: [spawnToolCall(run.runId)],
        };
      }
      expect(options?.useTools).toBe(false);
      expect(messages.at(-1)?.content).toContain("CHILD_RESULT=verified");
      return { content: "The delegated check finished: CHILD_RESULT=verified" };
    }) as typeof agentManager.execute;

    try {
      const responsePromise = handleChat({
        message: "Delegate this check and wait for the result",
        agentId: agent.id,
        sessionId,
        tools: true,
      });
      let responseSettled = false;
      void responsePromise.then(() => {
        responseSettled = true;
      });
      await waitForCondition(() => statusDetails.at(-1) === "Waiting for 1 delegated task...");

      expect(responseSettled).toBe(false);
      expect(getActiveSessionRunId(sessionId)).toBeDefined();
      expect(statusDetails.at(-1)).toBe("Waiting for 1 delegated task...");
      expect(executionCount).toBe(1);

      markRunCompleted(run.runId, "CHILD_RESULT=verified");
      const response = await responsePromise;

      expect(responseSettled).toBe(true);
      expect(getActiveSessionRunId(sessionId)).toBeUndefined();
      expect(response.message.content).toBe("The delegated check finished: CHILD_RESULT=verified");
      expect(response.message.tool_calls?.map((toolCall) => toolCall.name)).toEqual([
        "sessions_spawn",
        "sessions_wait",
      ]);
      expect(statusDetails).toContain("Waiting for 1 delegated task...");
      expect(statusDetails.at(-1)).toBe("Idle");
      expect(executionCount).toBe(2);
    } finally {
      unsubscribe();
    }
  });

  test("reconciles an unfinished plan after automatically waiting for delegated work", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Automatic Plan Reconciliation Provider",
      api_key: "automatic-plan-reconciliation-key",
    });
    createdProviderIds.push(provider.id);
    const agent = agentManager.create({
      name: "Automatic Plan Reconciliation Agent",
      type: "main",
      provider_id: provider.id,
      model: "glm-5.3",
      memory_enabled: false,
    });
    createdAgentIds.push(agent.id);
    const sessionId = `automatic-plan-reconciliation-${crypto.randomUUID()}`;
    createdSessionIds.push(sessionId);
    const run = registerSubagentRun({
      childSessionKey: `agent:child:subagent:${crypto.randomUUID()}`,
      requesterSessionKey: sessionId,
      task: "inspect lifecycle",
      cleanup: "delete",
    });
    createdRunIds.push(run.runId);
    let executionCount = 0;
    agentManager.execute = (async (_agentId, _messages, options) => {
      executionCount += 1;
      if (executionCount === 1) {
        return {
          content: "The delegated lifecycle check is accepted.",
          tool_calls: [todoToolCall("in_progress"), spawnToolCall(run.runId)],
        };
      }
      expect(options?.useTools).toBe(true);
      expect(options?.allowedToolNames).toEqual(["todo"]);
      expect(options?.requireToolUse).toBe(true);
      expect(options?.requiredToolName).toBe("todo");
      return {
        content: "The delegated lifecycle check finished successfully.",
        tool_calls: [todoToolCall("completed")],
      };
    }) as typeof agentManager.execute;

    setTimeout(() => markRunCompleted(run.runId, "CHILD_RESULT=verified"), 20);
    const response = await handleChat({
      message: "Plan, delegate, and complete this lifecycle check",
      agentId: agent.id,
      sessionId,
      tools: true,
    });

    expect(response.message.content).toBe("The delegated lifecycle check finished successfully.");
    expect(response.message.tool_calls?.map((toolCall) => toolCall.name)).toEqual([
      "todo",
      "sessions_spawn",
      "sessions_wait",
      "todo",
    ]);
    expect(response.plan?.summary).toEqual({
      total: 1,
      pending: 0,
      inProgress: 0,
      completed: 1,
      cancelled: 0,
    });
    expect(getRun(run.runId)).toBeUndefined();
  });
});
