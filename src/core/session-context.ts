// Session persistence and context management for chat
import db, { tables } from "./database";
import { randomUUID } from "crypto";
import { agentManager } from "./agent";
import { providerManager } from "./providers";
import type { ChatMessage } from "../api/chat";

// Context window configuration (OpenClaw compatible)
const DEFAULT_CONTEXT_TOKENS = 200_000;
const CONTEXT_SAFETY_MARGIN = 1.2; // 20% buffer for token estimation
const MAX_HISTORY_SHARE = 0.5; // Max 50% of context for history
const SUMMARY_RESERVE_TOKENS = 4000; // Reserve tokens for summary generation

// OpenClaw-style adaptive chunking
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
 * OpenClaw-style adaptive chunk ratio based on average message size.
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
// Based on Moltbot's verified model configurations from multiple sources:
// - models-config.providers.ts (MiniMax, Moonshot, Kimi, Qwen, Ollama)
// - opencode-zen-models.ts (OpenCode Zen proxy)
// - venice-models.ts (Venice AI)
// - bedrock-discovery.ts (AWS Bedrock)
// - github-copilot-models.ts (GitHub Copilot)
// - synthetic-models.ts (Hugging Face/Synthetic)
export function getContextWindow(model?: string): number {
  // Default to 200k (Claude Opus 4.5)
  if (!model) return DEFAULT_CONTEXT_TOKENS;

  const modelLower = model.toLowerCase();

  // Model-specific context windows from Moltbot's configs
  const contextWindows: Record<string, number> = {
    // ==========================================
    // ANTHROPIC (Claude) - 200k context
    // ==========================================
    "claude-opus-4-5": 200_000,
    "claude-opus-4": 200_000,
    "claude-sonnet-4-5": 200_000,
    "claude-sonnet-4": 200_000,
    "claude-opus": 200_000,
    "claude-sonnet": 200_000,
    "claude-haiku": 200_000,

    // ==========================================
    // OPENAI GPT - 128k-400k context
    // ==========================================
    // Standard GPT models
    "gpt-4": 128_000,
    "gpt-4o": 128_000,
    "gpt-4.1": 128_000,
    "gpt-4.1-mini": 128_000,
    "gpt-4.1-nano": 128_000,
    "gpt-4o-mini": 128_000,

    // GPT-5 series (via OpenCode Zen: 400k)
    "gpt-5": 128_000,
    "gpt-5.0": 128_000,
    "gpt-5.1": 400_000,
    "gpt-5.2": 400_000,

    // GPT-5.1 Codex series (via OpenCode Zen: 400k)
    "gpt-5.1-codex": 400_000,
    "gpt-5.1-codex-mini": 400_000,
    "gpt-5.1-codex-max": 400_000,

    // GPT-5.2 Codex (if available)
    "gpt-5.2-codex": 400_000,

    "gpt-5-mini": 128_000,

    // O-series reasoning models
    o1: 128_000,
    "o1-mini": 128_000,
    "o3-mini": 128_000,

    // ==========================================
    // KIMI (Moonshot) - 256k context
    // ==========================================
    "kimi-k2": 256_000,
    "kimi-k2.5": 256_000,
    "kimi-k2-thinking": 256_000,
    "kimi-k2.5-thinking": 256_000,

    // Kimi for Coding - 262,144 tokens (exact from Moltbot)
    "kimi-for-coding": 262_144,
    "kimi-code": 262_144,
    "kimi-coding": 262_144,

    // ==========================================
    // MINIMAX - 192k-200k context
    // ==========================================
    "minimax-text-01": 200_000,
    "minimax-m2.1": 192_000,
    "minimax-vl-01": 192_000,
    abab7: 128_000,
    "abab7-chat": 128_000,
    abab6: 128_000,

    // ==========================================
    // GOOGLE GEMINI - 1M context (1,048,576)
    // ==========================================
    "gemini-3-pro": 1_048_576,
    "gemini-3-pro-preview": 1_048_576,
    "gemini-3-flash": 1_048_576,
    "gemini-3-flash-preview": 1_048_576,
    "gemini-2-flash": 1_048_576,
    "gemini-2.5-pro": 1_048_576,
    "gemini-2.5-flash": 1_048_576,
    "gemini-pro": 1_048_576,
    "gemini-flash": 1_048_576,
    "gemini-1.5-pro": 1_048_576,
    "gemini-1.5-flash": 1_048_576,

    // ==========================================
    // DEEPSEEK - 128k-163k context
    // ==========================================
    "deepseek-r1": 128_000,
    "deepseek-v3": 128_000,
    "deepseek-v3.1": 128_000,
    "deepseek-v3.2": 163_840,
    "deepseek-chat": 128_000,
    "deepseek-coder": 128_000,
    "deepseek-coder-v2": 128_000,

    // ==========================================
    // QWEN (Alibaba) - 128k-262k context
    // ==========================================
    "qwen2.5": 128_000,
    "qwen2.5-coder": 128_000,
    qwen3: 128_000,
    "qwen3-coder": 262_144,
    "qwen-portal": 128_000,
    "qwen-max": 128_000,
    "qwen-plus": 128_000,
    "qwen-turbo": 128_000,

    // ==========================================
    // LLAMA (Meta) - 128k-131k context
    // ==========================================
    "llama3.3": 128_000,
    "llama3.2": 128_000,
    "llama3.1": 128_000,
    "llama-3.3": 131_072,
    "llama-3.3-70b": 131_072,
    "llama-3.2": 128_000,
    "llama-3.1": 128_000,
    "llama-3.1-405b": 128_000,
    llama3: 128_000,

    // ==========================================
    // GLM (Zhipu) - 198k-204k context
    // ==========================================
    "glm-4.7": 204_800,
    "glm-4": 128_000,
    "glm-4-plus": 128_000,
    "glm-4-flash": 128_000,

    // ==========================================
    // VENICE AI MODELS - 32k-262k context
    // ==========================================
    "venice-qwen3": 262_144,
    "venice-gpt": 262_144,
    "venice-llama-3.3": 131_072,
    "venice-llama-3.2": 131_072,
    "venice-qwen3-235b": 131_072,
    "venice-qwen3-coder": 262_144,
    "venice-deepseek-v3.2": 163_840,
    "venice-mistral": 131_072,
    "venice-gemma-3": 202_752,
    "venice-claude-opus": 202_752,
    "venice-claude-sonnet": 202_752,
    "venice-uncensored": 32_768,
    "venice-qwen3-4b": 32_768,

    // ==========================================
    // SYNTHETIC MODELS (HF endpoints)
    // ==========================================
    "synthetic-minimax": 192_000,
    "synthetic-kimi": 256_000,
    "synthetic-glm": 198_000,
    "synthetic-deepseek": 128_000,
    "synthetic-llama": 128_000,
    "synthetic-qwen": 128_000,
    "synthetic-mistral": 128_000,
    "synthetic-mixtral": 32_000,

    // ==========================================
    // GROQ - 8k-128k context
    // ==========================================
    "groq-llama": 128_000,
    "groq-mixtral": 32_000,
    "groq-gemma": 128_000,
    groq: 128_000,

    // ==========================================
    // OPENROUTER - defaults
    // ==========================================
    openrouter: 128_000,

    // ==========================================
    // GITHUB COPILOT - 128k context
    // ==========================================
    "github-copilot": 128_000,
    copilot: 128_000,

    // ==========================================
    // AWS BEDROCK - 32k default (varies by model)
    // ==========================================
    bedrock: 32_000,
    "bedrock-claude": 200_000,
    "bedrock-llama": 128_000,
    amazon: 32_000,

    // ==========================================
    // PERPLEXITY - 128k context
    // ==========================================
    perplexity: 128_000,
    pplx: 128_000,

    // ==========================================
    // FIREWORKS - 128k-256k context
    // ==========================================
    fireworks: 128_000,

    // ==========================================
    // TOGETHER - 128k context
    // ==========================================
    together: 128_000,

    // ==========================================
    // MISTRAL AI - 32k-128k context
    // ==========================================
    mistral: 128_000,
    mixtral: 32_000,
    "mistral-large": 128_000,
    "mistral-medium": 32_000,
    "mistral-small": 32_000,

    // ==========================================
    // COHERE - 128k context
    // ==========================================
    cohere: 128_000,
    command: 128_000,

    // ==========================================
    // AI21 - 256k context
    // ==========================================
    ai21: 256_000,
    jamba: 256_000,

    // ==========================================
    // OLLAMA defaults for common models
    // ==========================================
    codellama: 128_000,
    phi4: 128_000,
    phi3: 128_000,
    phi: 128_000,
    gemma: 128_000,
    "gemma-2": 128_000,
    "gemma-3": 128_000,
    "command-r": 128_000,
    dolphin: 128_000,
    orca: 128_000,
    vicuna: 128_000,
    wizard: 128_000,
    yi: 128_000,
    stablelm: 128_000,
    neural: 128_000,
    openchat: 128_000,
    starling: 128_000,
    zephyr: 128_000,
    solar: 128_000,
    falcon: 128_000,
    mpt: 128_000,
    replit: 128_000,
    phind: 128_000,
    airoboros: 128_000,
    everythinglm: 128_000,
    nexusraven: 128_000,
    samantha: 128_000,
    wizardlm: 128_000,
    tulu: 128_000,
    manticore: 128_000,
    nous: 128_000,
    luna: 128_000,
    pygmalion: 128_000,
    mytho: 128_000,
    alpaca: 128_000,
    "vicuna-v1": 128_000,
    baize: 128_000,
    koala: 128_000,
    redpajama: 128_000,
    gpt4all: 128_000,
    h2ogpt: 128_000,
    fastchat: 128_000,
    chatglm: 128_000,
    starchat: 128_000,
    starcoder: 128_000,
    santacoder: 128_000,
    octocoder: 128_000,
    wizardcoder: 128_000,
    "phind-codellama": 128_000,
  };

  // Check for exact match first
  if (contextWindows[modelLower]) {
    return contextWindows[modelLower];
  }

  // Check for partial matches (more specific patterns first)
  const partialMatches = [
    // Provider prefixes
    { pattern: "opencode-zen", tokens: 400_000 },
    { pattern: "opencode", tokens: 400_000 },
    { pattern: "github-copilot", tokens: 128_000 },
    { pattern: "copilot", tokens: 128_000 },

    // Model families (exact matches didn't work, try patterns)
    { pattern: "claude-opus", tokens: 200_000 },
    { pattern: "claude-sonnet", tokens: 200_000 },
    { pattern: "claude-haiku", tokens: 200_000 },
    { pattern: "claude", tokens: 200_000 },

    { pattern: "gpt-5.1-codex", tokens: 400_000 },
    { pattern: "gpt-5.2-codex", tokens: 400_000 },
    { pattern: "gpt-5.2", tokens: 400_000 },
    { pattern: "gpt-5.1-codex", tokens: 400_000 },
    { pattern: "gpt-5.1", tokens: 400_000 },
    { pattern: "gpt-5.0", tokens: 128_000 },
    { pattern: "gpt-5", tokens: 128_000 },
    { pattern: "gpt-4.1", tokens: 128_000 },
    { pattern: "gpt-4o", tokens: 128_000 },
    { pattern: "gpt-4", tokens: 128_000 },

    { pattern: "kimi-for-coding", tokens: 262_144 },
    { pattern: "kimi-code", tokens: 262_144 },
    { pattern: "kimi-k2", tokens: 256_000 },
    { pattern: "kimi", tokens: 256_000 },

    { pattern: "minimax-text", tokens: 200_000 },
    { pattern: "minimax-m2", tokens: 192_000 },
    { pattern: "minimax-vl", tokens: 192_000 },
    { pattern: "minimax", tokens: 200_000 },
    { pattern: "abab", tokens: 128_000 },

    { pattern: "gemini-3", tokens: 1_048_576 },
    { pattern: "gemini-2.5", tokens: 1_048_576 },
    { pattern: "gemini-2", tokens: 1_048_576 },
    { pattern: "gemini-1.5", tokens: 1_048_576 },
    { pattern: "gemini", tokens: 1_048_576 },

    { pattern: "deepseek-v3.2", tokens: 163_840 },
    { pattern: "deepseek-v3", tokens: 128_000 },
    { pattern: "deepseek-r1", tokens: 128_000 },
    { pattern: "deepseek", tokens: 128_000 },

    { pattern: "qwen3-coder", tokens: 262_144 },
    { pattern: "qwen3", tokens: 128_000 },
    { pattern: "qwen2.5-coder", tokens: 128_000 },
    { pattern: "qwen2.5", tokens: 128_000 },
    { pattern: "qwen", tokens: 128_000 },

    { pattern: "llama-3.3", tokens: 131_072 },
    { pattern: "llama-3.2", tokens: 128_000 },
    { pattern: "llama-3.1", tokens: 128_000 },
    { pattern: "llama3", tokens: 128_000 },
    { pattern: "llama-2", tokens: 32_000 },
    { pattern: "llama", tokens: 128_000 },

    { pattern: "glm-4.7", tokens: 204_800 },
    { pattern: "glm-4", tokens: 128_000 },
    { pattern: "glm", tokens: 128_000 },

    { pattern: "mixtral", tokens: 32_000 },
    { pattern: "mistral-large", tokens: 128_000 },
    { pattern: "mistral", tokens: 128_000 },

    { pattern: "o1-mini", tokens: 128_000 },
    { pattern: "o3-mini", tokens: 128_000 },
    { pattern: "o1", tokens: 128_000 },

    { pattern: "bedrock-claude", tokens: 200_000 },
    { pattern: "bedrock-llama", tokens: 128_000 },
    { pattern: "bedrock", tokens: 32_000 },
    { pattern: "amazon", tokens: 32_000 },
  ];

  for (const { pattern, tokens } of partialMatches) {
    if (modelLower.includes(pattern)) {
      return tokens;
    }
  }

  for (const [key, tokens] of Object.entries(contextWindows)) {
    if (model.toLowerCase().includes(key.toLowerCase())) {
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
    const sessionMessages = tables.sessionMessages?.getBySession(sessionId) || [];

    if (sessionMessages.length === 0) {
      return null;
    }

    // Reconstruct messages
    const messages: ChatMessage[] = sessionMessages.map((m: any) => ({
      role: m.role as ChatMessage["role"],
      content: m.content,
      timestamp: m.created_at,
      ...(m.metadata ? JSON.parse(m.metadata) : {}),
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
