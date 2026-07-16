import { agentManager, type AgentMessage } from "../core/agent";
import { KeyedMutex } from "../core/keyed-mutex";
import { type AgentImage, hasImages, sanitizeAgentImages } from "../core/llm/image-blocks";
import { persistImageAttachments, hydrateImageDataFromPath } from "../core/chat/attachments";
import {
  applyChatCapabilityInstruction,
  resolveChatCapabilityMentions,
} from "../core/chat/capability-mentions";
import { mergeSessionTranscriptMessages } from "./session-transcript";
import { providerManager } from "../core/providers";
import { agentSupportsImages } from "../core/agent-image-capabilities";
import { config } from "../core/config";
import { resolveChannelAgentId } from "../core/channels/agent-selection";
import type { Agent } from "../core/database";
import { expandPromptCommand } from "../core/prompt-commands";
import { getActiveGoalContextLine, handleSessionGoalCommand } from "../core/session-goals";
import { extractLatestSessionPlan, type SessionPlanSnapshot } from "../core/session-plan";
import {
  checkCircuit,
  recordCircuitSuccess,
  recordCircuitFailure,
  checkRateLimit,
  getRateLimitStatus,
} from "../core/tools/index";
import { getSubagentSession } from "../core/tools/handlers/index";
import { getRunBySessionKey } from "../core/subagent-registry";
import { maybeRunBackgroundReview } from "../core/background-review";
import { logSessionMessage, logAgentActivity } from "../core/logging";
import {
  listPersistedSessionPage,
  listPersistedSessions,
  loadPersistedSession,
  setPersistedSessionPinned,
  setPersistedSessionAgent,
  shouldCompactContext,
  compactContext,
  clearSessionContextState,
  persistSession,
  persistSessionContextState,
  upsertPersistedSessionMessage,
  deletePersistedSession,
  estimateMessagesTokens,
  estimateSessionContextUsage,
  summarizeSessionTokenUsage,
  getContextWindow,
  normalizeSessionWorkspaceDir,
  resolveSessionModelMetadata,
  type PersistedSessionListEntry,
  type SessionContextUsage,
  type SessionModelMetadata,
  type SessionTokenUsage,
} from "../core/session-context";
import {
  deriveSessionTitleFromMessages,
  deriveSessionTitleFromTurn,
  normalizeSessionTitle,
  parseModelGeneratedSessionTitle,
  shouldRegenerateSessionTitle,
  stripSessionTitleAgentPrefix,
} from "../core/session-title";
import { handleMemorySave } from "../core/tools/handlers/memory";
import {
  trackSessionTokens,
  trackSessionEvent,
  trackContextCompaction,
  trackMemoryFlush,
} from "../core/metrics";
import { shouldRunMemoryFlush, resolveMemoryFlushSettings } from "../core/memory/flush";
import {
  broadcastStatus,
  broadcastStatusSnapshot,
  getSessionRunStatusSnapshot,
  getSessionStatusSnapshot,
  isSessionStatusActive,
  setSessionPendingChatMessages,
  setSessionStatusLivenessResolver,
  type PendingChatMessageSnapshot,
} from "../core/status";
import { emitAgentHook } from "../core/agent-hooks";
import { createLogger } from "../core/logger";
import { recordCompletedTrajectory } from "../core/agent-eval";
import {
  buildToolExecutionFallbackMessage,
  classifyToolCallResult,
  requiredDirectToolForMessage,
  shouldEnforceToolUseForMessage,
  shouldPreferArtifactsForMessage,
  suppressRecoveredWebFailureActivities,
} from "./chat-tool-summary";
import {
  buildMemoryFlushMessages,
  compactChatContentForPrompt,
  formatToolResultPromptBlock,
} from "../core/chat-token-optimization";
import { sanitizeProcessThoughtText, stripThinkingTags } from "./chat-formatting";
import {
  buildFallbackProcessActivities,
  dedupeProcessActivities,
  formatProcessActivityFromToolCall,
  type ProcessActivityInfo,
  type ToolCallInfo,
} from "./chat-process-activities";
import { sanitizeAssistantContent } from "../core/llm/text-tool-calls";
import { stopComputerUseTrajectoryForSession } from "../core/computer-use";
import { resolveAgentToolPolicy } from "../core/toolsets";
import { constrainToolsForMessage } from "./chat-tool-constraints";
import {
  buildAgentTransferMessages,
  findAgentTransferEnvelope,
  type AgentTransferEnvelope,
} from "../core/agent-transfer";
import {
  activeAgentSystemPrompt,
  applyActiveAgentToSession,
  refreshSessionAgentSystemPromptIfNeeded,
} from "./chat-agent-prompt";
import {
  pendingChatDrainRetryDelay,
  selectResidentChatSessionEvictions,
} from "./chat-runtime-stability";
export { stripThinkingTags } from "./chat-formatting";
export {
  formatProcessActivityFromToolCall,
  type ProcessActivityInfo,
  type ToolCallInfo,
} from "./chat-process-activities";
const log = createLogger("Chat");

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
  provider?: string;
  provider_id?: string;
  provider_name?: string;
  model?: string;
  agent_id?: string;
  agent_name?: string;
  agent_type?: string;
  thinking?: string;
  tool_calls?: ToolCallInfo[];
  process_activities?: ProcessActivityInfo[];
  agent_transfers?: AgentTransferEnvelope[];
  /** Optional image inputs (vision) attached to a user message. */
  images?: AgentImage[];
  image_context?: string;
  _pendingSteeringId?: string;
}

export interface ChatRequest {
  message: string;
  agentId?: string;
  sessionId?: string;
  modelOverride?: string;
  clientPendingId?: string;
  workspaceDir?: string;
  stream?: boolean;
  tools?: boolean;
  channel?: string;
  userId?: string;
  source?: string;
  queueMode?: "queue" | "steer";
  recordedUserMessageId?: string;
  useModelRouter?: boolean;
  awaitQueuedCompletion?: boolean;
  /** Optional image inputs (vision) for this user turn. */
  images?: AgentImage[];
}

export interface SteerPendingChatMessageOptions {
  processActivities?: unknown;
}

export interface ChatResponse {
  sessionId: string;
  message: ChatMessage;
  workspaceDir?: string | null;
  contextUsage?: SessionContextUsage;
  tokenUsage?: SessionTokenUsage;
  queued?: boolean;
  interrupted?: boolean;
  stopped?: boolean;
  pendingMessage?: PendingChatMessageSnapshot;
  pendingMessages?: PendingChatMessageSnapshot[];
  plan?: SessionPlanSnapshot | null;
  agent?: {
    id: string;
    name: string;
  };
  thinking?: string;
  tool_calls?: ToolCallInfo[];
}

export function buildChatExecutionMessagesForAgent(
  sessionMessages: ChatMessage[],
  options?: {
    sessionId?: string;
    materializedSteeringTurn?: boolean;
    supportsImages?: boolean;
    activeAgentId?: string;
  }
): AgentMessage[] {
  const supportsImages = options?.supportsImages !== false;
  const latestUserIndex = sessionMessages.findLastIndex((message) => message.role === "user");
  const previousUserIndex = sessionMessages.findLastIndex(
    (message, index) => message.role === "user" && index < latestUserIndex
  );
  const executionSource =
    options?.materializedSteeringTurn &&
    previousUserIndex >= 0 &&
    latestUserIndex > previousUserIndex
      ? [...sessionMessages.slice(0, previousUserIndex), ...sessionMessages.slice(latestUserIndex)]
      : sessionMessages;
  const executionMessages: AgentMessage[] = executionSource.map((sessionMessage) => {
    const content = compactChatContentForPrompt(sessionMessage);
    const imageContext = sessionMessage.image_context?.trim();
    return {
      role: sessionMessage.role,
      content:
        !supportsImages && sessionMessage.images?.length
          ? `${content}\n\n${
              imageContext
                ? `[Attached image analysis]\n${imageContext}`
                : "[Attached image unavailable to this text-only model]"
            }`
          : content,
      ...(supportsImages && sessionMessage.images
        ? { images: sessionMessage.images.map(hydrateImageDataFromPath) }
        : {}),
    };
  });

  const latestTransfer = sessionMessages
    .flatMap((sessionMessage) => sessionMessage.agent_transfers || [])
    .findLast((transfer) => transfer.toAgentId === options?.activeAgentId);
  if (latestTransfer) {
    const transferInstruction: AgentMessage = {
      role: "system",
      content: `The session transfer from ${latestTransfer.fromAgentName} to ${latestTransfer.toAgentName} is complete. You are ${latestTransfer.toAgentName}, the current active agent. Continue with the shared conversation and do not deny or simulate the completed transfer.`,
    };
    if (executionMessages[0]?.role === "system") {
      executionMessages.splice(1, 0, transferInstruction);
    } else {
      executionMessages.unshift(transferInstruction);
    }
  }

  const activeGoalLine = options?.sessionId ? getActiveGoalContextLine(options.sessionId) : null;
  if (activeGoalLine) {
    const goalInstruction: AgentMessage = {
      role: "system",
      content: activeGoalLine,
    };
    if (executionMessages[0]?.role === "system") {
      executionMessages.splice(1, 0, goalInstruction);
    } else {
      executionMessages.unshift(goalInstruction);
    }
  }

  if (options?.materializedSteeringTurn) {
    const steeringInstruction: AgentMessage = {
      role: "system",
      content:
        "The previous assistant turn was interrupted by user steering. Treat the latest user message as the active instruction. Do not continue abandoned earlier work unless the latest user message explicitly asks for it.",
    };
    if (executionMessages[0]?.role === "system") {
      executionMessages.splice(1, 0, steeringInstruction);
    } else {
      executionMessages.unshift(steeringInstruction);
    }
  }

  return executionMessages;
}

interface InMemoryChatSession {
  id: string;
  agentId: string;
  title: string | null;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  workspaceDir?: string | null;
  persisted: boolean;
  compactionCount?: number;
  lastFlushCompactionCount?: number;
}

function persistActiveSessionContext(session: InMemoryChatSession): void {
  if ((session.compactionCount || 0) <= 0) return;
  persistSessionContextState(session.id, session.messages, session.compactionCount || 0);
}

export interface ChatSessionAgentUpdate {
  success: true;
  sessionId: string;
  agentId: string;
  agentName: string;
  provider?: string;
  providerId?: string;
  providerName?: string;
  model?: string;
  contextUsage: SessionContextUsage;
  tokenUsage: SessionTokenUsage;
}

interface SessionLastMessagePreview {
  role: ChatMessage["role"];
  content: string;
}

const SESSION_LAST_MESSAGE_PREVIEW_MAX_CHARS = 500;

interface SessionListEntry {
  id: string;
  agentId: string;
  title: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  workspaceDir: string | null;
  pinned: boolean;
  lastMessage: SessionLastMessagePreview | null;
  modelMetadata: SessionModelMetadata | null;
}

type PersistedSessionIndexEntry = SessionListEntry;

const chatSessions = new Map<string, InMemoryChatSession>();
const persistedSessionIndex = new Map<string, PersistedSessionIndexEntry>();

// Serialize chat turns per session so two near-simultaneous messages to the same
// session (e.g. a user retry, or several channel messages) can't interleave
// their user/assistant pushes or race a mid-turn conversation compaction.
const chatTurnMutex = new KeyedMutex();
setSessionStatusLivenessResolver((sessionId) => chatTurnMutex.isLocked(sessionId));
const MAX_PENDING_CHAT_MESSAGES_PER_SESSION = 20;

interface PendingChatItem {
  id: string;
  sessionId: string;
  clientPendingId?: string;
  request: ChatRequest;
  content: string;
  createdAt: number;
  updatedAt: number;
  mode: "queued" | "steering";
  sequence: number;
  materialized?: boolean;
}

interface PendingChatCompletion {
  promise: Promise<ChatResponse>;
  resolve: (response: ChatResponse) => void;
  reject: (error: unknown) => void;
}

const pendingChatQueues = new Map<string, PendingChatItem[]>();
const pendingChatCompletions = new Map<string, PendingChatCompletion>();
const pendingChatDrainScheduled = new Set<string>();
const deferredSessionMessages = new Map<string, ChatMessage[]>();
const activeChatTurnAbortControllers = new Map<string, AbortController>();
const interruptedChatTurnSteeringIds = new WeakMap<AbortController, string>();
const stoppedChatTurnControllers = new WeakSet<AbortController>();
const residentChatSessionSizes = new Map<string, number>();
const residentChatSessionAccess = new Map<string, number>();
const MAX_RESIDENT_CHAT_SESSIONS = 24;
const MAX_RESIDENT_CHAT_SESSION_CHARS = 12_000_000;
let pendingChatSequence = 0;

function estimateResidentChatSessionChars(session: InMemoryChatSession): number {
  try {
    return JSON.stringify(session.messages).length;
  } catch {
    return session.messages.reduce(
      (total, message) => total + message.content.length + (message.thinking?.length || 0),
      0
    );
  }
}

function residentChatSessionIsProtected(sessionId: string): boolean {
  return (
    chatTurnMutex.isLocked(sessionId) ||
    hasPendingChatMessages(sessionId) ||
    activeChatTurnAbortControllers.has(sessionId) ||
    deferredSessionMessages.has(sessionId)
  );
}

function pruneResidentChatSessions(preferredSessionId?: string): void {
  const records = Array.from(chatSessions.values()).map((session) => ({
    id: session.id,
    persisted: session.persisted,
    estimatedChars:
      residentChatSessionSizes.get(session.id) ?? estimateResidentChatSessionChars(session),
    lastAccessedAt: residentChatSessionAccess.get(session.id) ?? 0,
    protected: session.id === preferredSessionId || residentChatSessionIsProtected(session.id),
  }));
  const evictions = selectResidentChatSessionEvictions(records, {
    maxSessions: MAX_RESIDENT_CHAT_SESSIONS,
    maxEstimatedChars: MAX_RESIDENT_CHAT_SESSION_CHARS,
  });
  for (const sessionId of evictions) {
    chatSessions.delete(sessionId);
    residentChatSessionSizes.delete(sessionId);
    residentChatSessionAccess.delete(sessionId);
  }
}

function cacheChatSession(session: InMemoryChatSession): void {
  chatSessions.set(session.id, session);
  residentChatSessionSizes.set(session.id, estimateResidentChatSessionChars(session));
  residentChatSessionAccess.set(session.id, Date.now());
  pruneResidentChatSessions(session.id);
}

function getResidentChatSession(sessionId: string): InMemoryChatSession | undefined {
  const session = chatSessions.get(sessionId);
  if (session) residentChatSessionAccess.set(sessionId, Date.now());
  return session;
}

function deleteResidentChatSession(sessionId: string): boolean {
  residentChatSessionSizes.delete(sessionId);
  residentChatSessionAccess.delete(sessionId);
  return chatSessions.delete(sessionId);
}

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
  pendingChatCompletions.get(id)?.resolve(response);
}

function rejectPendingChatCompletion(id: string, error: unknown): void {
  pendingChatCompletions.get(id)?.reject(error);
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
      session.title
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

function pendingChatSnapshot(item: PendingChatItem): PendingChatMessageSnapshot {
  return {
    id: item.id,
    sessionId: item.sessionId,
    ...(item.clientPendingId ? { clientPendingId: item.clientPendingId } : {}),
    content: item.content,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    mode: item.mode,
    sequence: item.sequence,
  };
}

function pendingChatSnapshots(sessionId: string): PendingChatMessageSnapshot[] {
  return (pendingChatQueues.get(sessionId) || [])
    .filter((item) => item.materialized !== true)
    .map(pendingChatSnapshot);
}

function syncPendingChatStatus(sessionId: string): PendingChatMessageSnapshot[] {
  const snapshots = pendingChatSnapshots(sessionId);
  setSessionPendingChatMessages(sessionId, snapshots);
  broadcastStatusSnapshot();
  return snapshots;
}

function hasPendingChatMessages(sessionId: string): boolean {
  return (pendingChatQueues.get(sessionId)?.length || 0) > 0;
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
    sequence: ++pendingChatSequence,
  };

  if (queue.length >= MAX_PENDING_CHAT_MESSAGES_PER_SESSION) {
    throw new Error("Pending message queue is full");
  }
  if (request.awaitQueuedCompletion) createPendingChatCompletion(item.id);

  queue.push(item);
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
  syncPendingChatStatus(session.id);

  for (const item of steeringItems) {
    let materializedMessage = findMaterializedSteeringMessage(session, item.id);
    if (!materializedMessage) {
      materializedMessage = materializeSteeringMessage(session, item);
    }
    delete materializedMessage._pendingSteeringId;
  }

  return steeringItems.map((item) => ({
    id: item.id,
    content: item.content,
    createdAt: item.createdAt,
  }));
}

function schedulePendingChatDrain(sessionId: string, delayMs = 0): void {
  if (pendingChatDrainScheduled.has(sessionId)) return;
  pendingChatDrainScheduled.add(sessionId);
  setTimeout(() => {
    pendingChatDrainScheduled.delete(sessionId);
    void drainPendingChatQueue(sessionId);
  }, delayMs);
}

function findMaterializedSteeringMessage(
  session: InMemoryChatSession,
  pendingMessageId: string
): ChatMessage | undefined {
  return session.messages.find(
    (message) => message.role === "user" && message._pendingSteeringId === pendingMessageId
  );
}

function materializeSteeringMessage(
  session: InMemoryChatSession,
  item: PendingChatItem
): ChatMessage {
  const existing = findMaterializedSteeringMessage(session, item.id);
  if (existing) return existing;

  const latestMessageTimestamp = session.messages.reduce((latest, message) => {
    const parsed = parseIsoTimestampMs(message.timestamp);
    return parsed ? Math.max(latest, parsed) : latest;
  }, 0);
  const timestamp = new Date(
    Math.max(item.updatedAt || item.createdAt, latestMessageTimestamp + 2)
  ).toISOString();
  const message: ChatMessage = {
    role: "user",
    content: item.content,
    timestamp,
    _pendingSteeringId: item.id,
    ...(hasImages(item.request.images) ? { images: item.request.images } : {}),
  };
  session.messages.push(message);
  session.updatedAt = timestamp;
  return message;
}

function collectAttachedProcessActivityIds(messages: ChatMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (!Array.isArray(message.process_activities)) continue;
    for (const activity of message.process_activities) {
      if (typeof activity.id === "string" && activity.id.trim()) {
        ids.add(activity.id);
      }
    }
  }
  return ids;
}

function getSessionProcessActivities(
  sessionId: string,
  options?: { excludeActivityIds?: Set<string> }
): ProcessActivityInfo[] | undefined {
  const snapshot = getSessionStatusSnapshot(sessionId);
  if (!snapshot || !Array.isArray(snapshot.activities) || snapshot.activities.length === 0) {
    return undefined;
  }
  const excludeActivityIds = options?.excludeActivityIds;
  const activities = snapshot.activities
    .filter((activity) => !excludeActivityIds?.has(activity.id))
    .map((activity) => ({
      id: activity.id,
      phase: activity.phase,
      text: activity.text,
      timestamp: activity.timestamp,
      toolName: activity.toolName,
      toolCallId: activity.toolCallId,
      sandboxProvider: activity.sandboxProvider,
    }));
  return sanitizeObservedProcessActivities(activities);
}

function sanitizeObservedProcessActivities(activities: unknown): ProcessActivityInfo[] | undefined {
  if (!Array.isArray(activities)) return undefined;
  const sanitized: ProcessActivityInfo[] = [];
  for (const entry of activities) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const rawText = typeof record.text === "string" ? record.text.trim() : "";
    const text = record.toolName === "__thought" ? sanitizeProcessThoughtText(rawText) : rawText;
    if (!text) continue;
    const timestamp =
      typeof record.timestamp === "number" && Number.isFinite(record.timestamp)
        ? record.timestamp
        : Date.now();
    const id =
      typeof record.id === "string" && record.id.trim()
        ? record.id.trim().slice(0, 160)
        : `${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
    const phase =
      record.phase === "start" ||
      record.phase === "result" ||
      record.phase === "error" ||
      record.phase === "blocked"
        ? record.phase
        : "result";
    const toolName =
      typeof record.toolName === "string" && record.toolName.trim()
        ? record.toolName.trim().slice(0, 120)
        : undefined;
    const toolCallId =
      typeof record.toolCallId === "string" && record.toolCallId.trim()
        ? record.toolCallId.trim().slice(0, 160)
        : undefined;
    const sandboxProvider =
      typeof record.sandboxProvider === "string" && record.sandboxProvider.trim()
        ? record.sandboxProvider.trim().slice(0, 80)
        : undefined;
    sanitized.push({
      id,
      phase,
      text: text.length > 1000 ? `${text.slice(0, 1000)}...` : text,
      timestamp,
      toolName,
      toolCallId,
      sandboxProvider,
    });
  }
  const deduped = dedupeProcessActivities(sanitized);
  return deduped.length > 0 ? deduped : undefined;
}

function isSteeringHandoffProcessActivity(activity: ProcessActivityInfo): boolean {
  const text = activity.text.trim().toLowerCase();
  return text === "steering to follow-up..." || text === "starting queued follow-up";
}

function buildSteeringCompletionActivity(
  pendingSteeringId: string | undefined,
  timestamp: number
): ProcessActivityInfo {
  return {
    id: pendingSteeringId ? `steered-${pendingSteeringId}` : `steered-${timestamp}`,
    phase: "result",
    text: "Conversation steered.",
    timestamp,
    toolName: "__steering",
  };
}

function materializeInterruptedAssistantBeforeSteering(
  session: InMemoryChatSession,
  observedActivities?: ProcessActivityInfo[],
  options?: { pendingSteeringId?: string; createEmptyBoundary?: boolean }
): ChatMessage | undefined {
  const pendingSteeringId = options?.pendingSteeringId;
  const isMatchingPendingMessage = (message: ChatMessage): boolean =>
    !!message._pendingSteeringId &&
    (!pendingSteeringId || message._pendingSteeringId === pendingSteeringId);
  const steeringIndex = session.messages.findIndex(
    (message) => message.role === "user" && isMatchingPendingMessage(message)
  );
  const existingInterruptedIndex = session.messages.findIndex(
    (message) =>
      message.role === "assistant" &&
      message.content.trim().length === 0 &&
      Array.isArray(message.process_activities) &&
      isMatchingPendingMessage(message)
  );
  const previousMessage = steeringIndex >= 0 ? session.messages[steeringIndex - 1] : undefined;
  const previousInterruptedAssistant =
    previousMessage?.role === "assistant" &&
    previousMessage.content.trim().length === 0 &&
    Array.isArray(previousMessage.process_activities) &&
    isMatchingPendingMessage(previousMessage)
      ? previousMessage
      : existingInterruptedIndex >= 0
        ? session.messages[existingInterruptedIndex]
        : undefined;

  if (steeringIndex < 0 && !previousInterruptedAssistant) return undefined;

  const steeringTimestampMs =
    (steeringIndex >= 0
      ? parseIsoTimestampMs(session.messages[steeringIndex]?.timestamp)
      : parseIsoTimestampMs(previousInterruptedAssistant?.timestamp)) || Date.now();
  const resolvedPendingSteeringId =
    pendingSteeringId || previousInterruptedAssistant?._pendingSteeringId;
  const interruptedActivities = dedupeProcessActivities([
    ...(observedActivities || []),
    ...(getSessionProcessActivities(session.id, {
      excludeActivityIds: previousInterruptedAssistant
        ? undefined
        : collectAttachedProcessActivityIds(session.messages),
    }) || []),
  ]).filter((activity) => !isSteeringHandoffProcessActivity(activity));
  const latestActivityTimestamp = interruptedActivities.reduce(
    (latest, activity) => Math.max(latest, activity.timestamp),
    0
  );
  const steeringCompletion = buildSteeringCompletionActivity(
    resolvedPendingSteeringId,
    Math.max(0, steeringTimestampMs - 1, latestActivityTimestamp + 1)
  );
  const processActivities = dedupeProcessActivities([...interruptedActivities, steeringCompletion]);

  if (previousInterruptedAssistant) {
    const merged = dedupeProcessActivities([
      ...(previousInterruptedAssistant.process_activities || []),
      ...processActivities,
    ]);
    previousInterruptedAssistant.process_activities = merged;
    return previousInterruptedAssistant;
  }

  const assistantMessage: ChatMessage = {
    role: "assistant",
    content: "",
    timestamp: new Date(Math.max(0, steeringTimestampMs - 1)).toISOString(),
    process_activities: processActivities,
    ...(pendingSteeringId ? { _pendingSteeringId: pendingSteeringId } : {}),
  };
  session.messages.splice(steeringIndex, 0, assistantMessage);
  const lastMessage = session.messages[session.messages.length - 1] || assistantMessage;
  session.updatedAt = lastMessage.timestamp || new Date().toISOString();
  return assistantMessage;
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
  const next = queue.shift();
  if (!next) {
    pendingChatQueues.delete(sessionId);
    syncPendingChatStatus(sessionId);
    return;
  }

  if (queue.length > 0) {
    pendingChatQueues.set(sessionId, queue);
  } else {
    pendingChatQueues.delete(sessionId);
  }
  syncPendingChatStatus(sessionId);

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
        recordedUserMessageId: next.materialized ? next.id : undefined,
      },
      sessionId
    );
    resolvePendingChatCompletion(next.id, response);
  } catch (error) {
    rejectPendingChatCompletion(next.id, error);
    log.exception("Queued chat turn failed", error, { sessionId });
    schedulePendingChatDrain(sessionId);
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

function truncateSessionPreviewContent(content: string): string {
  if (content.length <= SESSION_LAST_MESSAGE_PREVIEW_MAX_CHARS) return content;
  return `${content.slice(0, SESSION_LAST_MESSAGE_PREVIEW_MAX_CHARS)}...`;
}

function buildLastMessagePreview(message?: ChatMessage): SessionLastMessagePreview | null {
  if (!message) return null;
  return {
    role: message.role,
    content: truncateSessionPreviewContent(message.content),
  };
}

function normalizePersistedIndexEntry(
  entry: Omit<PersistedSessionIndexEntry, "title" | "lastMessage" | "pinned" | "modelMetadata"> & {
    title?: string | null;
    pinned?: boolean;
    lastMessage?: SessionLastMessagePreview | null;
    modelMetadata?: SessionModelMetadata | null;
  }
): PersistedSessionIndexEntry {
  const modelMetadata = entry.modelMetadata ?? resolveSessionModelMetadata(entry.agentId);
  return {
    ...entry,
    title: stripSessionTitleAgentPrefix(entry.title, [modelMetadata?.agent_name, entry.agentId]),
    // Preserve an existing pin when the caller doesn't supply one, so unrelated
    // index updates (new messages, title regen, etc.) never clear it.
    pinned: entry.pinned ?? persistedSessionIndex.get(entry.id)?.pinned ?? false,
    lastMessage: entry.lastMessage
      ? {
          role: entry.lastMessage.role,
          content: truncateSessionPreviewContent(entry.lastMessage.content),
        }
      : null,
    modelMetadata,
  };
}

function upsertPersistedSessionIndex(
  entry: Omit<PersistedSessionIndexEntry, "title" | "lastMessage" | "pinned" | "modelMetadata"> & {
    title?: string | null;
    pinned?: boolean;
    lastMessage?: SessionLastMessagePreview | null;
    modelMetadata?: SessionModelMetadata | null;
  }
): void {
  persistedSessionIndex.set(entry.id, normalizePersistedIndexEntry(entry));
}

function countVisibleSessionMessages(messages: ChatMessage[]): number {
  return messages.reduce((count, message) => count + (message.role === "system" ? 0 : 1), 0);
}

async function persistChatSessionSnapshot(
  session: InMemoryChatSession,
  lastMessage?: ChatMessage
): Promise<boolean> {
  const modelMetadata = resolveSessionModelMetadata(session.agentId);
  session.persisted = await persistSession(
    session.id,
    session.agentId,
    session.messages,
    session.workspaceDir,
    session.title
  );
  upsertPersistedSessionIndex({
    id: session.id,
    agentId: session.agentId,
    title: session.title,
    messageCount: countVisibleSessionMessages(session.messages),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    workspaceDir: session.workspaceDir ?? null,
    lastMessage: buildLastMessagePreview(
      lastMessage ?? session.messages[session.messages.length - 1]
    ),
    modelMetadata,
  });
  cacheChatSession(session);
  return session.persisted;
}

function removePersistedSessionIndex(sessionId: string): void {
  persistedSessionIndex.delete(sessionId);
}

function buildMemorySessionListEntries(): SessionListEntry[] {
  return Array.from(chatSessions.values()).map((s) => {
    const modelMetadata = resolveSessionModelMetadata(s.agentId);
    return {
      id: s.id,
      agentId: s.agentId,
      title: shouldRegenerateSessionTitle(s.title)
        ? stripSessionTitleAgentPrefix(deriveSessionTitleFromMessages(s.messages), [
            modelMetadata?.agent_name,
            s.agentId,
          ])
        : stripSessionTitleAgentPrefix(s.title, [modelMetadata?.agent_name, s.agentId]),
      messageCount: countVisibleSessionMessages(s.messages),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt || s.createdAt,
      workspaceDir: s.workspaceDir ?? null,
      // In-memory sessions don't track pin state; inherit it from the persisted
      // index when the session has been saved.
      pinned: persistedSessionIndex.get(s.id)?.pinned ?? false,
      lastMessage: buildLastMessagePreview(s.messages[s.messages.length - 1]),
      modelMetadata,
    };
  });
}

function persistedSessionToIndexEntry(
  persisted: PersistedSessionListEntry
): PersistedSessionIndexEntry {
  return normalizePersistedIndexEntry({
    id: persisted.id,
    agentId: persisted.agentId,
    title: persisted.title,
    messageCount: persisted.messageCount,
    createdAt: persisted.createdAt,
    updatedAt: persisted.updatedAt,
    workspaceDir: persisted.workspaceDir ?? null,
    pinned: persisted.pinned,
    modelMetadata: persisted.modelMetadata ?? resolveSessionModelMetadata(persisted.agentId),
    lastMessage:
      persisted.lastMessageRole && persisted.lastMessageContent
        ? {
            role: persisted.lastMessageRole as ChatMessage["role"],
            content: persisted.lastMessageContent,
          }
        : null,
  });
}

function hydratePersistedSessionIndex(
  persistedSessions: PersistedSessionListEntry[],
  pruneMissing: boolean
): void {
  const persistedIds = new Set<string>();
  for (const persisted of persistedSessions) {
    persistedIds.add(persisted.id);
    persistedSessionIndex.set(persisted.id, persistedSessionToIndexEntry(persisted));
  }
  if (!pruneMissing) return;
  for (const existingId of persistedSessionIndex.keys()) {
    if (!persistedIds.has(existingId)) {
      removePersistedSessionIndex(existingId);
    }
  }
}

function sortSessionListEntries(sessions: SessionListEntry[]): SessionListEntry[] {
  // Pinned sessions first, then most-recently-updated. Keeps important chats
  // at the top regardless of activity.
  return sessions.sort(
    (a, b) =>
      (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) ||
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

async function restorePersistedChatSessionForChat(
  sessionId: string
): Promise<InMemoryChatSession | undefined> {
  try {
    const persisted = await loadPersistedSession(sessionId);
    if (!persisted || persisted.messages.length === 0) return undefined;
    const indexed = persistedSessionIndex.get(sessionId);
    const createdAt = indexed?.createdAt || new Date().toISOString();
    const modelMetadata = indexed?.modelMetadata ?? resolveSessionModelMetadata(persisted.agentId);
    const restored: InMemoryChatSession = {
      id: sessionId,
      agentId: persisted.agentId,
      title: stripSessionTitleAgentPrefix(persisted.title, [
        modelMetadata?.agent_name,
        persisted.agentId,
      ]),
      messages: persisted.contextMessages ?? persisted.messages,
      createdAt,
      updatedAt: indexed?.updatedAt || createdAt,
      workspaceDir: persisted.workspaceDir ?? indexed?.workspaceDir ?? null,
      persisted: true,
      compactionCount: persisted.compactionCount,
    };
    cacheChatSession(restored);
    log.info("Restored persisted session for chat turn", {
      sessionId,
      messages: (persisted.contextMessages ?? persisted.messages).length,
    });
    return restored;
  } catch {
    return undefined;
  }
}

async function loadPersistedSessions() {
  try {
    const sessions = await listPersistedSessions();

    hydratePersistedSessionIndex(sessions, true);

    if (sessions.length > 0) {
      log.info("Restored persisted session index", { count: sessions.length });
    }
  } catch (error) {
    log.exception("Failed to load persisted sessions", error);
  }
}

setTimeout(loadPersistedSessions, 1000);

const chatRateLimitConfig = { windowMs: 60000, maxRequests: 60 }; // 60 requests per minute

const SESSION_TITLE_MODEL_SYSTEM_PROMPT =
  "You generate concise chat session titles from a single user request. Return only the title text with no markdown, no quotes, and no preface. Use 3-10 words, concrete and specific. Avoid generic titles like Summary, Report, Session, Chat, or Response.";

function truncateForTitlePrompt(value: string, maxChars: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function parseIsoTimestampMs(value?: string): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

async function generateSessionTitleViaModel(params: {
  provider: ReturnType<typeof providerManager.getWithCredentials>;
  agent: NonNullable<ReturnType<typeof agentManager.get>> | undefined;
  sessionId: string;
  userMessage: string;
  channel?: string;
  userId?: string;
  workspaceDir?: string | null;
  abortSignal?: AbortSignal;
}): Promise<string | null> {
  const { provider, agent } = params;
  if (!provider || !agent) return null;

  try {
    const titleMessages: AgentMessage[] = [
      {
        role: "system",
        content: SESSION_TITLE_MODEL_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: [
          `Model: ${agent.model || "unknown"}`,
          `Agent: ${agent.name || "agent"}`,
          `User request: ${truncateForTitlePrompt(params.userMessage, 900)}`,
          "Generate the best session title now.",
        ].join("\n"),
      },
    ];

    const result = await agentManager.callLLM(provider, agent.model, titleMessages, [], {
      agentId: agent.id,
      sessionId: params.sessionId,
      channel: params.channel,
      userId: params.userId,
      workspaceDir: params.workspaceDir || undefined,
      abortSignal: params.abortSignal,
      // Title generation is a meta call — never stream its tokens/status into
      // the visible chat as if it were the assistant's reply.
      suppressStreaming: true,
    });
    return parseModelGeneratedSessionTitle(result.content);
  } catch (error) {
    log.warn("Session title model generation failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function cleanGeneratedSessionTitle(
  agentName: string | undefined,
  title: string | null
): string | null {
  return stripSessionTitleAgentPrefix(title, [agentName]);
}

export async function handleChat(request: ChatRequest): Promise<ChatResponse> {
  // Rate limiting and input validation touch no shared session state, so they
  // run outside the per-session lock.
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

  // Expand slash commands (e.g. /learn <url|prompt>) into a standards-guided
  // prompt handed to the agent as a normal turn. Done here so every client
  // (web, mobile, macOS, channels) gets the same commands with no extra wiring.
  const expandedCommand = expandPromptCommand(request.message);
  if (expandedCommand) {
    request = { ...request, message: expandedCommand };
  }

  // Serialize the turn per session. A provided sessionId is the contended key;
  // a new session gets a fresh id that is used as both the lock key and the
  // session id so the whole turn (create → push user → execute → push assistant
  // → persist) runs without interleaving.
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
    sequence: ++pendingChatSequence,
  }));
  const materializedItems = queue.filter((item) => item.materialized === true);

  pendingChatQueues.set(key, [...materializedItems, ...orderedVisibleItems]);
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

  const nextQueue = queue.filter((item) => item.id !== pendingMessageId);
  if (nextQueue.length > 0) {
    pendingChatQueues.set(key, nextQueue);
  } else {
    pendingChatQueues.delete(key);
  }
  const pendingMessages = syncPendingChatStatus(key);
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

  const item = queue[index];
  item.mode = "steering";
  item.updatedAt = Date.now();
  item.materialized = true;
  queue[index] = item;
  pendingChatQueues.set(key, queue);
  const materializedMessage = materializeSteeringMessage(session, item);
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
    stableKey: `steering:${item.id}`,
    metadata: { source: "chat_steering" },
  });
  session.persisted = await persistSession(
    session.id,
    session.agentId,
    session.messages,
    session.workspaceDir,
    session.title
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

async function handleChatTurn(
  request: ChatRequest,
  effectiveSessionId: string
): Promise<ChatResponse> {
  const { message, agentId, tools = true, channel, userId, source, workspaceDir } = request;
  const useModelRouter = request.useModelRouter === true;
  const requestedModelOverride =
    typeof request.modelOverride === "string" && request.modelOverride.trim()
      ? request.modelOverride.trim()
      : undefined;
  const requestedWorkspaceDir =
    workspaceDir !== undefined ? normalizeSessionWorkspaceDir(workspaceDir) : undefined;

  let session = getResidentChatSession(effectiveSessionId);
  if (!session) {
    // A miss for a previously-persisted id (gateway restart, memory eviction)
    // must restore history from the database — creating a fresh session here
    // silently clobbers the conversation on the next persist.
    session = await restorePersistedChatSessionForChat(effectiveSessionId);
  }
  const isNewSession = !session;

  if (!session) {
    // Resolve the agent for a brand-new session. Honor the explicit agentId if
    // provided; otherwise fall back to the user-configured default agent
    // (default_agent_id) before the arbitrary first agent. Channel handlers
    // (Discord/Slack/etc.) call handleChat WITHOUT an agentId, so without this
    // they'd silently land on agentManager.list()[0] — which may be an agent
    // whose provider token is expired (the source of spurious 401s in chat).
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
    ? findMaterializedSteeringMessage(session, recordedUserMessageId)
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
  const consumeSteeringMessagesForActiveTurn = () =>
    turnAbortController.signal.aborted ? [] : consumeSteeringMessages(session);
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
          [], // No tools - just let agent respond naturally (it can write to files if needed)
          {
            agentId: agent.id,
            sessionId: session.id,
            channel,
            userId,
            workspaceDir: session.workspaceDir || undefined,
            // Memory flush is a background meta call — don't stream it to chat.
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
      let result = await agentManager.execute(agent.id, executionMessages, {
        useTools: tools,
        sessionId: session.id,
        requireToolUse:
          shouldPreferArtifacts ||
          Boolean(requiredDirectToolName) ||
          selectedSkill ||
          capabilityMentions.mentions.some((mention) => mention.kind === "mcp"),
        requiredToolName,
        workspaceDir: session.workspaceDir || undefined,
        abortSignal: turnAbortController.signal,
        consumeSteeringMessages: consumeSteeringMessagesForActiveTurn,
        useModelRouter,
        modelOverride: activeModelOverride,
        allowedToolNames,
      });
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
          requireToolUse:
            shouldPreferArtifacts ||
            Boolean(requiredDirectToolName) ||
            selectedSkill ||
            capabilityMentions.mentions.some((mention) => mention.kind === "mcp"),
          requiredToolName,
          workspaceDir: session.workspaceDir || undefined,
          abortSignal: turnAbortController.signal,
          consumeSteeringMessages: consumeSteeringMessagesForActiveTurn,
          useModelRouter,
          allowedToolNames,
        });
        toolResults.push(...(result.tool_calls || []));
      }
      responseContent = result.content;

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

      const shouldForceToolExecution =
        tools &&
        (shouldEnforceToolUseForMessage(message) ||
          shouldPreferArtifacts ||
          Boolean(requiredDirectToolName));
      const hasRequiredToolCall = requiredToolName
        ? toolResults.some((toolCall) => toolCall.name === requiredToolName)
        : toolResults.length > 0;
      if (shouldForceToolExecution && (toolResults.length === 0 || !hasRequiredToolCall)) {
        try {
          const forcedInstruction = requiredToolName
            ? `Use the \`${requiredToolName}\` tool now to execute the request before responding. Perform concrete tool calls first, then summarize outcomes.`
            : "Execute the request now using available tools. Do not provide only a plan or intent. Perform concrete tool calls and then summarize the results.";
          const forcedMessages: AgentMessage[] = [
            ...executionMessages,
            {
              role: "user",
              content: forcedInstruction,
            },
          ];
          const forcedResult = await agentManager.execute(agent.id, forcedMessages, {
            useTools: true,
            sessionId: session.id,
            requireToolUse: true,
            requiredToolName,
            workspaceDir: session.workspaceDir || undefined,
            abortSignal: turnAbortController.signal,
            consumeSteeringMessages: consumeSteeringMessagesForActiveTurn,
            useModelRouter,
            modelOverride: activeModelOverride,
            allowedToolNames,
          });
          const forcedToolCalls = forcedResult.tool_calls || [];
          const forcedHasRequiredTool = requiredToolName
            ? forcedToolCalls.some((toolCall) => toolCall.name === requiredToolName)
            : forcedToolCalls.length > 0;
          if (forcedToolCalls.length > 0 && forcedHasRequiredTool) {
            result = forcedResult;
            responseContent = forcedResult.content;
            toolResults = [...toolResults, ...forcedToolCalls];
          }
        } catch (toolRetryError) {
          log.warn("Forced tool-execution retry failed", {
            sessionId: session.id,
            error: (toolRetryError as Error).message,
          });
        }
      }

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
          return await finishStoppedChatTurn(session, agent, turnAbortController);
        }
        return await finishInterruptedChatTurn(session, agent, turnAbortController);
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

  // Surface any image files produced by tools (e.g. computer_use/browser
  // screenshots) so channel adapters can attach them. We append a file:// link
  // for each image path not already referenced; the adapter extracts these,
  // attaches the file, and strips the marker from the visible text.
  const imageToolPaths = allToolCalls
    .map((tc) => (tc.result as { filePath?: unknown } | undefined)?.filePath)
    .filter((p): p is string => typeof p === "string" && /\.(png|jpe?g|gif|webp)$/i.test(p));
  for (const imgPath of [...new Set(imageToolPaths)]) {
    if (!responseContent.includes(imgPath)) {
      responseContent += `\n\n![screenshot](file://${imgPath})`;
    }
  }

  const { content: extractedContent, thinking: extractedThinking } =
    stripThinkingTags(responseContent);
  const cleanContent = sanitizeAssistantContent(extractedContent);
  const finalThinking = sanitizeProcessThoughtText(thinkingContent || extractedThinking);

  const memoryPatterns = [
    /(?:remember|save to memory|store this|note this|don't forget)(?: that |: )?(.+)/i,
    /(?:I'll|I will|I've) (?:already )?(?:saved|stored|remembered|noted)(?: that |: )?(.+)/i,
    /(?:I'll|I will|I've) (?:already )?(?:saved|stored|remembered|noted|keep that in mind|noted it)(?: that |: | for )?(.+)/i,
  ];

  if (allToolCalls.length === 0 && provider?.provider === "minimax") {
    for (const pattern of memoryPatterns) {
      const match = message.match(pattern);
      if (match && match[1] && match[1].length > 3 && match[1].length < 500) {
        try {
          await handleMemorySave({
            content: match[1].trim(),
            type: "context",
            tags: ["auto-saved"],
          });
          log.info("Auto-saved memory", {
            sessionId: session.id,
            preview: match[1].substring(0, 50),
          });
        } catch {
          // Ignore memory save errors
        }
        break;
      }
    }
  }

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
        : "Completed.";

  const modelMetadata = resolveSessionModelMetadata(agent?.id ?? session.agentId);

  const assistantMessage: ChatMessage = {
    role: "assistant",
    content: assistantContent,
    timestamp: assistantTimestamp,
    ...(modelMetadata ?? {}),
    thinking: finalThinking || undefined,
    tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
    process_activities: visibleProcessActivities,
    agent_transfers: agentTransfers.length > 0 ? agentTransfers : undefined,
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
    },
  });
  persistActiveSessionContext(session);

  // Only mark the session persisted when the write actually succeeded, so a
  // failed write is retried on the next turn instead of being silently lost.
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

  return {
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
}

export async function getSession(sessionId: string) {
  const session = getResidentChatSession(sessionId);
  if (session) {
    const modelMetadata = resolveSessionModelMetadata(session.agentId);
    if (shouldRegenerateSessionTitle(session.title)) {
      session.title = stripSessionTitleAgentPrefix(
        deriveSessionTitleFromMessages(session.messages),
        [modelMetadata?.agent_name, session.agentId]
      );
    } else {
      session.title = stripSessionTitleAgentPrefix(session.title, [
        modelMetadata?.agent_name,
        session.agentId,
      ]);
    }
    return session;
  }

  const subagentSession = getSubagentSession(sessionId);
  if (subagentSession) {
    return {
      id: subagentSession.id,
      agentId: "subagent",
      messages: subagentSession.messages.map((m) => ({
        role: m.role as ChatMessage["role"],
        content: m.content,
        timestamp: m.timestamp,
        thinking: m.thinking,
        tool_calls: m.tool_calls?.map((toolCall, index) => ({
          id: toolCall.id || `${sessionId}-tool-${index}`,
          name: toolCall.name,
          args: toolCall.args || {},
          status: toolCall.status || "completed",
          result: toolCall.result,
          timeline_index: toolCall.timeline_index,
        })),
        process_activities: m.process_activities,
      })),
      createdAt: subagentSession.createdAt,
      isSubagent: true,
      status: subagentSession.status,
      result: subagentSession.result,
    };
  }

  const persistedSubagentRun = getRunBySessionKey(sessionId);
  if (persistedSubagentRun) {
    const createdAt = new Date(persistedSubagentRun.createdAt).toISOString();
    const completedAt = persistedSubagentRun.endedAt
      ? new Date(persistedSubagentRun.endedAt).toISOString()
      : createdAt;
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: persistedSubagentRun.task,
        timestamp: createdAt,
      },
    ];
    if (persistedSubagentRun.outcome?.result || persistedSubagentRun.outcome?.error) {
      messages.push({
        role: "assistant",
        content:
          persistedSubagentRun.outcome.result || persistedSubagentRun.outcome.error || "No result",
        timestamp: completedAt,
        thinking: persistedSubagentRun.thinking,
        tool_calls: persistedSubagentRun.toolCalls?.map((toolCall, index) => ({
          id: toolCall.id || `${sessionId}-tool-${index}`,
          name: toolCall.name,
          args: toolCall.args || {},
          status: toolCall.status || "completed",
          result: toolCall.result,
          timeline_index: toolCall.timeline_index,
        })),
        process_activities: persistedSubagentRun.activities,
      });
    }
    return {
      id: sessionId,
      agentId: "subagent",
      messages,
      createdAt,
      isSubagent: true,
      status: persistedSubagentRun.outcome?.status || "running",
      result: persistedSubagentRun.outcome?.result,
    };
  }

  const indexed = persistedSessionIndex.get(sessionId);
  const persisted = await loadPersistedSession(sessionId);
  if (persisted) {
    const modelMetadata = indexed?.modelMetadata ?? resolveSessionModelMetadata(persisted.agentId);
    const resolvedTitle = shouldRegenerateSessionTitle(persisted.title)
      ? stripSessionTitleAgentPrefix(deriveSessionTitleFromMessages(persisted.messages), [
          modelMetadata?.agent_name,
          persisted.agentId,
        ])
      : stripSessionTitleAgentPrefix(persisted.title, [
          modelMetadata?.agent_name,
          persisted.agentId,
        ]);
    const createdAt = indexed?.createdAt || new Date().toISOString();
    const updatedAt = indexed?.updatedAt || createdAt;
    const workspaceDir = persisted.workspaceDir ?? indexed?.workspaceDir ?? null;
    const restoredSession = {
      id: sessionId,
      agentId: persisted.agentId,
      title: resolvedTitle,
      messages: persisted.contextMessages ?? persisted.messages,
      createdAt,
      updatedAt,
      workspaceDir,
      persisted: true,
      compactionCount: persisted.compactionCount,
    };
    cacheChatSession(restoredSession);
    upsertPersistedSessionIndex({
      id: sessionId,
      agentId: persisted.agentId,
      title: resolvedTitle,
      messageCount: countVisibleSessionMessages(persisted.messages),
      createdAt,
      updatedAt,
      workspaceDir,
      lastMessage: buildLastMessagePreview(persisted.messages[persisted.messages.length - 1]),
      modelMetadata,
    });
    return restoredSession;
  }

  if (indexed) {
    removePersistedSessionIndex(sessionId);
  }

  return undefined;
}

export async function updateSessionAgent(
  sessionId: string,
  agentId: string
): Promise<ChatSessionAgentUpdate> {
  const normalizedAgentId =
    typeof agentId === "string" && agentId.trim().length > 0 ? agentId.trim() : "";
  const agent = normalizedAgentId ? agentManager.get(normalizedAgentId) : undefined;
  if (!agent) {
    throw new Error("Agent not found");
  }

  await getSession(sessionId);
  const session = getResidentChatSession(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  await applyActiveAgentToSession(session, agent);
  const persistedAgent = await setPersistedSessionAgent(session.id, agent.id);
  if (!persistedAgent) {
    session.persisted = await persistSession(
      session.id,
      session.agentId,
      session.messages,
      session.workspaceDir,
      session.title
    );
  }
  persistActiveSessionContext(session);

  const modelMetadata = resolveSessionModelMetadata(agent.id);
  upsertPersistedSessionIndex({
    id: session.id,
    agentId: session.agentId,
    title: session.title,
    messageCount: countVisibleSessionMessages(session.messages),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    workspaceDir: session.workspaceDir ?? null,
    lastMessage: buildLastMessagePreview(session.messages[session.messages.length - 1]),
    modelMetadata,
  });

  return {
    success: true,
    sessionId: session.id,
    agentId: agent.id,
    agentName: agent.name,
    provider: modelMetadata?.provider,
    providerId: modelMetadata?.provider_id,
    providerName: modelMetadata?.provider_name,
    model: modelMetadata?.model,
    contextUsage: estimateSessionContextUsage(session.messages, agent.model, {
      sessionId: session.id,
      compactionCount: session.compactionCount || 0,
    }),
    tokenUsage: summarizeSessionTokenUsage(session.id),
  };
}

export async function getSessionMessages(sessionId: string): Promise<ChatMessage[]> {
  const session = await getSession(sessionId);
  if (!session) return [];
  if ("isSubagent" in session && session.isSubagent === true) return session.messages || [];
  const persisted = await loadPersistedSession(sessionId);
  if (!persisted) return session.messages || [];
  return mergeSessionTranscriptMessages(persisted.messages, session.messages || []);
}

function normalizeSessionPageOptions(options?: { limit?: number; offset?: number }): {
  limit?: number;
  offset: number;
} {
  const limit =
    typeof options?.limit === "number" && Number.isFinite(options.limit)
      ? Math.max(1, Math.floor(options.limit))
      : undefined;
  const offset =
    typeof options?.offset === "number" && Number.isFinite(options.offset)
      ? Math.max(0, Math.floor(options.offset))
      : 0;
  return { limit, offset };
}

function sliceSessionPage(
  sessions: SessionListEntry[],
  options?: { limit?: number; offset?: number }
) {
  const { limit, offset } = normalizeSessionPageOptions(options);
  if (!limit) {
    return sessions.slice(offset);
  }
  return sessions.slice(offset, offset + limit);
}

async function buildSessionListIndex(): Promise<SessionListEntry[]> {
  const memorySessions = buildMemorySessionListEntries();

  const persistedSessions = await listPersistedSessions();
  hydratePersistedSessionIndex(persistedSessions, true);

  const memoryMap = new Map(memorySessions.map((session) => [session.id, session]));
  for (const persisted of persistedSessionIndex.values()) {
    if (memoryMap.has(persisted.id)) continue;
    memorySessions.push({
      id: persisted.id,
      agentId: persisted.agentId,
      title: persisted.title,
      messageCount: persisted.messageCount,
      createdAt: persisted.createdAt,
      updatedAt: persisted.updatedAt,
      workspaceDir: persisted.workspaceDir,
      pinned: persisted.pinned,
      lastMessage: persisted.lastMessage,
      modelMetadata: persisted.modelMetadata,
    });
  }

  return sortSessionListEntries(memorySessions);
}

async function buildPersistedSessionPage(options: { limit: number; offset: number }): Promise<{
  sessions: SessionListEntry[];
  total: number;
}> {
  const memorySessions = buildMemorySessionListEntries();
  const transientSessions = memorySessions.filter(
    (session) => !persistedSessionIndex.has(session.id)
  );
  const queryOptions =
    transientSessions.length > 0 ? { limit: options.limit + options.offset, offset: 0 } : options;
  const page = await listPersistedSessionPage(queryOptions);
  hydratePersistedSessionIndex(page.sessions, false);
  const memoryById = new Map(memorySessions.map((session) => [session.id, session]));
  const persistedEntries = page.sessions.map((persisted) => {
    const memory = memoryById.get(persisted.id);
    return memory ?? persistedSessionToIndexEntry(persisted);
  });

  if (transientSessions.length === 0) {
    return {
      sessions: persistedEntries,
      total: page.total,
    };
  }

  const persistedIds = new Set(persistedEntries.map((session) => session.id));
  const uniqueTransientSessions = transientSessions.filter(
    (session) => !persistedIds.has(session.id)
  );
  const merged = sortSessionListEntries([...persistedEntries, ...uniqueTransientSessions]);
  return {
    sessions: merged.slice(options.offset, options.offset + options.limit),
    total: page.total + uniqueTransientSessions.length,
  };
}

export async function listSessions(options?: {
  limit?: number;
  offset?: number;
}): Promise<SessionListEntry[]> {
  const normalizedOptions = normalizeSessionPageOptions(options);
  if (normalizedOptions.limit) {
    const page = await buildPersistedSessionPage({
      limit: normalizedOptions.limit,
      offset: normalizedOptions.offset,
    });
    return page.sessions;
  }
  return sliceSessionPage(await buildSessionListIndex(), options);
}

export async function listSessionPage(options?: { limit?: number; offset?: number }): Promise<{
  sessions: SessionListEntry[];
  total: number;
  limit: number | null;
  offset: number;
  hasMore: boolean;
}> {
  const { limit, offset } = normalizeSessionPageOptions(options);
  if (limit) {
    const page = await buildPersistedSessionPage({ limit, offset });
    return {
      sessions: page.sessions,
      total: page.total,
      limit,
      offset,
      hasMore: offset + page.sessions.length < page.total,
    };
  }

  const sortedSessions = await buildSessionListIndex();
  const sessions = sliceSessionPage(sortedSessions, { limit, offset });
  return {
    sessions,
    total: sortedSessions.length,
    limit: limit ?? null,
    offset,
    hasMore: limit ? offset + sessions.length < sortedSessions.length : false,
  };
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  const memoryDeleted = deleteResidentChatSession(sessionId);

  const persistedDeleted = await deletePersistedSession(sessionId);
  if (memoryDeleted || persistedDeleted) {
    removePersistedSessionIndex(sessionId);
  }

  return memoryDeleted || persistedDeleted;
}

/**
 * Pin/unpin a session so it sorts to the top of the list. Persists to the DB
 * and keeps the in-memory index in sync so the next listSessions reflects it
 * immediately.
 */
export function getSessionPinned(sessionId: string): boolean {
  // Pin state lives in the persisted session index (what the list reads), not
  // on the in-memory session object — expose it so the session detail route
  // reports the same value the list does.
  return persistedSessionIndex.get(sessionId)?.pinned === true;
}

export async function setSessionPinned(
  sessionId: string,
  pinned: boolean
): Promise<{ found: boolean; pinned: boolean }> {
  const dbUpdated = await setPersistedSessionPinned(sessionId, pinned);
  const indexEntry = persistedSessionIndex.get(sessionId);
  if (indexEntry) {
    persistedSessionIndex.set(sessionId, { ...indexEntry, pinned });
  }
  const found = dbUpdated || !!indexEntry || chatSessions.has(sessionId);
  return { found, pinned };
}

function extractPersistedMessageMetadata(
  message: ChatMessage
): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {};
  if (typeof message.thinking === "string" && message.thinking.trim()) {
    metadata.thinking = message.thinking;
  }
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    metadata.tool_calls = message.tool_calls;
  }
  if (Array.isArray(message.process_activities) && message.process_activities.length > 0) {
    metadata.process_activities = message.process_activities;
  }
  if (Array.isArray(message.agent_transfers) && message.agent_transfers.length > 0) {
    metadata.agent_transfers = message.agent_transfers;
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

interface RevertSessionTarget {
  messageIndex?: number;
  messageRole?: ChatMessage["role"];
  messageContent?: string;
  messageTimestamp?: string;
}

function resolveRevertMessageIndex(messages: ChatMessage[], target: RevertSessionTarget): number {
  const desiredRole: ChatMessage["role"] =
    target.messageRole === "assistant" ? "assistant" : "user";
  const visibleIndexes = messages.reduce<number[]>((indexes, message, index) => {
    if (message.role !== "system") indexes.push(index);
    return indexes;
  }, []);
  const visibleCandidateIndex = Number.isInteger(target.messageIndex)
    ? Number(target.messageIndex)
    : -1;
  const candidateIndex = visibleIndexes[visibleCandidateIndex] ?? -1;
  const content = typeof target.messageContent === "string" ? target.messageContent.trim() : "";
  const timestamp =
    typeof target.messageTimestamp === "string" ? target.messageTimestamp.trim() : "";

  const isDesiredRole = (index: number): boolean =>
    index >= 0 && index < messages.length && messages[index]?.role === desiredRole;

  if (timestamp && content) {
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      if (!message || message.role !== desiredRole) continue;
      if ((message.timestamp || "") === timestamp && message.content === target.messageContent) {
        return index;
      }
    }
  }

  if (timestamp) {
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      if (!message || message.role !== desiredRole) continue;
      if ((message.timestamp || "") === timestamp) {
        return index;
      }
    }
  }

  if (content) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message || message.role !== desiredRole) continue;
      if (message.content === target.messageContent) {
        return index;
      }
    }
  }

  if (isDesiredRole(candidateIndex)) {
    return candidateIndex;
  }

  if (candidateIndex >= 0 && candidateIndex < messages.length) {
    for (let index = candidateIndex; index >= 0; index -= 1) {
      if (isDesiredRole(index)) return index;
    }
    for (let index = candidateIndex + 1; index < messages.length; index += 1) {
      if (isDesiredRole(index)) return index;
    }
  }

  return -1;
}

export async function revertSessionToMessage(
  sessionId: string,
  target: number | RevertSessionTarget
): Promise<{
  sessionId: string;
  messages: ChatMessage[];
  keptCount: number;
  removedCount: number;
  removedFromIndex: number;
}> {
  const session = await getSession(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  if ((session as { isSubagent?: boolean }).isSubagent) {
    throw new Error("Cannot revert subagent sessions");
  }

  const resolvedTarget: RevertSessionTarget =
    typeof target === "number" ? { messageIndex: target } : target;
  const targetIndex = resolveRevertMessageIndex(session.messages, resolvedTarget);
  if (targetIndex < 0 || targetIndex >= session.messages.length) {
    throw new Error("Unable to resolve target user message for revert");
  }

  const targetMessage = session.messages[targetIndex];
  if (!targetMessage || targetMessage.role !== "user") {
    throw new Error("Can only revert to a user message");
  }

  const keptMessages = session.messages.slice(0, targetIndex + 1);
  const visibleMessageCount = session.messages.filter(
    (message) => message.role !== "system"
  ).length;
  const keptCount = keptMessages.filter((message) => message.role !== "system").length;
  const removedCount = visibleMessageCount - keptCount;

  const inMemorySession = getResidentChatSession(sessionId);
  const agentId = inMemorySession?.agentId || session.agentId || "default";
  const sessionTitle =
    inMemorySession?.title !== undefined
      ? inMemorySession.title
      : "title" in session
        ? normalizeSessionTitle(session.title as string | null | undefined)
        : null;
  const createdAt = inMemorySession?.createdAt || session.createdAt || new Date().toISOString();
  const workspaceDir =
    inMemorySession?.workspaceDir !== undefined
      ? (inMemorySession.workspaceDir ?? null)
      : "workspaceDir" in session && typeof session.workspaceDir === "string"
        ? session.workspaceDir
        : null;

  if (inMemorySession) {
    inMemorySession.messages = keptMessages;
    inMemorySession.compactionCount = 0;
    inMemorySession.lastFlushCompactionCount = 0;
    inMemorySession.persisted = true;
    inMemorySession.updatedAt = new Date().toISOString();
  } else {
    cacheChatSession({
      id: sessionId,
      agentId,
      title: sessionTitle,
      messages: keptMessages,
      createdAt,
      updatedAt: new Date().toISOString(),
      workspaceDir,
      persisted: true,
    });
  }

  if (removedCount > 0) {
    clearSessionContextState(sessionId);
    await deletePersistedSession(sessionId);
    await persistSession(sessionId, agentId, keptMessages, workspaceDir, sessionTitle);
    for (const message of keptMessages) {
      if (message.role === "system") continue;
      await logSessionMessage(sessionId, message.role, message.content, {
        agentId,
        createdAt: message.timestamp,
        metadata: extractPersistedMessageMetadata(message),
      });
    }
    upsertPersistedSessionIndex({
      id: sessionId,
      agentId,
      title: sessionTitle,
      messageCount: keptCount,
      createdAt,
      updatedAt: new Date().toISOString(),
      workspaceDir,
      lastMessage: buildLastMessagePreview(keptMessages[keptMessages.length - 1]),
    });
  }

  return {
    sessionId,
    messages: keptMessages,
    keptCount,
    removedCount,
    removedFromIndex: keptCount,
  };
}

export function getChatRateLimitStatus() {
  return getRateLimitStatus("chat");
}

export async function updateSessionWorkspace(
  sessionId: string,
  workspaceDir: string | null
): Promise<{ sessionId: string; workspaceDir: string | null }> {
  const normalizedWorkspaceDir = normalizeSessionWorkspaceDir(workspaceDir);
  const session = await getSession(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  if ((session as { isSubagent?: boolean }).isSubagent) {
    throw new Error("Cannot update workspace for subagent sessions");
  }

  const inMemorySession = getResidentChatSession(sessionId);
  const agentId = inMemorySession?.agentId || session.agentId || "default";
  const sessionTitle =
    inMemorySession?.title !== undefined
      ? inMemorySession.title
      : "title" in session
        ? normalizeSessionTitle(session.title as string | null | undefined)
        : null;
  const createdAt = inMemorySession?.createdAt || session.createdAt || new Date().toISOString();
  const messages = session.messages || [];
  const updatedAt = new Date().toISOString();

  if (inMemorySession) {
    inMemorySession.workspaceDir = normalizedWorkspaceDir;
    inMemorySession.persisted = true;
    inMemorySession.updatedAt = updatedAt;
  } else {
    cacheChatSession({
      id: sessionId,
      agentId,
      title: sessionTitle,
      messages,
      createdAt,
      updatedAt,
      workspaceDir: normalizedWorkspaceDir,
      persisted: true,
    });
  }

  await persistSession(sessionId, agentId, messages, normalizedWorkspaceDir, sessionTitle);
  upsertPersistedSessionIndex({
    id: sessionId,
    agentId,
    title: sessionTitle,
    messageCount: countVisibleSessionMessages(messages),
    createdAt,
    updatedAt,
    workspaceDir: normalizedWorkspaceDir,
    lastMessage: buildLastMessagePreview(messages[messages.length - 1]),
  });
  return {
    sessionId,
    workspaceDir: normalizedWorkspaceDir,
  };
}

export async function updateSessionTitle(
  sessionId: string,
  title: string
): Promise<{ sessionId: string; title: string }> {
  const normalizedTitle = normalizeSessionTitle(title);
  if (!normalizedTitle) {
    throw new Error("Session title is required");
  }

  const session = await getSession(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }
  if ((session as { isSubagent?: boolean }).isSubagent) {
    throw new Error("Cannot update title for subagent sessions");
  }

  const inMemorySession = getResidentChatSession(sessionId);
  const agentId = inMemorySession?.agentId || session.agentId || "default";
  const createdAt = inMemorySession?.createdAt || session.createdAt || new Date().toISOString();
  const workspaceDir =
    inMemorySession?.workspaceDir !== undefined
      ? (inMemorySession.workspaceDir ?? null)
      : "workspaceDir" in session && typeof session.workspaceDir === "string"
        ? session.workspaceDir
        : null;
  const messages = session.messages || [];
  const updatedAt = new Date().toISOString();

  if (inMemorySession) {
    inMemorySession.title = normalizedTitle;
    inMemorySession.updatedAt = updatedAt;
    inMemorySession.persisted = true;
  } else {
    cacheChatSession({
      id: sessionId,
      agentId,
      title: normalizedTitle,
      messages,
      createdAt,
      updatedAt,
      workspaceDir,
      persisted: true,
    });
  }

  await persistSession(sessionId, agentId, messages, workspaceDir, normalizedTitle);
  upsertPersistedSessionIndex({
    id: sessionId,
    agentId,
    title: normalizedTitle,
    messageCount: countVisibleSessionMessages(messages),
    createdAt,
    updatedAt,
    workspaceDir,
    lastMessage: buildLastMessagePreview(messages[messages.length - 1]),
  });
  return { sessionId, title: normalizedTitle };
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
