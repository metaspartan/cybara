
import { tables } from "../database";
import {
    getContextWindow,
    estimateTokens,
    estimateMessagesTokens
} from "../session-context";

export { getContextWindow as getDefaultContextWindow };
export { estimateTokens, estimateMessagesTokens };

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

export function resolveMemoryFlushSettings(): MemoryFlushSettings | null {
    const config = tables.config.get("memoryFlush");
    let settings: Partial<MemoryFlushSettings> = {};

    if (config) {
        try {
            settings = JSON.parse(config.value);
        } catch {
        void 0;
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

export function shouldRunMemoryFlush(params: {
    totalTokens: number;
    contextWindowTokens: number;
    softThresholdTokens?: number;
    lastFlushCompactionCount?: number;
    currentCompactionCount?: number;
}): boolean {
    const softThreshold = params.softThresholdTokens ?? DEFAULT_MEMORY_FLUSH_SOFT_TOKENS;
    const threshold = Math.max(0, params.contextWindowTokens - softThreshold);

    if (params.totalTokens < threshold) {
        return false;
    }

    if (
        typeof params.lastFlushCompactionCount === "number" &&
        params.lastFlushCompactionCount === params.currentCompactionCount
    ) {
        return false;
    }

    return true;
}

