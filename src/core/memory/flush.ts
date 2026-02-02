// Memory Flush System - OpenClaw Compatible
// Triggers memory saves before context compaction to preserve important information

import { tables } from "../database";
import { getContextWindow } from "../session-context";

// Re-export for backwards compatibility
export { getContextWindow as getDefaultContextWindow };

export const DEFAULT_MEMORY_FLUSH_SOFT_TOKENS = 4000;

export const DEFAULT_MEMORY_FLUSH_PROMPT = [
    "Pre-compaction memory flush.",
    "Store durable memories now (use memory/YYYY-MM-DD.md via write tool; create memory/ if needed).",
    "If nothing to store, reply with [SILENT].",
].join(" ");

export const DEFAULT_MEMORY_FLUSH_SYSTEM_PROMPT = [
    "Pre-compaction memory flush turn.",
    "The session is near auto-compaction; capture durable memories to disk.",
    "You may reply, but usually [SILENT] is correct.",
].join(" ");

export interface MemoryFlushSettings {
    enabled: boolean;
    softThresholdTokens: number;
    prompt: string;
    systemPrompt: string;
}

/**
 * Load memory flush settings from config
 */
export function resolveMemoryFlushSettings(): MemoryFlushSettings | null {
    const config = tables.config.get("memoryFlush");
    let settings: Partial<MemoryFlushSettings> = {};

    if (config) {
        try {
            settings = JSON.parse(config.value);
        } catch {
            // Use defaults
        }
    }

    const enabled = settings.enabled ?? true;
    if (!enabled) {
        return null;
    }

    return {
        enabled,
        softThresholdTokens: settings.softThresholdTokens ?? DEFAULT_MEMORY_FLUSH_SOFT_TOKENS,
        prompt: settings.prompt?.trim() || DEFAULT_MEMORY_FLUSH_PROMPT,
        systemPrompt: settings.systemPrompt?.trim() || DEFAULT_MEMORY_FLUSH_SYSTEM_PROMPT,
    };
}

/**
 * Determine if memory flush should run based on token usage
 */
export function shouldRunMemoryFlush(params: {
    totalTokens: number;
    contextWindowTokens: number;
    softThresholdTokens?: number;
    lastFlushCompactionCount?: number;
    currentCompactionCount?: number;
}): boolean {
    const softThreshold = params.softThresholdTokens ?? DEFAULT_MEMORY_FLUSH_SOFT_TOKENS;
    const threshold = Math.max(0, params.contextWindowTokens - softThreshold);

    // Not near threshold yet
    if (params.totalTokens < threshold) {
        return false;
    }

    // Already flushed for this compaction cycle
    if (
        typeof params.lastFlushCompactionCount === "number" &&
        params.lastFlushCompactionCount === params.currentCompactionCount
    ) {
        return false;
    }

    return true;
}

/**
 * Simple token estimation (approximation: ~4 chars per token)
 */
export function estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens for an array of messages
 */
export function estimateMessagesTokens(messages: Array<{ content?: string; role?: string }>): number {
    return messages.reduce((sum, msg) => {
        const content = typeof msg.content === "string" ? msg.content : "";
        const role = typeof msg.role === "string" ? msg.role : "";
        // Add overhead for role and message structure
        return sum + estimateTokens(content) + estimateTokens(role) + 4;
    }, 0);
}

