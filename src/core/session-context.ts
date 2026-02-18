// Session persistence and context management for chat
import db, { tables } from "./database";
import { agentManager } from "./agent";
import { providerManager, providers } from "./providers";
import type { ChatMessage } from "../api/chat";

interface PersistedSessionMessage {
  role: string;
  content: string;
  created_at: string;
  metadata?: string;
  agent_id?: string;
}

type SessionMessageMetadata = Partial<Pick<ChatMessage, "thinking" | "tool_calls">>;

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

// Context window configuration (Cybara compatible)
const DEFAULT_CONTEXT_TOKENS = 200_000;
const CONTEXT_SAFETY_MARGIN = 1.2; // 20% buffer for token estimation
const MAX_HISTORY_SHARE = 0.5; // Max 50% of context for history
const SUMMARY_RESERVE_TOKENS = 4000; // Reserve tokens for summary generation

// Cybara-style adaptive chunking
const BASE_CHUNK_RATIO = 0.4;
const MIN_CHUNK_RATIO = 0.15;
const OVERSIZED_MESSAGE_THRESHOLD = 0.5; // Message > 50% of context is oversized

// Simple token estimation (4 chars per token average)
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(message: ChatMessage): number {
  const contentTokens = estimateTokens(message.content);
  const thinkingTokens = message.thinking ? estimateTokens(message.thinking) : 0;
  const toolTokens = message.tool_calls
    ? message.tool_calls.reduce((sum, tc) => sum + estimateTokens(JSON.stringify(tc)), 0)
    : 0;
  return contentTokens + thinkingTokens + toolTokens + 50; // +50 for message overhead
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

/**
 * Cybara-style adaptive chunk ratio based on average message size.
 * When messages are large, we use smaller chunks to avoid exceeding model limits.
 */
export function computeAdaptiveChunkRatio(messages: ChatMessage[], contextWindow: number): number {
  if (messages.length === 0) return BASE_CHUNK_RATIO;

  const totalTokens = estimateMessagesTokens(messages);
  const avgTokens = totalTokens / messages.length;

  // Apply safety margin to account for estimation inaccuracy
  const safeAvgTokens = avgTokens * CONTEXT_SAFETY_MARGIN;
  const avgRatio = safeAvgTokens / contextWindow;

  // If average message is > 10% of context, reduce chunk ratio
  if (avgRatio > 0.1) {
    const reduction = Math.min(avgRatio * 2, BASE_CHUNK_RATIO - MIN_CHUNK_RATIO);
    return Math.max(MIN_CHUNK_RATIO, BASE_CHUNK_RATIO - reduction);
  }

  return BASE_CHUNK_RATIO;
}

/**
 * Check if a single message is too large to safely summarize.
 * If single message > 50% of context, it can't be summarized safely.
 */
export function isOversizedForSummary(message: ChatMessage, contextWindow: number): boolean {
  const tokens = estimateMessageTokens(message) * CONTEXT_SAFETY_MARGIN;
  return tokens > contextWindow * OVERSIZED_MESSAGE_THRESHOLD;
}

/**
 * Split messages into chunks by token share for staged summarization.
 */
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

// Get context window for a model
// Priority:
// 1. Database lookup (provider_models table - most accurate)
// 2. Static providers.ts definitions
// 3. Fallback defaults with pattern matching

export function getContextWindow(model?: string): number {
  // Default to 200k (Claude Opus 4.5)
  if (!model) return DEFAULT_CONTEXT_TOKENS;

  const modelLower = model.toLowerCase();

  // 1. Try database lookup first (most accurate, reflects user's configured providers)
  try {
    const dbModel = tables.providerModels.getByModelId(model);
    if (dbModel?.context_window && dbModel.context_window > 0) {
      return dbModel.context_window;
    }
    // Also try lowercase
    if (model !== modelLower) {
      const dbModelLower = tables.providerModels.getByModelId(modelLower);
      if (dbModelLower?.context_window && dbModelLower.context_window > 0) {
        return dbModelLower.context_window;
      }
    }
  } catch {
    // Database not available, continue to fallbacks
  }

  // 2. Static lookup from providers.ts (authoritative catalog)
  for (const provider of Object.values(providers)) {
    const modelConfig = provider.models?.find(
      (m: { id: string; context?: number }) => m.id.toLowerCase() === modelLower
    );
    if (modelConfig?.context && modelConfig.context > 0) {
      return modelConfig.context;
    }
  }

  // 3. Pattern-based fallback for unknown models (minimal set)
  const patternMatches = [
    // Claude models
    { pattern: "claude", tokens: 200_000 },
    // Gemini (1M context)
    { pattern: "gemini", tokens: 1_048_576 },
    // GPT-5.x series (400k)
    { pattern: "gpt-5.1", tokens: 400_000 },
    { pattern: "gpt-5.2", tokens: 400_000 },
    // GPT-4/5 (128k)
    { pattern: "gpt-5", tokens: 128_000 },
    { pattern: "gpt-4", tokens: 128_000 },
    // O-series reasoning
    { pattern: "o1", tokens: 200_000 },
    { pattern: "o3", tokens: 200_000 },
    // Kimi for Coding
    { pattern: "kimi-for-coding", tokens: 262_144 },
    { pattern: "kimi-code", tokens: 262_144 },
    { pattern: "kimi", tokens: 256_000 },
    // MiniMax
    { pattern: "minimax", tokens: 200_000 },
    // DeepSeek
    { pattern: "deepseek", tokens: 128_000 },
    // Qwen
    { pattern: "qwen3-coder", tokens: 262_144 },
    { pattern: "qwen", tokens: 128_000 },
    // Llama
    { pattern: "llama-3.3", tokens: 131_072 },
    { pattern: "llama", tokens: 128_000 },
    // GLM
    { pattern: "glm-4.7", tokens: 204_800 },
    { pattern: "glm", tokens: 128_000 },
    // Mistral
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

// Check if context compaction is needed
export function shouldCompactContext(
  messages: ChatMessage[],
  model?: string,
  newContent?: string
): { needed: boolean; currentTokens: number; maxTokens: number; availableTokens: number } {
  const contextWindow = getContextWindow(model);
  const currentTokens = estimateMessagesTokens(messages);
  const newContentTokens = newContent ? estimateTokens(newContent) : 0;
  const totalTokens = currentTokens + newContentTokens;

  // Apply safety margin
  const maxUsableTokens = Math.floor(contextWindow / CONTEXT_SAFETY_MARGIN);
  const availableTokens = maxUsableTokens - totalTokens;

  return {
    needed: availableTokens < SUMMARY_RESERVE_TOKENS,
    currentTokens: totalTokens,
    maxTokens: contextWindow,
    availableTokens,
  };
}

// Summarize older messages to fit within context window
export async function compactContext(
  messages: ChatMessage[],
  model?: string,
  providerId?: string
): Promise<{ messages: ChatMessage[]; summary?: string; wasCompacted: boolean }> {
  const contextWindow = getContextWindow(model);
  const maxHistoryTokens = Math.floor((contextWindow * MAX_HISTORY_SHARE) / CONTEXT_SAFETY_MARGIN);

  // Keep system message and recent messages
  const systemMessages = messages.filter((m) => m.role === "system");
  const nonSystemMessages = messages.filter((m) => m.role !== "system");

  // Always keep last 4 messages
  const recentMessages = nonSystemMessages.slice(-4);
  const olderMessages = nonSystemMessages.slice(0, -4);

  if (olderMessages.length === 0) {
    return { messages, wasCompacted: false };
  }

  const recentTokens = estimateMessagesTokens(recentMessages);
  const systemTokens = estimateMessagesTokens(systemMessages);
  const availableForOlder = maxHistoryTokens - recentTokens - systemTokens - SUMMARY_RESERVE_TOKENS;

  // If older messages fit, no compaction needed
  const olderTokens = estimateMessagesTokens(olderMessages);
  if (olderTokens <= availableForOlder) {
    return { messages, wasCompacted: false };
  }

  // Need to summarize older messages
  console.log(
    `[Context] Compacting ${olderMessages.length} messages (${olderTokens} tokens) into summary`
  );

  // Generate summary using LLM if provider available
  let summary: string;
  try {
    if (providerId) {
      summary = await generateContextSummary(olderMessages, providerId, model);
    } else {
      // Fallback: simple extraction of key points
      summary = createFallbackSummary(olderMessages);
    }
  } catch (error) {
    console.error("[Context] Summary generation failed, using fallback:", error);
    summary = createFallbackSummary(olderMessages);
  }

  // Create summary message
  const summaryMessage: ChatMessage = {
    role: "system",
    content: `[Context Summary: ${summary}]`,
    timestamp: new Date().toISOString(),
  };

  const compactedMessages = [...systemMessages, summaryMessage, ...recentMessages];

  console.log(
    `[Context] Compacted from ${messages.length} messages to ${compactedMessages.length} messages`
  );

  return {
    messages: compactedMessages,
    summary,
    wasCompacted: true,
  };
}

// Generate summary using LLM
async function generateContextSummary(
  messages: ChatMessage[],
  providerId: string,
  model?: string
): Promise<string> {
  const provider = providerManager.getWithCredentials(providerId);
  if (!provider) {
    throw new Error("Provider not found");
  }

  const summaryPrompt = `Please summarize the following conversation history into a concise paragraph. Focus on:
- Key topics discussed
- Important decisions made
- Action items or TODOs
- Any critical context needed to continue the conversation

Keep it under 200 words.

Conversation to summarize:
${messages.map((m) => `${m.role}: ${m.content.slice(0, 500)}${m.content.length > 500 ? "..." : ""}`).join("\n\n")}`;

  const response = await agentManager.callLLM(
    provider,
    model,
    [{ role: "user", content: summaryPrompt }],
    []
  );

  return response.content.slice(0, 1000); // Limit summary length
}

// Fallback summary when LLM is unavailable
function createFallbackSummary(messages: ChatMessage[]): string {
  const topics = new Set<string>();
  const userMessages = messages.filter((m) => m.role === "user");

  // Extract keywords from user messages
  for (const msg of userMessages.slice(-5)) {
    const words = msg.content
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 5);
    words.slice(0, 3).forEach((w) => topics.add(w));
  }

  return `Previous conversation covered: ${Array.from(topics).slice(0, 5).join(", ") || "various topics"}. ${messages.length} messages summarized.`;
}

// Persist session to database
export async function persistSession(
  sessionId: string,
  agentId: string,
  messages: ChatMessage[]
): Promise<void> {
  try {
    // Check if session exists
    const existing = db.prepare("SELECT id FROM chat_sessions WHERE id = ?").get(sessionId);

    if (existing) {
      // Update session
      db.prepare("UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
        sessionId
      );
    } else {
      // Create new session
      db.prepare(
        "INSERT INTO chat_sessions (id, agent_id, messages, created_at, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
      ).run(sessionId, agentId, JSON.stringify(messages.slice(0, 2))); // Store preview
    }

    console.log(
      `[Session] Persisted session ${sessionId.slice(0, 8)}... with ${messages.length} messages`
    );
  } catch (error) {
    console.error("[Session] Failed to persist session:", error);
  }
}

// Load session from database
export async function loadPersistedSession(
  sessionId: string
): Promise<{ agentId: string; messages: ChatMessage[] } | null> {
  try {
    // Get session messages from database
    const sessionMessages =
      (tables.sessionMessages?.getBySession(sessionId) as PersistedSessionMessage[]) || [];

    if (sessionMessages.length === 0) {
      return null;
    }

    // Reconstruct messages
    const messages: ChatMessage[] = sessionMessages.map((m) => ({
      role: m.role as ChatMessage["role"],
      content: m.content,
      timestamp: m.created_at,
      ...parseSessionMessageMetadata(m.metadata),
    }));

    // Get agent from first message or session table
    let agentId = (sessionMessages[0] as { agent_id?: string })?.agent_id;
    if (!agentId) {
      const session = db
        .prepare("SELECT agent_id FROM chat_sessions WHERE id = ?")
        .get(sessionId) as { agent_id?: string } | null;
      agentId = session?.agent_id;
    }

    console.log(
      `[Session] Loaded persisted session ${sessionId.slice(0, 8)}... with ${messages.length} messages`
    );

    return {
      agentId: agentId || "default",
      messages,
    };
  } catch (error) {
    console.error("[Session] Failed to load persisted session:", error);
    return null;
  }
}

// List all persisted sessions
export async function listPersistedSessions(): Promise<
  Array<{
    id: string;
    agentId: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
  }>
> {
  try {
    const sessions = db
      .prepare(
        `
      SELECT 
        cs.id,
        cs.agent_id as agentId,
        cs.created_at as createdAt,
        cs.updated_at as updatedAt,
        COUNT(sm.id) as messageCount
      FROM chat_sessions cs
      LEFT JOIN session_messages sm ON cs.id = sm.session_id
      GROUP BY cs.id
      ORDER BY cs.updated_at DESC
    `
      )
      .all() as Array<{
      id: string;
      agentId: string;
      createdAt: string;
      updatedAt: string;
      messageCount: number;
    }>;

    return sessions;
  } catch (error) {
    console.error("[Session] Failed to list persisted sessions:", error);
    return [];
  }
}

// Delete persisted session
export async function deletePersistedSession(sessionId: string): Promise<boolean> {
  try {
    // Delete messages first
    db.prepare("DELETE FROM session_messages WHERE session_id = ?").run(sessionId);

    // Delete session
    db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(sessionId);

    console.log(`[Session] Deleted persisted session ${sessionId.slice(0, 8)}...`);
    return true;
  } catch (error) {
    console.error("[Session] Failed to delete persisted session:", error);
    return false;
  }
}

// Get session stats
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

    // Get messages to count tokens
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
    console.error("[Session] Failed to get session stats:", error);
    return null;
  }
}
