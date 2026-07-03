import { agentManager, type AgentMessage } from "../core/agent";
import { KeyedMutex } from "../core/keyed-mutex";
import { type AgentImage, hasImages, sanitizeAgentImages } from "../core/llm/image-blocks";
import { providerManager } from "../core/providers";
import { config } from "../core/config";
import {
  getToolSchemasForLLM,
  checkCircuit,
  recordCircuitSuccess,
  recordCircuitFailure,
  checkRateLimit,
  getRateLimitStatus,
} from "../core/tools/index";
import { getSubagentSession } from "../core/tools/handlers/index";
import { maybeRunBackgroundReview } from "../core/background-review";
import { logSessionMessage, logAgentActivity } from "../core/logging";
import {
  listPersistedSessionPage,
  listPersistedSessions,
  loadPersistedSession,
  setPersistedSessionPinned,
  shouldCompactContext,
  compactContext,
  persistSession,
  deletePersistedSession,
  estimateMessagesTokens,
  getContextWindow,
  normalizeSessionWorkspaceDir,
  resolveSessionModelMetadata,
  type PersistedSessionListEntry,
  type SessionModelMetadata,
} from "../core/session-context";
import {
  deriveSessionTitleFromMessages,
  deriveSessionTitleFromTurn,
  normalizeSessionTitle,
  parseModelGeneratedSessionTitle,
  shouldRegenerateSessionTitle,
} from "../core/session-title";
import { handleMemorySave } from "../core/tools/handlers/memory";
import {
  trackSessionTokens,
  trackSessionEvent,
  trackContextCompaction,
  trackMemoryFlush,
} from "../core/metrics";
import { shouldRunMemoryFlush, resolveMemoryFlushSettings } from "../core/memory/flush";
import { broadcastStatus, getSessionStatusSnapshot } from "../core/status";
import { emitAgentHook } from "../core/agent-hooks";
import { createLogger } from "../core/logger";
import {
  buildToolExecutionFallbackMessage,
  shouldEnforceToolUseForMessage,
  shouldPreferArtifactsForMessage,
} from "./chat-tool-summary";
import { stripThinkingTags } from "./chat-formatting";
export { stripThinkingTags } from "./chat-formatting";
const log = createLogger("Chat");

export interface ProcessActivityInfo {
  id: string;
  phase: "start" | "result" | "error";
  text: string;
  timestamp: number;
  toolName?: string;
  toolCallId?: string;
  sandboxProvider?: string;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "pending" | "executing" | "completed" | "failed";
  result?: unknown;
  error?: string;
  duration?: number;
  timeline_index?: number;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
  thinking?: string;
  tool_calls?: ToolCallInfo[];
  process_activities?: ProcessActivityInfo[];
  /** Optional image inputs (vision) attached to a user message. */
  images?: AgentImage[];
}

export interface ChatRequest {
  message: string;
  agentId?: string;
  sessionId?: string;
  workspaceDir?: string;
  stream?: boolean;
  tools?: boolean;
  channel?: string;
  userId?: string;
  source?: string;
  /** Optional image inputs (vision) for this user turn. */
  images?: AgentImage[];
}

export interface ChatResponse {
  sessionId: string;
  message: ChatMessage;
  workspaceDir?: string | null;
  agent?: {
    id: string;
    name: string;
  };
  thinking?: string;
  tool_calls?: ToolCallInfo[];
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
  compactionCount?: number; // Track compaction cycles for memory flush
  lastFlushCompactionCount?: number; // Last compaction cycle we flushed
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
  return {
    ...entry,
    title: normalizeSessionTitle(entry.title),
    // Preserve an existing pin when the caller doesn't supply one, so unrelated
    // index updates (new messages, title regen, etc.) never clear it.
    pinned: entry.pinned ?? persistedSessionIndex.get(entry.id)?.pinned ?? false,
    lastMessage: entry.lastMessage
      ? {
          role: entry.lastMessage.role,
          content: truncateSessionPreviewContent(entry.lastMessage.content),
        }
      : null,
    modelMetadata: entry.modelMetadata ?? resolveSessionModelMetadata(entry.agentId),
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

function removePersistedSessionIndex(sessionId: string): void {
  persistedSessionIndex.delete(sessionId);
}

function buildMemorySessionListEntries(): SessionListEntry[] {
  return Array.from(chatSessions.values()).map((s) => ({
    id: s.id,
    agentId: s.agentId,
    title: shouldRegenerateSessionTitle(s.title)
      ? deriveSessionTitleFromMessages(s.messages)
      : normalizeSessionTitle(s.title),
    messageCount: s.messages.length,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt || s.createdAt,
    workspaceDir: s.workspaceDir ?? null,
    // In-memory sessions don't track pin state; inherit it from the persisted
    // index when the session has been saved.
    pinned: persistedSessionIndex.get(s.id)?.pinned ?? false,
    lastMessage: buildLastMessagePreview(s.messages[s.messages.length - 1]),
    modelMetadata: resolveSessionModelMetadata(s.agentId),
  }));
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

function readToolArgString(
  args: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  if (!args) return undefined;
  const value = args[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toActivityDisplayPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").trim();
  if (!normalized) return "file";
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] || normalized;
}

function isGenericProcessLabel(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized === "thinking..." ||
    normalized === "thinking" ||
    normalized === "generating response..." ||
    normalized === "generating response" ||
    normalized === "working..." ||
    normalized === "working" ||
    normalized === "idle"
  );
}

function isMeaningfulProcessThought(value?: string): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return !isGenericProcessLabel(trimmed);
}

function normalizeProcessActivityTextForPhase(
  value: string,
  phase: "start" | "result" | "error"
): string {
  if (phase === "start") return value;
  if (phase === "result") {
    return value
      .replace(/^Exploring\b/i, "Explored")
      .replace(/^Searching\b/i, "Searched")
      .replace(/^Fetching\b/i, "Fetched")
      .replace(/^Running\b/i, "Ran")
      .replace(/^Writing\b/i, "Edited")
      .replace(/^Editing\b/i, "Edited");
  }
  return value
    .replace(/^Exploring\b/i, "Read failed")
    .replace(/^Searching\b/i, "Search failed")
    .replace(/^Fetching\b/i, "Fetch failed")
    .replace(/^Running\b/i, "Command failed")
    .replace(/^Writing\b/i, "Edit failed")
    .replace(/^Editing\b/i, "Edit failed");
}

function formatProcessActivityFromToolCall(toolCall: ToolCallInfo): string {
  const key = toolCall.name.toLowerCase();
  const args = toolCall.args || {};
  const path = readToolArgString(args, "path");
  const displayPath = path ? toActivityDisplayPath(path) : undefined;

  if (key === "read") {
    return displayPath ? `Explored ${displayPath}` : "Exploration complete";
  }
  if (key === "write" || key === "edit") {
    return displayPath ? `Edited ${displayPath}` : "Edit complete";
  }
  if (key === "file_search" || key === "grep") {
    const pattern = readToolArgString(args, "pattern");
    return pattern ? `Search complete for "${pattern}"` : "Search complete";
  }
  if (key === "web_search") {
    const query = readToolArgString(args, "query");
    return query ? `Web search complete for "${query}"` : "Web search complete";
  }
  if (key === "web_fetch") {
    const url = readToolArgString(args, "url");
    return url ? `Fetched ${url}` : "Fetch complete";
  }
  if (key === "exec" || key === "process" || key === "git") {
    const command = readToolArgString(args, "command") || readToolArgString(args, "cmd");
    if (command) {
      const compact = command
        .split(/\r?\n/)
        .map((line) => line.trim())
        .join(" ")
        .trim();
      if (compact.length > 0) {
        return `Ran ${compact.length > 80 ? `${compact.slice(0, 77)}...` : compact}`;
      }
    }
    return "Command complete";
  }
  if (key === "browser") {
    const action = readToolArgString(args, "action");
    return action ? `Browser ${action} complete` : "Browser action complete";
  }
  if (key === "artifacts" || key === "artifact") {
    const action = (readToolArgString(args, "action") || "list").toLowerCase();
    const name =
      readToolArgString(args, "name") ||
      readToolArgString(args, "artifact") ||
      readToolArgString(args, "artifactName") ||
      readToolArgString(args, "fileName");
    if (action === "list") return "Listed session artifacts";
    if (action === "create")
      return name
        ? `Created ${name.endsWith(".md.resolved") ? name : `${name}.md.resolved`}`
        : "Created artifact";
    if (action === "update" || action === "append")
      return name
        ? `Updated ${name.endsWith(".md.resolved") ? name : `${name}.md.resolved`}`
        : "Updated artifact";
    if (action === "read")
      return name
        ? `Read ${name.endsWith(".md.resolved") ? name : `${name}.md.resolved`}`
        : "Read artifact";
    return name ? `Artifact ${action} complete for ${name}` : `Artifact ${action} complete`;
  }

  return `${toolCall.name} complete`;
}

function extractSandboxProviderFromToolCall(toolCall: ToolCallInfo): string | undefined {
  const normalized = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim().toLowerCase();
    if (
      trimmed === "apple_sandbox" ||
      trimmed === "podman" ||
      trimmed === "docker" ||
      trimmed === "host"
    ) {
      return trimmed;
    }
    return undefined;
  };

  const result = toolCall.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
  const typed = result as Record<string, unknown>;
  return normalized(typed.sandboxProvider ?? typed.sandbox_provider);
}

function dedupeProcessActivities(activities: ProcessActivityInfo[]): ProcessActivityInfo[] {
  const seen = new Set<string>();
  const deduped: ProcessActivityInfo[] = [];
  for (const activity of activities.sort((a, b) => a.timestamp - b.timestamp)) {
    const normalizedText = normalizeProcessActivityTextForPhase(
      activity.text.trim(),
      activity.phase
    );
    if (!normalizedText) continue;
    const toolCallIdKey =
      typeof activity.toolCallId === "string" && activity.toolCallId.trim()
        ? activity.toolCallId.trim().toLowerCase()
        : "";
    const key = `${activity.phase}:${toolCallIdKey}:${(activity.toolName || "").toLowerCase()}:${normalizedText.toLowerCase()}:${Math.floor(activity.timestamp / 1000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      ...activity,
      text: normalizedText,
    });
  }
  return deduped;
}

function buildFallbackProcessActivities(
  toolCalls: ToolCallInfo[],
  thinking: string | undefined,
  baseTimestampMs: number
): ProcessActivityInfo[] | undefined {
  const activities: ProcessActivityInfo[] = [];
  const fallbackStart = Number.isFinite(baseTimestampMs) ? baseTimestampMs : Date.now();

  for (let index = 0; index < toolCalls.length; index += 1) {
    const toolCall = toolCalls[index];
    const phase: "start" | "result" | "error" =
      toolCall.status === "failed" ? "error" : toolCall.status === "executing" ? "start" : "result";
    const timelineOffset =
      typeof toolCall.timeline_index === "number" && Number.isFinite(toolCall.timeline_index)
        ? toolCall.timeline_index
        : index;
    activities.push({
      id: `fallback-${toolCall.id || index}`,
      phase,
      text: formatProcessActivityFromToolCall(toolCall),
      timestamp: fallbackStart + timelineOffset,
      toolName: toolCall.name,
      toolCallId: typeof toolCall.id === "string" && toolCall.id.trim() ? toolCall.id : undefined,
      sandboxProvider: extractSandboxProviderFromToolCall(toolCall),
    });
  }

  if (isMeaningfulProcessThought(thinking)) {
    const thoughtLines = (thinking || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !isGenericProcessLabel(line));
    for (let index = 0; index < thoughtLines.length; index += 1) {
      activities.push({
        id: `fallback-thought-${index}`,
        phase: "result",
        text: thoughtLines[index],
        timestamp: fallbackStart + toolCalls.length + index + 1,
        toolName: "__thought",
      });
    }
  }

  const deduped = dedupeProcessActivities(activities);
  return deduped.length > 0 ? deduped : undefined;
}

async function generateSessionTitleViaModel(params: {
  provider: ReturnType<typeof providerManager.getWithCredentials>;
  agent: NonNullable<ReturnType<typeof agentManager.get>> | undefined;
  sessionId: string;
  userMessage: string;
  channel?: string;
  userId?: string;
  workspaceDir?: string | null;
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
    });
    return parseModelGeneratedSessionTitle(result.content);
  } catch (error) {
    log.warn("Session title model generation failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function withAgentTitlePrefix(agentName: string | undefined, title: string | null): string | null {
  const normalizedTitle = normalizeSessionTitle(title);
  if (!normalizedTitle) return null;
  const normalizedAgent = normalizeSessionTitle(agentName);
  if (!normalizedAgent) return normalizedTitle;
  if (normalizedTitle.toLowerCase().startsWith(`${normalizedAgent.toLowerCase()}:`)) {
    return normalizedTitle;
  }
  return normalizeSessionTitle(`${normalizedAgent}: ${normalizedTitle}`);
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

  // Serialize the turn per session. A provided sessionId is the contended key;
  // a new session gets a fresh id that is used as both the lock key and the
  // session id so the whole turn (create → push user → execute → push assistant
  // → persist) runs without interleaving.
  const effectiveSessionId = request.sessionId || crypto.randomUUID();
  return chatTurnMutex.run(effectiveSessionId, () => handleChatTurn(request, effectiveSessionId));
}

async function handleChatTurn(
  request: ChatRequest,
  effectiveSessionId: string
): Promise<ChatResponse> {
  const { message, agentId, tools = true, channel, userId, source, workspaceDir } = request;
  const requestedWorkspaceDir =
    workspaceDir !== undefined ? normalizeSessionWorkspaceDir(workspaceDir) : undefined;

  let session = chatSessions.get(effectiveSessionId);
  const isNewSession = !session;

  if (!session) {
    // Resolve the agent for a brand-new session. Honor the explicit agentId if
    // provided; otherwise fall back to the user-configured default agent
    // (default_agent_id) before the arbitrary first agent. Channel handlers
    // (Discord/Slack/etc.) call handleChat WITHOUT an agentId, so without this
    // they'd silently land on agentManager.list()[0] — which may be an agent
    // whose provider token is expired (the source of spurious 401s in chat).
    const configuredDefaultId = config.get<string>("default_agent_id");
    const agent = agentId
      ? agentManager.get(agentId)
      : (configuredDefaultId ? agentManager.get(configuredDefaultId) : undefined) ||
        agentManager.list().find((a) => a.status === "running") ||
        agentManager.list()[0];

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
          content:
            agent.system_prompt ||
            "You are a helpful AI assistant with access to tools. Use tools when needed to help the user.",
          timestamp: nowIso,
        },
      ],
      createdAt: nowIso,
      updatedAt: nowIso,
      workspaceDir: requestedWorkspaceDir ?? null,
      persisted: false,
    };
    chatSessions.set(newSessionId, session);

    trackSessionEvent(newSessionId, "created", { agentId: agent.id, model: agent.model });
  }

  if (requestedWorkspaceDir !== undefined) {
    session.workspaceDir = requestedWorkspaceDir;
  }

  const agent = agentManager.get(session.agentId);
  const hookContext = {
    agentId: agent?.id,
    sessionId: session.id,
    channel,
    userId,
  };

  const sanitizedImages = sanitizeAgentImages(request.images);
  const userMessage: ChatMessage = {
    role: "user",
    content: message,
    timestamp: new Date().toISOString(),
    ...(hasImages(sanitizedImages) ? { images: sanitizedImages } : {}),
  };
  session.messages.push(userMessage);
  session.updatedAt = userMessage.timestamp || new Date().toISOString();

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

  await logSessionMessage(session.id, "user", message, {
    agentId: agent?.id,
    metadata: { source: "chat_api" },
  });

  const provider = agent ? agentManager.resolveProvider(agent.id) : undefined;

  if (isNewSession && (!session.title || shouldRegenerateSessionTitle(session.title))) {
    const generatedTitle = await generateSessionTitleViaModel({
      provider,
      agent,
      sessionId: session.id,
      userMessage: message,
      channel,
      userId,
      workspaceDir: session.workspaceDir,
    });
    session.title = withAgentTitlePrefix(agent?.name, generatedTitle);
    if (!session.title) {
      session.title = withAgentTitlePrefix(agent?.name, deriveSessionTitleFromTurn(message));
    }
  }

  if (provider && agent) {
    const contextWindow = getContextWindow(agent.model);
    const currentTokens = estimateMessagesTokens(session.messages);
    const flushSettings = resolveMemoryFlushSettings();

    trackSessionTokens(session.id, currentTokens, contextWindow, agent.model, {
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
        const flushMessages: AgentMessage[] = [
          ...session.messages.map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: flushSettings.prompt },
        ];

        const flushResult = await agentManager.callLLM(
          provider,
          agent.model,
          flushMessages,
          [], // No tools - just let agent respond naturally (it can write to files if needed)
          {
            agentId: agent.id,
            sessionId: session.id,
            channel,
            userId,
            workspaceDir: session.workspaceDir || undefined,
          }
        );

        session.lastFlushCompactionCount = session.compactionCount || 0;

        trackMemoryFlush(session.id, true, {
          tokensBeforeFlush: currentTokens,
          compactionCount: session.compactionCount || 0,
          durationMs: Date.now() - flushStartTime,
        });
        trackSessionEvent(session.id, "memory_flushed", { model: agent.model });

        log.info("Memory flush completed", {
          sessionId: session.id,
          preview: flushResult.content.substring(0, 100),
        });
      } catch (flushError) {
        log.exception("Memory flush failed", flushError, { sessionId: session.id });
        trackMemoryFlush(session.id, false, {
          tokensBeforeFlush: currentTokens,
          compactionCount: session.compactionCount || 0,
        });
      }
    }

    const contextCheck = shouldCompactContext(session.messages, agent.model, message);

    if (contextCheck.needed) {
      log.info("Context compaction needed", {
        sessionId: session.id,
        currentTokens: contextCheck.currentTokens,
        maxTokens: contextCheck.maxTokens,
      });
      const compactionStart = Date.now();
      const messagesBefore = session.messages.length;
      const tokensBefore = estimateMessagesTokens(session.messages);

      // Surface an explicit "compacting" lifecycle state so the UI shows an
      // indicator instead of an apparent silent reset.
      broadcastStatus({
        status: "compacting",
        sessionId: session.id,
        agentId: agent.id,
        timestamp: Date.now(),
        detail: "Summarizing earlier conversation to continue...",
      });

      const compaction = await compactContext(session.messages, agent.model, agent.provider_id);
      if (compaction.wasCompacted) {
        session.messages = compaction.messages;
        session.compactionCount = (session.compactionCount || 0) + 1;

        const tokensAfter = estimateMessagesTokens(session.messages);
        trackContextCompaction(session.id, {
          messagesBefore,
          messagesAfter: session.messages.length,
          tokensBefore,
          tokensAfter,
          model: agent.model,
          durationMs: Date.now() - compactionStart,
        });
        trackSessionEvent(session.id, "compacted", { model: agent.model });

        log.info("Context compacted", {
          sessionId: session.id,
          summaryPreview: compaction.summary?.slice(0, 100),
        });
      }
    }
  }

  let responseContent: string;
  const thinkingContent: string = "";
  const allToolCalls: ToolCallInfo[] = [];

  if (provider && agent) {
    try {
      const circuit = checkCircuit(`llm:${provider.id}`);
      if (!circuit.allowed) {
        throw new Error(`LLM circuit breaker open for provider ${provider.id}`);
      }

      const executionMessages: AgentMessage[] = session.messages.map((sessionMessage) => ({
        role: sessionMessage.role,
        content: sessionMessage.content,
        ...(sessionMessage.images ? { images: sessionMessage.images } : {}),
      }));
      const shouldPreferArtifacts = tools && shouldPreferArtifactsForMessage(message);
      let result = await agentManager.execute(agent.id, executionMessages, {
        useTools: tools,
        sessionId: session.id,
        requireToolUse: shouldPreferArtifacts,
        requiredToolName: shouldPreferArtifacts ? "artifacts" : undefined,
        workspaceDir: session.workspaceDir || undefined,
      });
      responseContent = result.content;

      // Opportunistic, non-blocking background memory review. Forks a restricted
      // subagent (memory tools only) to persist durable facts/preferences from
      // this turn. Throttled per-session; failures are swallowed.
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
      ).catch(() => {
        /* best-effort; never affects the main turn */
      });

      let toolResults = result.tool_calls || [];
      const shouldForceToolExecution =
        tools && (shouldEnforceToolUseForMessage(message) || shouldPreferArtifacts);
      const hasArtifactsToolCall = toolResults.some((toolCall) => toolCall.name === "artifacts");
      if (
        shouldForceToolExecution &&
        (toolResults.length === 0 || (shouldPreferArtifacts && !hasArtifactsToolCall))
      ) {
        try {
          const forcedInstruction = shouldPreferArtifacts
            ? "Use the `artifacts` tool now to create or update the relevant .md.resolved artifact(s) for this request before responding. Perform concrete tool calls first, then summarize outcomes."
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
            requiredToolName: shouldPreferArtifacts ? "artifacts" : undefined,
            workspaceDir: session.workspaceDir || undefined,
          });
          const forcedToolCalls = forcedResult.tool_calls || [];
          const forcedHasArtifacts = forcedToolCalls.some(
            (toolCall) => toolCall.name === "artifacts"
          );
          if (forcedToolCalls.length > 0 && (!shouldPreferArtifacts || forcedHasArtifacts)) {
            result = forcedResult;
            responseContent = forcedResult.content;
            toolResults = forcedToolCalls;
          }
        } catch (toolRetryError) {
          log.warn("Forced tool-execution retry failed", {
            sessionId: session.id,
            error: (toolRetryError as Error).message,
          });
        }
      }

      if (toolResults.length > 0) {
        for (const tc of toolResults) {
          const timelineIndex = allToolCalls.length;
          allToolCalls.push({
            id: `call_${crypto.randomUUID().slice(0, 8)}`,
            name: tc.name,
            args:
              tc.args && typeof tc.args === "object" && !Array.isArray(tc.args)
                ? (tc.args as Record<string, unknown>)
                : {},
            status: "completed",
            result: tc.result,
            duration: 0,
            timeline_index: timelineIndex,
          });
        }

        const toolResultsText = toolResults
          .map(
            (tc) =>
              `Tool: ${tc.name}\nResult: ${
                typeof tc.result === "string"
                  ? tc.result.slice(0, 2000)
                  : JSON.stringify(tc.result).slice(0, 2000)
              }`
          )
          .join("\n\n");

        try {
          const summaryMessages: AgentMessage[] = [
            ...session.messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
            {
              role: "user",
              content: `The user asked: "${message}"\n\nTools executed:\n${toolResultsText}\n\nIf more actions are needed to fully complete the user's request (e.g., taking a screenshot after navigating), call the appropriate tools. Otherwise, respond to the user with what was accomplished.`,
            },
          ];

          const providerForSummary = agent?.provider_id
            ? providerManager.getWithCredentials(agent.provider_id)
            : undefined;

          if (providerForSummary) {
            const toolSchemaList = tools ? getToolSchemasForLLM() : [];

            const summaryResult = await agentManager.callLLM(
              providerForSummary,
              agent?.model,
              summaryMessages,
              toolSchemaList.map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.input_schema,
              })),
              {
                agentId: agent.id,
                sessionId: session.id,
                channel,
                userId,
                workspaceDir: session.workspaceDir || undefined,
              }
            );
            responseContent = summaryResult.content;

            if (summaryResult.tool_calls && summaryResult.tool_calls.length > 0) {
              for (const tc of summaryResult.tool_calls) {
                const timelineIndex = allToolCalls.length;
                allToolCalls.push({
                  id: `call_${crypto.randomUUID().slice(0, 8)}`,
                  name: tc.name,
                  args:
                    tc.args && typeof tc.args === "object" && !Array.isArray(tc.args)
                      ? (tc.args as Record<string, unknown>)
                      : {},
                  status: "completed",
                  result: tc.result,
                  duration: 0,
                  timeline_index: timelineIndex,
                });
              }

              let screenshotFound = false;
              let screenshotPath = "";
              for (const tc of summaryResult.tool_calls) {
                const toolResult = tc.result as { filePath?: unknown } | undefined;
                if (typeof toolResult?.filePath === "string") {
                  screenshotFound = true;
                  screenshotPath = toolResult.filePath;
                  break;
                }
              }

              if (screenshotFound) {
                responseContent = `Here's the screenshot of the page:\n\n📸 Screenshot saved: ${screenshotPath}\n\n![Screenshot](file://${screenshotPath})`;
              } else {
                const allToolResultsText = [...toolResults, ...summaryResult.tool_calls]
                  .map(
                    (tc) =>
                      `Tool: ${tc.name}\nResult: ${typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result).substring(0, 500)}`
                  )
                  .join("\n\n");

                const finalMessages: AgentMessage[] = [
                  {
                    role: "user",
                    content: `The user asked: "${message}"\n\nAll tools completed:\n${allToolResultsText}\n\nProvide a brief, friendly response summarizing what was accomplished.`,
                  },
                ];

                try {
                  const finalResult = await agentManager.callLLM(
                    providerForSummary,
                    agent?.model,
                    finalMessages,
                    [], // No more tools - final response only
                    {
                      agentId: agent.id,
                      sessionId: session.id,
                      channel,
                      userId,
                      workspaceDir: session.workspaceDir || undefined,
                    }
                  );
                  responseContent = finalResult.content;
                } catch {
                  responseContent = `Completed! ${allToolCalls.length} tool${allToolCalls.length === 1 ? "" : "s"} executed successfully.`;
                }
              }
            }
          }
        } catch {
          log.warn("Could not generate summary, returning concise tool digest", {
            sessionId: session.id,
          });
          responseContent = buildToolExecutionFallbackMessage(toolResults);
        }
      }

      recordCircuitSuccess(`llm:${provider.id}`);
      log.info("LLM response received", {
        sessionId: session.id,
        preview: responseContent.substring(0, 100),
      });
    } catch (error) {
      recordCircuitFailure(`llm:${provider.id}`);
      log.error("LLM API error", {
        sessionId: session.id,
        error: (error as Error).message,
      });
      responseContent = `I encountered an error calling the LLM API: ${(error as Error).message}. Please check your provider configuration.`;
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

  const { content: cleanContent, thinking: extractedThinking } = stripThinkingTags(responseContent);
  const finalThinking = thinkingContent || extractedThinking;

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
  const statusSnapshotActivities = (() => {
    const snapshot = getSessionStatusSnapshot(session.id);
    if (!snapshot || !Array.isArray(snapshot.activities) || snapshot.activities.length === 0) {
      return undefined;
    }
    return snapshot.activities.map((activity) => ({
      id: activity.id,
      phase: activity.phase,
      text: activity.text,
      timestamp: activity.timestamp,
      toolName: activity.toolName,
      toolCallId: activity.toolCallId,
      sandboxProvider: activity.sandboxProvider,
    }));
  })();
  const fallbackProcessActivities =
    !statusSnapshotActivities || statusSnapshotActivities.length === 0
      ? buildFallbackProcessActivities(
          allToolCalls,
          finalThinking || undefined,
          parseIsoTimestampMs(userMessage.timestamp) || assistantTimestampMs
        )
      : undefined;
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

  const assistantMessage: ChatMessage = {
    role: "assistant",
    content: assistantContent,
    timestamp: assistantTimestamp,
    thinking: finalThinking || undefined,
    tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
    process_activities:
      statusSnapshotActivities && statusSnapshotActivities.length > 0
        ? statusSnapshotActivities
        : fallbackProcessActivities,
  };
  session.messages.push(assistantMessage);
  session.updatedAt = assistantMessage.timestamp || new Date().toISOString();
  if (!session.title || shouldRegenerateSessionTitle(session.title)) {
    session.title = withAgentTitlePrefix(agent?.name, deriveSessionTitleFromTurn(message));
  }
  const modelMetadata = resolveSessionModelMetadata(agent?.id ?? session.agentId);

  await logSessionMessage(session.id, "assistant", assistantMessage.content, {
    agentId: agent?.id,
    metadata: {
      source: "chat_api",
      ...(modelMetadata ?? {}),
      thinking: finalThinking,
      tool_calls: allToolCalls,
      process_activities: assistantMessage.process_activities,
    },
  });

  // Only mark the session persisted when the write actually succeeded, so a
  // failed write is retried on the next turn instead of being silently lost.
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
    messageCount: session.messages.length,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    workspaceDir: session.workspaceDir ?? null,
    lastMessage: buildLastMessagePreview(assistantMessage),
    modelMetadata,
  });

  await emitAgentHook({
    type: "message:sent",
    context: hookContext,
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
  const session = chatSessions.get(sessionId);
  if (session) {
    if (shouldRegenerateSessionTitle(session.title)) {
      session.title = deriveSessionTitleFromMessages(session.messages);
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
      })),
      createdAt: subagentSession.createdAt,
      isSubagent: true,
      status: subagentSession.status,
      result: subagentSession.result,
    };
  }

  const indexed = persistedSessionIndex.get(sessionId);
  const persisted = await loadPersistedSession(sessionId);
  if (persisted) {
    const resolvedTitle = shouldRegenerateSessionTitle(persisted.title)
      ? deriveSessionTitleFromMessages(persisted.messages)
      : normalizeSessionTitle(persisted.title);
    const createdAt = indexed?.createdAt || new Date().toISOString();
    const updatedAt = indexed?.updatedAt || createdAt;
    const workspaceDir = persisted.workspaceDir ?? indexed?.workspaceDir ?? null;
    const restoredSession = {
      id: sessionId,
      agentId: persisted.agentId,
      title: resolvedTitle,
      messages: persisted.messages,
      createdAt,
      updatedAt,
      workspaceDir,
      persisted: true,
    };
    chatSessions.set(sessionId, restoredSession);
    upsertPersistedSessionIndex({
      id: sessionId,
      agentId: persisted.agentId,
      title: resolvedTitle,
      messageCount: persisted.messages.length,
      createdAt,
      updatedAt,
      workspaceDir,
      lastMessage: buildLastMessagePreview(persisted.messages[persisted.messages.length - 1]),
    });
    return restoredSession;
  }

  if (indexed) {
    removePersistedSessionIndex(sessionId);
  }

  return undefined;
}

export async function getSessionMessages(sessionId: string): Promise<ChatMessage[]> {
  const session = await getSession(sessionId);
  return session?.messages || [];
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
  const page = await listPersistedSessionPage(options);
  hydratePersistedSessionIndex(page.sessions, false);
  return {
    sessions: page.sessions.map(persistedSessionToIndexEntry),
    total: page.total,
  };
}

export async function listSessions(options?: {
  limit?: number;
  offset?: number;
}): Promise<SessionListEntry[]> {
  const normalizedOptions = normalizeSessionPageOptions(options);
  if (normalizedOptions.limit && chatSessions.size === 0) {
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
  if (limit && chatSessions.size === 0) {
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
  const memoryDeleted = chatSessions.delete(sessionId);

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
  const candidateIndex = Number.isInteger(target.messageIndex) ? Number(target.messageIndex) : -1;
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

  if (content) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message || message.role !== desiredRole) continue;
      if (message.content === target.messageContent) {
        return index;
      }
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

  const keptMessages = session.messages.slice(0, targetIndex);
  const removedCount = session.messages.length - keptMessages.length;

  const inMemorySession = chatSessions.get(sessionId);
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
    inMemorySession.persisted = true;
    inMemorySession.updatedAt = new Date().toISOString();
  } else {
    chatSessions.set(sessionId, {
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
    await deletePersistedSession(sessionId);
    await persistSession(sessionId, agentId, keptMessages, workspaceDir, sessionTitle);
    for (const message of keptMessages) {
      await logSessionMessage(sessionId, message.role, message.content, {
        agentId,
        metadata: extractPersistedMessageMetadata(message),
      });
    }
    upsertPersistedSessionIndex({
      id: sessionId,
      agentId,
      title: sessionTitle,
      messageCount: keptMessages.length,
      createdAt,
      updatedAt: new Date().toISOString(),
      workspaceDir,
      lastMessage: buildLastMessagePreview(keptMessages[keptMessages.length - 1]),
    });
  }

  return {
    sessionId,
    messages: keptMessages,
    keptCount: keptMessages.length,
    removedCount,
    removedFromIndex: targetIndex,
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

  const inMemorySession = chatSessions.get(sessionId);
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
    chatSessions.set(sessionId, {
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
    messageCount: messages.length,
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

  const inMemorySession = chatSessions.get(sessionId);
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
    chatSessions.set(sessionId, {
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
    messageCount: messages.length,
    createdAt,
    updatedAt,
    workspaceDir,
    lastMessage: buildLastMessagePreview(messages[messages.length - 1]),
  });
  return { sessionId, title: normalizedTitle };
}

export function sendToSession(sessionKey: string, message: ChatMessage): boolean {
  const session = chatSessions.get(sessionKey);
  if (session) {
    session.messages.push(message);
    session.updatedAt = message.timestamp || new Date().toISOString();
    if (!session.title && session.messages.some((entry) => entry.role === "assistant")) {
      session.title = deriveSessionTitleFromMessages(
        session.messages,
        agentManager.get(session.agentId)?.name
      );
    }
    if (session.persisted) {
      upsertPersistedSessionIndex({
        id: session.id,
        agentId: session.agentId,
        title: session.title,
        messageCount: session.messages.length,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        workspaceDir: session.workspaceDir ?? null,
        lastMessage: buildLastMessagePreview(message),
      });
    }
    log.debug("Injected message into session", { sessionId: sessionKey });
    return true;
  }
  log.debug("Session not in memory, skipping announcement", { sessionId: sessionKey });
  return false;
}
