import { agentManager } from "../core/agent";
import { logSessionMessage } from "../core/logging";
import {
  clearSessionContextState,
  deletePersistedSession,
  estimateSessionContextUsage,
  listPersistedSessionPage,
  listPersistedSessions,
  loadPersistedSession,
  normalizeSessionWorkspaceDir,
  persistSession,
  resolveSessionModelMetadata,
  setPersistedSessionRouting,
  setPersistedSessionPinned,
  summarizeSessionTokenUsage,
} from "../core/session-context";
import {
  deriveSessionTitleFromMessages,
  normalizeSessionTitle,
  shouldRegenerateSessionTitle,
  stripSessionTitleAgentPrefix,
} from "../core/session-title";
import { getRunBySessionKey } from "../core/subagent-registry";
import { getSubagentSession } from "../core/tools/handlers/index";
import { getRateLimitStatus } from "../core/tools/index";
import { applyActiveAgentToSession } from "./chat-agent-prompt";
import { recoverInterruptedSessionMessages } from "./chat-run-recovery";
import {
  activeChatTurnAbortControllers,
  buildLastMessagePreview,
  buildMemorySessionListEntries,
  type ChatSessionAgentUpdate,
  cacheChatSession,
  chatSessions,
  countVisibleSessionMessages,
  deleteResidentChatSession,
  deletingChatSessionIds,
  getResidentChatSession,
  hydratePersistedSessionIndex,
  persistActiveSessionContext,
  persistedSessionIndex,
  persistedSessionToIndexEntry,
  pendingChatCompletions,
  pendingChatQueues,
  removePersistedSessionIndex,
  type SessionListEntry,
  sortSessionListEntries,
  chatTurnMutex,
  upsertPersistedSessionIndex,
} from "./chat-runtime-state";
import type { ChatMessage } from "./chat-types";
import { mergeSessionTranscriptMessages } from "./session-transcript";

export { stripThinkingTags } from "./chat-formatting";
export {
  formatProcessActivityFromToolCall,
  type ProcessActivityInfo,
  type ToolCallInfo,
} from "./chat-process-activities";

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
    const recoveredMessages = await recoverInterruptedSessionMessages(
      sessionId,
      persisted.agentId,
      persisted.messages
    );
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
      useModelRouter: persisted.useModelRouter,
      title: resolvedTitle,
      messages: persisted.contextMessages ?? recoveredMessages,
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
      useModelRouter: persisted.useModelRouter,
      title: resolvedTitle,
      messageCount: countVisibleSessionMessages(recoveredMessages),
      createdAt,
      updatedAt,
      workspaceDir,
      lastMessage: buildLastMessagePreview(recoveredMessages[recoveredMessages.length - 1]),
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
  agentId?: string,
  useModelRouter = false
): Promise<ChatSessionAgentUpdate> {
  const normalizedAgentId =
    typeof agentId === "string" && agentId.trim().length > 0 ? agentId.trim() : "";

  await getSession(sessionId);
  const session = getResidentChatSession(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  const agent = useModelRouter
    ? agentManager.get(session.agentId)
    : normalizedAgentId
      ? agentManager.get(normalizedAgentId)
      : undefined;
  if (!agent) {
    throw new Error("Agent not found");
  }

  if (!useModelRouter) {
    await applyActiveAgentToSession(session, agent);
  }
  session.useModelRouter = useModelRouter;
  const persistedRouting = await setPersistedSessionRouting(
    session.id,
    session.agentId,
    useModelRouter
  );
  if (!persistedRouting) {
    session.persisted = await persistSession(
      session.id,
      session.agentId,
      session.messages,
      session.workspaceDir,
      session.title,
      session.useModelRouter
    );
  }
  persistActiveSessionContext(session);

  const modelMetadata = resolveSessionModelMetadata(agent.id);
  upsertPersistedSessionIndex({
    id: session.id,
    agentId: session.agentId,
    useModelRouter: session.useModelRouter,
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
    useModelRouter: session.useModelRouter,
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
  const recoveredMessages = await recoverInterruptedSessionMessages(
    sessionId,
    persisted.agentId,
    persisted.messages
  );
  return mergeSessionTranscriptMessages(recoveredMessages, session.messages || []);
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
      useModelRouter: persisted.useModelRouter,
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
  const key = sessionId.trim();
  if (!key) return false;
  deletingChatSessionIds.add(key);
  const controller = activeChatTurnAbortControllers.get(key);
  if (controller && !controller.signal.aborted) {
    controller.abort(new DOMException("Chat session deleted", "AbortError"));
  }
  for (const item of pendingChatQueues.get(key) || []) {
    const completion = pendingChatCompletions.get(item.id);
    if (!completion) continue;
    pendingChatCompletions.delete(item.id);
    completion.reject(new Error("Chat session deleted"));
  }
  try {
    await chatTurnMutex.waitForIdle(key);
    const memoryDeleted = deleteResidentChatSession(key);
    const persistedDeleted = await deletePersistedSession(key);
    if (memoryDeleted || persistedDeleted) {
      removePersistedSessionIndex(key);
    }
    return memoryDeleted || persistedDeleted;
  } finally {
    deletingChatSessionIds.delete(key);
  }
}

export function getSessionPinned(sessionId: string): boolean {
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
  for (const key of [
    "provider",
    "provider_id",
    "provider_name",
    "model",
    "agent_id",
    "agent_name",
    "agent_type",
    "run_id",
  ] as const) {
    const value = message[key];
    if (typeof value === "string" && value.trim()) metadata[key] = value.trim();
  }
  if (message.interrupted === true) metadata.interrupted = true;
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
  revertedMessage: ChatMessage;
}> {
  if (chatTurnMutex.isLocked(sessionId)) {
    throw new Error("Cannot revert a session while a chat turn is active");
  }
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

  const keptMessages = session.messages.slice(0, targetIndex);
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
      useModelRouter: "useModelRouter" in session && session.useModelRouter === true,
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
    revertedMessage: targetMessage,
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
      useModelRouter: "useModelRouter" in session && session.useModelRouter === true,
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
      useModelRouter: "useModelRouter" in session && session.useModelRouter === true,
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
