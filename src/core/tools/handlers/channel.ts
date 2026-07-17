import { agentManager } from "../../agent";
import type { ToolContext } from "../index";
import {
  channels as channelDefinitions,
  channelManager,
  discordSessions,
  slackSessions,
  type ChannelAdapter,
  type ChannelTarget,
  type ChannelType,
} from "../../channels";
import type { Channel } from "../../database";
import * as subagentRegistry from "../../subagent-registry";
import type { SubagentRunRecord } from "../../subagent-registry";
import { sendChannelRuntimeMessage } from "../../channels/chat-runtime";
import { providerManager } from "../../providers";
import { getProviderAvailability } from "../../router";
import { broadcastStatus, onStatus, type StatusPayload, type ToolStatusPhase } from "../../status";
import type { AgentToolCallResult } from "../../agent-internals";
import {
  createAgentTransferEnvelope,
  normalizeAgentTransferContextMode,
  type AgentTransferEnvelope,
} from "../../agent-transfer";

interface SubagentSession {
  id: string;
  agentId?: string;
  parentSessionId?: string;
  workspaceDir?: string;
  allowedToolNames?: string[];
  task: string;
  model?: string;
  timeout?: number;
  status: "pending" | "running" | "completed" | "failed" | "killed";
  messages: Array<{
    role: string;
    content: string;
    timestamp: string;
    thinking?: string;
    tool_calls?: AgentToolCallResult[];
    process_activities?: subagentRegistry.SubagentActivity[];
  }>;
  result?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

const sessions = new Map<string, SubagentSession>();
const subagentAbortControllers = new Map<string, AbortController>();
const DEFAULT_SUBAGENT_MAX_ACTIVE_CHILDREN = 3;

export function getSubagentSession(sessionKey: string): SubagentSession | undefined {
  return sessions.get(sessionKey);
}

export function getAllSubagentSessions(): SubagentSession[] {
  return Array.from(sessions.values());
}

export function resetSubagentSessionsForTests(): void {
  for (const controller of subagentAbortControllers.values()) {
    controller.abort();
  }
  subagentAbortControllers.clear();
  sessions.clear();
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readNonNegativeInteger(value: unknown): number | undefined {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric) || numeric < 0) return undefined;
  return Math.floor(numeric);
}

function resolveRunTimeoutSeconds(args: Record<string, unknown>): number | undefined {
  const explicit = readNonNegativeInteger(args.runTimeoutSeconds);
  if (explicit !== undefined) return explicit;
  return readNonNegativeInteger(args.timeoutSeconds);
}

function resolveMaxActiveChildren(args: Record<string, unknown>): number | undefined {
  const explicit = readNonNegativeInteger(args.maxActiveChildren);
  const envValue = readNonNegativeInteger(process.env.CYBARA_SUBAGENT_MAX_ACTIVE_CHILDREN);
  const limit = explicit ?? envValue ?? DEFAULT_SUBAGENT_MAX_ACTIVE_CHILDREN;
  return limit > 0 ? limit : undefined;
}

function resolveSubagentTargetAgent(requestedAgentId?: string) {
  const availableAgents = agentManager.list();
  return typeof requestedAgentId === "string" && requestedAgentId.trim().length > 0
    ? availableAgents.find((agent) => agent.id === requestedAgentId)
    : availableAgents.find((agent) => agent.status === "running") || availableAgents[0];
}

function getSubagentProviderBlockReason(requestedAgentId?: string): string | undefined {
  const agent = resolveSubagentTargetAgent(requestedAgentId);
  if (!agent?.provider_id) return undefined;
  const provider = providerManager.get(agent.provider_id);
  const availability = getProviderAvailability(agent.provider_id);
  if (availability.available) return undefined;
  if (!availability.inCooldown && !availability.circuitOpen) return undefined;
  const label = provider?.name || provider?.provider || agent.provider_id;
  return `${label} is temporarily unavailable: ${availability.reason || "provider cooldown"}`;
}

function modelFamilyForName(model: string): string | undefined {
  const normalized = model.toLowerCase();
  if (/\b(claude|sonnet|opus|haiku)\b/.test(normalized)) return "anthropic";
  if (/\b(gpt|codex|o[134](?:-|$))\b/.test(normalized)) return "openai";
  if (/\b(gemini)\b/.test(normalized)) return "google";
  if (/\b(minimax|m[123](?:\.|-|$))\b/.test(normalized)) return "minimax";
  if (/\b(glm)\b/.test(normalized)) return "zai";
  if (/\b(grok)\b/.test(normalized)) return "xai";
  if (/\b(kimi)\b/.test(normalized)) return "kimi";
  return undefined;
}

function providerFamily(providerType: string): string | undefined {
  const normalized = providerType.toLowerCase();
  if (normalized.includes("anthropic") || normalized.includes("bedrock")) return "anthropic";
  if (normalized.includes("openai") || normalized.includes("azure")) return "openai";
  if (normalized.includes("google") || normalized.includes("gemini")) return "google";
  if (normalized.includes("minimax")) return "minimax";
  if (normalized.includes("zai") || normalized.includes("z.ai")) return "zai";
  if (normalized.includes("xai") || normalized.includes("grok")) return "xai";
  if (normalized.includes("kimi") || normalized.includes("moonshot")) return "kimi";
  return undefined;
}

function resolveSubagentModel(
  agent: ReturnType<typeof resolveSubagentTargetAgent>,
  requestedModel?: string
): { model?: string; modelApplied?: boolean; warning?: string } {
  if (!agent) return {};
  if (!requestedModel) return { model: agent.model };
  const provider = agent.provider_id ? providerManager.get(agent.provider_id) : undefined;
  const requestedFamily = modelFamilyForName(requestedModel);
  const activeFamily = providerFamily(String(provider?.provider || ""));
  if (requestedFamily && activeFamily && requestedFamily !== activeFamily) {
    return {
      model: agent.model,
      modelApplied: false,
      warning: `Ignored model override ${requestedModel}; it does not match the ${provider?.name || activeFamily} provider`,
    };
  }
  return { model: requestedModel, modelApplied: true };
}

export async function handleSessionsSpawn(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<{
  status: string;
  childSessionKey: string;
  runId: string;
  task: string;
  modelApplied?: boolean;
  warning?: string;
}> {
  const task = readTrimmedString(args.task);
  const label = readTrimmedString(args.label);
  const requestedAgentId = readTrimmedString(args.agentId);
  const modelOverride = readTrimmedString(args.model);
  const runTimeoutSeconds = resolveRunTimeoutSeconds(args);
  const cleanup = args.cleanup === "delete" ? "delete" : "keep";
  const silent = args.silent === true;

  const requesterSessionKey =
    readTrimmedString(args._requesterSessionKey) || readTrimmedString(context?.sessionId) || "main";
  const requestedWorkspaceDir =
    readTrimmedString(args.workspaceDir) || readTrimmedString(context?.workspaceDir);

  if (!task) {
    throw new Error("task is required");
  }

  if (subagentRegistry.isSubagentSessionKey(requesterSessionKey)) {
    return {
      status: "forbidden",
      childSessionKey: "",
      runId: "",
      task,
      warning: "sessions_spawn is not allowed from sub-agent sessions",
    };
  }

  const providerBlockReason = getSubagentProviderBlockReason(requestedAgentId);
  if (providerBlockReason) {
    return {
      status: "forbidden",
      childSessionKey: "",
      runId: "",
      task,
      warning: `sessions_spawn was not started because ${providerBlockReason}`,
    };
  }

  const targetAgent = resolveSubagentTargetAgent(requestedAgentId);
  if (!targetAgent) {
    return {
      status: "forbidden",
      childSessionKey: "",
      runId: "",
      task,
      warning: requestedAgentId
        ? `sessions_spawn was not started because agent ${requestedAgentId} was not found`
        : "sessions_spawn was not started because no agent is available",
    };
  }

  const maxActiveChildren = resolveMaxActiveChildren(args);
  const activeChildren = subagentRegistry.countActiveRunsForRequester(requesterSessionKey);
  if (maxActiveChildren !== undefined && activeChildren >= maxActiveChildren) {
    return {
      status: "forbidden",
      childSessionKey: "",
      runId: "",
      task,
      warning: `sessions_spawn has reached the active sub-agent limit (${maxActiveChildren}) for this session`,
    };
  }

  const agentId = targetAgent.id;
  const modelSelection = resolveSubagentModel(targetAgent, modelOverride);
  const childSessionKey = subagentRegistry.generateSubagentSessionKey(agentId);
  const runId = crypto.randomUUID();

  const run = subagentRegistry.registerSubagentRun({
    runId,
    childSessionKey,
    requesterSessionKey,
    requesterDisplayKey: requesterSessionKey === "main" ? "main" : requesterSessionKey,
    task,
    cleanup,
    label,
    model: modelSelection.model,
    workspaceDir: requestedWorkspaceDir,
    runTimeoutSeconds,
    silent,
  });

  const session: SubagentSession = {
    id: childSessionKey,
    agentId,
    parentSessionId: requesterSessionKey,
    task,
    model: modelSelection.model,
    timeout: runTimeoutSeconds && runTimeoutSeconds > 0 ? runTimeoutSeconds : undefined,
    status: "pending",
    messages: [
      {
        role: "system",
        content: buildSubagentSystemPrompt(
          requesterSessionKey,
          childSessionKey,
          task,
          label,
          requestedWorkspaceDir,
          silent
        ),
        timestamp: new Date().toISOString(),
      },
      {
        role: "user",
        content: task,
        timestamp: new Date().toISOString(),
      },
    ],
    createdAt: new Date().toISOString(),
    workspaceDir: requestedWorkspaceDir,
    allowedToolNames: context?.allowedToolNames,
  };

  sessions.set(childSessionKey, session);

  executeSubagent(childSessionKey, run).catch((err) => {
    console.error(`[Subagent] Error executing session ${childSessionKey}:`, err);
    subagentRegistry.markRunFailed(runId, err.message || "Unknown error");
  });

  return {
    status: "accepted",
    childSessionKey,
    runId,
    task,
    modelApplied: modelSelection.modelApplied,
    warning: modelSelection.warning,
  };
}

interface SubagentWaitResult {
  runId: string;
  childSessionKey: string;
  status: "pending" | "running" | "completed" | "failed" | "timeout" | "killed";
  label: string;
  task: string;
  result?: string;
  error?: string;
  activityCount: number;
  toolCallCount: number;
  endedAt?: number;
}

function subagentWaitStatus(run: SubagentRunRecord): SubagentWaitResult["status"] {
  if (!run.endedAt) return run.startedAt ? "running" : "pending";
  if (run.outcome?.status === "ok") return "completed";
  if (run.outcome?.status === "timeout") return "timeout";
  if (run.outcome?.status === "killed") return "killed";
  return "failed";
}

function subagentWaitResult(run: SubagentRunRecord): SubagentWaitResult {
  return {
    runId: run.runId,
    childSessionKey: run.childSessionKey,
    status: subagentWaitStatus(run),
    label: run.label || run.task.slice(0, 80),
    task: run.task,
    result: run.outcome?.result,
    error: run.outcome?.error,
    activityCount: run.activities?.length || 0,
    toolCallCount: run.toolCalls?.length || 0,
    endedAt: run.endedAt,
  };
}

function readRunIds(args: Record<string, unknown>): string[] {
  const values = Array.isArray(args.runIds)
    ? args.runIds
    : typeof args.runId === "string"
      ? [args.runId]
      : [];
  return [
    ...new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    ),
  ];
}

function waitDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason || new Error("Wait cancelled"));
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason || new Error("Wait cancelled"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function handleSessionsWait(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<{
  status: "completed" | "partial" | "timeout";
  runs: SubagentWaitResult[];
  pendingRunIds: string[];
  elapsedMs: number;
}> {
  const runIds = readRunIds(args);
  if (runIds.length === 0) throw new Error("runIds is required");
  if (runIds.length > 10) throw new Error("sessions_wait accepts at most 10 run IDs");

  const runs = runIds.map((runId) => subagentRegistry.getRun(runId));
  const missing = runIds.filter((_runId, index) => !runs[index]);
  if (missing.length > 0) throw new Error(`Subagent run not found: ${missing.join(", ")}`);

  const requesterSessionKey = readTrimmedString(context?.sessionId);
  if (requesterSessionKey && runs.some((run) => run?.requesterSessionKey !== requesterSessionKey)) {
    throw new Error("Cannot wait for subagents from another session");
  }

  const requestedTimeout = readNonNegativeInteger(args.timeoutSeconds);
  const timeoutSeconds = Math.min(requestedTimeout ?? 120, 600);
  const startedAt = Date.now();
  const deadline = startedAt + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    const current = runIds.map((runId) => subagentRegistry.getRun(runId));
    if (current.every((run) => Boolean(run?.endedAt))) break;
    await waitDelay(Math.min(200, Math.max(1, deadline - Date.now())), context?.abortSignal);
  }

  const completedRuns = runIds
    .map((runId) => subagentRegistry.getRun(runId))
    .filter((run): run is SubagentRunRecord => Boolean(run));
  const pendingRunIds = completedRuns.filter((run) => !run.endedAt).map((run) => run.runId);
  const finishedCount = completedRuns.length - pendingRunIds.length;
  return {
    status: pendingRunIds.length === 0 ? "completed" : finishedCount > 0 ? "partial" : "timeout",
    runs: completedRuns.map(subagentWaitResult),
    pendingRunIds,
    elapsedMs: Date.now() - startedAt,
  };
}

function buildSubagentSystemPrompt(
  requesterSessionKey: string,
  childSessionKey: string,
  task: string,
  label?: string,
  workspaceDir?: string,
  silent?: boolean
): string {
  const lines = [
    "You are a sub-agent running a specific task.",
    "",
    "## Task",
    label ? `Label: ${label}` : "",
    `Task: ${task}`,
    "",
    "## Instructions",
    "- Complete the task thoroughly but concisely",
    "- Focus only on the specified task",
    "- Return the requested result directly in plain Markdown with concrete evidence",
    "- Use the smallest sufficient set of tool calls and stop once the task is answered",
    "- Do not save memories or create skills unless the task explicitly requests it",
    "- Do not spawn additional sub-agents from this sub-agent session",
    silent
      ? "- This is a silent background task. Do NOT announce your result to the requester."
      : "- Return the completed result in your final response; the parent retrieves it through sessions_wait and synthesizes the user-facing answer",
    "",
    `Requester session: ${requesterSessionKey}`,
    `Your session: ${childSessionKey}`,
    workspaceDir ? `Workspace directory: ${workspaceDir}` : "",
  ];

  return lines.filter(Boolean).join("\n");
}

function statusPhase(payload: StatusPayload): ToolStatusPhase | undefined {
  if (payload.toolPhase) return payload.toolPhase;
  if (payload.status === "tool_executing") return "start";
  if (payload.status === "tool_completed") return "result";
  if (payload.status === "error") return "error";
  return undefined;
}

function recordSubagentActivity(
  activities: subagentRegistry.SubagentActivity[],
  payload: StatusPayload
): boolean {
  const text = payload.detail?.trim();
  const phase = statusPhase(payload);
  if (phase && (payload.toolName || payload.toolCallId)) {
    const matchingIndex = payload.toolCallId
      ? activities.findIndex(
          (activity) => activity.phase === "start" && activity.toolCallId === payload.toolCallId
        )
      : activities.findIndex(
          (activity) => activity.phase === "start" && activity.toolName === payload.toolName
        );
    const activity: subagentRegistry.SubagentActivity = {
      id:
        matchingIndex >= 0
          ? activities[matchingIndex]?.id || `${payload.timestamp}`
          : payload.toolCallId || `${payload.timestamp}-${activities.length}`,
      phase,
      text: text || `${payload.toolName || "Tool"} ${phase}`,
      timestamp: payload.timestamp,
      toolName: payload.toolName,
      toolCallId: payload.toolCallId,
      sandboxProvider: payload.sandboxProvider,
    };
    if (matchingIndex >= 0) activities[matchingIndex] = activity;
    else activities.push(activity);
    return true;
  }

  if (!text || !["thinking", "generating", "compacting"].includes(payload.status)) return false;
  const normalized = text.toLowerCase();
  if (
    ["thinking", "thinking...", "generating response", "generating response..."].includes(
      normalized
    )
  ) {
    return false;
  }
  const previous = activities[activities.length - 1];
  if (previous?.toolName === "__thought" && previous.text === text) return false;
  activities.push({
    id: `${payload.timestamp}-${activities.length}`,
    phase: "result",
    text,
    timestamp: payload.timestamp,
    toolName: "__thought",
  });
  return true;
}

function recordSubagentToolCall(
  toolCalls: subagentRegistry.SubagentToolCall[],
  payload: StatusPayload
): boolean {
  const phase = statusPhase(payload);
  if (!phase || (!payload.toolName && !payload.toolCallId)) return false;
  const id = payload.toolCallId || `${payload.toolName}-${payload.timestamp}`;
  const existingIndex = toolCalls.findIndex((toolCall) => toolCall.id === id);
  const status = phase === "start" ? "executing" : phase === "result" ? "completed" : "failed";
  const next: subagentRegistry.SubagentToolCall = {
    id,
    name: payload.toolName || "tool",
    result: phase === "start" ? null : payload.detail || null,
    status,
    timeline_index:
      existingIndex >= 0 ? toolCalls[existingIndex]?.timeline_index : toolCalls.length,
  };
  if (existingIndex >= 0) toolCalls[existingIndex] = next;
  else toolCalls.push(next);
  return true;
}

async function executeSubagent(sessionId: string, run?: SubagentRunRecord): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  session.status = "running";
  if (run) {
    subagentRegistry.markRunStarted(run.runId);
  }

  const activities: subagentRegistry.SubagentActivity[] = [];
  const liveToolCalls: subagentRegistry.SubagentToolCall[] = [];
  const abortController = new AbortController();
  subagentAbortControllers.set(sessionId, abortController);
  const stopStatusCapture = onStatus((payload) => {
    if (payload.sessionId !== sessionId) return;
    const activityChanged = recordSubagentActivity(activities, payload);
    const toolCallChanged = recordSubagentToolCall(liveToolCalls, payload);
    if ((activityChanged || toolCallChanged) && run) {
      subagentRegistry.updateRunDetails(run.runId, { activities, toolCalls: liveToolCalls });
    }
  });

  try {
    const availableAgents = agentManager.list();
    const agent =
      typeof session.agentId === "string" && session.agentId.trim().length > 0
        ? availableAgents.find((a) => a.id === session.agentId)
        : availableAgents.find((a) => a.status === "running") || availableAgents[0];

    if (!agent) {
      throw new Error("No agent available for subagent execution");
    }

    const agentMessages = session.messages.map((m) => ({
      role: m.role as "user" | "assistant" | "system" | "tool",
      content: m.content,
    }));

    console.log(
      `[Subagent] Executing ${sessionId} using agent ${agent.id}${session.model ? ` (model override: ${session.model})` : ""}`
    );

    const result = await agentManager.execute(agent.id, agentMessages, {
      useTools: true,
      sessionId,
      workspaceDir: session.workspaceDir,
      channel: "subagent",
      userId: "subagent",
      modelOverride: session.model,
      abortSignal: abortController.signal,
      allowedToolNames: session.allowedToolNames,
    });

    session.messages.push({
      role: "assistant",
      content: result.content,
      timestamp: new Date().toISOString(),
      thinking: result.thinking,
      tool_calls: result.tool_calls,
      process_activities: activities,
    });

    session.result = result.content;
    session.status = "completed";
    session.completedAt = new Date().toISOString();

    if (run) {
      subagentRegistry.markRunCompleted(run.runId, result.content, {
        thinking: result.thinking,
        activities,
        toolCalls: result.tool_calls,
      });
    }

    console.log(
      `[Subagent] Session ${sessionId} completed with ${result.tool_calls?.length || 0} tool calls`
    );
  } catch (error) {
    if (abortController.signal.aborted) {
      session.status = "killed";
      session.completedAt = new Date().toISOString();
      if (run && subagentRegistry.getRun(run.runId)?.outcome?.status !== "killed") {
        subagentRegistry.markRunKilled(run.runId);
      }
      return;
    }
    session.status = "failed";
    session.error = (error as Error).message;
    session.completedAt = new Date().toISOString();

    if (run) {
      subagentRegistry.markRunFailed(run.runId, (error as Error).message);
    }

    console.error(`[Subagent] Session ${sessionId} failed:`, error);
  } finally {
    broadcastStatus({
      status: "idle",
      sessionId,
      agentId: session.agentId,
      timestamp: Date.now(),
    });
    stopStatusCapture();
    if (subagentAbortControllers.get(sessionId) === abortController) {
      subagentAbortControllers.delete(sessionId);
    }
  }
}

export function killSubagentSession(runId: string): boolean {
  const run = subagentRegistry.getRun(runId);
  if (!run || run.endedAt) return false;
  const session = sessions.get(run.childSessionKey);
  if (session) {
    session.status = "killed";
    session.completedAt = new Date().toISOString();
  }
  subagentRegistry.markRunKilled(runId);
  subagentAbortControllers.get(run.childSessionKey)?.abort(new Error("Subagent stopped"));
  return true;
}

export function clearSubagentSession(sessionKey: string): void {
  subagentAbortControllers.get(sessionKey)?.abort();
  subagentAbortControllers.delete(sessionKey);
  sessions.delete(sessionKey);
}

export async function handleSessionsSend(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<{ success: boolean; sessionId: string; message: string }> {
  const sessionId = readTrimmedString(args.sessionId);
  const message = readTrimmedString(args.message);

  if (!sessionId || !message) {
    throw new Error("sessionId and message are required");
  }

  if (subagentRegistry.isSubagentSessionKey(context?.sessionId || "") && !sessions.has(sessionId)) {
    throw new Error(
      "Subagents cannot write directly to the parent transcript. Return the result for the parent to retrieve with sessions_wait."
    );
  }

  const session = sessions.get(sessionId);
  if (!session) {
    const delivered = sendChannelRuntimeMessage(sessionId, {
      role: "assistant",
      content: message,
      timestamp: new Date().toISOString(),
    });
    if (!delivered) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return {
      success: true,
      sessionId,
      message: "Message delivered to session.",
    };
  }

  session.messages.push({
    role: "user",
    content: message,
    timestamp: new Date().toISOString(),
  });

  if (session.status === "completed" || session.status === "failed") {
    session.status = "pending";
    executeSubagent(sessionId).catch((err) => {
      console.error(`[Subagent] Error re-executing session ${sessionId}:`, err);
    });
  }

  return {
    success: true,
    sessionId,
    message: "Message added to session. Check sessions_history for response.",
  };
}

export async function handleSessionsHistory(args: Record<string, unknown>): Promise<{
  sessionId: string;
  status: string;
  task: string;
  messages: Array<{ role: string; content: string; timestamp: string }>;
  result?: string;
  error?: string;
}> {
  const sessionId = args.sessionId as string;
  const limit = (args.limit as number) || 50;

  if (!sessionId) {
    throw new Error("sessionId is required");
  }

  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  return {
    sessionId,
    status: session.status,
    task: session.task,
    messages: session.messages.slice(-limit),
    result: session.result,
    error: session.error,
  };
}

export async function handleSessionsList(): Promise<{
  sessions: Array<{
    id: string;
    task: string;
    status: string;
    createdAt: string;
    completedAt?: string;
    workspaceDir?: string;
    model?: string;
    timeout?: number;
    messageCount: number;
  }>;
}> {
  return {
    sessions: Array.from(sessions.values()).map((s) => ({
      id: s.id,
      task: s.task,
      status: s.status,
      createdAt: s.createdAt,
      completedAt: s.completedAt,
      workspaceDir: s.workspaceDir,
      model: s.model,
      timeout: s.timeout,
      messageCount: s.messages.length,
    })),
  };
}

export async function handleSessionStatus(args: Record<string, unknown>): Promise<{
  sessionId: string;
  status: string;
  model?: string;
  workspaceDir?: string;
  messageCount: number;
  tokenEstimate: number;
  createdAt: string;
  lastActivityAt?: string;
  task?: string;
  uptime?: number;
}> {
  const sessionId = args.sessionId as string;

  if (!sessionId) {
    return {
      sessionId: "main",
      status: "active",
      messageCount: 0,
      tokenEstimate: 0,
      createdAt: new Date().toISOString(),
      uptime: process.uptime() * 1000,
    };
  }

  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const totalChars = session.messages.reduce((sum, m) => sum + m.content.length, 0);
  const tokenEstimate = Math.ceil(totalChars / 4);

  return {
    sessionId: session.id,
    status: session.status,
    model: session.model,
    workspaceDir: session.workspaceDir,
    messageCount: session.messages.length,
    tokenEstimate,
    createdAt: session.createdAt,
    lastActivityAt: session.completedAt || session.createdAt,
    task: session.task,
  };
}

export async function handleAgentsList(): Promise<{
  agents: Array<{ id: string; name: string; status: string; type: string }>;
}> {
  try {
    const agents = agentManager.list();
    return {
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status || "stopped",
        type: a.type || "general",
      })),
    };
  } catch {
    return {
      agents: [{ id: "default", name: "Assistant", status: "running", type: "general" }],
    };
  }
}

export async function handleSessionsTransfer(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<AgentTransferEnvelope | { status: "forbidden"; error: string }> {
  const sessionId = readTrimmedString(context?.sessionId);
  const targetAgentReference = readTrimmedString(args.agentId);
  if (!sessionId) {
    return { status: "forbidden", error: "Agent transfer requires an active chat session" };
  }
  if (subagentRegistry.isSubagentSessionKey(sessionId)) {
    return { status: "forbidden", error: "Sub-agent sessions cannot transfer chat ownership" };
  }
  if (!targetAgentReference) {
    return { status: "forbidden", error: "agentId is required" };
  }
  const sourceAgent = agentManager.get(context?.agentId || "");
  const matchingAgents = agentManager
    .list()
    .filter(
      (candidate) =>
        candidate.name.trim().toLocaleLowerCase() === targetAgentReference.toLocaleLowerCase()
    );
  const targetAgent = agentManager.get(targetAgentReference) || matchingAgents[0];
  if (!sourceAgent) {
    return { status: "forbidden", error: "Current agent is unavailable" };
  }
  if (!targetAgent) {
    return { status: "forbidden", error: "Target agent was not found" };
  }
  if (!agentManager.get(targetAgentReference) && matchingAgents.length > 1) {
    return { status: "forbidden", error: "Target agent name is ambiguous; use its agent ID" };
  }
  if (targetAgent.id === sourceAgent.id) {
    return { status: "forbidden", error: "Target agent is already active" };
  }
  if (targetAgent.type === "subagent" || targetAgent.type === "worker") {
    return {
      status: "forbidden",
      error: "Worker agents must be delegated with sessions_spawn instead of a transfer",
    };
  }
  const targetProvider = agentManager.resolveProvider(targetAgent.id);
  if (!targetProvider) {
    return { status: "forbidden", error: "Target agent has no available provider" };
  }
  const availability = getProviderAvailability(targetProvider.id);
  if (!availability.available && (availability.inCooldown || availability.circuitOpen)) {
    return {
      status: "forbidden",
      error: availability.reason || "Target agent provider is temporarily unavailable",
    };
  }
  const reason = readTrimmedString(args.reason)?.slice(0, 1_000) || "Specialist handoff";
  const contextSummary = readTrimmedString(args.contextSummary)?.slice(0, 8_000);
  return createAgentTransferEnvelope({
    sessionId,
    fromAgentId: sourceAgent.id,
    fromAgentName: sourceAgent.name,
    toAgentId: targetAgent.id,
    toAgentName: targetAgent.name,
    reason,
    contextMode: normalizeAgentTransferContextMode(args.contextMode),
    contextSummary,
  });
}

type MessageToolContext = {
  channel?: string;
  userId?: string;
  sessionId?: string;
};

type MessageAction = "list" | "send" | "broadcast" | "react" | "unreact";

type MessageChannelSummary = {
  id: string;
  name: string;
  type: ChannelType;
  running: boolean;
  targets: ChannelTarget[];
  targetError?: string;
};

type MessageToolResult = {
  success: boolean;
  action: string;
  target: string;
  resolvedTarget?: string;
  message?: string;
  channel?: string;
  channelId?: string;
  channels?: MessageChannelSummary[];
  delivered?: number;
  attempted?: number;
};

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveChannelType(value: unknown): ChannelType | undefined {
  const normalized = asNonEmptyString(value)?.toLowerCase();
  return normalized && Object.hasOwn(channelDefinitions, normalized)
    ? (normalized as ChannelType)
    : undefined;
}

type EnabledChannel = {
  id: string;
  name: string;
  type: ChannelType;
  enabled: boolean;
};

function resolveEnabledChannels(): EnabledChannel[] {
  return (channelManager.list() as Channel[])
    .filter((entry) => entry.enabled)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      type: entry.type as ChannelType,
      enabled: Boolean(entry.enabled),
    }));
}

async function summarizeChannel(channel: EnabledChannel): Promise<MessageChannelSummary> {
  const adapter = channelManager.getAdapter(channel.type);
  const running = adapter?.isRunning(channel.id) ?? false;
  if (!adapter?.listTargets || !running) {
    return {
      id: channel.id,
      name: channel.name,
      type: channel.type,
      running,
      targets: [],
    };
  }
  try {
    return {
      id: channel.id,
      name: channel.name,
      type: channel.type,
      running,
      targets: await adapter.listTargets(channel.id),
    };
  } catch (error) {
    return {
      id: channel.id,
      name: channel.name,
      type: channel.type,
      running,
      targets: [],
      targetError: error instanceof Error ? error.message : String(error),
    };
  }
}

function resolveChannelsForAction(args: {
  channelId?: string;
  channelType?: ChannelType;
  action: MessageAction;
}): EnabledChannel[] {
  const allEnabled = resolveEnabledChannels();

  if (args.channelId) {
    const selected = allEnabled.find((entry) => entry.id === args.channelId);
    if (!selected) {
      throw new Error(`No active channel found for channelId '${args.channelId}'`);
    }
    return [selected];
  }

  if (args.channelType) {
    const matching = allEnabled.filter((entry) => entry.type === args.channelType);
    if (matching.length === 0) {
      throw new Error(`No active ${args.channelType} channel found`);
    }
    return matching;
  }

  if (args.action === "react" || args.action === "unreact") {
    const reactionCapable = allEnabled.filter((entry) => {
      const adapter = channelManager.getAdapter(entry.type) as ReactionAdapter | undefined;
      if (!adapter) return false;
      return args.action === "react"
        ? Boolean(adapter.sendReaction)
        : Boolean(adapter.removeReaction);
    });
    if (reactionCapable.length === 0) {
      throw new Error(`No active channels support '${args.action}'`);
    }
    return reactionCapable;
  }

  if (allEnabled.length === 0) {
    throw new Error("No active channels found");
  }

  return allEnabled;
}

function resolveChannelIdFromDelimitedSessionMap(
  sessionMap: Map<string, string>,
  sessionId: string | undefined,
  chatId: string | undefined
): string | undefined {
  if (!sessionId) return undefined;

  const matches: string[] = [];
  for (const [key, value] of sessionMap.entries()) {
    if (value !== sessionId) continue;
    const separatorIndex = key.indexOf(":");
    if (separatorIndex <= 0) continue;

    const channelId = key.slice(0, separatorIndex);
    const sessionChatId = key.slice(separatorIndex + 1);
    if (chatId && sessionChatId !== chatId) {
      continue;
    }
    matches.push(channelId);
  }

  return matches.length === 1 ? matches[0] : undefined;
}

function resolveChannelIdFromContext(
  channelType: ChannelType | undefined,
  context?: MessageToolContext
): string | undefined {
  const sessionId = asNonEmptyString(context?.sessionId);
  const chatId = asNonEmptyString(context?.userId);
  if (!channelType || !sessionId) {
    return undefined;
  }

  if (channelType === "discord") {
    return resolveChannelIdFromDelimitedSessionMap(discordSessions, sessionId, chatId);
  }

  if (channelType === "slack") {
    return resolveChannelIdFromDelimitedSessionMap(slackSessions, sessionId, chatId);
  }

  return undefined;
}

function resolveTarget(args: Record<string, unknown>, context?: MessageToolContext): string {
  const explicitTarget = asNonEmptyString(args.target) || asNonEmptyString(args.to);
  if (explicitTarget) return explicitTarget;

  if (typeof args.chatId === "string" || typeof args.chatId === "number") {
    return String(args.chatId);
  }

  const contextTarget = asNonEmptyString(context?.userId);
  if (contextTarget) return contextTarget;

  throw new Error("target is required (or provide to/chatId)");
}

function resolveMessageText(args: Record<string, unknown>): string {
  const message =
    asNonEmptyString(args.message) || asNonEmptyString(args.text) || asNonEmptyString(args.content);
  if (!message) {
    throw new Error("message is required (or provide text/content)");
  }
  return message;
}

type ReactionAdapter = ChannelAdapter & {
  sendReaction?: (
    channelId: string,
    chatId: string | number,
    messageId: string,
    emoji: string,
    options?: Record<string, unknown>
  ) => Promise<boolean>;
  removeReaction?: (
    channelId: string,
    chatId: string | number,
    messageId: string,
    emoji: string,
    options?: Record<string, unknown>
  ) => Promise<boolean>;
};

async function sendSingleMessage(
  channel: EnabledChannel,
  target: string,
  messageText: string,
  args: Record<string, unknown>
): Promise<{ success: boolean; resolvedTarget: string }> {
  const adapter = channelManager.getAdapter(channel.type);
  if (!adapter) {
    throw new Error(`Adapter not available for channel type '${channel.type}'`);
  }

  const resolvedTarget = adapter.resolveTarget
    ? await adapter.resolveTarget(channel.id, target)
    : target;
  const success = await adapter.sendMessage(channel.id, resolvedTarget, messageText, {
    contentType: args.contentType,
    buffer: args.buffer,
    replyToId: args.replyToId,
  });
  return { success, resolvedTarget };
}

async function runReactionAction(
  action: "react" | "unreact",
  channel: EnabledChannel,
  target: string,
  messageId: string,
  emoji: string,
  options?: Record<string, unknown>
): Promise<boolean> {
  const adapter = channelManager.getAdapter(channel.type) as ReactionAdapter | undefined;
  if (!adapter) {
    throw new Error(`Channel adapter '${channel.type}' is not available`);
  }

  if (action === "react") {
    if (!adapter.sendReaction) {
      throw new Error(`Channel '${channel.type}' does not support react`);
    }
    return await adapter.sendReaction(channel.id, target, messageId, emoji, options);
  }

  if (!adapter.removeReaction) {
    throw new Error(`Channel '${channel.type}' does not support unreact`);
  }

  return await adapter.removeReaction(channel.id, target, messageId, emoji, options);
}

export async function handleMessage(
  args: Record<string, unknown>,
  context?: MessageToolContext
): Promise<MessageToolResult> {
  const actionRaw = asNonEmptyString(args.action);
  if (!actionRaw) {
    throw new Error("action is required");
  }

  const normalizedAction = actionRaw.toLowerCase();
  const action: MessageAction =
    normalizedAction === "list" ||
    normalizedAction === "send" ||
    normalizedAction === "broadcast" ||
    normalizedAction === "react" ||
    normalizedAction === "unreact"
      ? normalizedAction
      : (() => {
          throw new Error(`Unknown message action: ${actionRaw}`);
        })();

  const explicitChannelType = asNonEmptyString(args.channel) || asNonEmptyString(args.platform);
  const requestedChannelType =
    resolveChannelType(explicitChannelType) || resolveChannelType(context?.channel);
  if (explicitChannelType && !resolveChannelType(explicitChannelType)) {
    throw new Error(`Unknown channel type: ${explicitChannelType}`);
  }
  const requestedChannelId =
    asNonEmptyString(args.channelId) || resolveChannelIdFromContext(requestedChannelType, context);
  const channels = resolveChannelsForAction({
    channelId: requestedChannelId,
    channelType: requestedChannelType,
    action,
  });

  if (action === "list") {
    const summaries = await Promise.all(channels.map(summarizeChannel));
    return {
      success: true,
      action,
      target: "",
      channels: summaries,
      message: `Found ${summaries.length} enabled channel connection${summaries.length === 1 ? "" : "s"}`,
    };
  }

  if ((action === "send" || action === "react" || action === "unreact") && channels.length > 1) {
    throw new Error(
      `Multiple active channels match request (${channels.length}). Provide channel or channelId to disambiguate.`
    );
  }

  const target = resolveTarget(args, context);

  if (action === "send") {
    const channel = channels[0];
    const messageText = resolveMessageText(args);
    const delivery = await sendSingleMessage(channel, target, messageText, args);
    return {
      success: delivery.success,
      action,
      target,
      resolvedTarget: delivery.resolvedTarget,
      channel: channel.type,
      channelId: channel.id,
      message: delivery.success
        ? `Message sent to ${target} via ${channel.type}`
        : `Failed to send message to ${target} via ${channel.type}`,
    };
  }

  if (action === "broadcast") {
    const messageText = resolveMessageText(args);
    const results = await Promise.all(
      channels.map(async (channel) => await sendSingleMessage(channel, target, messageText, args))
    );
    const delivered = results.filter((result) => result.success).length;
    return {
      success: delivered > 0,
      action,
      target,
      delivered,
      attempted: channels.length,
      message: `Broadcast delivered to ${delivered}/${channels.length} channels for target ${target}`,
    };
  }

  const messageId = asNonEmptyString(args.messageId) || asNonEmptyString(args.replyToId);
  if (!messageId) {
    throw new Error("messageId is required for react/unreact actions");
  }
  const emoji = asNonEmptyString(args.emoji) || asNonEmptyString(args.reaction);
  if (!emoji) {
    throw new Error("emoji is required for react/unreact actions");
  }

  const channel = channels[0];
  const adapter = channelManager.getAdapter(channel.type);
  const resolvedTarget = adapter?.resolveTarget
    ? await adapter.resolveTarget(channel.id, target)
    : target;
  const success = await runReactionAction(action, channel, resolvedTarget, messageId, emoji, {
    userId: args.userId,
  });

  return {
    success,
    action,
    target,
    resolvedTarget,
    channel: channel.type,
    channelId: channel.id,
    message: success
      ? `${action === "react" ? "Reaction added" : "Reaction removed"} on ${messageId}`
      : `Failed to ${action} on ${messageId}`,
  };
}

export * from "./channel-utilities";
