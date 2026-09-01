import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { agentManager } from "../../src/core/agent";
import { providerManager } from "../../src/core/providers";
import {
  getProviderAvailability,
  recordRateLimit,
  resetRouterForTests,
} from "../../src/core/router";
import type { ToolDefinition } from "../../src/core/database";
import type { AgentToolCallResult } from "../../src/core/agent-internals";
import { broadcastStatus, createStatusSnapshotEvent } from "../../src/core/status";
import {
  getRun,
  getRunsByRequester,
  initSubagentRegistry,
  markRunCompleted,
  onSubagentLifecycle,
  registerSubagentRun,
  resetSubagentRegistryForTests,
  configureSubagentRegistry,
  cleanupOldRuns,
} from "../../src/core/subagent-registry";
import {
  configureChannelChatRuntime,
  resetChannelChatRuntime,
} from "../../src/core/channels/chat-runtime";
import {
  getAllSubagentSessions,
  getSubagentSession,
  handleSessionsSend,
  handleSessionsSpawn,
  handleSessionsWait,
  resetSubagentSessionsForTests,
} from "../../src/core/tools/handlers/channel";

type ExecuteShape = (
  agentId: string,
  messages: Array<{ role: "user" | "assistant" | "system" | "tool"; content: string }>,
  options?: {
    useTools?: boolean;
    sessionId?: string;
    workspaceDir?: string;
    channel?: string;
    userId?: string;
    modelOverride?: string;
    modelParamsOverride?: Record<string, unknown>;
    abortSignal?: AbortSignal;
  }
) => Promise<{ content: string; thinking?: string; tool_calls?: AgentToolCallResult[] }>;

const createdAgentIds: string[] = [];
const createdProviderIds: string[] = [];
const originalFetch = globalThis.fetch;
const testRegistryPath = join(tmpdir(), `cybara-subagent-registry-${process.pid}.json`);

async function waitFor(predicate: () => boolean, timeoutMs = 1000, intervalMs = 10): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for subagent completion");
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const agentId of createdAgentIds.splice(0)) {
    agentManager.delete(agentId);
  }
  for (const providerId of createdProviderIds.splice(0)) {
    providerManager.delete(providerId);
  }
  resetSubagentSessionsForTests();
  resetSubagentRegistryForTests();
  rmSync(testRegistryPath, { force: true });
  resetRouterForTests();
  resetChannelChatRuntime();
});

describe("Subagent execution wiring", () => {
  test("leaves ordinary subagent runs unbounded unless a timeout is requested", () => {
    const run = registerSubagentRun({
      childSessionKey: `child-default-timeout-${process.pid}`,
      requesterSessionKey: `parent-default-timeout-${process.pid}`,
      task: "Continue until the delegated work is complete",
    });

    expect(run.runTimeoutSeconds).toBe(0);
    expect(run.archiveAtMs).toBeUndefined();
  });

  test("starts the archive window only after a subagent becomes terminal", () => {
    const run = registerSubagentRun({
      childSessionKey: `child-archive-window-${process.pid}`,
      requesterSessionKey: `parent-archive-window-${process.pid}`,
      task: "Keep working beyond the retention window",
    });

    expect(run.archiveAtMs).toBeUndefined();
    markRunCompleted(run.runId, "finished");

    const completed = getRun(run.runId);
    expect(completed?.archiveAtMs).toBeGreaterThan(completed?.endedAt ?? Number.MAX_SAFE_INTEGER);
  });

  test("closes restored active runs as interrupted while retaining partial details", () => {
    const restorePath = join(tmpdir(), `cybara-subagent-restore-${process.pid}.json`);
    const runId = `restored-active-${process.pid}`;
    resetSubagentRegistryForTests();
    configureSubagentRegistry({ persistPath: restorePath });
    writeFileSync(
      restorePath,
      JSON.stringify([
        [
          runId,
          {
            runId,
            childSessionKey: `child-${runId}`,
            requesterSessionKey: `parent-${runId}`,
            requesterDisplayKey: `parent-${runId}`,
            task: "Long-running review",
            cleanup: "keep",
            createdAt: Date.now() - 60_000,
            startedAt: Date.now() - 59_000,
            activities: [
              {
                id: "read-1",
                phase: "result",
                text: "Read package metadata",
                timestamp: Date.now() - 30_000,
                toolName: "read",
              },
            ],
          },
        ],
      ])
    );

    initSubagentRegistry();

    expect(getRun(runId)?.outcome).toEqual({
      status: "error",
      error: "Subagent interrupted by gateway restart",
    });
    expect(getRun(runId)?.endedAt).toBeNumber();
    expect(getRun(runId)?.activities?.[0]?.text).toBe("Read package metadata");
    resetSubagentRegistryForTests();
    configureSubagentRegistry({ persistPath: testRegistryPath });
    rmSync(restorePath, { force: true });
  });

  test("preserves oversized final results in the private recovery cache", () => {
    const runId = `result-recovery-${process.pid}`;
    registerSubagentRun({
      runId,
      childSessionKey: `child-${runId}`,
      requesterSessionKey: `parent-${runId}`,
      task: "Return a large review result",
    });

    const fullResult = `HEAD_MARKER\n${"x".repeat(15_000)}\nTAIL_MARKER`;
    const fullToolResult = { output: `TOOL_HEAD\n${"y".repeat(28_000)}\nTOOL_TAIL` };
    expect(
      markRunCompleted(runId, fullResult, {
        toolCalls: [
          {
            id: "large-tool-call",
            name: "exec",
            result: fullToolResult,
            status: "completed",
          },
        ],
      })
    ).toBe(true);

    const preview = getRun(runId)?.outcome?.result || "";
    expect(preview).toContain("HEAD_MARKER");
    expect(preview).toContain("TAIL_MARKER");
    expect(preview).toContain("Full output saved to:");
    const outputPath = preview.match(/Full output saved to: (.+)/)?.[1]?.trim();
    expect(outputPath).toBeTruthy();
    expect(existsSync(outputPath || "")).toBe(true);
    expect(readFileSync(outputPath || "", "utf8")).toBe(fullResult);
    const toolResult = getRun(runId)?.toolCalls?.[0]?.result as
      | { preview?: string; outputPath?: string }
      | undefined;
    expect(toolResult?.preview).toContain("TOOL_HEAD");
    expect(toolResult?.preview).toContain("TOOL_TAIL");
    expect(existsSync(toolResult?.outputPath || "")).toBe(true);
    expect(JSON.parse(readFileSync(toolResult?.outputPath || "", "utf8"))).toEqual(fullToolResult);
    rmSync(outputPath || "", { force: true });
    rmSync(toolResult?.outputPath || "", { force: true });
  });

  test("uses requested agent id and model override through agentManager.execute", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Subagent Provider",
      api_key: "subagent-key",
    });
    createdProviderIds.push(provider.id);

    const firstAgent = agentManager.create({
      name: "First Agent",
      type: "main",
      provider_id: provider.id,
      model: "model-first",
      tools: [],
    });
    createdAgentIds.push(firstAgent.id);

    const targetAgent = agentManager.create({
      name: "Target Agent",
      type: "subagent",
      provider_id: provider.id,
      model: "model-target",
      tools: [],
    });
    createdAgentIds.push(targetAgent.id);

    const requestedModel = "model-override";
    const task = "summarize deployment status";

    let captured:
      | {
          agentId: string;
          messages: Array<{ role: "user" | "assistant" | "system" | "tool"; content: string }>;
          options?: {
            useTools?: boolean;
            sessionId?: string;
            workspaceDir?: string;
            channel?: string;
            userId?: string;
            modelOverride?: string;
            abortSignal?: AbortSignal;
          };
        }
      | undefined;
    let capturedLiveActivities: string[] = [];
    let capturedLiveToolCalls: Array<{
      name: string;
      status?: "pending" | "executing" | "completed" | "failed";
      result: unknown;
    }> = [];

    const originalExecute = agentManager.execute.bind(agentManager) as ExecuteShape;
    (agentManager as unknown as { execute: ExecuteShape }).execute = async (
      agentId,
      messages,
      options
    ) => {
      captured = { agentId, messages, options };
      const sessionId = options?.sessionId || "";
      broadcastStatus({
        status: "thinking",
        detail: "Inspecting the requested files",
        sessionId,
        timestamp: 100,
      });
      broadcastStatus({
        status: "tool_executing",
        detail: "Reading package metadata",
        sessionId,
        timestamp: 101,
        toolName: "read",
        toolCallId: "read-1",
      });
      broadcastStatus({
        status: "tool_completed",
        detail: "Read package metadata",
        sessionId,
        timestamp: 102,
        toolName: "read",
        toolCallId: "read-1",
      });
      capturedLiveActivities =
        getRunsByRequester("main")[0]?.activities?.map((activity) => activity.text) || [];
      capturedLiveToolCalls =
        getRunsByRequester("main")[0]?.toolCalls?.map((toolCall) => ({
          name: toolCall.name,
          status: toolCall.status,
          result: toolCall.result,
        })) || [];
      return {
        content: "subagent complete",
        thinking: "The package metadata confirms the result.",
        tool_calls: [
          {
            id: "read-1",
            name: "read",
            args: { path: "package.json" },
            result: { content: "package metadata" },
            status: "completed",
            timeline_index: 1,
          },
        ],
      };
    };

    try {
      const spawnResult = await handleSessionsSpawn({
        task,
        agentId: targetAgent.id,
        model: requestedModel,
        _requesterSessionKey: "main",
      });

      expect(spawnResult.status).toBe("accepted");
      expect(spawnResult.modelApplied).toBe(true);
      expect(existsSync(testRegistryPath)).toBe(true);

      await waitFor(
        () => getSubagentSession(spawnResult.childSessionKey)?.status === "completed",
        2000
      );

      const session = getSubagentSession(spawnResult.childSessionKey);
      expect(session?.status).toBe("completed");
      expect(session?.result).toBe("subagent complete");
      expect(session?.messages.at(-1)?.thinking).toBe("The package metadata confirms the result.");
      expect(session?.messages.at(-1)?.tool_calls?.[0]?.name).toBe("read");
      expect(
        session?.messages.at(-1)?.process_activities?.map((activity) => activity.text)
      ).toEqual(["Inspecting the requested files", "Read package metadata"]);

      const persistedRun = getRun(spawnResult.runId);
      expect(persistedRun?.thinking).toBe("The package metadata confirms the result.");
      expect(persistedRun?.toolCalls?.[0]).toMatchObject({
        id: "read-1",
        name: "read",
        status: "completed",
      });
      expect(persistedRun?.activities?.map((activity) => activity.text)).toEqual([
        "Inspecting the requested files",
        "Read package metadata",
      ]);
      expect(capturedLiveActivities).toEqual([
        "Inspecting the requested files",
        "Read package metadata",
      ]);
      expect(capturedLiveToolCalls).toEqual([
        {
          name: "read",
          status: "completed",
          result: "Read package metadata",
        },
      ]);
      expect(
        createStatusSnapshotEvent().activeSessionIds.includes(spawnResult.childSessionKey)
      ).toBe(false);

      expect(captured?.agentId).toBe(targetAgent.id);
      expect(captured?.options?.useTools).toBe(true);
      expect(captured?.options?.channel).toBe("subagent");
      expect(captured?.options?.userId).toBe("subagent");
      expect(captured?.options?.sessionId).toBe(spawnResult.childSessionKey);
      expect(captured?.options?.workspaceDir).toBeUndefined();
      expect(captured?.options?.modelOverride).toBe(requestedModel);
      const lastMessage =
        captured && captured.messages.length > 0
          ? captured.messages[captured.messages.length - 1]
          : undefined;
      expect(lastMessage).toEqual({ role: "user", content: task });
      expect(captured?.messages[0]?.content).toContain("plain Markdown with concrete evidence");
      expect(captured?.messages[0]?.content).toContain(
        "Do not save memories or create skills unless the task explicitly requests it"
      );
    } finally {
      (agentManager as unknown as { execute: ExecuteShape }).execute = originalExecute;
    }
  });

  test("ignores model overrides from a different provider family", async () => {
    const provider = providerManager.create({
      provider: "minimax",
      name: "MiniMax Subagent Provider",
      api_key: "subagent-minimax-key",
    });
    createdProviderIds.push(provider.id);

    const targetAgent = agentManager.create({
      name: "MiniMax Subagent",
      type: "subagent",
      provider_id: provider.id,
      model: "MiniMax-M3",
      tools: [],
    });
    createdAgentIds.push(targetAgent.id);

    let capturedModel: string | undefined;
    const originalExecute = agentManager.execute.bind(agentManager) as ExecuteShape;
    (agentManager as unknown as { execute: ExecuteShape }).execute = async (
      _agentId,
      _messages,
      options
    ) => {
      capturedModel = options?.modelOverride;
      return { content: "MiniMax child complete" };
    };

    try {
      const result = await handleSessionsSpawn({
        task: "review the repository",
        agentId: targetAgent.id,
        model: "sonnet",
        _requesterSessionKey: "model-family-parent",
      });

      expect(result.status).toBe("accepted");
      expect(result.modelApplied).toBe(false);
      expect(result.warning).toContain("does not match");
      await waitFor(() => getSubagentSession(result.childSessionKey)?.status === "completed", 2000);
      expect(capturedModel).toBe("MiniMax-M3");
      expect(getRun(result.runId)?.model).toBe("MiniMax-M3");
      expect(getSubagentSession(result.childSessionKey)?.agentId).toBe(targetAgent.id);
    } finally {
      (agentManager as unknown as { execute: ExecuteShape }).execute = originalExecute;
    }
  });

  test("delivers sessions_send messages from a normal session", async () => {
    const delivered: Array<{
      sessionId: string;
      role: string;
      content: string;
      timestamp: string;
    }> = [];
    configureChannelChatRuntime({
      sendToSession: (sessionId, message) => {
        delivered.push({ sessionId, ...message });
        return true;
      },
    });

    const result = await handleSessionsSend({
      sessionId: "parent-chat-session",
      message: "CHILD_RESULT=delivered",
    });

    expect(result).toEqual({
      success: true,
      sessionId: "parent-chat-session",
      message: "Message delivered to session.",
    });
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.sessionId).toBe("parent-chat-session");
    expect(delivered[0]?.role).toBe("assistant");
    expect(delivered[0]?.content).toBe("CHILD_RESULT=delivered");
    expect(Number.isFinite(Date.parse(delivered[0]?.timestamp || ""))).toBe(true);
  });

  test("prevents subagents from injecting messages into the parent transcript", async () => {
    configureChannelChatRuntime({
      sendToSession: () => true,
    });

    await expect(
      handleSessionsSend(
        {
          sessionId: "parent-chat-session",
          message: "raw child report",
        },
        {
          agentId: "child-agent",
          sessionId: "agent:child-agent:subagent:run-1",
        }
      )
    ).rejects.toThrow("cannot write directly to the parent transcript");
  });

  test("waits for parallel child runs and returns synthesis-ready results", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Subagent Wait Provider",
      api_key: "subagent-wait-key",
    });
    createdProviderIds.push(provider.id);
    const targetAgent = agentManager.create({
      name: "Subagent Wait Agent",
      type: "subagent",
      provider_id: provider.id,
      model: "model-wait",
      tools: [],
    });
    createdAgentIds.push(targetAgent.id);

    const originalExecute = agentManager.execute.bind(agentManager) as ExecuteShape;
    (agentManager as unknown as { execute: ExecuteShape }).execute = async (_agentId, messages) => {
      const task = messages.at(-1)?.content || "unknown";
      await new Promise((resolve) => setTimeout(resolve, task.includes("mobile") ? 30 : 10));
      return {
        content: `RESULT:${task}`,
        tool_calls: [
          {
            id: `tool-${task}`,
            name: "read",
            args: { path: task },
            result: { content: task },
            status: "completed",
          },
        ],
      };
    };

    try {
      const first = await handleSessionsSpawn({
        task: "review gateway",
        agentId: targetAgent.id,
        _requesterSessionKey: "parent-review",
      });
      const second = await handleSessionsSpawn({
        task: "review mobile",
        agentId: targetAgent.id,
        _requesterSessionKey: "parent-review",
      });
      const waited = await handleSessionsWait(
        { runIds: [first.runId, second.runId], timeoutSeconds: 2 },
        { agentId: targetAgent.id, sessionId: "parent-review" }
      );

      expect(waited.status).toBe("completed");
      expect(waited.pendingRunIds).toEqual([]);
      expect(waited.runs.map((run) => run.result).sort()).toEqual([
        "RESULT:review gateway",
        "RESULT:review mobile",
      ]);
      expect(waited.runs.every((run) => run.toolCallCount === 1)).toBe(true);
    } finally {
      (agentManager as unknown as { execute: ExecuteShape }).execute = originalExecute;
    }
  });

  test("sessions_wait is scoped to the requester and reports pending runs without blocking", async () => {
    const run = registerSubagentRun({
      childSessionKey: "agent:wait:subagent:pending",
      requesterSessionKey: "parent-one",
      task: "pending review",
    });

    await expect(
      handleSessionsWait(
        { runIds: [run.runId], timeoutSeconds: 0 },
        { agentId: "parent-agent", sessionId: "parent-two" }
      )
    ).rejects.toThrow("another session");

    const result = await handleSessionsWait(
      { runIds: [run.runId], timeoutSeconds: 0 },
      { agentId: "parent-agent", sessionId: "parent-one" }
    );
    expect(result.status).toBe("timeout");
    expect(result.pendingRunIds).toEqual([run.runId]);
    expect(result.runs[0]?.status).toBe("running");
  });

  test("cleanup delete keeps a completed result until the requester consumes it", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Disposable Subagent Provider",
      api_key: "disposable-subagent-key",
    });
    createdProviderIds.push(provider.id);
    const targetAgent = agentManager.create({
      name: "Disposable Subagent",
      type: "subagent",
      provider_id: provider.id,
      model: "disposable-model",
      tools: [],
    });
    createdAgentIds.push(targetAgent.id);
    const originalExecute = agentManager.execute.bind(agentManager) as ExecuteShape;
    (agentManager as unknown as { execute: ExecuteShape }).execute = async () => ({
      content: "DISPOSABLE_RESULT=verified",
    });

    const spawned = await handleSessionsSpawn({
      task: "return a disposable result",
      agentId: targetAgent.id,
      cleanup: "delete",
      _requesterSessionKey: "parent-cleanup",
    });
    await waitFor(() => getRun(spawned.runId)?.outcome?.status === "ok", 2000);
    expect(getSubagentSession(spawned.childSessionKey)).toBeDefined();

    try {
      expect(getRun(spawned.runId)?.outcome?.result).toBe("DISPOSABLE_RESULT=verified");
      const waited = await handleSessionsWait(
        { runIds: [spawned.runId], timeoutSeconds: 0 },
        { agentId: "parent-agent", sessionId: "parent-cleanup" }
      );
      expect(waited.runs[0]?.result).toBe("DISPOSABLE_RESULT=verified");
      expect(getRun(spawned.runId)).toBeUndefined();
      expect(getSubagentSession(spawned.childSessionKey)).toBeUndefined();
    } finally {
      (agentManager as unknown as { execute: ExecuteShape }).execute = originalExecute;
    }
  });

  test("completes one hundred disposable subagents with bounded concurrency and no retained runs", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Subagent Scale Provider",
      api_key: "subagent-scale-key",
    });
    createdProviderIds.push(provider.id);
    const targetAgent = agentManager.create({
      name: "Subagent Scale Agent",
      type: "subagent",
      provider_id: provider.id,
      model: "model-scale",
      tools: [],
    });
    createdAgentIds.push(targetAgent.id);

    let active = 0;
    let peakActive = 0;
    let completed = 0;
    const originalExecute = agentManager.execute.bind(agentManager) as ExecuteShape;
    const originalLog = console.log;
    console.log = () => undefined;
    (agentManager as unknown as { execute: ExecuteShape }).execute = async () => {
      active += 1;
      peakActive = Math.max(peakActive, active);
      await Bun.sleep(2);
      active -= 1;
      completed += 1;
      return { content: "SCALE_RESULT=verified" };
    };

    try {
      for (let offset = 0; offset < 100; offset += 3) {
        const batchSize = Math.min(3, 100 - offset);
        const spawned = await Promise.all(
          Array.from({ length: batchSize }, (_value, index) =>
            handleSessionsSpawn({
              task: `scale task ${offset + index + 1}`,
              agentId: targetAgent.id,
              cleanup: "delete",
              _requesterSessionKey: "parent-scale",
            })
          )
        );
        await waitFor(
          () => spawned.every((run) => getRun(run.runId)?.outcome?.status === "ok"),
          1000,
          2
        );
        const waited = await handleSessionsWait(
          { runIds: spawned.map((run) => run.runId), timeoutSeconds: 0 },
          { agentId: "parent-agent", sessionId: "parent-scale" }
        );
        expect(waited.status).toBe("completed");
        expect(waited.runs.every((run) => run.result === "SCALE_RESULT=verified")).toBe(true);
      }

      expect(completed).toBe(100);
      expect(peakActive).toBe(3);
      expect(getRunsByRequester("parent-scale")).toHaveLength(0);
      expect(getAllSubagentSessions()).toHaveLength(0);
    } finally {
      console.log = originalLog;
      (agentManager as unknown as { execute: ExecuteShape }).execute = originalExecute;
    }
  });

  test("removes resident child sessions when completed runs are archived", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Subagent Archive Provider",
      api_key: "subagent-archive-key",
    });
    createdProviderIds.push(provider.id);
    const targetAgent = agentManager.create({
      name: "Subagent Archive Agent",
      type: "subagent",
      provider_id: provider.id,
      model: "model-archive",
      tools: [],
    });
    createdAgentIds.push(targetAgent.id);
    const originalExecute = agentManager.execute.bind(agentManager) as ExecuteShape;
    (agentManager as unknown as { execute: ExecuteShape }).execute = async () => ({
      content: "ARCHIVE_RESULT=verified",
    });

    try {
      const spawned = await handleSessionsSpawn({
        task: "return an archivable result",
        agentId: targetAgent.id,
        _requesterSessionKey: "parent-archive",
      });
      await waitFor(() => getRun(spawned.runId)?.outcome?.status === "ok", 2000);
      expect(getSubagentSession(spawned.childSessionKey)).toBeDefined();

      const run = getRun(spawned.runId);
      if (run) run.endedAt = Date.now() - 10_000;
      expect(cleanupOldRuns(1)).toBe(1);
      expect(getRun(spawned.runId)).toBeUndefined();
      expect(getSubagentSession(spawned.childSessionKey)).toBeUndefined();
    } finally {
      (agentManager as unknown as { execute: ExecuteShape }).execute = originalExecute;
    }
  });

  test("keeps the completed child result in the registry without announcing it", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Subagent Result Provider",
      api_key: "subagent-result-key",
    });
    createdProviderIds.push(provider.id);

    const targetAgent = agentManager.create({
      name: "Subagent Result Agent",
      type: "subagent",
      provider_id: provider.id,
      model: "model-result",
      tools: [],
    });
    createdAgentIds.push(targetAgent.id);

    const lifecycleTypes: string[] = [];
    const unsubscribe = onSubagentLifecycle((event) => {
      lifecycleTypes.push(event.type);
    });
    const originalExecute = agentManager.execute.bind(agentManager) as ExecuteShape;
    (agentManager as unknown as { execute: ExecuteShape }).execute = async () => ({
      content: "AUTO_CHILD_RESULT=verified",
    });

    try {
      const spawnResult = await handleSessionsSpawn({
        task: "return a deterministic result",
        agentId: targetAgent.id,
        label: "Result delivery",
        _requesterSessionKey: "parent-result-session",
      });

      expect(spawnResult.status).toBe("accepted");
      await waitFor(() => getRun(spawnResult.runId)?.outcome?.status === "ok", 2000);
      expect(getRun(spawnResult.runId)?.outcome?.result).toBe("AUTO_CHILD_RESULT=verified");
      expect(lifecycleTypes).toContain("end");
      expect(lifecycleTypes).not.toContain("announce");
    } finally {
      unsubscribe();
      (agentManager as unknown as { execute: ExecuteShape }).execute = originalExecute;
    }
  });

  test("enforces the same tool allowlist guardrails for subagent runs", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Subagent Guardrail Provider",
      api_key: "subagent-guardrail-key",
      base_url: "https://api.openai.com/v1",
    });
    createdProviderIds.push(provider.id);

    const calcOnlyTool: ToolDefinition = {
      name: "calc",
      description: "Evaluate math expressions",
      input_schema: {
        type: "object",
        properties: { expression: { type: "string" } },
        required: ["expression"],
      },
    };

    const guardedAgent = agentManager.create({
      name: "Subagent Guardrail Agent",
      type: "subagent",
      provider_id: provider.id,
      model: "gpt-5.2",
      tools: [calcOnlyTool],
    });
    createdAgentIds.push(guardedAgent.id);

    const requestBodies: Array<Record<string, unknown>> = [];
    let completionCalls = 0;

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      completionCalls += 1;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      requestBodies.push(body as Record<string, unknown>);

      if (completionCalls === 1) {
        return new Response(
          JSON.stringify({
            id: "resp-subagent-1",
            object: "chat.completion",
            model: "gpt-5.2",
            choices: [
              {
                index: 0,
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call-subagent-1",
                      type: "function",
                      function: {
                        name: "read",
                        arguments: JSON.stringify({ path: "/tmp/secret.txt" }),
                      },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          id: "resp-subagent-2",
          object: "chat.completion",
          model: "gpt-5.2",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "subagent done",
              },
            },
          ],
          usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const spawnResult = await handleSessionsSpawn({
      task: "read sensitive file",
      agentId: guardedAgent.id,
      _requesterSessionKey: "main",
    });

    expect(spawnResult.status).toBe("accepted");

    await waitFor(
      () => getSubagentSession(spawnResult.childSessionKey)?.status === "completed",
      2000
    );

    const session = getSubagentSession(spawnResult.childSessionKey);
    expect(session?.result).toBe("subagent done");
    expect(requestBodies.length).toBeGreaterThanOrEqual(2);

    const secondRequestMessages =
      (requestBodies[1]?.messages as Array<{ role?: string; content?: string }>) || [];
    const toolMessage = secondRequestMessages.find((message) => message.role === "tool");
    expect(toolMessage?.content).toContain("Tool not enabled for this agent: read");
  });

  test("blocks nested subagent spawning from subagent sessions", async () => {
    const nestedSpawn = await handleSessionsSpawn({
      task: "attempt nested spawn",
      _requesterSessionKey: "agent:parent-agent:subagent:child-session",
    });

    expect(nestedSpawn.status).toBe("forbidden");
    expect(nestedSpawn.warning).toContain("not allowed from sub-agent sessions");
  });

  test("preserves explicit no-timeout subagent runs with metadata", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "No Timeout Provider",
      api_key: "subagent-no-timeout-key",
    });
    createdProviderIds.push(provider.id);

    const targetAgent = agentManager.create({
      name: "No Timeout Agent",
      type: "subagent",
      provider_id: provider.id,
      model: "model-default",
      tools: [],
    });
    createdAgentIds.push(targetAgent.id);

    const originalExecute = agentManager.execute.bind(agentManager) as ExecuteShape;
    (agentManager as unknown as { execute: ExecuteShape }).execute = async () =>
      new Promise<{ content: string; tool_calls?: Array<{ name: string; result: unknown }> }>(
        () => {}
      );

    try {
      const workspaceDir = process.cwd();
      const spawnResult = await handleSessionsSpawn({
        task: "stay active without timeout",
        agentId: targetAgent.id,
        model: "model-no-timeout",
        runTimeoutSeconds: 0,
        workspaceDir,
        _requesterSessionKey: "main",
      });

      expect(spawnResult.status).toBe("accepted");
      await new Promise((resolve) => setTimeout(resolve, 25));

      const run = getRun(spawnResult.runId);
      expect(run?.runTimeoutSeconds).toBe(0);
      expect(run?.model).toBe("model-no-timeout");
      expect(run?.workspaceDir).toBe(workspaceDir);
      expect(run?.outcome).toBeUndefined();
    } finally {
      (agentManager as unknown as { execute: ExecuteShape }).execute = originalExecute;
    }
  });

  test("aborts timed-out executions and preserves the timeout outcome", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Subagent Timeout Provider",
      api_key: "subagent-timeout-key",
    });
    createdProviderIds.push(provider.id);
    const targetAgent = agentManager.create({
      name: "Subagent Timeout Agent",
      type: "subagent",
      provider_id: provider.id,
      model: "model-timeout",
      tools: [],
    });
    createdAgentIds.push(targetAgent.id);

    let capturedSignal: AbortSignal | undefined;
    const originalExecute = agentManager.execute.bind(agentManager) as ExecuteShape;
    (agentManager as unknown as { execute: ExecuteShape }).execute = async (
      _agentId,
      _messages,
      options
    ) => {
      capturedSignal = options?.abortSignal;
      return await new Promise<never>((_resolve, reject) => {
        const signal = options?.abortSignal;
        if (!signal) return;
        const abort = () => reject(signal.reason || new Error("aborted"));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    };

    try {
      const spawned = await handleSessionsSpawn({
        task: "remain active until timeout",
        agentId: targetAgent.id,
        runTimeoutSeconds: 1,
        _requesterSessionKey: "parent-timeout",
      });
      await waitFor(() => getRun(spawned.runId)?.outcome?.status === "timeout", 2000);
      await waitFor(() => getSubagentSession(spawned.childSessionKey)?.status === "failed", 2000);

      expect(capturedSignal?.aborted).toBe(true);
      expect(getRun(spawned.runId)?.outcome?.status).toBe("timeout");
      expect(getRun(spawned.runId)?.outcome?.error).toBe("Timed out after 1s");
      expect(getSubagentSession(spawned.childSessionKey)?.error).toBe("Timed out after 1s");
    } finally {
      (agentManager as unknown as { execute: ExecuteShape }).execute = originalExecute;
    }
  });

  test("limits active child subagents per requester", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Subagent Limit Provider",
      api_key: "subagent-limit-key",
    });
    createdProviderIds.push(provider.id);

    const targetAgent = agentManager.create({
      name: "Limit Agent",
      type: "subagent",
      provider_id: provider.id,
      model: "model-limit",
      tools: [],
    });
    createdAgentIds.push(targetAgent.id);

    const originalExecute = agentManager.execute.bind(agentManager) as ExecuteShape;
    (agentManager as unknown as { execute: ExecuteShape }).execute = async () =>
      new Promise<{ content: string; tool_calls?: Array<{ name: string; result: unknown }> }>(
        () => {}
      );

    try {
      const first = await handleSessionsSpawn({
        task: "first child",
        agentId: targetAgent.id,
        maxActiveChildren: 1,
        _requesterSessionKey: "main",
      });
      expect(first.status).toBe("accepted");

      const second = await handleSessionsSpawn({
        task: "second child",
        agentId: targetAgent.id,
        maxActiveChildren: 1,
        _requesterSessionKey: "main",
      });
      expect(second.status).toBe("forbidden");
      expect(second.warning).toContain("active sub-agent limit (1)");
    } finally {
      (agentManager as unknown as { execute: ExecuteShape }).execute = originalExecute;
    }
  });

  test("uses a safer default active child limit", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Default Limit Provider",
      api_key: "subagent-default-limit-key",
    });
    createdProviderIds.push(provider.id);

    const targetAgent = agentManager.create({
      name: "Default Limit Agent",
      type: "subagent",
      provider_id: provider.id,
      model: "model-limit",
      tools: [],
    });
    createdAgentIds.push(targetAgent.id);

    const originalExecute = agentManager.execute.bind(agentManager) as ExecuteShape;
    (agentManager as unknown as { execute: ExecuteShape }).execute = async () =>
      new Promise<{ content: string; tool_calls?: Array<{ name: string; result: unknown }> }>(
        () => {}
      );

    try {
      const accepted = [];
      for (let index = 0; index < 3; index++) {
        accepted.push(
          await handleSessionsSpawn({
            task: `child ${index}`,
            agentId: targetAgent.id,
            _requesterSessionKey: "main",
          })
        );
      }

      const fourth = await handleSessionsSpawn({
        task: "child 4",
        agentId: targetAgent.id,
        _requesterSessionKey: "main",
      });

      expect(accepted.every((result) => result.status === "accepted")).toBe(true);
      expect(fourth.status).toBe("forbidden");
      expect(fourth.warning).toContain("active sub-agent limit (3)");
    } finally {
      (agentManager as unknown as { execute: ExecuteShape }).execute = originalExecute;
    }
  });

  test("does not spawn subagents when target provider is cooling down", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Cooling Provider",
      api_key: "subagent-cooldown-key",
    });
    createdProviderIds.push(provider.id);

    const targetAgent = agentManager.create({
      name: "Cooling Agent",
      type: "subagent",
      provider_id: provider.id,
      model: "model-cooldown",
      tools: [],
    });
    createdAgentIds.push(targetAgent.id);

    recordRateLimit(provider.id, 60_000);
    expect(getProviderAvailability(provider.id).inCooldown).toBe(true);

    const result = await handleSessionsSpawn({
      task: "should wait for provider",
      agentId: targetAgent.id,
      _requesterSessionKey: "main",
    });

    expect(result.status).toBe("forbidden");
    expect(result.warning).toContain("temporarily unavailable");
    expect(result.warning).toContain("Rate-limit cooldown");
  });

  test("resolves a unique exact agent name for natural delegation", async () => {
    const targetAgent = agentManager.create({
      name: "Natural Delegation Specialist",
      type: "subagent",
      model: "test-model",
      tools: [],
    });
    createdAgentIds.push(targetAgent.id);
    const originalExecute = agentManager.execute.bind(agentManager) as ExecuteShape;
    let capturedModelParams: Record<string, unknown> | undefined;
    (agentManager as unknown as { execute: ExecuteShape }).execute = async (
      _agentId,
      _messages,
      options
    ) => {
      capturedModelParams = options?.modelParamsOverride;
      return { content: "delegation complete" };
    };

    try {
      const result = await handleSessionsSpawn({
        task: "Review the launch notes",
        agentId: "natural delegation specialist",
        maxToolIterations: 8,
        _requesterSessionKey: "natural-name-parent",
      });
      expect(result.status).toBe("accepted");
      await waitFor(() => getSubagentSession(result.childSessionKey)?.status === "completed", 2000);
      expect(getSubagentSession(result.childSessionKey)?.agentId).toBe(targetAgent.id);
      expect(capturedModelParams).toEqual({ max_tool_iterations: 8 });
    } finally {
      (agentManager as unknown as { execute: ExecuteShape }).execute = originalExecute;
    }
  });

  test("propagates requester session/workspace from tool context when args omit them", async () => {
    const provider = providerManager.create({
      provider: "openai",
      name: "Subagent Context Provider",
      api_key: "subagent-context-key",
    });
    createdProviderIds.push(provider.id);

    const targetAgent = agentManager.create({
      name: "Context Agent",
      type: "subagent",
      provider_id: provider.id,
      model: "model-context",
      tools: [],
    });
    createdAgentIds.push(targetAgent.id);

    const workspaceDir = process.cwd();
    const requesterSessionKey = "chat:session:abc123";

    let captured:
      | {
          options?: {
            sessionId?: string;
            workspaceDir?: string;
          };
        }
      | undefined;

    const originalExecute = agentManager.execute.bind(agentManager) as ExecuteShape;
    (agentManager as unknown as { execute: ExecuteShape }).execute = async (
      _agentId,
      _messages,
      options
    ) => {
      captured = { options };
      return { content: "done" };
    };

    try {
      const spawnResult = await handleSessionsSpawn(
        {
          task: "context propagation",
          agentId: targetAgent.id,
        },
        {
          agentId: targetAgent.id,
          sessionId: requesterSessionKey,
          workspaceDir,
        }
      );

      expect(spawnResult.status).toBe("accepted");
      await waitFor(
        () => getSubagentSession(spawnResult.childSessionKey)?.status === "completed",
        2000
      );

      const subagentSession = getSubagentSession(spawnResult.childSessionKey);
      expect(subagentSession?.parentSessionId).toBe(requesterSessionKey);
      expect(subagentSession?.workspaceDir).toBe(workspaceDir);
      expect(captured?.options?.workspaceDir).toBe(workspaceDir);
    } finally {
      (agentManager as unknown as { execute: ExecuteShape }).execute = originalExecute;
    }
  });
});
