import { createHash } from "crypto";
import { existsSync, statSync } from "fs";
import { homedir } from "os";
import { isAbsolute, resolve } from "path";
import type { ChatMessage } from "../api/chat";
import { agentManager } from "./agent";
import { attachmentsToImages } from "./chat/attachments";
import { compactChatContentForPrompt } from "./chat-token-optimization";
import db, { tables } from "./database";
import { sanitizeAssistantContent } from "./llm/text-tool-calls";
import { createLogger } from "./logger";
import { providerManager, providers } from "./providers";
import { capSessionMessageMetadata } from "./session-message-metadata";
import { clearSessionEventLedger } from "./session-event-ledger";
import { deriveSessionTitleFromMessages, normalizeSessionTitle } from "./session-title";

const log = createLogger("Session");

function sanitizePersistedMessageContent(role: string, content: string): string {
  return role === "assistant" ? sanitizeAssistantContent(content) : content;
}

interface PersistedSessionMessage {
  role: string;
  content: string;
  created_at: string;
  metadata?: string;
  agent_id?: string;
}

type SessionMessageMetadata = Partial<
  Pick<
    ChatMessage,
    | "provider"
    | "provider_id"
    | "provider_name"
    | "model"
    | "agent_id"
    | "agent_name"
    | "agent_type"
    | "thinking"
    | "tool_calls"
    | "process_activities"
    | "agent_transfers"
    | "run_id"
    | "interrupted"
  >
>;

function sessionMessageStableId(parts: unknown[]): string {
  const hash = createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
  return `msg_${hash}`;
}

function toSqliteTimestamp(value?: string, offsetMs = 0): string {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  const timestamp = Number.isFinite(parsed) ? parsed + offsetMs : Date.now() + offsetMs;
  return new Date(Math.max(0, timestamp)).toISOString().replace("T", " ").replace("Z", "");
}

function serializeSessionMessageMetadata(
  message: ChatMessage,
  extra?: Record<string, unknown>
): string | undefined {
  const metadata: Record<string, unknown> = { ...(extra || {}) };
  for (const key of [
    "provider",
    "provider_id",
    "provider_name",
    "model",
    "agent_id",
    "agent_name",
    "agent_type",
  ] as const) {
    const value = message[key];
    if (typeof value === "string" && value.trim()) metadata[key] = value.trim();
  }
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
  if (typeof message.run_id === "string" && message.run_id.trim()) {
    metadata.run_id = message.run_id.trim();
  }
  if (message.interrupted === true) {
    metadata.interrupted = true;
  }
  return Object.keys(metadata).length > 0
    ? capSessionMessageMetadata(JSON.stringify(metadata))
    : undefined;
}

export async function upsertPersistedSessionMessage(
  sessionId: string,
  agentId: string,
  message: ChatMessage,
  options?: { stableKey?: string; createdAtOffsetMs?: number; metadata?: Record<string, unknown> }
): Promise<void> {
  const id = sessionMessageStableId([
    sessionId,
    message.role,
    options?.stableKey || message.timestamp || message.content,
  ]);
  const createdAt = toSqliteTimestamp(message.timestamp, options?.createdAtOffsetMs || 0);
  const metadata = serializeSessionMessageMetadata(message, options?.metadata);
  db.prepare(
    `INSERT INTO session_messages (id, session_id, agent_id, role, content, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       agent_id = excluded.agent_id,
       role = excluded.role,
       content = excluded.content,
       metadata = excluded.metadata`
  ).run(id, sessionId, agentId, message.role, message.content, metadata ?? null, createdAt);
}

export interface SessionModelMetadata {
  provider?: string;
  provider_id?: string;
  provider_name?: string;
  model?: string;
  agent_id?: string;
  agent_name?: string;
  agent_type?: string;
}

function parseSessionMessageMetadata(metadata?: string): SessionMessageMetadata {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as SessionMessageMetadata)
      : {};
  } catch {
    return {};
  }
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function pruneModelMetadata(metadata: SessionModelMetadata): SessionModelMetadata | null {
  const pruned = Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => typeof value === "string" && value.trim())
  ) as SessionModelMetadata;
  return Object.keys(pruned).length > 0 ? pruned : null;
}

function parseSessionModelMetadata(metadata?: string | null): SessionModelMetadata | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    return pruneModelMetadata({
      provider: nonEmptyString(record.provider) || nonEmptyString(record.providerType),
      provider_id: nonEmptyString(record.provider_id) || nonEmptyString(record.providerId),
      provider_name: nonEmptyString(record.provider_name) || nonEmptyString(record.providerName),
      model: nonEmptyString(record.model) || nonEmptyString(record.model_id),
      agent_id: nonEmptyString(record.agent_id) || nonEmptyString(record.agentId),
      agent_name: nonEmptyString(record.agent_name) || nonEmptyString(record.agentName),
      agent_type: nonEmptyString(record.agent_type) || nonEmptyString(record.agentType),
    });
  } catch {
    return null;
  }
}

function mergeSessionModelMetadata(
  primary?: SessionModelMetadata | null,
  fallback?: SessionModelMetadata | null
): SessionModelMetadata | null {
  const merged: SessionModelMetadata = { ...(fallback ?? {}) };
  for (const [key, value] of Object.entries(primary ?? {}) as Array<
    [keyof SessionModelMetadata, string | undefined]
  >) {
    const normalized = nonEmptyString(value);
    if (normalized) merged[key] = normalized;
  }
  return pruneModelMetadata(merged);
}

export function resolveSessionModelMetadata(agentId?: string | null): SessionModelMetadata | null {
  const normalizedAgentId = nonEmptyString(agentId);
  if (!normalizedAgentId) return null;
  const agent = agentManager.get(normalizedAgentId);
  if (!agent) return null;
  const providerId = nonEmptyString(agent.provider_id) || nonEmptyString(agent.provider);
  const provider = providerId ? providerManager.get(providerId) : undefined;
  return pruneModelMetadata({
    provider: nonEmptyString(provider?.provider) || providerId,
    provider_id: providerId,
    provider_name: nonEmptyString(provider?.name),
    model: nonEmptyString(agent.model),
    agent_id: agent.id,
    agent_name: nonEmptyString(agent.name),
    agent_type: nonEmptyString(agent.type),
  });
}

export function normalizeSessionWorkspaceDir(workspaceDir?: string | null): string | null {
  if (typeof workspaceDir !== "string") return null;

  const trimmed = workspaceDir.trim();
  if (!trimmed) return null;

  const expanded = trimmed.startsWith("~") ? trimmed.replace(/^~(?=$|\/|\\)/, homedir()) : trimmed;
  const absolute = isAbsolute(expanded) ? resolve(expanded) : resolve(process.cwd(), expanded);

  if (!existsSync(absolute)) {
    throw new Error(`Workspace directory does not exist: ${absolute}`);
  }
  const stats = statSync(absolute);
  if (!stats.isDirectory()) {
    throw new Error(`Workspace path is not a directory: ${absolute}`);
  }

  return absolute;
}

function resolveSessionAgentName(agentId: string): string | null {
  const inMemoryAgentName = agentManager.get(agentId)?.name;
  if (typeof inMemoryAgentName === "string" && inMemoryAgentName.trim().length > 0) {
    return inMemoryAgentName.trim();
  }

  try {
    const row = db.prepare("SELECT name FROM agents WHERE id = ?").get(agentId) as {
      name?: string | null;
    } | null;
    if (typeof row?.name === "string" && row.name.trim().length > 0) {
      return row.name.trim();
    }
  } catch {
    return null;
  }

  return null;
}

function deriveSessionTitle(messages: ChatMessage[], agentId: string): string {
  const agentName = resolveSessionAgentName(agentId);
  return deriveSessionTitleFromMessages(messages, agentName);
}

const DEFAULT_CONTEXT_TOKENS = 200_000;
const CONTEXT_SAFETY_MARGIN = 1.2; // 20% buffer for token estimation
const MAX_HISTORY_SHARE = 0.5; // Max 50% of context for history
const SUMMARY_RESERVE_TOKENS = 4000; // Reserve tokens for summary generation
const COMPACTION_SUMMARY_MAX_CHARS = 4000;
const COMPACTION_CHUNK_SUMMARY_MAX_CHARS = 2400;

const BASE_CHUNK_RATIO = 0.4;
const MIN_CHUNK_RATIO = 0.15;
const OVERSIZED_MESSAGE_THRESHOLD = 0.5; // Message > 50% of context is oversized

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(message: ChatMessage): number {
  const contentTokens = estimateTokens(compactChatContentForPrompt(message));
  const imageTokens = Array.isArray(message.images) ? message.images.length * 768 : 0;
  return contentTokens + imageTokens + 50;
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

function estimateRawMessageTokens(message: ChatMessage): number {
  const contentTokens = estimateTokens(message.content);
  const imageTokens = Array.isArray(message.images) ? message.images.length * 768 : 0;
  return contentTokens + imageTokens + 50;
}

export function estimateMessageTranscriptTokens(message: ChatMessage): number {
  const thinkingTokens = message.thinking ? estimateTokens(message.thinking) : 0;
  const toolTokens = message.tool_calls
    ? message.tool_calls.reduce((sum, tc) => sum + estimateTokens(JSON.stringify(tc)), 0)
    : 0;
  const processActivityTokens = message.process_activities
    ? message.process_activities.reduce(
        (sum, activity) => sum + estimateTokens(JSON.stringify(activity)),
        0
      )
    : 0;
  return estimateRawMessageTokens(message) + thinkingTokens + toolTokens + processActivityTokens;
}

export function estimateMessagesTranscriptTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTranscriptTokens(msg), 0);
}

export interface SessionContextUsage {
  usedTokens: number;
  limitTokens: number;
  remainingTokens: number;
  usedPercent: number;
  messageCount: number;
  transcriptTokens: number;
  metadataTokens: number;
  compacted: boolean;
  compactionCount: number;
  compactedTokens: number;
  source: "estimated";
}

export interface SessionTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  cacheHitRate: number | null;
  totalTokens: number;
  callCount: number;
  durationMs: number;
  tokensPerSecond: number | null;
  firstTokenMs: number | null;
  source: "metrics";
}

interface SessionTokenUsageRow {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  durationMs?: number;
  callCount?: number;
}

interface LatestSessionLatencyRow {
  firstTokenMs?: number;
}

export function summarizeSessionTokenUsage(sessionId: string): SessionTokenUsage {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      cacheHitRate: null,
      totalTokens: 0,
      callCount: 0,
      durationMs: 0,
      tokensPerSecond: null,
      firstTokenMs: null,
      source: "metrics",
    };
  }

  const sessionRow = db
    .prepare(
      `SELECT
         COALESCE(SUM(CAST(json_extract(metadata, '$.inputTokens') AS REAL)), 0) as inputTokens,
         COALESCE(SUM(CAST(json_extract(metadata, '$.outputTokens') AS REAL)), 0) as outputTokens,
         COALESCE(SUM(CAST(json_extract(metadata, '$.cachedInputTokens') AS REAL)), 0) as cachedInputTokens,
         COALESCE(SUM(CAST(json_extract(metadata, '$.cacheWriteTokens') AS REAL)), 0) as cacheWriteTokens,
         COALESCE(SUM(value), 0) as totalTokens,
         COALESCE(SUM(CASE
           WHEN CAST(json_extract(metadata, '$.durationMs') AS REAL) > 0
           THEN CAST(json_extract(metadata, '$.durationMs') AS REAL)
           ELSE 0
         END), 0) as durationMs,
         COUNT(*) as callCount
       FROM metrics
       WHERE type = 'token_usage_by_session'
         AND key = ?`
    )
    .get(normalizedSessionId) as SessionTokenUsageRow | null;

  const latestLatency = db
    .prepare(
      `SELECT CAST(json_extract(metadata, '$.firstTokenMs') AS REAL) as firstTokenMs
       FROM metrics
       WHERE type = 'token_usage_by_session'
         AND key = ?
         AND json_type(metadata, '$.firstTokenMs') IN ('integer', 'real')
         AND CAST(json_extract(metadata, '$.firstTokenMs') AS REAL) > 0
       ORDER BY rowid DESC
       LIMIT 1`
    )
    .get(normalizedSessionId) as LatestSessionLatencyRow | null;

  const row = sessionRow;

  const inputTokens = Math.max(0, Math.round(Number(row?.inputTokens || 0)));
  const outputTokens = Math.max(0, Math.round(Number(row?.outputTokens || 0)));
  const cachedInputTokens = Math.max(0, Math.round(Number(row?.cachedInputTokens || 0)));
  const cacheWriteTokens = Math.max(0, Math.round(Number(row?.cacheWriteTokens || 0)));
  const totalTokens = Math.max(
    inputTokens + outputTokens,
    Math.round(Number(row?.totalTokens || 0))
  );
  const durationMs = Math.max(0, Number(row?.durationMs || 0));
  const tokensPerSecond =
    durationMs > 0 ? Number(((outputTokens / durationMs) * 1000).toFixed(2)) : null;
  const firstTokenMs = Number(latestLatency?.firstTokenMs);

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    cacheHitRate:
      inputTokens > 0 && cachedInputTokens <= inputTokens
        ? Number(((cachedInputTokens / inputTokens) * 100).toFixed(1))
        : null,
    totalTokens,
    callCount: Math.max(0, Math.round(Number(row?.callCount || 0))),
    durationMs: Math.round(durationMs),
    tokensPerSecond,
    firstTokenMs: Number.isFinite(firstTokenMs) ? Math.max(0, Math.round(firstTokenMs)) : null,
    source: "metrics",
  };
}

export function estimateSessionContextUsage(
  messages: ChatMessage[],
  model?: string,
  options?: {
    sessionId?: string;
    compactionCount?: number;
  }
): SessionContextUsage {
  const usedTokens = Math.max(0, estimateMessagesTokens(messages));
  const transcriptTokens = Math.max(usedTokens, estimateMessagesTranscriptTokens(messages));
  const limitTokens = Math.max(1, getContextWindow(model));
  const remainingTokens = Math.max(0, limitTokens - usedTokens);
  const usedPercent = Math.min(100, Math.round((usedTokens / limitTokens) * 1000) / 10);
  const persistedCompactedTokens =
    typeof options?.sessionId === "string" && options.sessionId.trim()
      ? Math.max(0, tables.metrics.getTotal("context_compaction", options.sessionId.trim()))
      : 0;
  const persistedCompactionCount =
    typeof options?.sessionId === "string" && options.sessionId.trim()
      ? Math.max(0, tables.metrics.getCount("context_compaction", options.sessionId.trim()))
      : 0;
  const compactionCount = Math.max(
    0,
    Number.isFinite(options?.compactionCount) ? Math.floor(options?.compactionCount ?? 0) : 0,
    persistedCompactionCount,
    messages.filter(
      (message) =>
        typeof message.content === "string" &&
        /^\[Context Summary:|^Previous conversation summary:/i.test(message.content.trim())
    ).length
  );
  const compactedTokens = Math.max(0, Math.round(persistedCompactedTokens));
  return {
    usedTokens,
    limitTokens,
    remainingTokens,
    usedPercent,
    messageCount: messages.length,
    transcriptTokens,
    metadataTokens: Math.max(0, transcriptTokens - usedTokens),
    compacted: compactionCount > 0 || compactedTokens > 0,
    compactionCount,
    compactedTokens,
    source: "estimated",
  };
}

export function computeAdaptiveChunkRatio(messages: ChatMessage[], contextWindow: number): number {
  if (messages.length === 0) return BASE_CHUNK_RATIO;

  const totalTokens = estimateMessagesTokens(messages);
  const avgTokens = totalTokens / messages.length;

  const safeAvgTokens = avgTokens * CONTEXT_SAFETY_MARGIN;
  const avgRatio = safeAvgTokens / contextWindow;

  if (avgRatio > 0.1) {
    const reduction = Math.min(avgRatio * 2, BASE_CHUNK_RATIO - MIN_CHUNK_RATIO);
    return Math.max(MIN_CHUNK_RATIO, BASE_CHUNK_RATIO - reduction);
  }

  return BASE_CHUNK_RATIO;
}

export function isOversizedForSummary(message: ChatMessage, contextWindow: number): boolean {
  const tokens = estimateMessageTokens(message) * CONTEXT_SAFETY_MARGIN;
  return tokens > contextWindow * OVERSIZED_MESSAGE_THRESHOLD;
}

export function splitMessagesByTokenShare(
  messages: ChatMessage[],
  parts: number = 2
): ChatMessage[][] {
  if (messages.length === 0) return [];
  const normalizedParts = Math.min(Math.max(1, Math.floor(parts)), Math.max(1, messages.length));
  if (normalizedParts <= 1) return [messages];

  const totalTokens = estimateMessagesTokens(messages);
  const targetTokens = totalTokens / normalizedParts;
  const chunks: ChatMessage[][] = [];
  let current: ChatMessage[] = [];
  let currentTokens = 0;

  for (const message of messages) {
    const messageTokens = estimateMessageTokens(message);
    if (
      chunks.length < normalizedParts - 1 &&
      current.length > 0 &&
      currentTokens + messageTokens > targetTokens
    ) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }

    current.push(message);
    currentTokens += messageTokens;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

export function getContextWindow(model?: string): number {
  if (!model) return DEFAULT_CONTEXT_TOKENS;

  const modelLower = model.toLowerCase();

  try {
    const dbModel = tables.providerModels.getByModelId(model);
    const dbModelIsGenericFallback =
      dbModel?.model_name?.trim().toLowerCase() === dbModel?.model_id?.trim().toLowerCase() &&
      dbModel?.context_window === 128000 &&
      dbModel?.max_tokens === 8192;
    if (dbModel?.context_window && dbModel.context_window > 0 && !dbModelIsGenericFallback) {
      return dbModel.context_window;
    }
    if (model !== modelLower) {
      const dbModelLower = tables.providerModels.getByModelId(modelLower);
      const dbModelLowerIsGenericFallback =
        dbModelLower?.model_name?.trim().toLowerCase() ===
          dbModelLower?.model_id?.trim().toLowerCase() &&
        dbModelLower?.context_window === 128000 &&
        dbModelLower?.max_tokens === 8192;
      if (
        dbModelLower?.context_window &&
        dbModelLower.context_window > 0 &&
        !dbModelLowerIsGenericFallback
      ) {
        return dbModelLower.context_window;
      }
    }
  } catch {
    void 0;
  }

  for (const provider of Object.values(providers)) {
    const modelConfig = provider.models?.find(
      (m: { id: string; context?: number }) => m.id.toLowerCase() === modelLower
    );
    if (modelConfig?.context && modelConfig.context > 0) {
      return modelConfig.context;
    }
  }

  const patternMatches = [
    { pattern: "claude", tokens: 200_000 },
    { pattern: "gemini", tokens: 1_048_576 },
    { pattern: "gpt-5.1", tokens: 400_000 },
    { pattern: "gpt-5.2", tokens: 400_000 },
    { pattern: "gpt-5", tokens: 128_000 },
    { pattern: "gpt-4", tokens: 128_000 },
    { pattern: "o1", tokens: 200_000 },
    { pattern: "o3", tokens: 200_000 },
    { pattern: "kimi-code-oauth/k3", tokens: 1_048_576 },
    { pattern: "kimi-code/k3", tokens: 1_048_576 },
    { pattern: "kimi-for-coding", tokens: 262_144 },
    { pattern: "kimi-code", tokens: 262_144 },
    { pattern: "kimi", tokens: 256_000 },
    { pattern: "minimax", tokens: 200_000 },
    { pattern: "deepseek", tokens: 128_000 },
    { pattern: "qwen3-coder", tokens: 262_144 },
    { pattern: "qwen", tokens: 128_000 },
    { pattern: "grok-build", tokens: 256_000 },
    { pattern: "grok-4.5", tokens: 500_000 },
    { pattern: "grok-4", tokens: 256_000 },
    { pattern: "grok", tokens: 256_000 },
    { pattern: "llama-3.3", tokens: 131_072 },
    { pattern: "llama", tokens: 128_000 },
    { pattern: "glm-4.7", tokens: 204_800 },
    { pattern: "glm", tokens: 128_000 },
    { pattern: "mixtral", tokens: 32_000 },
    { pattern: "mistral", tokens: 128_000 },
  ];

  for (const { pattern, tokens } of patternMatches) {
    if (modelLower.includes(pattern)) {
      return tokens;
    }
  }

  return DEFAULT_CONTEXT_TOKENS;
}

export function shouldCompactContext(
  messages: ChatMessage[],
  model?: string,
  newContent?: string
): { needed: boolean; currentTokens: number; maxTokens: number; availableTokens: number } {
  const contextWindow = getContextWindow(model);
  const currentTokens = estimateMessagesTokens(messages);
  const newContentTokens = newContent ? estimateTokens(newContent) : 0;
  const totalTokens = currentTokens + newContentTokens;

  const maxUsableTokens = Math.floor(contextWindow / CONTEXT_SAFETY_MARGIN);
  const availableTokens = maxUsableTokens - totalTokens;

  return {
    needed: availableTokens < SUMMARY_RESERVE_TOKENS,
    currentTokens: totalTokens,
    maxTokens: contextWindow,
    availableTokens,
  };
}

export async function compactContext(
  messages: ChatMessage[],
  model?: string,
  providerId?: string,
  options?: { force?: boolean }
): Promise<{ messages: ChatMessage[]; summary?: string; wasCompacted: boolean }> {
  const contextWindow = getContextWindow(model);
  const maxHistoryTokens = Math.floor((contextWindow * MAX_HISTORY_SHARE) / CONTEXT_SAFETY_MARGIN);

  const systemMessages = messages.filter((m) => m.role === "system");
  const nonSystemMessages = messages.filter((m) => m.role !== "system");

  // Token-aware recent window: keep as many trailing messages as fit the budget,
  // rather than a fixed -4 tail. Ensures the model retains the most context.
  const minRecent = 4;
  let recentCount = Math.min(nonSystemMessages.length, minRecent);
  const systemTokens = estimateMessagesTokens(systemMessages);
  const reserveForSummaryAndSystem = systemTokens + SUMMARY_RESERVE_TOKENS;
  if (!options?.force) {
    for (let n = recentCount + 1; n <= nonSystemMessages.length; n += 1) {
      const candidateRecent = nonSystemMessages.slice(-n);
      const candidateTokens = estimateMessagesTokens(candidateRecent);
      if (candidateTokens > (maxHistoryTokens - reserveForSummaryAndSystem) * 0.4) break;
      recentCount = n;
    }
  }
  const recentMessages = nonSystemMessages.slice(-recentCount);
  const olderMessages = nonSystemMessages.slice(0, -recentCount);

  if (olderMessages.length === 0) {
    return { messages, wasCompacted: false };
  }

  const recentTokens = estimateMessagesTokens(recentMessages);
  const availableForOlder = maxHistoryTokens - recentTokens - reserveForSummaryAndSystem;

  const olderTokens = estimateMessagesTokens(olderMessages);
  if (!options?.force && olderTokens <= availableForOlder) {
    return { messages, wasCompacted: false };
  }

  log.info("Compacting context messages", {
    olderMessageCount: olderMessages.length,
    olderTokens,
  });

  let summary: string;
  try {
    if (providerId) {
      summary = await generateContextSummary(olderMessages, providerId, model);
    } else {
      summary = createFallbackSummary(olderMessages);
    }
  } catch (error) {
    log.exception("Summary generation failed, using fallback", error);
    summary = createFallbackSummary(olderMessages);
  }

  const summaryMessage: ChatMessage = {
    role: "system",
    content: `[Context Summary: ${summary}]`,
    timestamp: new Date().toISOString(),
  };

  const compactedMessages = [...systemMessages, summaryMessage, ...recentMessages];

  log.info("Context compaction complete", {
    messagesBefore: messages.length,
    messagesAfter: compactedMessages.length,
  });

  return {
    messages: compactedMessages,
    summary,
    wasCompacted: true,
  };
}

/**
 * Structured summary prompt with a compaction quality contract.
 * Forces explicit sections + literal identifier preservation so the summary is
 * genuinely useful for continuing work, not a vague paragraph.
 */
function buildStructuredSummaryPrompt(conversationText: string, previousSummary?: string): string {
  return `Summarize the conversation history below so work can continue without it. Be precise, not generic.

Use EXACTLY these markdown sections (omit a section if empty):
## Decisions
- Concrete decisions made (one per bullet).
## Open TODOs
- Outstanding tasks / next steps.
## Constraints / Rules
- Preferences, constraints, or requirements the user stated.
## Pending user asks
- Unanswered questions or requested follow-ups.
## Exact identifiers
- Literal file paths, URLs, IDs, ports, hashes, version numbers, function/symbol names that must be preserved verbatim. Do NOT paraphrase these.

Keep each section tight. Total under 250 words. Do NOT include filler like "The user discussed...". Only durable facts.
${previousSummary ? `\nA prior summary of even-older context exists; fold it in where relevant:\n<prior_summary>\n${previousSummary}\n</prior_summary>\n` : ""}
Conversation to summarize:
${conversationText}`;
}

function messagesToConversationText(messages: ChatMessage[]): string {
  return messages
    .map((message) => `${message.role}: ${compactChatContentForPrompt(message)}`)
    .join("\n\n");
}

async function generateContextSummary(
  messages: ChatMessage[],
  providerId: string,
  model?: string
): Promise<string> {
  const provider = providerManager.getWithCredentials(providerId);
  if (!provider) {
    throw new Error("Provider not found");
  }

  // If the older history is large, chunk it by token share, summarize each chunk,
  // then merge the chunk summaries in a final pass (summarize-in-stages).
  // ~2k tokens per chunk keeps each summary call well within the aux model's window.
  const totalTokens = estimateMessagesTokens(messages);
  const chunkCount = totalTokens > 8000 ? Math.min(4, Math.ceil(totalTokens / 4000)) : 1;

  if (chunkCount <= 1) {
    const prompt = buildStructuredSummaryPrompt(messagesToConversationText(messages));
    const response = await agentManager.callLLM(
      provider,
      model,
      [{ role: "user", content: prompt }],
      []
    );
    return response.content.slice(0, COMPACTION_SUMMARY_MAX_CHARS);
  }

  // Multi-stage: summarize each chunk, then merge.
  const chunks = splitMessagesByTokenShare(messages, chunkCount);
  const chunkSummaries: string[] = [];
  let previousSummary: string | undefined;
  for (const chunk of chunks) {
    const prompt = buildStructuredSummaryPrompt(messagesToConversationText(chunk), previousSummary);
    const response = await agentManager.callLLM(
      provider,
      model,
      [{ role: "user", content: prompt }],
      []
    );
    const summary = response.content.slice(0, COMPACTION_CHUNK_SUMMARY_MAX_CHARS);
    chunkSummaries.push(summary);
    previousSummary = summary;
  }

  // Final merge pass.
  const mergePrompt = `Merge these partial context summaries into one concise summary with these sections:
## Decisions / ## Open TODOs / ## Constraints / ## Pending asks / ## Exact identifiers
Deduplicate. Keep it under 250 words. Preserve all literal identifiers.

Partial summaries:
${chunkSummaries.map((s, i) => `--- Part ${i + 1} ---\n${s}`).join("\n")}`;
  const merged = await agentManager.callLLM(
    provider,
    model,
    [{ role: "user", content: mergePrompt }],
    []
  );
  return merged.content.slice(0, COMPACTION_SUMMARY_MAX_CHARS);
}

function createFallbackSummary(messages: ChatMessage[]): string {
  const transcript = messagesToConversationText(messages.slice(-12));
  return `Earlier conversation (${messages.length} messages):\n${transcript}`.slice(
    0,
    COMPACTION_SUMMARY_MAX_CHARS
  );
}

export async function persistSession(
  sessionId: string,
  agentId: string,
  messages: ChatMessage[],
  workspaceDir?: string | null,
  sessionTitle?: string | null,
  useModelRouter?: boolean
): Promise<boolean> {
  try {
    const hasWorkspaceUpdate = workspaceDir !== undefined;
    const hasTitleUpdate = sessionTitle !== undefined;
    const normalizedWorkspaceDir = hasWorkspaceUpdate
      ? normalizeSessionWorkspaceDir(workspaceDir)
      : null;
    const normalizedTitle = hasTitleUpdate ? normalizeSessionTitle(sessionTitle) : null;
    const existing = db
      .prepare("SELECT id, title FROM chat_sessions WHERE id = ?")
      .get(sessionId) as { id: string; title?: string | null } | null;
    const existingTitle = normalizeSessionTitle(existing?.title);
    const derivedTitle = normalizedTitle || deriveSessionTitle(messages, agentId);

    if (existing) {
      if (hasWorkspaceUpdate && hasTitleUpdate) {
        db.prepare(
          "UPDATE chat_sessions SET agent_id = ?, workspace_dir = ?, title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).run(agentId, normalizedWorkspaceDir, normalizedTitle, sessionId);
      } else if (hasWorkspaceUpdate) {
        db.prepare(
          "UPDATE chat_sessions SET agent_id = ?, workspace_dir = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).run(agentId, normalizedWorkspaceDir, sessionId);
      } else if (hasTitleUpdate) {
        db.prepare(
          "UPDATE chat_sessions SET agent_id = ?, title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).run(agentId, normalizedTitle, sessionId);
      } else {
        db.prepare(
          "UPDATE chat_sessions SET agent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).run(agentId, sessionId);
      }

      if (!hasTitleUpdate && !existingTitle && derivedTitle) {
        db.prepare(
          "UPDATE chat_sessions SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).run(derivedTitle, sessionId);
      }
      if (typeof useModelRouter === "boolean") {
        tables.chatSessions.updateRouting(sessionId, agentId, useModelRouter);
      }
    } else {
      db.prepare(
        "INSERT INTO chat_sessions (id, agent_id, use_model_router, title, messages, workspace_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
      ).run(
        sessionId,
        agentId,
        useModelRouter === true ? 1 : 0,
        derivedTitle,
        JSON.stringify(messages.slice(0, 2)),
        normalizedWorkspaceDir
      );
    }

    log.info("Persisted session", { sessionId, messageCount: messages.length });
    return true;
  } catch (error) {
    // Return failure so callers don't falsely mark the session as persisted;
    // a swallowed error here previously reported success to the client while
    // the write never landed.
    log.exception("Failed to persist session", error, { sessionId });
    return false;
  }
}

interface PersistedSessionContextState {
  messages: ChatMessage[];
  compactionCount: number;
}

function parsePersistedSessionContextState(
  value?: string | null
): PersistedSessionContextState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.messages) || record.messages.length === 0) return null;
    const messages = record.messages.filter(
      (message): message is ChatMessage =>
        !!message &&
        typeof message === "object" &&
        !Array.isArray(message) &&
        typeof (message as Record<string, unknown>).role === "string" &&
        typeof (message as Record<string, unknown>).content === "string"
    );
    if (messages.length !== record.messages.length) return null;
    const rawCount = Number(record.compactionCount);
    return {
      messages,
      compactionCount: Number.isFinite(rawCount) ? Math.max(1, Math.floor(rawCount)) : 1,
    };
  } catch {
    return null;
  }
}

export function persistSessionContextState(
  sessionId: string,
  messages: ChatMessage[],
  compactionCount: number
): boolean {
  const normalizedCount = Math.max(0, Math.floor(compactionCount));
  if (!sessionId.trim() || normalizedCount === 0 || messages.length === 0) return false;
  try {
    const state: PersistedSessionContextState = {
      messages,
      compactionCount: normalizedCount,
    };
    return (
      db
        .prepare("UPDATE chat_sessions SET context_state = ? WHERE id = ?")
        .run(JSON.stringify(state), sessionId).changes > 0
    );
  } catch (error) {
    log.exception("Failed to persist compacted session context", error, { sessionId });
    return false;
  }
}

export function clearSessionContextState(sessionId: string): boolean {
  if (!sessionId.trim()) return false;
  try {
    return (
      db.prepare("UPDATE chat_sessions SET context_state = NULL WHERE id = ?").run(sessionId)
        .changes > 0
    );
  } catch (error) {
    log.exception("Failed to clear compacted session context", error, { sessionId });
    return false;
  }
}

export async function loadPersistedSession(sessionId: string): Promise<{
  agentId: string;
  useModelRouter: boolean;
  messages: ChatMessage[];
  contextMessages: ChatMessage[] | null;
  compactionCount: number;
  workspaceDir: string | null;
  title: string | null;
} | null> {
  try {
    const sessionMessages =
      (tables.sessionMessages?.getBySession(sessionId) as PersistedSessionMessage[]) || [];

    if (sessionMessages.length === 0) {
      return null;
    }

    const messages: ChatMessage[] = sessionMessages.map((m) => {
      const parsed = parseSessionMessageMetadata(m.metadata);
      const images = attachmentsToImages((parsed as Record<string, unknown>).attachments);
      return {
        role: m.role as ChatMessage["role"],
        content: sanitizePersistedMessageContent(m.role, m.content),
        timestamp: m.created_at,
        ...parsed,
        ...(images.length ? { images } : {}),
      };
    });

    const session = db
      .prepare(
        "SELECT agent_id, use_model_router, workspace_dir, title, context_state FROM chat_sessions WHERE id = ?"
      )
      .get(sessionId) as {
      agent_id?: string;
      use_model_router?: number;
      workspace_dir?: string | null;
      title?: string | null;
      context_state?: string | null;
    } | null;
    const agentId =
      (typeof session?.agent_id === "string" && session.agent_id.trim()
        ? session.agent_id.trim()
        : undefined) || (sessionMessages[0] as { agent_id?: string })?.agent_id;
    const workspaceDir =
      typeof session?.workspace_dir === "string" && session.workspace_dir.trim().length > 0
        ? session.workspace_dir
        : null;
    const title = normalizeSessionTitle(session?.title);
    const contextState = parsePersistedSessionContextState(session?.context_state);

    log.debug("Loaded persisted session", { sessionId, messageCount: messages.length });

    return {
      agentId: agentId || "default",
      useModelRouter: session?.use_model_router === 1,
      messages,
      contextMessages: contextState?.messages ?? null,
      compactionCount: contextState?.compactionCount ?? 0,
      workspaceDir,
      title: title || deriveSessionTitle(messages, agentId || "default"),
    };
  } catch (error) {
    log.exception("Failed to load persisted session", error, { sessionId });
    return null;
  }
}

export interface PersistedSessionListEntry {
  id: string;
  agentId: string;
  useModelRouter: boolean;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  workspaceDir: string | null;
  pinned: boolean;
  lastMessageRole: string | null;
  lastMessageContent: string | null;
  modelMetadata: SessionModelMetadata | null;
}

interface PersistedSessionListRow {
  id: string;
  agentId: string;
  useModelRouter: number;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  workspaceDir: string | null;
  pinned: number;
  lastMessageRole: string | null;
  lastMessageContent: string | null;
  lastModelMetadata: string | null;
}

function normalizePersistedSessionListRow(
  session: PersistedSessionListRow
): PersistedSessionListEntry {
  return {
    ...session,
    useModelRouter: session.useModelRouter === 1,
    lastMessageContent:
      typeof session.lastMessageContent === "string" && session.lastMessageRole === "assistant"
        ? sanitizeAssistantContent(session.lastMessageContent)
        : session.lastMessageContent,
    pinned: !!session.pinned,
    modelMetadata: mergeSessionModelMetadata(
      resolveSessionModelMetadata(session.agentId),
      parseSessionModelMetadata(session.lastModelMetadata)
    ),
  };
}

function persistedSessionListSql(
  limit?: number,
  offset?: number
): {
  sql: string;
  params: number[];
} {
  // The last-message subqueries resolve the target rowid FIRST (sorting only
  // rowids), then fetch that one row's columns. Sorting rows directly pulls
  // their payloads through the temp b-tree — with large stored messages that
  // meant re-reading hundreds of MB per list call. Content is also substr'd to
  // the preview budget so the list never ships whole messages.
  const sql = `
      SELECT
        cs.id,
        cs.agent_id as agentId,
        COALESCE(cs.use_model_router, 0) as useModelRouter,
        cs.title as title,
        cs.created_at as createdAt,
        cs.updated_at as updatedAt,
        cs.workspace_dir as workspaceDir,
        COALESCE(cs.pinned, 0) as pinned,
        COALESCE(NULLIF((
          SELECT COUNT(*)
          FROM session_messages sm
          WHERE sm.session_id = cs.id
        ), 0), json_array_length(cs.messages), 0) as messageCount,
        COALESCE((
          SELECT lm.role FROM session_messages lm WHERE lm.rowid = (
            SELECT lm2.rowid FROM session_messages lm2
            WHERE lm2.session_id = cs.id
            ORDER BY lm2.rowid DESC LIMIT 1
          )
        ), json_extract(cs.messages, '$[#-1].role')) as lastMessageRole,
        COALESCE((
          SELECT substr(lm.content, 1, 501) FROM session_messages lm WHERE lm.rowid = (
            SELECT lm2.rowid FROM session_messages lm2
            WHERE lm2.session_id = cs.id
            ORDER BY lm2.rowid DESC LIMIT 1
          )
        ), substr(json_extract(cs.messages, '$[#-1].content'), 1, 501)) as lastMessageContent,
        (
          SELECT lm.metadata FROM session_messages lm WHERE lm.rowid = (
            SELECT lm2.rowid FROM session_messages lm2
            WHERE lm2.session_id = cs.id
              AND lm2.role = 'assistant'
              AND lm2.metadata IS NOT NULL
              AND LENGTH(lm2.metadata) > 0
            ORDER BY lm2.rowid DESC LIMIT 1
          )
        ) as lastModelMetadata
      FROM chat_sessions cs
      ORDER BY cs.pinned DESC, cs.updated_at DESC
      ${typeof limit === "number" ? "LIMIT ? OFFSET ?" : ""}
    `;
  return typeof limit === "number" ? { sql, params: [limit, offset ?? 0] } : { sql, params: [] };
}

export async function countPersistedSessions(): Promise<number> {
  try {
    const row = db.prepare("SELECT COUNT(*) as total FROM chat_sessions").get() as {
      total?: number;
    } | null;
    return typeof row?.total === "number" ? row.total : 0;
  } catch (error) {
    log.exception("Failed to count persisted sessions", error);
    return 0;
  }
}

export async function listPersistedSessions(options?: {
  limit?: number;
  offset?: number;
}): Promise<PersistedSessionListEntry[]> {
  try {
    const normalizedLimit =
      typeof options?.limit === "number" && Number.isFinite(options.limit)
        ? Math.max(1, Math.floor(options.limit))
        : undefined;
    const normalizedOffset =
      typeof options?.offset === "number" && Number.isFinite(options.offset)
        ? Math.max(0, Math.floor(options.offset))
        : 0;
    const { sql, params } = persistedSessionListSql(normalizedLimit, normalizedOffset);
    const sessions = db.prepare(sql).all(...params) as PersistedSessionListRow[];

    return sessions.map(normalizePersistedSessionListRow);
  } catch (error) {
    log.exception("Failed to list persisted sessions", error);
    return [];
  }
}

export async function listPersistedSessionPage(options?: {
  limit?: number;
  offset?: number;
}): Promise<{
  sessions: PersistedSessionListEntry[];
  total: number;
}> {
  const [sessions, total] = await Promise.all([
    listPersistedSessions(options),
    countPersistedSessions(),
  ]);
  return { sessions, total };
}

export async function getPersistedSessionWorkspace(sessionId: string): Promise<string | null> {
  return tables.chatSessions.getWorkspace(sessionId);
}

export async function setPersistedSessionWorkspace(
  sessionId: string,
  workspaceDir: string | null
): Promise<string | null> {
  const normalizedWorkspaceDir = normalizeSessionWorkspaceDir(workspaceDir);
  tables.chatSessions.updateWorkspace(sessionId, normalizedWorkspaceDir);
  return normalizedWorkspaceDir;
}

export async function setPersistedSessionTitle(
  sessionId: string,
  title: string | null
): Promise<string | null> {
  const normalizedTitle = normalizeSessionTitle(title);
  tables.chatSessions.updateTitle(sessionId, normalizedTitle);
  return normalizedTitle;
}

export async function setPersistedSessionAgent(
  sessionId: string,
  agentId: string
): Promise<boolean> {
  const normalizedAgentId = nonEmptyString(agentId);
  if (!normalizedAgentId) return false;
  const result = db
    .prepare("UPDATE chat_sessions SET agent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(normalizedAgentId, sessionId);
  return (result.changes ?? 0) > 0;
}

export async function setPersistedSessionRouting(
  sessionId: string,
  agentId: string,
  useModelRouter: boolean
): Promise<boolean> {
  const normalizedAgentId = nonEmptyString(agentId);
  if (!normalizedAgentId) return false;
  return tables.chatSessions.updateRouting(sessionId, normalizedAgentId, useModelRouter);
}

/** Returns true when a chat_sessions row was actually updated (i.e. it exists). */
export async function setPersistedSessionPinned(
  sessionId: string,
  pinned: boolean
): Promise<boolean> {
  return tables.chatSessions.setPinned(sessionId, pinned);
}

export async function deletePersistedSession(sessionId: string): Promise<boolean> {
  try {
    clearSessionEventLedger(sessionId);
    db.prepare("DELETE FROM session_messages WHERE session_id = ?").run(sessionId);

    db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(sessionId);

    log.info("Deleted persisted session", { sessionId });
    return true;
  } catch (error) {
    log.exception("Failed to delete persisted session", error, { sessionId });
    return false;
  }
}

export async function getSessionStats(sessionId: string): Promise<{
  messageCount: number;
  tokenCount: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
} | null> {
  try {
    const stats = db
      .prepare(
        `
      SELECT 
        COUNT(*) as messageCount,
        MIN(created_at) as firstMessageAt,
        MAX(created_at) as lastMessageAt
      FROM session_messages
      WHERE session_id = ?
    `
      )
      .get(sessionId);

    if (!stats) return null;

    const typedStats = stats as {
      messageCount: number;
      firstMessageAt: string | null;
      lastMessageAt: string | null;
    };

    const messages = (tables.sessionMessages?.getBySession(sessionId) || []) as Array<{
      content: string;
    }>;
    const tokenCount = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);

    return {
      messageCount: typedStats.messageCount,
      tokenCount,
      firstMessageAt: typedStats.firstMessageAt,
      lastMessageAt: typedStats.lastMessageAt,
    };
  } catch (error) {
    log.exception("Failed to get session stats", error, { sessionId });
    return null;
  }
}
