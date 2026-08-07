import { type AgentMessage, agentManager } from "../core/agent";
import { KeyedMutex } from "../core/keyed-mutex";
import { createLogger } from "../core/logger";
import { providerManager } from "../core/providers";
import {
  listPersistedSessions,
  loadPersistedSession,
  type PersistedSessionListEntry,
  persistSession,
  persistSessionContextState,
  resolveSessionModelMetadata,
  type SessionContextUsage,
  type SessionModelMetadata,
  type SessionTokenUsage,
} from "../core/session-context";
import {
  deriveSessionTitleFromMessages,
  parseModelGeneratedSessionTitle,
  shouldRegenerateSessionTitle,
  stripSessionTitleAgentPrefix,
} from "../core/session-title";
import { setSessionStatusLivenessResolver } from "../core/status";
import { selectResidentChatSessionEvictions } from "./chat-runtime-stability";
import type { ChatMessage, ChatRequest, ChatResponse } from "./chat-types";

const log = createLogger("ChatState");

export { stripThinkingTags } from "./chat-formatting";
export {
  formatProcessActivityFromToolCall,
  type ProcessActivityInfo,
  type ToolCallInfo,
} from "./chat-process-activities";
export interface InMemoryChatSession {
  id: string;
  agentId: string;
  useModelRouter: boolean;
  title: string | null;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  workspaceDir?: string | null;
  persisted: boolean;
  compactionCount?: number;
  lastFlushCompactionCount?: number;
}

export function persistActiveSessionContext(session: InMemoryChatSession): void {
  if ((session.compactionCount || 0) <= 0) return;
  persistSessionContextState(session.id, session.messages, session.compactionCount || 0);
}

export interface ChatSessionAgentUpdate {
  success: true;
  sessionId: string;
  agentId: string;
  agentName: string;
  useModelRouter: boolean;
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

export interface SessionListEntry {
  id: string;
  agentId: string;
  useModelRouter: boolean;
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

export const chatSessions = new Map<string, InMemoryChatSession>();
export const persistedSessionIndex = new Map<string, PersistedSessionIndexEntry>();

export const chatTurnMutex = new KeyedMutex();
setSessionStatusLivenessResolver((sessionId) => chatTurnMutex.isLocked(sessionId));
export const MAX_PENDING_CHAT_MESSAGES_PER_SESSION = 20;

export interface PendingChatItem {
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

export interface PendingChatCompletion {
  promise: Promise<ChatResponse>;
  resolve: (response: ChatResponse) => void;
  reject: (error: unknown) => void;
}

export const pendingChatQueues = new Map<string, PendingChatItem[]>();

export function createPendingChatCompletion(id: string): void {
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

export function resolvePendingChatCompletion(id: string, response: ChatResponse): void {
  const completion = pendingChatCompletions.get(id);
  if (!completion) return;
  pendingChatCompletions.delete(id);
  completion.resolve(response);
}

export function rejectPendingChatCompletion(id: string, error: unknown): void {
  const completion = pendingChatCompletions.get(id);
  if (!completion) return;
  pendingChatCompletions.delete(id);
  completion.reject(error);
}

export const pendingChatCompletions = new Map<string, PendingChatCompletion>();
export const pendingChatDrainScheduled = new Set<string>();
export const pendingChatDrainTimers = new Map<string, ReturnType<typeof setTimeout>>();
export const deferredSessionMessages = new Map<string, ChatMessage[]>();
export const activeChatTurnAbortControllers = new Map<string, AbortController>();
export const deletingChatSessionIds = new Set<string>();
export const interruptedChatTurnSteeringIds = new WeakMap<AbortController, string>();
export const stoppedChatTurnControllers = new WeakSet<AbortController>();
const residentChatSessionSizes = new Map<string, number>();
const residentChatSessionAccess = new Map<string, number>();
const MAX_RESIDENT_CHAT_SESSIONS = 24;
const MAX_RESIDENT_CHAT_SESSION_CHARS = 12_000_000;

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
    (pendingChatQueues.get(sessionId)?.length ?? 0) > 0 ||
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

export function cacheChatSession(session: InMemoryChatSession): void {
  chatSessions.set(session.id, session);
  residentChatSessionSizes.set(session.id, estimateResidentChatSessionChars(session));
  residentChatSessionAccess.set(session.id, Date.now());
  pruneResidentChatSessions(session.id);
}

export function getResidentChatSession(sessionId: string): InMemoryChatSession | undefined {
  const session = chatSessions.get(sessionId);
  if (session) residentChatSessionAccess.set(sessionId, Date.now());
  return session;
}

export function deleteResidentChatSession(sessionId: string): boolean {
  const drainTimer = pendingChatDrainTimers.get(sessionId);
  if (drainTimer) clearTimeout(drainTimer);
  pendingChatDrainTimers.delete(sessionId);
  residentChatSessionSizes.delete(sessionId);
  residentChatSessionAccess.delete(sessionId);
  pendingChatQueues.delete(sessionId);
  pendingChatDrainScheduled.delete(sessionId);
  deferredSessionMessages.delete(sessionId);
  return chatSessions.delete(sessionId);
}

function truncateSessionPreviewContent(content: string): string {
  if (content.length <= SESSION_LAST_MESSAGE_PREVIEW_MAX_CHARS) return content;
  return `${content.slice(0, SESSION_LAST_MESSAGE_PREVIEW_MAX_CHARS)}...`;
}

export function buildLastMessagePreview(message?: ChatMessage): SessionLastMessagePreview | null {
  if (!message) return null;
  return {
    role: message.role,
    content: truncateSessionPreviewContent(message.content),
  };
}

export function normalizePersistedIndexEntry(
  entry: Omit<
    PersistedSessionIndexEntry,
    "title" | "lastMessage" | "pinned" | "modelMetadata" | "useModelRouter"
  > & {
    title?: string | null;
    pinned?: boolean;
    useModelRouter?: boolean;
    lastMessage?: SessionLastMessagePreview | null;
    modelMetadata?: SessionModelMetadata | null;
  }
): PersistedSessionIndexEntry {
  const modelMetadata = entry.modelMetadata ?? resolveSessionModelMetadata(entry.agentId);
  return {
    ...entry,
    useModelRouter:
      entry.useModelRouter ?? persistedSessionIndex.get(entry.id)?.useModelRouter ?? false,
    title: stripSessionTitleAgentPrefix(entry.title, [modelMetadata?.agent_name, entry.agentId]),
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

export function upsertPersistedSessionIndex(
  entry: Omit<
    PersistedSessionIndexEntry,
    "title" | "lastMessage" | "pinned" | "modelMetadata" | "useModelRouter"
  > & {
    title?: string | null;
    pinned?: boolean;
    useModelRouter?: boolean;
    lastMessage?: SessionLastMessagePreview | null;
    modelMetadata?: SessionModelMetadata | null;
  }
): void {
  persistedSessionIndex.set(entry.id, normalizePersistedIndexEntry(entry));
}

export function countVisibleSessionMessages(messages: ChatMessage[]): number {
  return messages.reduce((count, message) => count + (message.role === "system" ? 0 : 1), 0);
}

export async function persistChatSessionSnapshot(
  session: InMemoryChatSession,
  lastMessage?: ChatMessage
): Promise<boolean> {
  const modelMetadata = resolveSessionModelMetadata(session.agentId);
  session.persisted = await persistSession(
    session.id,
    session.agentId,
    session.messages,
    session.workspaceDir,
    session.title,
    session.useModelRouter
  );
  upsertPersistedSessionIndex({
    id: session.id,
    agentId: session.agentId,
    useModelRouter: session.useModelRouter,
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

export function removePersistedSessionIndex(sessionId: string): void {
  persistedSessionIndex.delete(sessionId);
}

export function buildMemorySessionListEntries(): SessionListEntry[] {
  return Array.from(chatSessions.values()).map((s) => {
    const modelMetadata = resolveSessionModelMetadata(s.agentId);
    return {
      id: s.id,
      agentId: s.agentId,
      useModelRouter: s.useModelRouter,
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
      pinned: persistedSessionIndex.get(s.id)?.pinned ?? false,
      lastMessage: buildLastMessagePreview(s.messages[s.messages.length - 1]),
      modelMetadata,
    };
  });
}

export function persistedSessionToIndexEntry(
  persisted: PersistedSessionListEntry
): PersistedSessionIndexEntry {
  return normalizePersistedIndexEntry({
    id: persisted.id,
    agentId: persisted.agentId,
    useModelRouter: persisted.useModelRouter,
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

export function hydratePersistedSessionIndex(
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

export function sortSessionListEntries(sessions: SessionListEntry[]): SessionListEntry[] {
  return sessions.sort(
    (a, b) =>
      (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) ||
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export async function restorePersistedChatSessionForChat(
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
      useModelRouter: persisted.useModelRouter,
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

export async function loadPersistedSessions(): Promise<void> {
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

export const chatRateLimitConfig = { windowMs: 60000, maxRequests: 60 };

const SESSION_TITLE_MODEL_SYSTEM_PROMPT =
  "You generate concise chat session titles from a single user request. Return only the title text with no markdown, no quotes, and no preface. Use 3-10 words, concrete and specific. Avoid generic titles like Summary, Report, Session, Chat, or Response.";

function truncateForTitlePrompt(value: string, maxChars: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

export function parseIsoTimestampMs(value?: string): number | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  const normalized = /(?:z|[+-]\d{2}:?\d{2})$/i.test(trimmed)
    ? trimmed
    : `${trimmed.replace(" ", "T")}Z`;
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

export async function generateSessionTitleViaModel(params: {
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

export function cleanGeneratedSessionTitle(
  agentName: string | undefined,
  title: string | null
): string | null {
  return stripSessionTitleAgentPrefix(title, [agentName]);
}
