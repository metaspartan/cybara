import { config, DEFAULT_MEMORY_BEHAVIOR_SETTINGS } from "../config";
import { getContextWindow, estimateTokens, estimateMessagesTokens } from "../session-context";

export { getContextWindow as getDefaultContextWindow };
export { estimateTokens, estimateMessagesTokens };

export const DEFAULT_MEMORY_FLUSH_SOFT_TOKENS =
  DEFAULT_MEMORY_BEHAVIOR_SETTINGS.memoryFlushSoftThresholdTokens;

export const DEFAULT_MEMORY_FLUSH_PROMPT = DEFAULT_MEMORY_BEHAVIOR_SETTINGS.memoryFlushPrompt;

export const DEFAULT_MEMORY_FLUSH_SYSTEM_PROMPT =
  DEFAULT_MEMORY_BEHAVIOR_SETTINGS.memoryFlushSystemPrompt;

export interface MemoryFlushSettings {
  enabled: boolean;
  softThresholdTokens: number;
  prompt: string;
  systemPrompt: string;
}

export function resolveMemoryFlushSettings(): MemoryFlushSettings | null {
  const settings = config.getMemoryBehaviorSettings();

  if (!settings.memoryFlushEnabled) {
    return null;
  }

  return {
    enabled: true,
    softThresholdTokens: settings.memoryFlushSoftThresholdTokens,
    prompt: settings.memoryFlushPrompt,
    systemPrompt: settings.memoryFlushSystemPrompt,
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
