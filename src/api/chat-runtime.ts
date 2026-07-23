import { agentManager } from "../core/agent";
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
import {
  buildMemoryFlushMessages,
  formatToolResultPromptBlock,
} from "../core/chat-token-optimization";
import { stopComputerUseTrajectoryForSession } from "../core/computer-use";
import { config } from "../core/config";
import { hasImages, sanitizeAgentImages } from "../core/llm/image-blocks";
import { sanitizeAssistantContent } from "../core/llm/text-tool-calls";
import { createLogger } from "../core/logger";
import { logAgentActivity, logSessionMessage } from "../core/logging";
import { resolveMemoryFlushSettings, shouldRunMemoryFlush } from "../core/memory/flush";
import {
  trackContextCompaction,
  trackMemoryFlush,
  trackSessionEvent,
  trackSessionTokens,
} from "../core/metrics";
import { expandPromptCommand } from "../core/prompt-commands";
import { providerManager } from "../core/providers";
import {
  compactContext,
  estimateMessagesTokens,
  estimateSessionContextUsage,
  getContextWindow,
  normalizeSessionWorkspaceDir,
  persistSession,
  resolveSessionModelMetadata,
  type SessionModelMetadata,
  setPersistedSessionAgent,
  shouldCompactContext,
  summarizeSessionTokenUsage,
  upsertPersistedSessionMessage,
} from "../core/session-context";
import {
  getActiveSessionRunId,
  getActiveSessionRunStartedAtMs,
} from "../core/session-event-ledger";
import { handleSessionGoalCommand } from "../core/session-goals";
import { extractLatestSessionPlan } from "../core/session-plan";
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
import {
  checkCircuit,
  checkRateLimit,
  recordCircuitFailure,
  recordCircuitSuccess,
} from "../core/tools/index";
import { resolveAgentToolPolicy } from "../core/toolsets";
import {
  activeAgentSystemPrompt,
  applyActiveAgentToSession,
  refreshSessionAgentSystemPromptIfNeeded,
} from "./chat-agent-prompt";
import { buildChatExecutionMessagesForAgent } from "./chat-execution-messages";
import { executionMetadataFromResult } from "./chat-execution-metadata";
import { sanitizeProcessThoughtText, stripThinkingTags } from "./chat-formatting";
import { appendToolImageReferences, maybeSaveAutomaticMemory } from "./chat-response-enrichment";
import { recoverAssistantResponse } from "./chat-response-recovery";
import { settlePendingChatFailure } from "./chat-pending-failure";
import {
  deletePersistedPendingChatItem,
  persistPendingChatItem,
  persistPendingChatItems,
} from "./chat-pending-store";
import {
  findMaterializedPendingMessage,
  findAssistantResponseAfterPendingMessage,
  hasPendingChatMessages,
  materializePendingMessage,
  nextPendingChatSequence,
  pendingChatSnapshot,
  pendingChatSnapshots,
  preparePendingMessage,
  removePendingChatQueueItem,
  restorePendingChatQueueState,
  syncPendingChatStatus,
} from "./chat-pending-state";
import {
  buildFallbackProcessActivities,
  dedupeProcessActivities,
  type ProcessActivityInfo,
  type ToolCallInfo,
} from "./chat-process-activities";
import { pendingChatDrainRetryDelay } from "./chat-runtime-stability";
import {
  activeChatTurnAbortControllers,
  buildLastMessagePreview,
  cacheChatSession,
  chatRateLimitConfig,
  chatTurnMutex,
  cleanGeneratedSessionTitle,
  countVisibleSessionMessages,
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
  restorePersistedChatSessionForChat,
  stoppedChatTurnControllers,
  upsertPersistedSessionIndex,
} from "./chat-runtime-state";
import {
  collectAttachedProcessActivityIds,
  getSessionProcessActivities,
  materializeInterruptedAssistantBeforeSteering,
  sanitizeObservedProcessActivities,
} from "./chat-steering-activities";
import { constrainToolsForMessage } from "./chat-tool-constraints";
import {
  buildNoUsableAssistantResponseMessage,
  buildToolExecutionFallbackMessage,
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

export type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  SteerPendingChatMessageOptions,
} from "./chat-types";

function createPendingChatCompletion(id: string): void {
  let resolveCompletion: ((response: ChatResponse) => void) | null = null;
  let rejectCompletion: ((error: unknown) => void) | null = null;
  const promise = new Promise<ChatResponse>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  if (!resolveCompletion || !rejectCompletion) {
    throw new Error("Unable to initialize pending chat completion");
  }
  pendingChatCompletions.set(id, {
    promise,
    resolve: resolveCompletion,
    reject: rejectCompletion,
  });
}

function resolvePendingChatCompletion(id: string, response: ChatResponse): void {
  const completion = pendingChatCompletions.get(id);
  if (!completion) return;
  pendingChatCompletions.delete(id);
  completion.resolve(response);
}

function rejectPendingChatCompletion(id: string, error: unknown): void {
  const completion = pendingChatCompletions.get(id);
  if (!completion) return;
  pendingChatCompletions.delete(id);
  completion.reject(error);
}

export async function waitForPendingChatCompletion(id: string): Promise<ChatResponse> {
  const completion = pendingChatCompletions.get(id);
  if (!completion) throw new Error("Pending chat completion was not registered");
  try {
    return await completion.promise;
  } finally {
    pendingChatCompletions.delete(id);
  }
}

function isChatTurnInterrupted(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (error instanceof DOMException) return error.name === "AbortError";
  return (
    !!error &&
    typeof error === "object" &&
    "name" in error &&
    (error as Error).name === "AbortError"
  );
}

function interruptActiveChatTurnForSteering(sessionId: string, pendingSteeringId: string): boolean {
  const controller = activeChatTurnAbortControllers.get(sessionId);
  if (!controller || controller.signal.aborted) return false;
  interruptedChatTurnSteeringIds.set(controller, pendingSteeringId);
  controller.abort(new DOMException("Chat turn interrupted by user steering", "AbortError"));
  return true;
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
  if (activeChatTurnAbortControllers.get(sessionId) === controller) {
    activeChatTurnAbortControllers.delete(sessionId);
  }
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
  const materializedMessage = materializeInterruptedAssistantBeforeSteering(session, undefined, {
    ...(pendingSteeringId ? { pendingSteeringId } : {}),
  });
  if (materializedMessage) {
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
    detail: "Steering to follow-up...",
    sessionId: session.id,
    agentId: agent.id,
  });
  return {
    sessionId: session.id,
    workspaceDir: session.workspaceDir ?? null,
    interrupted: true,
    plan: extractLatestSessionPlan(session.id, session.messages),
    message: {
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
    },
    agent: {
      id: agent.id,
      name: agent.name,
    },
  };
}

function enqueuePendingChatMessage(
  request: ChatRequest,
  sessionId: string,
  mode: "queued" | "steering"
): ChatResponse {
  const now = Date.now();
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

function schedulePendingChatDrain(sessionId: string, delayMs = 0): void {
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

function finalizeStoppedProcessActivity(activity: ProcessActivityInfo): ProcessActivityInfo {
  if (activity.phase !== "start") return activity;
  return {
    ...activity,
    phase: "blocked",
    text: `Stopped: ${activity.text}`,
  };
}

function materializeStoppedAssistantTurn(session: InMemoryChatSession): ChatMessage | undefined {
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
    ...(observed || []).map(finalizeStoppedProcessActivity),
  ]);
  if (activities.length === 0) return existing;
  if (existing) {
    existing.process_activities = activities;
    return existing;
  }
  const userTimestamp = parseIsoTimestampMs(session.messages[latestUserIndex]?.timestamp);
  const assistantMessage: ChatMessage = {
    role: "assistant",
    content: "",
    timestamp: new Date(Math.max(Date.now(), (userTimestamp ?? 0) + 1)).toISOString(),
    process_activities: activities,
  };
  session.messages.splice(latestUserIndex + 1, 0, assistantMessage);
  session.updatedAt = assistantMessage.timestamp || new Date().toISOString();
  return assistantMessage;
}

async function persistStoppedAssistantTurn(
  session: InMemoryChatSession
): Promise<ChatMessage | undefined> {
  const stoppedMessage = materializeStoppedAssistantTurn(session);
  if (!stoppedMessage) return undefined;
  const latestUser = [...session.messages]
    .slice(0, session.messages.indexOf(stoppedMessage))
    .reverse()
    .find((message) => message.role === "user");
  await upsertPersistedSessionMessage(session.id, session.agentId, stoppedMessage, {
    stableKey: `stopped:${latestUser?.timestamp || stoppedMessage.timestamp || session.id}`,
    metadata: { source: "chat_stopped" },
  });
  await persistChatSessionSnapshot(session, stoppedMessage);
  persistActiveSessionContext(session);
  return stoppedMessage;
}

function queuedMaterializedSteeringIds(sessionId: string): Set<string> {
  return new Set(
    (pendingChatQueues.get(sessionId) || [])
      .filter((item) => item.mode === "steering" && item.materialized === true)
      .map((item) => item.id)
  );
}

function appendAssistantMessage(session: InMemoryChatSession, assistantMessage: ChatMessage): void {
  const queuedSteeringIds = queuedMaterializedSteeringIds(session.id);
  const trailingSteeringMessages: ChatMessage[] = [];
  while (session.messages.length > 0) {
    const last = session.messages[session.messages.length - 1];
    const pendingSteeringId = last?._pendingSteeringId;
    if (!pendingSteeringId || !queuedSteeringIds.has(pendingSteeringId)) break;
    const removed = session.messages.pop();
    if (removed) trailingSteeringMessages.unshift(removed);
  }
  session.messages.push(assistantMessage, ...trailingSteeringMessages);
  const lastMessage = session.messages[session.messages.length - 1] || assistantMessage;
  session.updatedAt =
    lastMessage.timestamp || assistantMessage.timestamp || new Date().toISOString();
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
  syncPendingChatStatus(sessionId);
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
      agentId: next.request.agentId,
    });
    const response = await runChatTurnWithQueueDrain(
      {
        ...next.request,
        message: next.content,
        sessionId,
        queueMode: "queue",
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

function runChatTurnWithQueueDrain(
  request: ChatRequest,
  effectiveSessionId: string
): Promise<ChatResponse> {
  const result = chatTurnMutex.run(effectiveSessionId, () =>
    handleChatTurn(request, effectiveSessionId)
  );
  const finalized = result.then(
    async (response) => {
      await stopComputerUseTrajectoryForSession(
        effectiveSessionId,
        response.interrupted ? "interrupted" : "completed"
      );
      return response;
    },
    async (error: unknown) => {
      await stopComputerUseTrajectoryForSession(
        effectiveSessionId,
        "error",
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  );
  void finalized
    .finally(() => {
      flushDeferredSessionMessages(effectiveSessionId);
      schedulePendingChatDrain(effectiveSessionId);
    })
    .catch(() => undefined);
  return finalized;
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
    return {
      sessionId: effectiveSessionId,
      message: {
        role: "assistant",
        content: goalCommand.response || "",
        timestamp: new Date().toISOString(),
      },
    };
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
    agentId: item.request.agentId,
  });
  return {
    success: true,
    message: materializedMessage,
    ...(interruptedMessage ? { interruptedMessage } : {}),
    pendingMessages,
  };
}

setTimeout(() => restorePersistedPendingChatQueues(), 1200);

async function handleChatTurn(
  request: ChatRequest,
  effectiveSessionId: string
): Promise<ChatResponse> {
  const { message, agentId, tools = true, channel, userId, source, workspaceDir } = request;
  let useModelRouter = request.useModelRouter === true;
  const requestedModelOverride =
    typeof request.modelOverride === "string" && request.modelOverride.trim()
      ? request.modelOverride.trim()
      : undefined;
  const requestedWorkspaceDir =
    workspaceDir !== undefined ? normalizeSessionWorkspaceDir(workspaceDir) : undefined;

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
            {
              useTools: tools,
            }
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
      {
        useTools: tools,
      }
    );
    await setPersistedSessionAgent(session.id, requestedAgent.id);
  }

  let agent = agentManager.get(session.agentId);
  if (agent && !isNewSession) {
    await refreshSessionAgentSystemPromptIfNeeded(
      session,
      agent,
      [...session.messages, { role: "user", content: message }],
      {
        useTools: tools,
      }
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
  const isMaterializedSteeringTurn = !!userMessage;
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
  const consumedSteeringCompletionIds = new Set<string>();
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
    const generatedTitle = await generateSessionTitleViaModel({
      provider,
      agent,
      sessionId: session.id,
      userMessage: message,
      channel,
      userId,
      workspaceDir: session.workspaceDir,
      abortSignal: turnAbortController.signal,
    });
    session.title = cleanGeneratedSessionTitle(agent?.name, generatedTitle);
    if (!session.title) {
      session.title = cleanGeneratedSessionTitle(agent?.name, deriveSessionTitleFromTurn(message));
    }
  }

  if (agent && turnAbortController.signal.aborted) {
    if (isStoppedChatTurn(turnAbortController)) {
      return finishStoppedChatTurn(session, agent, turnAbortController);
    }
    return finishInterruptedChatTurn(session, agent, turnAbortController);
  }

  if (!imageRoutingError && provider && agent) {
    const effectiveModel = requestedModelOverride || agent.model;
    const contextWindow = getContextWindow(effectiveModel);
    const currentTokens = estimateMessagesTokens(session.messages);
    const flushSettings = resolveMemoryFlushSettings();

    trackSessionTokens(session.id, currentTokens, contextWindow, effectiveModel, {
      messageCount: session.messages.length,
    });

    if (
      flushSettings &&
      shouldRunMemoryFlush({
        totalTokens: currentTokens,
        contextWindowTokens: contextWindow,
        softThresholdTokens: flushSettings.softThresholdTokens,
        lastFlushCompactionCount: session.lastFlushCompactionCount,
        currentCompactionCount: session.compactionCount || 0,
      })
    ) {
      log.info("Running pre-compaction memory flush", {
        sessionId: session.id,
        currentTokens,
        contextWindow,
      });
      const flushStartTime = Date.now();

      try {
        const flushMessages = buildMemoryFlushMessages(session.messages, flushSettings.prompt);

        const flushResult = await agentManager.callLLM(
          provider,
          effectiveModel,
          flushMessages,
          [],
          {
            agentId: agent.id,
            sessionId: session.id,
            channel,
            userId,
            workspaceDir: session.workspaceDir || undefined,
            suppressStreaming: true,
          }
        );

        session.lastFlushCompactionCount = session.compactionCount || 0;

        trackMemoryFlush(session.id, true, {
          tokensBeforeFlush: currentTokens,
          compactionCount: session.compactionCount || 0,
          durationMs: Date.now() - flushStartTime,
        });
        trackSessionEvent(session.id, "memory_flushed", {
          model: effectiveModel,
        });

        log.info("Memory flush completed", {
          sessionId: session.id,
          preview: flushResult.content.substring(0, 100),
        });
      } catch (flushError) {
        log.exception("Memory flush failed", flushError, {
          sessionId: session.id,
        });
        trackMemoryFlush(session.id, false, {
          tokensBeforeFlush: currentTokens,
          compactionCount: session.compactionCount || 0,
        });
      }
    }

    const contextCheck = shouldCompactContext(session.messages, effectiveModel);

    if (contextCheck.needed) {
      log.info("Context compaction needed", {
        sessionId: session.id,
        currentTokens: contextCheck.currentTokens,
        maxTokens: contextCheck.maxTokens,
      });
      const compactionStart = Date.now();
      const messagesBefore = session.messages.length;
      const tokensBefore = estimateMessagesTokens(session.messages);

      broadcastStatus({
        status: "compacting",
        sessionId: session.id,
        agentId: agent.id,
        timestamp: Date.now(),
        detail: "Summarizing earlier conversation to continue...",
      });

      const compaction = await compactContext(session.messages, effectiveModel, agent.provider_id);
      if (compaction.wasCompacted) {
        session.messages = compaction.messages;
        session.compactionCount = (session.compactionCount || 0) + 1;
        persistActiveSessionContext(session);

        const tokensAfter = estimateMessagesTokens(session.messages);
        trackContextCompaction(session.id, {
          messagesBefore,
          messagesAfter: session.messages.length,
          tokensBefore,
          tokensAfter,
          model: agent.model,
          durationMs: Date.now() - compactionStart,
        });
        trackSessionEvent(session.id, "compacted", { model: effectiveModel });

        log.info("Context compacted", {
          sessionId: session.id,
          summaryPreview: compaction.summary?.slice(0, 100),
        });
        broadcastStatus({
          status: "thinking",
          sessionId: session.id,
          agentId: agent.id,
          timestamp: Date.now(),
          detail: `Context compacted · ${Math.max(0, tokensBefore - tokensAfter).toLocaleString()} tokens freed`,
        });
      }
    }
  }

  let responseContent: string;
  let executionModelMetadata: SessionModelMetadata | null = null;
  const thinkingContent: string = "";
  const allToolCalls: ToolCallInfo[] = [];
  const agentTransfers: AgentTransferEnvelope[] = [];

  if (imageRoutingError) {
    responseContent = imageRoutingError;
  } else if (provider && agent) {
    try {
      const circuit = checkCircuit(`llm:${provider.id}`);
      if (!circuit.allowed) {
        throw new Error(`LLM circuit breaker open for provider ${provider.id}`);
      }

      const capabilityMentions = await resolveChatCapabilityMentions(
        message,
        session.workspaceDir || undefined
      );
      const shouldPreferArtifacts = tools && shouldPreferArtifactsForMessage(message);
      const directToolCandidate = tools ? requiredDirectToolForMessage(message) : undefined;
      const selectedSkill = capabilityMentions.mentions.some((mention) => mention.kind === "skill");
      let activeModelOverride = requestedModelOverride;
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
      let allowedToolNames = tools
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
        tools &&
          (shouldPreferArtifacts ||
            requiredDirectToolName ||
            selectedSkill ||
            capabilityMentions.mentions.some((mention) => mention.kind === "mcp"))
      );
      let result = await agentManager.execute(agent.id, executionMessages, {
        useTools: tools,
        sessionId: session.id,
        requireToolUse: shouldRequireToolUse,
        requiredToolName,
        workspaceDir: session.workspaceDir || undefined,
        abortSignal: turnAbortController.signal,
        consumeSteeringMessages: consumeSteeringMessagesForActiveTurn,
        useModelRouter,
        modelOverride: activeModelOverride,
        allowedToolNames,
      });
      executionModelMetadata = executionMetadataFromResult(result);
      let toolResults = result.tool_calls || [];
      const maximumTransferDepth = 4;

      while (true) {
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
          useTools: tools,
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
        const targetCircuit = checkCircuit(`llm:${provider.id}`);
        if (!targetCircuit.allowed) {
          result = {
            ...result,
            content: `${targetAgent.name} is temporarily unavailable. Choose another agent to continue.`,
          };
          break;
        }

        activeModelOverride = undefined;
        activeSupportsImages = agentSupportsImages(targetAgent);
        allowedToolNames = tools
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
          tools &&
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
          useTools: tools,
          sessionId: session.id,
          requireToolUse: shouldRequireToolUse,
          requiredToolName,
          workspaceDir: session.workspaceDir || undefined,
          abortSignal: turnAbortController.signal,
          consumeSteeringMessages: consumeSteeringMessagesForActiveTurn,
          useModelRouter,
          allowedToolNames,
        });
        executionModelMetadata = executionMetadataFromResult(result);
        toolResults.push(...(result.tool_calls || []));
      }
      responseContent = result.content;
      responseContent = extractVisibleClarification(toolResults) || responseContent;

      const recoveredResponse = await recoverAssistantResponse({
        agentId: agent.id,
        executeOptions: {
          sessionId: session.id,
          workspaceDir: session.workspaceDir || undefined,
          abortSignal: turnAbortController.signal,
          consumeSteeringMessages: consumeSteeringMessagesForActiveTurn,
          useModelRouter,
          modelOverride: activeModelOverride,
          allowedToolNames,
        },
        executionMessages,
        requiredToolName,
        responseContent,
        shouldRequireToolUse,
        toolResults,
        toolsEnabled: tools,
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
        executionModelMetadata = executionMetadataFromResult(recoveredResponse.result);
      }
      responseContent = recoveredResponse.responseContent;
      toolResults = recoveredResponse.toolResults;

      const memorySettings = config.getMemoryBehaviorSettings();
      void maybeRunBackgroundReview(
        {
          agentId: agent.id,
          sessionId: session.id,
          workspaceDir: session.workspaceDir || undefined,
        },
        responseContent,
        {
          disabled: !memorySettings.backgroundReviewEnabled,
          minIntervalMs: memorySettings.backgroundReviewMinIntervalMs,
          timeoutSeconds: memorySettings.backgroundReviewTimeoutSeconds,
        }
      ).catch(() => undefined);

      if (toolResults.length > 0) {
        const toonStructuredDataEnabled =
          config.getTokenOptimizationSettings().toonStructuredDataEnabled;
        for (const tc of toolResults) {
          const timelineIndex = allToolCalls.length;
          const outcome = classifyToolCallResult(tc.result);
          allToolCalls.push({
            id: `call_${crypto.randomUUID().slice(0, 8)}`,
            name: tc.name,
            args:
              tc.args && typeof tc.args === "object" && !Array.isArray(tc.args)
                ? (tc.args as Record<string, unknown>)
                : {},
            status: outcome.status,
            result: tc.result,
            error: outcome.error,
            duration: 0,
            timeline_index: timelineIndex,
          });
        }

        const toolResultsText = toolResults
          .map((tc) =>
            formatToolResultPromptBlock(tc.name, tc.result, {
              toonEnabled: toonStructuredDataEnabled,
              sessionId: session.id,
              toolCallId: typeof tc.id === "string" ? tc.id : undefined,
            })
          )
          .join("\n\n");

        if (!responseContent.trim()) {
          const providerForSummary = agent?.provider_id
            ? providerManager.getWithCredentials(agent.provider_id)
            : undefined;
          if (providerForSummary) {
            try {
              const finalResult = await agentManager.callLLM(
                providerForSummary,
                agent?.model,
                [
                  {
                    role: "user",
                    content: `The user asked: "${message}"\n\nTools completed:\n${toolResultsText}\n\nAnswer the user from these results. Do not call tools.`,
                  },
                ],
                [],
                {
                  agentId: agent.id,
                  sessionId: session.id,
                  channel,
                  userId,
                  workspaceDir: session.workspaceDir || undefined,
                  abortSignal: turnAbortController.signal,
                }
              );
              responseContent = finalResult.content;
            } catch {
              responseContent = buildToolExecutionFallbackMessage(toolResults);
            }
          } else {
            responseContent = buildToolExecutionFallbackMessage(toolResults);
          }
        }
      }

      if (provider) recordCircuitSuccess(`llm:${provider.id}`);
      log.info("LLM response received", {
        sessionId: session.id,
        preview: responseContent.substring(0, 100),
      });
    } catch (error) {
      if (isChatTurnInterrupted(error, turnAbortController.signal)) {
        if (isStoppedChatTurn(turnAbortController)) {
          const response = await finishStoppedChatTurn(session, agent, turnAbortController);
          for (const id of consumedSteeringCompletionIds) {
            resolvePendingChatCompletion(id, response);
          }
          return response;
        }
        const response = await finishInterruptedChatTurn(session, agent, turnAbortController);
        for (const id of consumedSteeringCompletionIds) {
          resolvePendingChatCompletion(id, response);
        }
        return response;
      }
      if (provider) recordCircuitFailure(`llm:${provider.id}`);
      log.error("LLM API error", {
        sessionId: session.id,
        error: (error as Error).message,
      });
      responseContent = `I encountered an error calling the LLM API: ${(error as Error).message}. Please check your provider configuration.`;
    } finally {
      clearActiveChatTurnAbortController(session.id, turnAbortController);
    }
  } else {
    responseContent =
      "No AI provider configured. Please add a provider (like MiniMax, OpenAI, or Ollama) to enable AI responses.";
  }

  responseContent = appendToolImageReferences(responseContent, allToolCalls);

  const { content: extractedContent, thinking: extractedThinking } =
    stripThinkingTags(responseContent);
  const cleanContent = sanitizeAssistantContent(extractedContent);
  const finalThinking = sanitizeProcessThoughtText(thinkingContent || extractedThinking);

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
    cleanContent.trim().length > 0
      ? cleanContent
      : allToolCalls.length > 0
        ? buildToolExecutionFallbackMessage(
            allToolCalls.map((toolCall) => ({
              name: toolCall.name,
              result: toolCall.result ?? null,
            }))
          )
        : buildNoUsableAssistantResponseMessage();

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
  };
  appendAssistantMessage(session, assistantMessage);
  if (!session.title || shouldRegenerateSessionTitle(session.title)) {
    session.title = cleanGeneratedSessionTitle(agent?.name, deriveSessionTitleFromTurn(message));
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

  const response: ChatResponse = {
    sessionId: session.id,
    workspaceDir: session.workspaceDir ?? null,
    contextUsage: estimateSessionContextUsage(
      session.messages,
      requestedModelOverride || agent?.model,
      {
        sessionId: session.id,
        compactionCount: session.compactionCount || 0,
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
