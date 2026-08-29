import {
  CONTEXT_CHARS_PER_TOKEN_ESTIMATE,
  CONTEXT_INPUT_HEADROOM_RATIO,
  CONTEXT_LIMIT_TRUNCATION_NOTICE,
  HARD_MAX_TOOL_RESULT_CHARS,
  MAX_TOOL_RESULT_CONTEXT_SHARE,
  MIN_TOOL_RESULT_CHARS,
} from "./agent-internals";
import { config } from "./config";
import { recordMidLoopContextCompaction } from "./llm/context-pressure";
import { formatToolResultForModel } from "./llm/model-visible-format";
import {
  compactOpenAIChatTranscriptInPlace,
  TOOL_RESULT_COMPACTION_NOTICE,
} from "./llm/tool-transcript";
import { formatRecoverableToolOutputPreview } from "./tool-output-recovery";
import type { ToolContext } from "./tools";

export interface ContextGuardBudgets {
  contextBudgetChars: number;
  maxSingleToolResultChars: number;
}

const MATERIALIZATION_CONTEXT_BUDGET_CHARS = 120_000;

interface CompactionContext {
  model?: string;
  toolContext?: ToolContext;
}

function recordContextCompaction(
  beforeChars: number,
  afterChars: number,
  messageCount: number,
  context?: CompactionContext
): void {
  recordMidLoopContextCompaction({
    beforeChars,
    afterChars,
    messageCount,
    model: context?.model,
    toolContext: context?.toolContext,
  });
}

export function resolveContextGuardBudgets(contextWindowTokens: number): ContextGuardBudgets {
  const safeContextTokens = Math.max(1024, Math.floor(contextWindowTokens));
  const contextBudgetChars = Math.max(
    4096,
    Math.floor(safeContextTokens * CONTEXT_CHARS_PER_TOKEN_ESTIMATE * CONTEXT_INPUT_HEADROOM_RATIO)
  );
  const maxSingleToolResultChars = Math.max(
    MIN_TOOL_RESULT_CHARS,
    Math.min(
      HARD_MAX_TOOL_RESULT_CHARS,
      Math.floor(
        safeContextTokens * CONTEXT_CHARS_PER_TOKEN_ESTIMATE * MAX_TOOL_RESULT_CONTEXT_SHARE
      )
    )
  );
  return { contextBudgetChars, maxSingleToolResultChars };
}

export function resolveMaterializationContextBudgetChars(contextBudgetChars: number): number {
  return Math.max(4096, Math.min(contextBudgetChars, MATERIALIZATION_CONTEXT_BUDGET_CHARS));
}

function estimateAnthropicMessageChars(message: Record<string, unknown>): number {
  const content = message.content;
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  let total = 0;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const typed = block as Record<string, unknown>;
    if (typeof typed.text === "string") {
      total += typed.text.length;
      continue;
    }
    if (typeof typed.content === "string") {
      total += typed.content.length;
      continue;
    }
    try {
      const serialized = JSON.stringify(block);
      total += typeof serialized === "string" ? serialized.length : 0;
    } catch {
      total += 128;
    }
  }
  return total;
}

function truncateTextToContextBudget(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const suffix = `\n${CONTEXT_LIMIT_TRUNCATION_NOTICE}`;
  if (maxChars <= suffix.length) return CONTEXT_LIMIT_TRUNCATION_NOTICE;
  const budget = Math.max(0, maxChars - suffix.length);
  let cutPoint = budget;
  const nearestNewline = text.lastIndexOf("\n", budget);
  if (nearestNewline > budget * 0.7) cutPoint = nearestNewline;
  return text.slice(0, cutPoint) + suffix;
}

export function truncateTextWithHeadAndTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const marker = `\n${CONTEXT_LIMIT_TRUNCATION_NOTICE}\n[...${Math.max(1, text.length - maxChars)} chars truncated...]\n`;
  const budget = Math.max(0, maxChars - marker.length);
  if (budget <= 16) return truncateTextToContextBudget(text, maxChars);
  const headBudget = Math.floor(budget * 0.7);
  const tailBudget = budget - headBudget;
  return text.slice(0, headBudget) + marker + text.slice(text.length - tailBudget);
}

export function truncateToolResultContentForContext(
  resultPayload: unknown,
  maxChars: number,
  recovery?: { sessionId?: string; toolName?: string; toolCallId?: string }
): string {
  const serialized = formatToolResultForModel(resultPayload, {
    toonEnabled: config.getTokenOptimizationSettings().toonStructuredDataEnabled,
  });
  return formatRecoverableToolOutputPreview(serialized, maxChars, recovery).content;
}

export function compactAnthropicLoopMessagesForContext(
  messages: Record<string, unknown>[],
  contextBudgetChars: number,
  aggressive = false,
  context?: CompactionContext
): boolean {
  const estimates = messages.map((message) => estimateAnthropicMessageChars(message));
  const beforeChars = estimates.reduce((sum, value) => sum + value + 64, 0);
  let totalChars = beforeChars;
  if (totalChars <= contextBudgetChars && !aggressive) return false;
  const minRecentMessagesToKeep = aggressive ? 0 : 6;
  let compacted = false;
  let forceCompaction = aggressive;
  for (let index = 0; index < messages.length; index += 1) {
    if (!forceCompaction && totalChars <= contextBudgetChars) break;
    if (messages.length - index <= minRecentMessagesToKeep) break;
    const message = messages[index];
    if (!message || message.role !== "user" || !Array.isArray(message.content)) continue;
    let changed = false;
    const nextContent = message.content.map((block) => {
      if (!block || typeof block !== "object") return block;
      const typed = block as Record<string, unknown>;
      if (typed.type !== "tool_result" || typeof typed.content !== "string") return block;
      if (typed.content.includes(TOOL_RESULT_COMPACTION_NOTICE)) return block;
      changed = true;
      return { ...typed, content: TOOL_RESULT_COMPACTION_NOTICE };
    });
    if (!changed) continue;
    message.content = nextContent;
    const previousEstimate = estimates[index];
    const nextEstimate = estimateAnthropicMessageChars(message);
    estimates[index] = nextEstimate;
    totalChars = totalChars - previousEstimate + nextEstimate;
    compacted = true;
    forceCompaction = false;
  }
  if (compacted) {
    recordContextCompaction(beforeChars, totalChars, messages.length, context);
  }
  return compacted;
}

export function compactOpenAILoopMessagesForContext(
  messages: Record<string, unknown>[],
  contextBudgetChars: number,
  aggressive = false,
  context?: CompactionContext
): boolean {
  const beforeChars = JSON.stringify(messages).length;
  const elided = compactOpenAIChatTranscriptInPlace(messages, contextBudgetChars, { aggressive });
  if (elided > 0) {
    recordContextCompaction(beforeChars, JSON.stringify(messages).length, messages.length, context);
  }
  return elided > 0;
}
