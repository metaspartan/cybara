import { type AgentExecutionFailure, agentManager } from "../core/agent";
import { recordCompletedTrajectory } from "../core/agent-eval";
import { emitAgentHook } from "../core/agent-hooks";
import { agentSupportsImages } from "../core/agent-image-capabilities";
import {
  type AgentTransferEnvelope,
  buildAgentTransferMessages,
  findAgentTransferEnvelope,
} from "../core/agent-transfer";
import { maybeRunBackgroundReview } from "../core/background-review";
import { resolveChannelAgentId } from "../core/channels/agent-selection";
import { persistImageAttachments } from "../core/chat/attachments";
import {
  applyChatCapabilityInstruction,
  resolveChatCapabilityMentions,
} from "../core/chat/capability-mentions";
import { isBotProfileConfig } from "../core/bot-profile";
import { stopRegisteredComputerUseTrajectory } from "../core/computer-use-lifecycle";
import { config } from "../core/config";
import { hasImages, sanitizeAgentImages } from "../core/llm/image-blocks";
import { sanitizeAssistantContent } from "../core/llm/text-tool-calls";
import { createLogger } from "../core/logger";
import { logAgentActivity, logSessionMessage } from "../core/logging";
import { trackSessionEvent } from "../core/metrics";
import { expandPromptCommand } from "../core/prompt-commands";
import {
  estimateMessagesTokens,
  estimateSessionContextUsage,
  normalizeSessionWorkspaceDir,
  persistSession,
  resolveSessionModelMetadata,
  type SessionModelMetadata,
  setPersistedSessionAgent,
  summarizeSessionTokenUsage,
  upsertPersistedSessionMessage,
} from "../core/session-context";
import {
  getActiveSessionRunId,
  getActiveSessionRunStartedAtMs,
} from "../core/session-event-ledger";
import {
  handleSessionGoalCommand,
  getSessionGoal,
  type SessionGoalCommandResult,
} from "../core/session-goals";
import { GOAL_LOOP_SOURCE, recordGoalIterationOutcome } from "../core/session-goal-loop";
import { extractLatestSessionPlan, extractLatestSessionPlanState } from "../core/session-plan";
import {
  deriveSessionTitleFromMessages,
  deriveSessionTitleFromTurn,
  shouldRegenerateSessionTitle,
} from "../core/session-title";
import {
  broadcastStatus,
  getSessionRunStatusSnapshot,
  isSessionStatusActive,
  type PendingChatMessageSnapshot,
} from "../core/status";
import { hydrateTodoState } from "../core/tools/handlers/todo";
import {
  checkRateLimit,
  recordCircuitFailure,
  recordCircuitSuccess,
} from "../core/tools/runtime-guards";
import { resolveAgentToolPolicy } from "../core/toolsets";
import { stripAgentAttributionTag } from "./chat-agent-handoff";
import {
  activeAgentSystemPrompt,
  applyActiveAgentToSession,
  refreshSessionAgentSystemPromptIfNeeded,
} from "./chat-agent-prompt";
import { buildChatExecutionMessagesForAgent } from "./chat-execution-messages";
import { executionMetadataFromResult } from "./chat-execution-metadata";
import {
  normalizeRequestedAssistantResponse,
  sanitizeProcessThoughtText,
  stripThinkingTags,
} from "./chat-formatting";
import { kickOffGoalLoop, maybeScheduleGoalIteration } from "./chat-goal-runtime";
import { settlePendingChatFailure } from "./chat-pending-failure";
import {
  appendAssistantMessage,
  findAssistantResponseAfterPendingMessage,
  findMaterializedPendingMessage,
  hasPendingChatMessages,
  materializePendingMessage,
  nextPendingChatSequence,
  pendingChatSnapshot,
  pendingChatSnapshots,
  preparePendingMessage,
  removePendingChatMessagesBySource,
  removePendingChatQueueItem,
  resolveQueuedTurnRouting,
  restorePendingChatQueueState,
  syncPendingChatStatus,
} from "./chat-pending-state";
import {
  deletePersistedPendingChatItem,
  persistPendingChatItem,
  persistPendingChatItems,
} from "./chat-pending-store";
import {
  buildFallbackProcessActivities,
  dedupeProcessActivities,
  type ProcessActivityInfo,
  type ToolCallInfo,
} from "./chat-process-activities";
import {
  finishRetryableProviderFailure,
  normalizeAgentExecutionFailure,
} from "./chat-provider-failure";
import { appendToolImageReferences, maybeSaveAutomaticMemory } from "./chat-response-enrichment";
import { recoverAssistantResponse } from "./chat-response-recovery";
import { awaitSpawnedSubagentResults } from "./chat-subagent-completion";
import { resolveExplicitSubagentSpawnLimit } from "./chat-subagent-budget";
import {
  interruptActiveChatTurnForSteering,
  isChatTurnInterrupted,
  pendingChatDrainRetryDelay,
} from "./chat-runtime-stability";
import {
  activeChatTurnAbortControllers,
  buildLastMessagePreview,
  cacheChatSession,
  chatRateLimitConfig,
  chatTurnMutex,
  cleanGeneratedSessionTitle,
  countVisibleSessionMessages,
  createPendingChatCompletion,
  deferredSessionMessages,
  deletingChatSessionIds,
  generateSessionTitleViaModel,
  getResidentChatSession,
  type InMemoryChatSession,
  interruptedChatTurnSteeringIds,
  MAX_PENDING_CHAT_MESSAGES_PER_SESSION,
  type PendingChatItem,
  parseIsoTimestampMs,
  pendingChatCompletions,
  pendingChatDrainScheduled,
  pendingChatDrainTimers,
  pendingChatQueues,
  persistActiveSessionContext,
  persistChatSessionSnapshot,
  rejectPendingChatCompletion,
  resolvePendingChatCompletion,
  restorePersistedChatSessionForChat,
  stoppedChatTurnControllers,
  upsertPersistedSessionIndex,
} from "./chat-runtime-state";
import { applySessionTitleWithBackgroundUpgrade } from "./chat-session-title-upgrade";
import { maybeCaptureSkillFromTurn } from "./chat-skill-capture";
import { prepareTurnContext, resolveTurnContextWindow } from "./chat-turn-context";
import {
  buildInterruptedToolCalls,
  collectAttachedProcessActivityIds,
  getSessionProcessActivities,
  materializeInterruptedAssistantBeforeSteering,
  sanitizeObservedProcessActivities,
} from "./chat-steering-activities";
import { constrainToolsForMessage, messageDisallowsAllTools } from "./chat-tool-constraints";
import { resolveToolResponseContent } from "./chat-tool-response";
import {
  buildNoUsableAssistantResponseMessage,
  classifyToolCallResult,
  extractVisibleClarification,
  requiredDirectToolForMessage,
  shouldPreferArtifactsForMessage,
  suppressRecoveredWebFailureActivities,
} from "./chat-tool-summary";
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  SteerPendingChatMessageOptions,
} from "./chat-types";

export { buildChatExecutionMessagesForAgent } from "./chat-execution-messages";
export { stripThinkingTags } from "./chat-formatting";
export {
  formatProcessActivityFromToolCall,
  type ProcessActivityInfo,
  type ToolCallInfo,
} from "./chat-process-activities";

const log = createLogger("Chat");
const linkedChatAbortCleanups = new WeakMap<AbortController, () => void>();

export type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  SteerPendingChatMessageOptions,
} from "./chat-types";

export async function waitForPendingChatCompletion(id: string): Promise<ChatResponse> {
  const completion = pendingChatCompletions.get(id);
  if (!completion) throw new Error("Pending chat completion was not registered");
  try {
    return await completion.promise;
  } finally {
    pendingChatCompletions.delete(id);
  }
}

export async function stopActiveChatTurn(sessionId: string): Promise<{
  success: boolean;
  stopped: boolean;
  sessionId: string;
  error?: string;
}> {
  const key = sessionId.trim();
  const controller = activeChatTurnAbortControllers.get(key);
  if (!key || !controller || controller.signal.aborted) {
    return {
      success: true,
      stopped: false,
      sessionId: key,
      error: "No active chat turn for session",
    };
  }
  stoppedChatTurnControllers.add(controller);
  controller.abort(new DOMException("Chat turn stopped by user", "AbortError"));
  const session = getResidentChatSession(key);
  if (session) {
    await persistStoppedAssistantTurn(session);
  }
  return { success: true, stopped: true, sessionId: key };
}

function clearActiveChatTurnAbortController(sessionId: string, controller: AbortController): void {
  linkedChatAbortCleanups.get(controller)?.();
  linkedChatAbortCleanups.delete(controller);
  if (activeChatTurnAbortControllers.get(sessionId) === controller) {
    activeChatTurnAbortControllers.delete(sessionId);
  }
}

function linkChatAbortSignal(controller: AbortController, signal?: AbortSignal): void {
  if (!signal) return;
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason ?? new DOMException("Chat turn aborted", "AbortError"));
    }
  };
  if (signal.aborted) {
    abort();
    return;
  }
  signal.addEventListener("abort", abort, { once: true });
  linkedChatAbortCleanups.set(controller, () => signal.removeEventListener("abort", abort));
}

function isStoppedChatTurn(controller: AbortController): boolean {
  return stoppedChatTurnControllers.has(controller);
}

async function finishStoppedChatTurn(
  session: InMemoryChatSession,
  agent: { id: string; name: string },
  controller: AbortController
): Promise<ChatResponse> {
  const stoppedMessage = await persistStoppedAssistantTurn(session);
  clearActiveChatTurnAbortController(session.id, controller);
  broadcastStatus({
    status: "idle",
    timestamp: Date.now(),
    detail: "Stopped",
    sessionId: session.id,
    agentId: agent.id,
  });
  return {
    sessionId: session.id,
    workspaceDir: session.workspaceDir ?? null,
    interrupted: true,
    stopped: true,
    plan: extractLatestSessionPlan(session.id, session.messages),
    message:
      stoppedMessage ||
      ({
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
      } satisfies ChatMessage),
    agent: {
      id: agent.id,
      name: agent.name,
    },
  };
}

async function finishInterruptedChatTurn(
  session: InMemoryChatSession,
  agent: { id: string; name: string },
  controller: AbortController
): Promise<ChatResponse> {
  clearActiveChatTurnAbortController(session.id, controller);
  const pendingSteeringId = interruptedChatTurnSteeringIds.get(controller);
  const materializedMessage = pendingSteeringId
    ? materializeInterruptedAssistantBeforeSteering(session, undefined, { pendingSteeringId })
    : await persistInterruptedAssistantTurn(session, "interrupted");
  if (pendingSteeringId && materializedMessage) {
    const stableKey = materializedMessage._pendingSteeringId
      ? `interrupted:${materializedMessage._pendingSteeringId}`
      : `interrupted:${materializedMessage.timestamp || ""}`;
    await upsertPersistedSessionMessage(session.id, session.agentId, materializedMessage, {
      stableKey,
      metadata: { source: "chat_steering_interrupted" },
    });
    if (pendingSteeringId && materializedMessage._pendingSteeringId === pendingSteeringId) {
      delete materializedMessage._pendingSteeringId;
    }
    session.persisted = await persistSession(
      session.id,
      session.agentId,
      session.messages,
      session.workspaceDir,
      session.title,
      session.useModelRouter
    );
    persistActiveSessionContext(session);
    upsertPersistedSessionIndex({
      id: session.id,
      agentId: session.agentId,
      title: session.title,
      messageCount: countVisibleSessionMessages(session.messages),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      workspaceDir: session.workspaceDir ?? null,
      lastMessage: buildLastMessagePreview(session.messages[session.messages.length - 1]),
      modelMetadata: resolveSessionModelMetadata(session.agentId),
    });
  }
  broadcastStatus({
    status: "idle",
    timestamp: Date.now(),
    detail: pendingSteeringId ? "Steering to follow-up..." : "Interrupted",
    sessionId: session.id,
    agentId: agent.id,
  });
  return {
    sessionId: session.id,
    workspaceDir: session.workspaceDir ?? null,
    interrupted: true,
    plan: extractLatestSessionPlan(session.id, session.messages),
    message:
      materializedMessage ||
      ({
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
      } satisfies ChatMessage),
    agent: {
      id: agent.id,
      name: agent.name,
    },
  };
}

async function finishAbortedChatTurn(
  session: InMemoryChatSession,
  agent: { id: string; name: string },
  controller: AbortController,
  consumedSteeringCompletionIds: Set<string>
): Promise<ChatResponse> {
  const response = isStoppedChatTurn(controller)
    ? await finishStoppedChatTurn(session, agent, controller)
    : await finishInterruptedChatTurn(session, agent, controller);
  for (const id of consumedSteeringCompletionIds) resolvePendingChatCompletion(id, response);
  return response;
}

export function enqueuePendingChatMessage(
  request: ChatRequest,
  sessionId: string,
  mode: "queued" | "steering"
): ChatResponse {
  const now = Date.now();
  if (request.source !== GOAL_LOOP_SOURCE) {
    removePendingChatMessagesBySource(sessionId, GOAL_LOOP_SOURCE);
  }
  const queue = pendingChatQueues.get(sessionId) || [];
  const clientPendingId =
    typeof request.clientPendingId === "string" && request.clientPendingId.trim().length > 0
      ? request.clientPendingId.trim()
      : undefined;
  const item: PendingChatItem = {
    id: `pending_${crypto.randomUUID()}`,
    sessionId,
    clientPendingId,
    request: {
      ...request,
      sessionId,
      queueMode: "queue",
    },
    content: request.message.trim(),
    createdAt: now,
    updatedAt: now,
    mode,
    sequence: nextPendingChatSequence(),
  };

  if (queue.length >= MAX_PENDING_CHAT_MESSAGES_PER_SESSION) {
    throw new Error("Pending message queue is full");
  }
  if (request.awaitQueuedCompletion) createPendingChatCompletion(item.id);

  queue.push(item);
  persistPendingChatItem(item);
  pendingChatQueues.set(sessionId, queue);

  const pendingMessages = syncPendingChatStatus(sessionId);
  return {
    sessionId,
    queued: true,
    pendingMessage: pendingChatSnapshot(item),
    pendingMessages,
    workspaceDir: request.workspaceDir ?? null,
    plan: (() => {
      const session = getResidentChatSession(sessionId);
      return session ? extractLatestSessionPlan(sessionId, session.messages) : null;
    })(),
    message: {
      role: "assistant",
      content:
        mode === "steering"
          ? "Follow-up queued for the current run."
          : "Message queued for the next turn.",
      timestamp: new Date(now).toISOString(),
    },
  };
}

function consumeSteeringMessages(session: InMemoryChatSession): Array<{
  id: string;
  content: string;
  createdAt: number;
}> {
  const queue = pendingChatQueues.get(session.id) || [];
  const steeringItems = queue.filter((item) => item.mode === "steering");
  if (steeringItems.length === 0) return [];

  const steeringIds = new Set(steeringItems.map((item) => item.id));
  const remaining = queue.filter((item) => !steeringIds.has(item.id));
  if (remaining.length > 0) {
    pendingChatQueues.set(session.id, remaining);
  } else {
    pendingChatQueues.delete(session.id);
  }

  for (const item of steeringItems) {
    let materializedMessage = findMaterializedPendingMessage(session, item.id);
    if (!materializedMessage) {
      materializedMessage = materializePendingMessage(session, item);
    }
    delete materializedMessage._pendingSteeringId;
    deletePersistedPendingChatItem(item.id);
  }
  syncPendingChatStatus(session.id);

  return steeringItems.map((item) => ({
    id: item.id,
    content: item.content,
    createdAt: item.createdAt,
  }));
}

export function schedulePendingChatDrain(sessionId: string, delayMs = 0): void {
  if (pendingChatDrainScheduled.has(sessionId)) return;
  pendingChatDrainScheduled.add(sessionId);
  const timer = setTimeout(() => {
    pendingChatDrainScheduled.delete(sessionId);
    pendingChatDrainTimers.delete(sessionId);
    void drainPendingChatQueue(sessionId);
  }, delayMs);
  pendingChatDrainTimers.set(sessionId, timer);
  timer.unref?.();
}

type ChatTurnInterruptionKind = "stopped" | "interrupted";

function finalizeInterruptedProcessActivity(
  activity: ProcessActivityInfo,
  kind: ChatTurnInterruptionKind
): ProcessActivityInfo {
  if (activity.phase !== "start") return activity;
  const label = kind === "stopped" ? "Stopped" : "Interrupted";
  return {
    ...activity,
    phase: "blocked",
    text: `${label}: ${activity.text}`,
  };
}

function materializeInterruptedAssistantTurn(
  session: InMemoryChatSession,
  kind: ChatTurnInterruptionKind
): ChatMessage | undefined {
  const latestUserIndex = session.messages.findLastIndex((message) => message.role === "user");
  if (latestUserIndex < 0) return undefined;
  const nextMessage = session.messages[latestUserIndex + 1];
  const existing =
    nextMessage?.role === "assistant" &&
    nextMessage.content.trim().length === 0 &&
    Array.isArray(nextMessage.process_activities)
      ? nextMessage
      : undefined;
  const observed = getSessionProcessActivities(session.id, {
    excludeActivityIds: collectAttachedProcessActivityIds(session.messages),
  });
  const activities = dedupeProcessActivities([
    ...(existing?.process_activities || []),
    ...(observed || []).map((activity) => finalizeInterruptedProcessActivity(activity, kind)),
  ]);
  if (activities.length === 0) return existing;
  const stoppedAt = Date.now();
  const statusSnapshot = getSessionRunStatusSnapshot(session.id);
  const userTimestamp = parseIsoTimestampMs(session.messages[latestUserIndex]?.timestamp);
  const startedAt = statusSnapshot?.startedAt ?? userTimestamp ?? stoppedAt;
  const toolCalls = buildInterruptedToolCalls(activities);
  if (existing) {
    existing.process_activities = activities;
    existing.tool_calls = toolCalls;
    existing.interrupted = true;
    existing.worked_duration_ms = Math.max(0, stoppedAt - startedAt);
    return existing;
  }
  const assistantMessage: ChatMessage = {
    role: "assistant",
    content: "",
    timestamp: new Date(Math.max(stoppedAt, (userTimestamp ?? 0) + 1)).toISOString(),
    process_activities: activities,
    tool_calls: toolCalls,
    interrupted: true,
    worked_duration_ms: Math.max(0, stoppedAt - startedAt),
  };
  session.messages.splice(latestUserIndex + 1, 0, assistantMessage);
  session.updatedAt = assistantMessage.timestamp || new Date().toISOString();
  return assistantMessage;
}

async function persistStoppedAssistantTurn(
  session: InMemoryChatSession
): Promise<ChatMessage | undefined> {
  return persistInterruptedAssistantTurn(session, "stopped");
}

async function persistInterruptedAssistantTurn(
  session: InMemoryChatSession,
  kind: ChatTurnInterruptionKind
): Promise<ChatMessage | undefined> {
  const interruptedMessage = materializeInterruptedAssistantTurn(session, kind);
  if (!interruptedMessage) return undefined;
  const latestUser = [...session.messages]
    .slice(0, session.messages.indexOf(interruptedMessage))
    .reverse()
    .find((message) => message.role === "user");
  await upsertPersistedSessionMessage(session.id, session.agentId, interruptedMessage, {
    stableKey: `${kind}:${latestUser?.timestamp || interruptedMessage.timestamp || session.id}`,
    metadata: { source: kind === "stopped" ? "chat_stopped" : "chat_interrupted" },
  });
  await persistChatSessionSnapshot(session, interruptedMessage);
  persistActiveSessionContext(session);
  return interruptedMessage;
}

async function drainPendingChatQueue(sessionId: string): Promise<void> {
  const runStatusSnapshot = getSessionRunStatusSnapshot(sessionId);
  const isSteeringHandoff =
    typeof runStatusSnapshot?.detail === "string" &&
    runStatusSnapshot.detail.trim().toLowerCase() === "steering to follow-up...";
  const runStatusActive = isSessionStatusActive(runStatusSnapshot?.status) && !isSteeringHandoff;
  const retryDelay = pendingChatDrainRetryDelay(chatTurnMutex.isLocked(sessionId), runStatusActive);
  if (retryDelay !== null) {
    schedulePendingChatDrain(sessionId, retryDelay);
    return;
  }

  const queue = pendingChatQueues.get(sessionId) || [];
  const next = queue[0];
  if (!next) {
    pendingChatQueues.delete(sessionId);
    syncPendingChatStatus(sessionId);
    return;
  }

  const session =
    getResidentChatSession(sessionId) || (await restorePersistedChatSessionForChat(sessionId));
  if (!session) {
    log.error("Queued chat session could not be restored", {
      sessionId,
      pendingId: next.id,
    });
    removePendingChatQueueItem(sessionId, next.id);
    rejectPendingChatCompletion(next.id, new Error("Queued chat session no longer exists"));
    schedulePendingChatDrain(sessionId);
    return;
  }

  const completedPendingResponse = next.materialized
    ? findAssistantResponseAfterPendingMessage(session, next.id)
    : undefined;
  if (completedPendingResponse) {
    try {
      removePendingChatQueueItem(sessionId, next.id);
    } catch (error) {
      log.exception("Restored queued chat cleanup failed", error, {
        sessionId,
      });
    }
    resolvePendingChatCompletion(next.id, {
      sessionId,
      message: completedPendingResponse,
    });
    maybeScheduleGoalIteration(sessionId);
    schedulePendingChatDrain(sessionId);
    return;
  }

  const preparedMessage = preparePendingMessage(session, next);
  try {
    await upsertPersistedSessionMessage(session.id, session.agentId, preparedMessage, {
      stableKey: `pending:${next.id}`,
      metadata: { source: "chat_queue" },
    });
  } catch (error) {
    log.exception("Queued user turn could not be persisted", error, {
      sessionId,
      pendingId: next.id,
    });
    schedulePendingChatDrain(sessionId, 1000);
    return;
  }

  const materializedMessage = materializePendingMessage(session, next);
  next.materialized = true;
  persistPendingChatItem(next);
  const materializedPersisted = await persistChatSessionSnapshot(session, materializedMessage);
  if (!materializedPersisted) {
    log.warn("Queued user turn session metadata could not be persisted", {
      sessionId,
      pendingId: next.id,
    });
  }
  persistActiveSessionContext(session);

  try {
    broadcastStatus({
      status: "thinking",
      timestamp: Date.now(),
      detail: "Starting queued follow-up",
      sessionId,
      agentId: session.agentId,
      pendingChatId: next.id,
      clientPendingId: next.clientPendingId,
    });
    syncPendingChatStatus(sessionId);
    const response = await runChatTurnWithQueueDrain(
      {
        ...next.request,
        ...resolveQueuedTurnRouting(session),
        message: next.content,
        sessionId,
        queueMode: next.mode === "steering" ? "steer" : "queue",
        recordedUserMessageId: next.id,
      },
      sessionId
    );
    try {
      removePendingChatQueueItem(sessionId, next.id);
    } catch (error) {
      log.exception("Completed queued chat cleanup failed", error, {
        sessionId,
      });
      schedulePendingChatDrain(sessionId, 1000);
    }
    resolvePendingChatCompletion(next.id, response);
    maybeScheduleGoalIteration(sessionId);
  } catch (error) {
    log.exception("Queued chat turn failed", error, { sessionId });
    try {
      const cleanupError = await settlePendingChatFailure(session, next, error);
      if (cleanupError) {
        log.exception("Failed queued chat cleanup failed", cleanupError, {
          sessionId,
        });
        schedulePendingChatDrain(sessionId, 1000);
      }
      rejectPendingChatCompletion(next.id, error);
    } catch (persistenceError) {
      log.exception("Queued chat failure could not be persisted", persistenceError, { sessionId });
      rejectPendingChatCompletion(next.id, error);
    }
  }
}

export function runChatTurnWithQueueDrain(
  request: ChatRequest,
  effectiveSessionId: string,
  goalCommand?: SessionGoalCommandResult,
  goalCommandSideEffectsApplied = false
): Promise<ChatResponse> {
  const isGoalIteration = request.source === GOAL_LOOP_SOURCE;
  const result = chatTurnMutex.run(effectiveSessionId, () =>
    handleChatTurn(request, effectiveSessionId, goalCommand, goalCommandSideEffectsApplied)
  );
  const finalized = result.then(
    async (response) => {
      await stopRegisteredComputerUseTrajectory(
        effectiveSessionId,
        response.interrupted ? "interrupted" : "completed"
      );
      return response;
    },
    async (error: unknown) => {
      await stopRegisteredComputerUseTrajectory(
        effectiveSessionId,
        "error",
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  );
  if (isGoalIteration) {
    void finalized.then(
      (response) => recordGoalIterationOutcome(effectiveSessionId, !response.failure),
      () => recordGoalIterationOutcome(effectiveSessionId, false)
    );
  }
  void finalized
    .finally(() => {
      flushDeferredSessionMessages(effectiveSessionId);
      schedulePendingChatDrain(effectiveSessionId);
      maybeScheduleGoalIteration(effectiveSessionId);
    })
    .catch(() => undefined);
  return finalized;
}

export function applyGoalCommandSideEffects(
  sessionId: string,
  goalAction: SessionGoalCommandResult["action"],
  goal: SessionGoalCommandResult["goal"]
): void {
  if (
    goalAction === "pause" ||
    goalAction === "block" ||
    goalAction === "complete" ||
    goalAction === "clear"
  ) {
    removePendingChatMessagesBySource(sessionId, GOAL_LOOP_SOURCE);
    void stopActiveChatTurn(sessionId).catch(() => undefined);
    return;
  }
  if (
    (goalAction === "start" || goalAction === "resume" || goalAction === "edit") &&
    goal?.status === "active"
  ) {
    kickOffGoalLoop(sessionId, goal);
  }
}

export async function handleChat(request: ChatRequest): Promise<ChatResponse> {
  const rateLimit = checkRateLimit("chat", chatRateLimitConfig);
  if (!rateLimit.allowed) {
    return {
      sessionId: request.sessionId || crypto.randomUUID(),
      message: {
        role: "assistant",
        content: "Rate limit exceeded. Please try again later.",
        timestamp: new Date().toISOString(),
      },
    };
  }

  if (!request.message.trim()) {
    throw new Error("Message is required");
  }

  const effectiveSessionId = request.sessionId || crypto.randomUUID();
  if (deletingChatSessionIds.has(effectiveSessionId)) {
    throw new Error("Chat session is being deleted");
  }

  const goalCommand = handleSessionGoalCommand(effectiveSessionId, request.message);
  if (goalCommand.handled) {
    const shouldStopImmediately =
      goalCommand.action === "pause" ||
      goalCommand.action === "block" ||
      goalCommand.action === "complete" ||
      goalCommand.action === "clear";
    if (shouldStopImmediately) {
      applyGoalCommandSideEffects(effectiveSessionId, goalCommand.action, goalCommand.goal);
    }
    return runChatTurnWithQueueDrain(
      request,
      effectiveSessionId,
      goalCommand,
      shouldStopImmediately
    );
  }

  const expandedCommand = expandPromptCommand(request.message);
  if (expandedCommand) {
    request = { ...request, message: expandedCommand };
  }

  const sessionLocked = chatTurnMutex.isLocked(effectiveSessionId);
  const sessionHasPendingMessages = hasPendingChatMessages(effectiveSessionId);
  const sessionStatusActive =
    !!request.queueMode &&
    isSessionStatusActive(getSessionRunStatusSnapshot(effectiveSessionId)?.status);
  const shouldQueue =
    !!request.sessionId && (sessionLocked || sessionHasPendingMessages || sessionStatusActive);
  if (shouldQueue) {
    if (!config.getFollowUpBehaviorEnabled()) {
      throw new Error("Queue and steer follow-ups are disabled while this chat is active");
    }
    const response = enqueuePendingChatMessage(
      request,
      effectiveSessionId,
      request.queueMode === "steer" ? "steering" : "queued"
    );
    if (!sessionLocked) {
      schedulePendingChatDrain(effectiveSessionId);
    }
    return response;
  }
  return runChatTurnWithQueueDrain(request, effectiveSessionId);
}

export function listPendingChatMessages(sessionId: string): PendingChatMessageSnapshot[] {
  return pendingChatSnapshots(sessionId.trim());
}

export function restorePersistedPendingChatQueues(schedule = true): number {
  return restorePendingChatQueueState(schedule ? schedulePendingChatDrain : undefined);
}

export function reorderPendingChatMessages(
  sessionId: string,
  pendingMessageIds: string[]
):
  | { success: true; pendingMessages: PendingChatMessageSnapshot[] }
  | {
      success: false;
      error: string;
      pendingMessages: PendingChatMessageSnapshot[];
    } {
  const key = sessionId.trim();
  const queue = pendingChatQueues.get(key) || [];
  if (queue.length === 0) {
    return { success: true, pendingMessages: [] };
  }

  const normalizedIds = pendingMessageIds
    .map((id) => (typeof id === "string" ? id.trim() : ""))
    .filter((id, index, ids) => id.length > 0 && ids.indexOf(id) === index);
  const visibleItems = queue.filter((item) => item.materialized !== true);
  const visibleById = new Map(visibleItems.map((item) => [item.id, item]));
  const unknownId = normalizedIds.find((id) => !visibleById.has(id));
  if (unknownId) {
    return {
      success: false,
      error: "Pending message not found",
      pendingMessages: pendingChatSnapshots(key),
    };
  }

  const orderedIds = new Set(normalizedIds);
  const now = Date.now();
  const orderedVisibleItems = [
    ...normalizedIds
      .map((id) => visibleById.get(id))
      .filter((item): item is PendingChatItem => !!item),
    ...visibleItems.filter((item) => !orderedIds.has(item.id)),
  ].map((item) => ({
    ...item,
    updatedAt: now,
    sequence: nextPendingChatSequence(),
  }));
  const materializedItems = queue.filter((item) => item.materialized === true);

  pendingChatQueues.set(key, [...materializedItems, ...orderedVisibleItems]);
  persistPendingChatItems([...materializedItems, ...orderedVisibleItems]);
  const pendingMessages = syncPendingChatStatus(key);
  return { success: true, pendingMessages };
}

export function updatePendingChatMessage(
  sessionId: string,
  pendingMessageId: string,
  content: string
):
  | {
      success: true;
      pendingMessage: PendingChatMessageSnapshot;
      pendingMessages: PendingChatMessageSnapshot[];
    }
  | {
      success: false;
      error: string;
      pendingMessages: PendingChatMessageSnapshot[];
    } {
  const key = sessionId.trim();
  const nextContent = typeof content === "string" ? content.trim() : "";
  if (nextContent.length === 0) {
    return {
      success: false,
      error: "Pending message cannot be empty",
      pendingMessages: pendingChatSnapshots(key),
    };
  }

  const queue = pendingChatQueues.get(key) || [];
  const index = queue.findIndex(
    (item) => item.id === pendingMessageId && item.materialized !== true
  );
  if (index < 0) {
    return {
      success: false,
      error: "Pending message not found",
      pendingMessages: pendingChatSnapshots(key),
    };
  }

  const item = {
    ...queue[index],
    content: nextContent,
    request: {
      ...queue[index].request,
      message: nextContent,
    },
    updatedAt: Date.now(),
  };
  queue[index] = item;
  pendingChatQueues.set(key, queue);
  persistPendingChatItem(item);
  const pendingMessages = syncPendingChatStatus(key);
  return {
    success: true,
    pendingMessage: pendingChatSnapshot(item),
    pendingMessages,
  };
}

export function deletePendingChatMessage(
  sessionId: string,
  pendingMessageId: string
):
  | { success: true; pendingMessages: PendingChatMessageSnapshot[] }
  | {
      success: false;
      error: string;
      pendingMessages: PendingChatMessageSnapshot[];
    } {
  const key = sessionId.trim();
  const queue = pendingChatQueues.get(key) || [];
  const visibleIndex = queue.findIndex(
    (item) => item.id === pendingMessageId && item.materialized !== true
  );
  if (visibleIndex < 0) {
    return {
      success: false,
      error: "Pending message not found",
      pendingMessages: pendingChatSnapshots(key),
    };
  }

  const pendingMessages = removePendingChatQueueItem(key, pendingMessageId);
  rejectPendingChatCompletion(pendingMessageId, new Error("Pending chat message was deleted"));
  return { success: true, pendingMessages };
}

async function waitForPendingChatSession(sessionId: string): Promise<InMemoryChatSession | null> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const session = getResidentChatSession(sessionId);
    if (session) return session;
    if (!chatTurnMutex.isLocked(sessionId)) return null;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return getResidentChatSession(sessionId) ?? null;
}

export async function steerPendingChatMessage(
  sessionId: string,
  pendingMessageId: string,
  options?: SteerPendingChatMessageOptions
): Promise<
  | {
      success: true;
      message: ChatMessage;
      interruptedMessage?: ChatMessage;
      pendingMessages: PendingChatMessageSnapshot[];
    }
  | {
      success: false;
      error: string;
      pendingMessages: PendingChatMessageSnapshot[];
    }
> {
  const key = sessionId.trim();
  if (!config.getFollowUpBehaviorEnabled()) {
    return {
      success: false,
      error: "Queue and steer follow-ups are disabled",
      pendingMessages: pendingChatSnapshots(key),
    };
  }
  const queue = pendingChatQueues.get(key) || [];
  const index = queue.findIndex((item) => item.id === pendingMessageId);
  if (index < 0) {
    return {
      success: false,
      error: "Pending message not found",
      pendingMessages: pendingChatSnapshots(key),
    };
  }

  const session = await waitForPendingChatSession(key);
  if (!session) {
    return {
      success: false,
      error: "Session not found for pending message",
      pendingMessages: pendingChatSnapshots(key),
    };
  }

  const item: PendingChatItem = {
    ...queue[index],
    mode: "steering",
    updatedAt: Date.now(),
    materialized: true,
  };
  const materializedMessage = materializePendingMessage(session, item);
  const interruptedMessage = materializeInterruptedAssistantBeforeSteering(
    session,
    sanitizeObservedProcessActivities(options?.processActivities),
    {
      pendingSteeringId: item.id,
      createEmptyBoundary: true,
    }
  );
  if (interruptedMessage) {
    await upsertPersistedSessionMessage(session.id, session.agentId, interruptedMessage, {
      stableKey: `interrupted:${item.id}`,
      metadata: { source: "chat_steering_interrupted" },
    });
  }
  await upsertPersistedSessionMessage(session.id, session.agentId, materializedMessage, {
    stableKey: `pending:${item.id}`,
    metadata: { source: "chat_steering" },
  });
  session.persisted = await persistSession(
    session.id,
    session.agentId,
    session.messages,
    session.workspaceDir,
    session.title,
    session.useModelRouter
  );
  queue[index] = item;
  pendingChatQueues.set(key, queue);
  persistPendingChatItem(item);
  persistActiveSessionContext(session);
  upsertPersistedSessionIndex({
    id: session.id,
    agentId: session.agentId,
    title: session.title,
    messageCount: countVisibleSessionMessages(session.messages),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    workspaceDir: session.workspaceDir ?? null,
    lastMessage: buildLastMessagePreview(materializedMessage),
    modelMetadata: resolveSessionModelMetadata(session.agentId),
  });
  const pendingMessages = syncPendingChatStatus(key);
  const interrupted = interruptActiveChatTurnForSteering(key, item.id);
  schedulePendingChatDrain(key);
  broadcastStatus({
    status: "thinking",
    timestamp: Date.now(),
    detail: interrupted ? "Steering to follow-up..." : "Follow-up added",
    sessionId: key,
    agentId: session.agentId,
  });
  return {
    success: true,
    message: materializedMessage,
    ...(interruptedMessage ? { interruptedMessage } : {}),
    pendingMessages,
  };
}

async function handleChatTurn(
  request: ChatRequest,
  effectiveSessionId: string,
  goalCommand?: SessionGoalCommandResult,
  goalCommandSideEffectsApplied = false
): Promise<ChatResponse> {
  const { message, agentId, tools = true, channel, userId, source, workspaceDir } = request;
  const toolsEnabled = tools && !messageDisallowsAllTools(message);
  let useModelRouter = request.useModelRouter === true;
  const requestedModelOverride =
    typeof request.modelOverride === "string" && request.modelOverride.trim()
      ? request.modelOverride.trim()
      : undefined;
  const requestedWorkspaceDir =
    workspaceDir !== undefined ? normalizeSessionWorkspaceDir(workspaceDir) : undefined;
  const agentPromptOptions = { useTools: toolsEnabled, runtimeChannel: channel };

  let session = getResidentChatSession(effectiveSessionId);
  if (!session) {
    session = await restorePersistedChatSessionForChat(effectiveSessionId);
  }
  const isNewSession = !session;

  if (!session) {
    const agents = agentManager.list();
    const resolvedDefaultId = resolveChannelAgentId(undefined, agents);
    const agent = agentId
      ? agentManager.get(agentId)
      : resolvedDefaultId
        ? agentManager.get(resolvedDefaultId)
        : undefined;

    if (!agent) {
      return {
        sessionId: crypto.randomUUID(),
        message: {
          role: "assistant",
          content: "No agent available. Please create or select an agent first.",
          timestamp: new Date().toISOString(),
        },
      };
    }

    const newSessionId = effectiveSessionId;
    const nowIso = new Date().toISOString();
    session = {
      id: newSessionId,
      agentId: agent.id,
      useModelRouter,
      title: null,
      messages: [
        {
          role: "system",
          content: await activeAgentSystemPrompt(
            agent,
            requestedWorkspaceDir,
            [{ role: "user", content: message }],
            agentPromptOptions
          ),
          timestamp: nowIso,
        },
      ],
      createdAt: nowIso,
      updatedAt: nowIso,
      workspaceDir: requestedWorkspaceDir ?? null,
      persisted: false,
    };
    cacheChatSession(session);

    trackSessionEvent(newSessionId, "created", {
      agentId: agent.id,
      model: agent.model,
    });
  } else if (typeof request.useModelRouter === "boolean") {
    session.useModelRouter = request.useModelRouter;
  } else {
    useModelRouter = session.useModelRouter;
  }

  if (requestedWorkspaceDir !== undefined) {
    session.workspaceDir = requestedWorkspaceDir;
  }

  const requestedAgentId =
    typeof agentId === "string" && agentId.trim().length > 0 ? agentId.trim() : undefined;
  if (requestedAgentId && requestedAgentId !== session.agentId) {
    const requestedAgent = agentManager.get(requestedAgentId);
    if (!requestedAgent) {
      return {
        sessionId: session.id,
        workspaceDir: session.workspaceDir ?? null,
        message: {
          role: "assistant",
          content: "Selected agent is unavailable. Choose another agent and try again.",
          timestamp: new Date().toISOString(),
        },
      };
    }
    await applyActiveAgentToSession(
      session,
      requestedAgent,
      [...session.messages, { role: "user", content: message }],
      agentPromptOptions
    );
    await setPersistedSessionAgent(session.id, requestedAgent.id);
  }

  let agent = agentManager.get(session.agentId);
  const persistedPlanState = extractLatestSessionPlanState(session.id, session.messages);
  hydrateTodoState(
    session.id,
    persistedPlanState?.plan.items ?? [],
    persistedPlanState?.writerAgentId
  );
  if (agent && !isNewSession) {
    await refreshSessionAgentSystemPromptIfNeeded(
      session,
      agent,
      [...session.messages, { role: "user", content: message }],
      agentPromptOptions
    );
  }
  const hookContext = {
    agentId: agent?.id,
    sessionId: session.id,
    channel,
    userId,
  };

  const sanitizedImages = sanitizeAgentImages(request.images);
  const supportsImages = agentSupportsImages(agent, requestedModelOverride);
  let imageRoutingError: string | null = null;
  const recordedUserMessageId =
    typeof request.recordedUserMessageId === "string" && request.recordedUserMessageId.trim()
      ? request.recordedUserMessageId.trim()
      : undefined;
  let userMessage = recordedUserMessageId
    ? findMaterializedPendingMessage(session, recordedUserMessageId)
    : undefined;
  const isMaterializedSteeringTurn = !!userMessage && request.queueMode === "steer";
  const shouldLogUserMessage = !userMessage;
  if (userMessage) {
    delete userMessage._pendingSteeringId;
  } else {
    userMessage = {
      role: "user",
      content: message,
      timestamp: new Date().toISOString(),
      ...(hasImages(sanitizedImages) ? { images: sanitizedImages } : {}),
    };
    session.messages.push(userMessage);
    session.updatedAt = userMessage.timestamp || new Date().toISOString();
  }

  let provider = agent ? agentManager.resolveProvider(agent.id) : undefined;
  const turnAbortController = new AbortController();
  linkChatAbortSignal(turnAbortController, request.abortSignal);
  const consumedSteeringCompletionIds = new Set<string>();
  const finishAbortedTurn = (activeAgent: { id: string; name: string }) =>
    finishAbortedChatTurn(session, activeAgent, turnAbortController, consumedSteeringCompletionIds);
  const consumeSteeringMessagesForActiveTurn = () => {
    if (turnAbortController.signal.aborted) return [];
    const consumed = consumeSteeringMessages(session);
    for (const item of consumed) {
      if (pendingChatCompletions.has(item.id)) consumedSteeringCompletionIds.add(item.id);
    }
    return consumed;
  };
  if (provider && agent) {
    activeChatTurnAbortControllers.set(session.id, turnAbortController);
  }

  const persistedAttachments =
    shouldLogUserMessage && hasImages(sanitizedImages)
      ? persistImageAttachments(session.id, sanitizedImages)
      : [];
  const persistedUserMessageKey = `chat-user:${userMessage.timestamp || session.id}`;
  const persistUserMessage = async (): Promise<void> => {
    if (!shouldLogUserMessage) return;
    await upsertPersistedSessionMessage(session.id, agent?.id || session.agentId, userMessage, {
      stableKey: persistedUserMessageKey,
      metadata: {
        source: "chat_api",
        ...(persistedAttachments.length ? { attachments: persistedAttachments } : {}),
        ...(userMessage.image_context ? { image_context: userMessage.image_context } : {}),
      },
    });
  };
  await persistUserMessage();
  persistActiveSessionContext(session);
  await persistChatSessionSnapshot(session, userMessage);

  if (goalCommand) {
    clearActiveChatTurnAbortController(session.id, turnAbortController);
    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: goalCommand.response || "",
      timestamp: new Date().toISOString(),
    };
    appendAssistantMessage(session, assistantMessage);
    if (!session.title || shouldRegenerateSessionTitle(session.title)) {
      session.title = cleanGeneratedSessionTitle(
        agent?.name,
        deriveSessionTitleFromTurn(goalCommand.goal?.objective || message)
      );
    }
    await logSessionMessage(session.id, "assistant", assistantMessage.content, {
      agentId: agent?.id,
      createdAt: assistantMessage.timestamp,
      metadata: { source: "chat_goal_command" },
    });
    session.persisted = await persistChatSessionSnapshot(session, assistantMessage);
    if (!goalCommandSideEffectsApplied) {
      applyGoalCommandSideEffects(session.id, goalCommand.action, goalCommand.goal);
    }
    broadcastStatus({
      status: "idle",
      timestamp: Date.now(),
      detail: "Idle",
      sessionId: session.id,
      agentId: agent?.id,
    });
    return {
      sessionId: session.id,
      workspaceDir: session.workspaceDir ?? null,
      plan: extractLatestSessionPlan(session.id, session.messages),
      message: assistantMessage,
      agent: agent ? { id: agent.id, name: agent.name } : undefined,
    };
  }

  broadcastStatus({
    status: "thinking",
    timestamp: Date.now(),
    detail: "Thinking...",
    sessionId: session.id,
    agentId: agent?.id,
  });

  await emitAgentHook({
    type: "message:received",
    context: hookContext,
    message,
    metadata: {
      source: source || "chat_api",
    },
  });

  if (agent && hasImages(sanitizedImages) && !supportsImages) {
    const fallbackAgentId = config.get<string>("vision_fallback_agent_id")?.trim();
    const fallbackAgent = fallbackAgentId ? agentManager.get(fallbackAgentId) : undefined;
    if (!fallbackAgentId || !fallbackAgent || !agentSupportsImages(fallbackAgent)) {
      imageRoutingError = `${agent.name || agent.model || "The selected agent"} uses a text-only model. Choose an image-capable agent or configure an Image fallback agent in Settings.`;
    } else {
      broadcastStatus({
        status: "thinking",
        timestamp: Date.now(),
        detail: `Analyzing attached image with ${fallbackAgent.name}`,
        sessionId: session.id,
        agentId: fallbackAgent.id,
      });
      try {
        const visionResult = await agentManager.execute(
          fallbackAgent.id,
          [
            {
              role: "user",
              content: `Describe the attached image or images factually for another assistant. Focus on details relevant to this request: ${message}`,
              images: sanitizedImages,
            },
          ],
          {
            useTools: false,
            sessionId: session.id,
            workspaceDir: session.workspaceDir || undefined,
            abortSignal: turnAbortController.signal,
          }
        );
        const imageContext = visionResult.content.trim();
        if (imageContext) {
          userMessage.image_context = imageContext;
          await persistUserMessage();
          persistActiveSessionContext(session);
        } else {
          imageRoutingError = "The configured image fallback agent returned no description.";
        }
      } catch (error) {
        if (isChatTurnInterrupted(error, turnAbortController.signal)) {
          if (isStoppedChatTurn(turnAbortController)) {
            return finishStoppedChatTurn(session, agent, turnAbortController);
          }
          return finishInterruptedChatTurn(session, agent, turnAbortController);
        }
        imageRoutingError = `The configured image fallback agent failed: ${(error as Error).message}`;
      }
    }
  }

  if (imageRoutingError || !provider || !agent) {
    clearActiveChatTurnAbortController(session.id, turnAbortController);
  }

  if (isNewSession && (!session.title || shouldRegenerateSessionTitle(session.title))) {
    applySessionTitleWithBackgroundUpgrade({
      session,
      provider,
      agent,
      message,
      channel,
      userId,
      abortSignal: turnAbortController.signal,
      skipModelUpgrade: request.source === "dataset_generation",
    });
  }

  if (agent && turnAbortController.signal.aborted) {
    if (isStoppedChatTurn(turnAbortController)) {
      return finishStoppedChatTurn(session, agent, turnAbortController);
    }
    return finishInterruptedChatTurn(session, agent, turnAbortController);
  }

  if (!imageRoutingError && provider && agent) {
    const effectiveModel = requestedModelOverride || agent.model;
    await prepareTurnContext({
      session,
      agent,
      provider,
      effectiveModel,
      channel,
      userId,
      maxOutputTokens: request.maxOutputTokens,
      modelParamsOverride: request.modelParamsOverride,
    });
  }

  let responseContent: string;
  let executionModelMetadata: SessionModelMetadata | null = null;
  let executionFailure: AgentExecutionFailure | undefined;
  const thinkingParts: string[] = [];
  const appendThinking = (value?: string): void => {
    const normalized = sanitizeProcessThoughtText(value || "");
    if (normalized && thinkingParts.at(-1) !== normalized) thinkingParts.push(normalized);
  };
  const allToolCalls: ToolCallInfo[] = [];
  const agentTransfers: AgentTransferEnvelope[] = [];
  if (imageRoutingError) {
    responseContent = imageRoutingError;
  } else if (provider && agent) {
    try {
      const capabilityMentions = await resolveChatCapabilityMentions(
        message,
        session.workspaceDir || undefined,
        isBotProfileConfig(agent.config) ? "bots" : "all"
      );
      const shouldPreferArtifacts = toolsEnabled && shouldPreferArtifactsForMessage(message);
      const directToolCandidate = toolsEnabled ? requiredDirectToolForMessage(message) : undefined;
      const selectedSkill = capabilityMentions.mentions.some((mention) => mention.kind === "skill");
      let activeModelOverride = requestedModelOverride;
      const subagentSpawnLimit = resolveExplicitSubagentSpawnLimit(message);
      const orchestrationState = {
        subagentSpawnsStarted: 0,
        subagentSpawnLimit,
      };
      let activeSupportsImages = supportsImages;
      let executionMessages = applyChatCapabilityInstruction(
        buildChatExecutionMessagesForAgent(session.messages, {
          sessionId: session.id,
          materializedSteeringTurn: isMaterializedSteeringTurn,
          supportsImages: activeSupportsImages,
          activeAgentId: agent.id,
        }),
        capabilityMentions.instruction
      );
      let allowedToolNames = toolsEnabled
        ? constrainToolsForMessage(message, resolveAgentToolPolicy(agent).allowedToolNames)
        : undefined;
      let requiredDirectToolName =
        directToolCandidate && (!allowedToolNames || allowedToolNames.includes(directToolCandidate))
          ? directToolCandidate
          : undefined;
      let requiredToolName = shouldPreferArtifacts
        ? "artifacts"
        : requiredDirectToolName || (selectedSkill ? "skill_load" : undefined);
      let shouldRequireToolUse = Boolean(
        toolsEnabled &&
          (shouldPreferArtifacts ||
            requiredDirectToolName ||
            selectedSkill ||
            capabilityMentions.mentions.some((mention) => mention.kind === "mcp"))
      );
      const executionOptions = () => ({
        sessionId: session.id,
        workspaceDir: session.workspaceDir || undefined,
        abortSignal: turnAbortController.signal,
        consumeSteeringMessages: consumeSteeringMessagesForActiveTurn,
        useModelRouter,
        modelOverride: activeModelOverride,
        allowedToolNames,
        maxOutputTokens: request.maxOutputTokens,
        modelParamsOverride: request.modelParamsOverride,
        orchestrationState,
      });
      let result = await agentManager.execute(agent.id, executionMessages, {
        ...executionOptions(),
        useTools: toolsEnabled,
        requireToolUse: shouldRequireToolUse,
        requiredToolName,
      });
      appendThinking(result.thinking);
      executionModelMetadata = executionMetadataFromResult(result);
      executionFailure = result.failure;
      let toolResults = result.tool_calls || [];
      const maximumTransferDepth = 4;

      while (true) {
        if (result.failure) break;
        const transfer = findAgentTransferEnvelope(result.tool_calls);
        if (!transfer) break;
        if (agentTransfers.length >= maximumTransferDepth) {
          result = {
            ...result,
            content:
              "The agent transfer limit was reached for this turn. Choose an agent manually to continue.",
          };
          break;
        }
        const targetAgent = agentManager.get(transfer.toAgentId);
        if (!targetAgent || targetAgent.type === "subagent" || targetAgent.type === "worker") {
          result = {
            ...result,
            content:
              "The requested target agent is no longer available. Choose another agent to continue.",
          };
          break;
        }

        agentTransfers.push(transfer);
        broadcastStatus({
          status: "thinking",
          timestamp: Date.now(),
          detail: `Continuing with ${targetAgent.name}...`,
          sessionId: session.id,
          agentId: targetAgent.id,
        });
        await applyActiveAgentToSession(session, targetAgent, session.messages, {
          useTools: toolsEnabled,
        });
        await setPersistedSessionAgent(session.id, targetAgent.id);
        persistActiveSessionContext(session);
        agent = targetAgent;
        provider = agentManager.resolveProvider(targetAgent.id);
        if (!provider) {
          result = {
            ...result,
            content: `${targetAgent.name} has no available provider. Choose another agent to continue.`,
          };
          break;
        }
        activeModelOverride = undefined;
        activeSupportsImages = agentSupportsImages(targetAgent);
        allowedToolNames = toolsEnabled
          ? constrainToolsForMessage(message, resolveAgentToolPolicy(targetAgent).allowedToolNames)
          : undefined;
        requiredDirectToolName =
          directToolCandidate &&
          (!allowedToolNames || allowedToolNames.includes(directToolCandidate))
            ? directToolCandidate
            : undefined;
        requiredToolName = shouldPreferArtifacts
          ? "artifacts"
          : requiredDirectToolName || (selectedSkill ? "skill_load" : undefined);
        shouldRequireToolUse = Boolean(
          toolsEnabled &&
            (shouldPreferArtifacts ||
              requiredDirectToolName ||
              selectedSkill ||
              capabilityMentions.mentions.some((mention) => mention.kind === "mcp"))
        );
        executionMessages = buildAgentTransferMessages(
          applyChatCapabilityInstruction(
            buildChatExecutionMessagesForAgent(session.messages, {
              sessionId: session.id,
              materializedSteeringTurn: isMaterializedSteeringTurn,
              supportsImages: activeSupportsImages,
              activeAgentId: targetAgent.id,
            }),
            capabilityMentions.instruction
          ),
          transfer,
          {
            response: result.content,
            toolCalls: toolResults,
          }
        );
        result = await agentManager.execute(targetAgent.id, executionMessages, {
          ...executionOptions(),
          useTools: toolsEnabled,
          requireToolUse: shouldRequireToolUse,
          requiredToolName,
        });
        appendThinking(result.thinking);
        executionModelMetadata = executionMetadataFromResult(result);
        executionFailure = result.failure;
        toolResults.push(...(result.tool_calls || []));
      }
      responseContent = result.content;
      responseContent = extractVisibleClarification(toolResults) || responseContent;

      if (!executionFailure) {
        const recoveredResponse = await recoverAssistantResponse({
          agentId: agent.id,
          allowPlanOnly: agent.type === "planner",
          executeOptions: executionOptions(),
          executionMessages,
          requiredToolName,
          responseContent,
          shouldRequireToolUse,
          toolResults,
          toolsEnabled,
          userMessage: message,
        });
        if (recoveredResponse.error) {
          log.warn("Assistant response recovery retry failed", {
            sessionId: session.id,
            error: recoveredResponse.error,
          });
        }
        if (recoveredResponse.result) {
          result = recoveredResponse.result;
          appendThinking(recoveredResponse.result.thinking);
          executionModelMetadata = executionMetadataFromResult(recoveredResponse.result);
        }
        responseContent = recoveredResponse.responseContent;
        toolResults = recoveredResponse.toolResults;
      }
      responseContent = normalizeRequestedAssistantResponse(message, responseContent);
      let automaticWaitCompleted = false;
      if (!executionFailure) {
        const automaticWait = await awaitSpawnedSubagentResults({
          abortSignal: turnAbortController.signal,
          agentId: agent.id,
          sessionId: session.id,
          toolResults,
          onWaiting: (pendingCount) => {
            broadcastStatus({
              status: "thinking",
              timestamp: Date.now(),
              detail: `Waiting for ${pendingCount} delegated ${pendingCount === 1 ? "task" : "tasks"}...`,
              sessionId: session.id,
              agentId: agent?.id,
            });
          },
        });
        if (automaticWait) {
          toolResults = [...toolResults, automaticWait];
          responseContent = "";
          automaticWaitCompleted = true;
        }
      }

      const memorySettings = config.getMemoryBehaviorSettings();
      void maybeRunBackgroundReview(
        {
          agentId: agent.id,
          sessionId: session.id,
          workspaceDir: session.workspaceDir || undefined,
          useModelRouter,
          activeModel: executionModelMetadata?.model || activeModelOverride,
          activeProviderId: executionModelMetadata?.provider_id,
          activeProviderName: executionModelMetadata?.provider_name,
        },
        responseContent,
        {
          disabled: !memorySettings.backgroundReviewEnabled,
          minIntervalMs: memorySettings.backgroundReviewMinIntervalMs,
          timeoutSeconds: memorySettings.backgroundReviewTimeoutSeconds,
        }
      ).catch(() => undefined);
      if (toolResults.length > 0) {
        const resolvedToolResponse = await resolveToolResponseContent({
          abortSignal: turnAbortController.signal,
          agentId: agent.id,
          channel,
          executionFailure,
          executionMessages,
          maxOutputTokens: request.maxOutputTokens,
          message,
          modelOverride: activeModelOverride,
          modelParamsOverride: request.modelParamsOverride,
          responseContent,
          reconcileTodo: automaticWaitCompleted,
          sessionId: session.id,
          toolResults,
          useModelRouter,
          userId,
          workspaceDir: session.workspaceDir || undefined,
        });
        responseContent = resolvedToolResponse.responseContent;
        toolResults.push(...resolvedToolResponse.toolResults);
        for (const tc of toolResults) {
          const timelineIndex = allToolCalls.length;
          const outcome = classifyToolCallResult(tc.result);
          allToolCalls.push({
            id:
              typeof tc.id === "string" && tc.id.trim()
                ? tc.id
                : `call_${crypto.randomUUID().slice(0, 8)}`,
            name: tc.name,
            args:
              tc.args && typeof tc.args === "object" && !Array.isArray(tc.args)
                ? (tc.args as Record<string, unknown>)
                : {},
            status: outcome.status,
            result: tc.result,
            error: outcome.error,
            duration:
              typeof tc.duration === "number" && Number.isFinite(tc.duration)
                ? Math.max(0, Math.round(tc.duration))
                : 0,
            timeline_index: timelineIndex,
          });
        }
      }

      if (provider) {
        if (executionFailure?.retryable) recordCircuitFailure(`llm:${provider.id}`);
        else recordCircuitSuccess(`llm:${provider.id}`);
      }
      log.info("LLM response received", {
        sessionId: session.id,
        preview: responseContent.substring(0, 100),
      });
    } catch (error) {
      if (isChatTurnInterrupted(error, turnAbortController.signal)) {
        return await finishAbortedTurn(agent);
      }
      log.error("LLM API error", {
        sessionId: session.id,
        error: (error as Error).message,
      });
      const normalizedFailure = normalizeAgentExecutionFailure(error);
      executionFailure = normalizedFailure.failure;
      if (provider) {
        if (normalizedFailure.failure.retryable) recordCircuitFailure(`llm:${provider.id}`);
        else recordCircuitSuccess(`llm:${provider.id}`);
      }
      responseContent = normalizedFailure.content;
    } finally {
      clearActiveChatTurnAbortController(session.id, turnAbortController);
    }
  } else {
    responseContent =
      "No AI provider configured. Please add a provider (like MiniMax, OpenAI, or Ollama) to enable AI responses.";
  }

  if (turnAbortController.signal.aborted && agent) {
    return await finishAbortedTurn(agent);
  }

  if (executionFailure?.retryable && allToolCalls.length === 0 && agent) {
    const response = await finishRetryableProviderFailure({
      session,
      agent,
      failure: executionFailure,
    });
    for (const id of consumedSteeringCompletionIds) resolvePendingChatCompletion(id, response);
    return response;
  }

  responseContent = appendToolImageReferences(responseContent, allToolCalls);

  const { content: extractedContent, thinking: extractedThinking } =
    stripThinkingTags(responseContent);
  const cleanContent = stripAgentAttributionTag(sanitizeAssistantContent(extractedContent));
  const finalThinking = sanitizeProcessThoughtText(
    thinkingParts.length > 0 ? thinkingParts.join("\n\n") : extractedThinking
  );

  await maybeSaveAutomaticMemory({
    message,
    providerType: provider?.provider,
    sessionId: session.id,
    toolCallCount: allToolCalls.length,
  });

  const assistantTimestamp = new Date().toISOString();
  const assistantTimestampMs = parseIsoTimestampMs(assistantTimestamp) || Date.now();
  const statusSnapshotActivities = getSessionProcessActivities(session.id, {
    excludeActivityIds: collectAttachedProcessActivityIds(session.messages),
  });
  const fallbackProcessActivities =
    !statusSnapshotActivities || statusSnapshotActivities.length === 0
      ? buildFallbackProcessActivities(
          allToolCalls,
          finalThinking || undefined,
          parseIsoTimestampMs(userMessage.timestamp) || assistantTimestampMs
        )
      : undefined;
  const visibleProcessActivities = suppressRecoveredWebFailureActivities(
    statusSnapshotActivities && statusSnapshotActivities.length > 0
      ? statusSnapshotActivities
      : fallbackProcessActivities,
    allToolCalls
  );
  const assistantContent =
    cleanContent.trim().length > 0 ? cleanContent : buildNoUsableAssistantResponseMessage();

  const configuredModelMetadata = resolveSessionModelMetadata(agent?.id ?? session.agentId);
  const modelMetadata = executionModelMetadata
    ? { ...(configuredModelMetadata ?? {}), ...executionModelMetadata }
    : configuredModelMetadata;

  const assistantMessage: ChatMessage = {
    role: "assistant",
    content: assistantContent,
    timestamp: assistantTimestamp,
    ...(modelMetadata ?? {}),
    thinking: finalThinking || undefined,
    tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
    process_activities: visibleProcessActivities,
    agent_transfers: agentTransfers.length > 0 ? agentTransfers : undefined,
    run_id: getActiveSessionRunId(session.id),
    worked_duration_ms: Math.max(
      0,
      assistantTimestampMs - (getActiveSessionRunStartedAtMs(session.id) ?? assistantTimestampMs)
    ),
    interrupted: executionFailure?.retryable === true || undefined,
  };
  appendAssistantMessage(session, assistantMessage);
  if (!session.title || shouldRegenerateSessionTitle(session.title)) {
    session.title = cleanGeneratedSessionTitle(agent?.name, deriveSessionTitleFromTurn(message));
  }
  if (provider && agent && !executionFailure) {
    void maybeCaptureSkillFromTurn({
      provider,
      agent,
      sessionId: session.id,
      userMessage: message,
      toolCalls: allToolCalls,
      workspaceDir: session.workspaceDir,
      abortSignal: turnAbortController.signal,
    }).catch(() => undefined);
  }
  await logSessionMessage(session.id, "assistant", assistantMessage.content, {
    agentId: agent?.id,
    createdAt: assistantMessage.timestamp,
    metadata: {
      source: "chat_api",
      ...(modelMetadata ?? {}),
      thinking: finalThinking,
      tool_calls: allToolCalls,
      process_activities: assistantMessage.process_activities,
      agent_transfers: assistantMessage.agent_transfers,
      run_id: assistantMessage.run_id,
      worked_duration_ms: assistantMessage.worked_duration_ms,
      interrupted: assistantMessage.interrupted,
    },
  });
  persistActiveSessionContext(session);

  session.persisted = await persistChatSessionSnapshot(session, assistantMessage);
  const labSettings = config.getLabSettings();
  if (session.persisted && labSettings.enabled && labSettings.trajectoryCaptureEnabled) {
    recordCompletedTrajectory({
      sessionId: session.id,
      agentId: session.agentId,
      messages: session.messages,
      workspaceDir: session.workspaceDir,
      provider: modelMetadata?.provider,
      model: modelMetadata?.model,
    });
  }
  await emitAgentHook({
    type: "message:sent",
    context: { ...hookContext, agentId: agent?.id },
    message: assistantMessage.content,
    metadata: {
      source: source || "chat_api",
      toolCalls: allToolCalls.length,
    },
  });

  if (agent) {
    await logAgentActivity(
      agent.id,
      "chat_response",
      `Responded to session ${session.id.slice(0, 8)}...`,
      {
        sessionId: session.id,
        messageLength: assistantMessage.content.length,
        toolsUsed: allToolCalls.length,
      }
    );
  }

  log.debug("Broadcasting idle status", {
    sessionId: session.id,
    agentId: agent?.id,
  });
  broadcastStatus({
    status: "idle",
    timestamp: Date.now(),
    detail: "Idle",
    sessionId: session.id,
    agentId: agent?.id,
  });

  const responseContextWindowTokens = agent
    ? resolveTurnContextWindow(agent, requestedModelOverride || agent.model).contextWindowTokens
    : undefined;
  const response: ChatResponse = {
    sessionId: session.id,
    session_agent_id: session.agentId,
    workspaceDir: session.workspaceDir ?? null,
    contextUsage: estimateSessionContextUsage(
      session.messages,
      requestedModelOverride || agent?.model,
      {
        sessionId: session.id,
        compactionCount: session.compactionCount || 0,
        contextWindowTokens: responseContextWindowTokens,
      }
    ),
    tokenUsage: summarizeSessionTokenUsage(session.id),
    plan: extractLatestSessionPlan(session.id, session.messages),
    message: assistantMessage,
    agent: agent
      ? {
          id: agent.id,
          name: agent.name,
        }
      : undefined,
    thinking: finalThinking || undefined,
    tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
    failure: executionFailure,
  };
  for (const id of consumedSteeringCompletionIds) resolvePendingChatCompletion(id, response);
  return response;
}

function injectSessionMessage(session: InMemoryChatSession, message: ChatMessage): void {
  session.messages.push(message);
  session.updatedAt = message.timestamp || new Date().toISOString();
  if (!session.title && session.messages.some((entry) => entry.role === "assistant")) {
    session.title = deriveSessionTitleFromMessages(
      session.messages,
      agentManager.get(session.agentId)?.name
    );
  }
  if (session.persisted) {
    void logSessionMessage(session.id, message.role, message.content, {
      agentId: session.agentId,
      createdAt: message.timestamp,
      metadata: {
        source: "session_injection",
        ...(resolveSessionModelMetadata(session.agentId) ?? {}),
      },
    });
    upsertPersistedSessionIndex({
      id: session.id,
      agentId: session.agentId,
      title: session.title,
      messageCount: countVisibleSessionMessages(session.messages),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      workspaceDir: session.workspaceDir ?? null,
      lastMessage: buildLastMessagePreview(message),
    });
  }
  log.debug("Injected message into session", { sessionId: session.id });
}

function flushDeferredSessionMessages(sessionKey: string): void {
  const messages = deferredSessionMessages.get(sessionKey);
  if (!messages?.length) return;
  deferredSessionMessages.delete(sessionKey);
  const session = getResidentChatSession(sessionKey);
  if (!session) return;
  const deliveredAt = Date.now();
  messages.forEach((message, index) => {
    injectSessionMessage(session, {
      ...message,
      timestamp: new Date(deliveredAt + index).toISOString(),
    });
  });
}

export function sendToSession(sessionKey: string, message: ChatMessage): boolean {
  const session = getResidentChatSession(sessionKey);
  if (session) {
    if (chatTurnMutex.isLocked(sessionKey)) {
      const queued = deferredSessionMessages.get(sessionKey) || [];
      queued.push(message);
      deferredSessionMessages.set(sessionKey, queued);
      return true;
    }
    injectSessionMessage(session, message);
    return true;
  }
  log.debug("Session not in memory, skipping announcement", {
    sessionId: sessionKey,
  });
  return false;
}
