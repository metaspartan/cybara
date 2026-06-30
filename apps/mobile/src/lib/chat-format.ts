import type { SessionMessageSummary } from "./api";

export type MessageContentPart =
  { type: "text"; content: string } | { type: "code"; language: string; content: string };

export type UnicodeTextRun = {
  type: "text" | "emoji" | "unicode";
  content: string;
};

export type MobileWorkActivityPhase = "start" | "result" | "error";

export interface MobileWorkActivity {
  id: string;
  phase: MobileWorkActivityPhase;
  text: string;
  timestamp: number;
  toolName?: string;
}

export const MOBILE_VISIBLE_CHAT_MESSAGE_LIMIT = 80;
export const MOBILE_NATIVE_TEXT_RENDERING = {
  disablesSelectableForUnicode: true,
  forceEmojiFontFamily: false,
  preserveNativeUnicodeFallback: true,
  monospaceOnlyForAsciiCode: true,
} as const;

export const MOBILE_CHAT_WORK_TIMELINE = {
  showWorkedForLine: true,
  renderToolCallsAsActivityText: true,
  useDesktopToolIntentLabels: true,
} as const;

const EMOJI_SEQUENCE_PATTERN =
  /^(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|(?:[\p{Extended_Pictographic}\p{Emoji_Presentation}]\uFE0F?(?:\u200D[\p{Extended_Pictographic}\p{Emoji_Presentation}]\uFE0F?)*))$/u;

const UNICODE_TEXT_FALLBACK_PATTERN =
  /(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|(?:[\p{Extended_Pictographic}\p{Emoji_Presentation}]\uFE0F?(?:\u200D[\p{Extended_Pictographic}\p{Emoji_Presentation}]\uFE0F?)*)|(?:[A-Za-z0-9]\p{Mark}+)|[^\u0000-\u007F]+)/gu;

export function splitUnicodeTextRuns(content: string): UnicodeTextRun[] {
  const runs: UnicodeTextRun[] = [];
  UNICODE_TEXT_FALLBACK_PATTERN.lastIndex = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = UNICODE_TEXT_FALLBACK_PATTERN.exec(content))) {
    if (match.index > cursor) {
      runs.push({ type: "text", content: content.slice(cursor, match.index) });
    }
    const matched = match[0];
    runs.push({
      type: EMOJI_SEQUENCE_PATTERN.test(matched) ? "emoji" : "unicode",
      content: matched,
    });
    cursor = match.index + matched.length;
  }
  if (cursor < content.length) {
    runs.push({ type: "text", content: content.slice(cursor) });
  }
  return runs.length > 0 ? runs : [{ type: "text", content }];
}

export function hasUnicodeTextFallback(content: string): boolean {
  UNICODE_TEXT_FALLBACK_PATTERN.lastIndex = 0;
  return UNICODE_TEXT_FALLBACK_PATTERN.test(content);
}

export function shouldUseSelectableNativeText(content: string): boolean {
  return !hasUnicodeTextFallback(content);
}

export function splitMessageContent(content: string): MessageContentPart[] {
  const parts: MessageContentPart[] = [];
  const regex = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content))) {
    if (match.index > cursor) {
      parts.push({ type: "text", content: content.slice(cursor, match.index) });
    }
    parts.push({
      type: "code",
      language: match[1]?.trim() || "code",
      content: match[2] || "",
    });
    cursor = match.index + match[0].length;
  }
  if (cursor < content.length) {
    parts.push({ type: "text", content: content.slice(cursor) });
  }
  return parts.length > 0 ? parts : [{ type: "text", content }];
}

function normalizeActivityText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function readStringArg(
  args: Record<string, unknown> | undefined,
  keys: string[]
): string | undefined {
  if (!args) return undefined;
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return undefined;
}

function readNumberArg(
  args: Record<string, unknown> | undefined,
  keys: string[]
): number | undefined {
  if (!args) return undefined;
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function activityPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").trim();
  if (!normalized) return "file";
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

function summarizeCommand(command: string): string {
  const compact = command
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  if (!compact) return "command";
  return compact.length > 72 ? `${compact.slice(0, 69)}...` : compact;
}

function toolPhase(status: string | undefined): MobileWorkActivityPhase {
  const normalized = (status || "").toLowerCase();
  if (normalized === "pending" || normalized === "executing" || normalized === "running") {
    return "start";
  }
  if (normalized === "failed" || normalized === "error") return "error";
  return "result";
}

function normalizeVerb(text: string, phase: MobileWorkActivityPhase): string {
  const trimmed = text.trim();
  if (!trimmed || phase === "start") return trimmed;
  if (phase === "result") {
    return trimmed
      .replace(/^Exploring\b/i, "Explored")
      .replace(/^Searching\b/i, "Searched")
      .replace(/^Fetching\b/i, "Fetched")
      .replace(/^Running\b/i, "Ran")
      .replace(/^Writing\b/i, "Edited")
      .replace(/^Editing\b/i, "Edited");
  }
  return trimmed
    .replace(/^Exploring\b/i, "Read failed")
    .replace(/^Searching\b/i, "Search failed")
    .replace(/^Fetching\b/i, "Fetch failed")
    .replace(/^Running\b/i, "Command failed")
    .replace(/^Writing\b/i, "Edit failed")
    .replace(/^Editing\b/i, "Edit failed");
}

function formatToolIntent(
  toolName: string,
  args: Record<string, unknown> | undefined,
  phase: MobileWorkActivityPhase,
  fallbackDetail?: string
): string {
  if (fallbackDetail?.trim() && !isGenericStatusLabel(fallbackDetail)) {
    return normalizeVerb(fallbackDetail, phase);
  }

  const key = toolName.toLowerCase();
  const path = readStringArg(args, ["path", "file_path", "filePath"]);
  const displayPath = path ? activityPath(path) : undefined;

  if (key === "read" || key === "read_file") {
    if (path) {
      const offset = readNumberArg(args, ["offset"]);
      const limit = readNumberArg(args, ["limit"]);
      if (offset !== undefined && limit !== undefined && limit > 0) {
        const startLine = Math.max(1, Math.floor(offset));
        const endLine = startLine + Math.max(1, Math.floor(limit)) - 1;
        if (phase === "start") return `Exploring ${displayPath} (lines ${startLine}-${endLine})`;
        if (phase === "result") return `Explored ${displayPath} (lines ${startLine}-${endLine})`;
        return `Read failed for ${displayPath}`;
      }
      if (phase === "start") return `Exploring ${displayPath}`;
      if (phase === "result") return `Explored ${displayPath}`;
      return `Read failed for ${displayPath}`;
    }
    if (phase === "start") return "Exploring files...";
    if (phase === "result") return "Exploration complete";
    return "Read failed";
  }

  if (key === "write" || key === "edit" || key === "apply_patch") {
    if (path) {
      if (phase === "start")
        return key === "edit" ? `Editing ${displayPath}` : `Writing ${displayPath}`;
      if (phase === "result") return `Edited ${displayPath}`;
      return `Edit failed for ${displayPath}`;
    }
    if (phase === "start") return key === "edit" ? "Editing file..." : "Writing file...";
    if (phase === "result") return "Edit complete";
    return "Edit failed";
  }

  if (key === "file_search" || key === "grep" || key === "rg" || key === "tool_search") {
    const pattern = readStringArg(args, ["pattern", "query", "q"]);
    const basePath = readStringArg(args, ["path"]);
    if (pattern && basePath) {
      if (phase === "start") return `Searching ${basePath} for "${pattern}"`;
      if (phase === "result") return `Searched ${basePath} for "${pattern}"`;
      return `Search failed in ${basePath}`;
    }
    if (pattern) {
      if (phase === "start") return `Searching for "${pattern}"`;
      if (phase === "result") return `Search complete for "${pattern}"`;
      return `Search failed for "${pattern}"`;
    }
    if (phase === "start") return "Searching files...";
    if (phase === "result")
      return key === "tool_search" ? "tool_search complete" : "Search complete";
    return "Search failed";
  }

  if (key === "web_search") {
    const query = readStringArg(args, ["query"]);
    if (query) {
      if (phase === "start") return `Searching web for "${query}"`;
      if (phase === "result") return `Web search complete for "${query}"`;
      return `Web search failed for "${query}"`;
    }
    if (phase === "start") return "Searching the web...";
    if (phase === "result") return "Web search complete";
    return "Web search failed";
  }

  if (key === "web_fetch") {
    const url = readStringArg(args, ["url"]);
    if (url) {
      if (phase === "start") return `Fetching ${url}`;
      if (phase === "result") return `Fetched ${url}`;
      return `Fetch failed for ${url}`;
    }
    if (phase === "start") return "Fetching webpage...";
    if (phase === "result") return "Fetch complete";
    return "Fetch failed";
  }

  if (
    key === "exec" ||
    key === "process" ||
    key === "git" ||
    key === "shell" ||
    key === "exec_command"
  ) {
    const command = readStringArg(args, ["command", "cmd"]) || fallbackDetail;
    if (command && !isGenericStatusLabel(command)) {
      const summary = summarizeCommand(command);
      if (phase === "start") return `Running ${summary}`;
      if (phase === "result") return `Ran ${summary}`;
      return `Command failed: ${summary}`;
    }
    if (phase === "start") return "Running command...";
    if (phase === "result") return "Command complete";
    return "Command failed";
  }

  if (phase === "start") return `${toolName} running...`;
  if (phase === "result") return `${toolName} complete`;
  return `${toolName} failed`;
}

export function formatMobileWorkedDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

function parseDurationMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return Math.max(0, numeric);
  const match = trimmed.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return undefined;
  const unit = match[2].toLowerCase();
  if (unit === "ms") return amount;
  if (unit === "s") return amount * 1000;
  if (unit === "m") return amount * 60000;
  return amount * 3600000;
}

function isGenericStatusLabel(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return [
    "none",
    "value",
    "completed",
    "complete",
    "success",
    "failed",
    "error",
    "running",
    "pending",
  ].includes(normalized);
}

function activityTimestamp(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function buildMobileWorkTimeline(message: SessionMessageSummary): {
  workedDuration: string;
  activities: MobileWorkActivity[];
} {
  const baseTimestamp = activityTimestamp(message.timestamp, 0);
  const activities: MobileWorkActivity[] = [];

  if (message.thinking?.trim()) {
    activities.push({
      id: `${message.id}-thinking`,
      phase: "result",
      text: message.thinking.trim(),
      timestamp: baseTimestamp,
      toolName: "__thought",
    });
  }

  for (const activity of message.processActivities || []) {
    const text = normalizeActivityText(activity.text);
    if (!text || isGenericStatusLabel(text)) continue;
    activities.push({
      id: activity.id,
      phase: activity.phase as MobileWorkActivityPhase,
      text,
      timestamp: activityTimestamp(activity.timestamp, baseTimestamp + activities.length + 1),
      toolName: activity.toolName,
    });
  }

  for (const [index, toolCall] of (message.toolCalls || []).entries()) {
    const phase = toolPhase(toolCall.status);
    const text = normalizeActivityText(
      formatToolIntent(toolCall.name, toolCall.args, phase, toolCall.command || toolCall.detail)
    );
    if (!text || isGenericStatusLabel(text)) continue;
    activities.push({
      id: `tool-${toolCall.id}`,
      phase,
      text,
      timestamp: activityTimestamp(
        toolCall.startedAt,
        baseTimestamp + activities.length + index + 1
      ),
      toolName: toolCall.name,
    });
  }

  const seen = new Set<string>();
  const uniqueActivities = activities
    .sort((left, right) => left.timestamp - right.timestamp)
    .filter((activity) => {
      const key = `${activity.phase}:${activity.toolName || ""}:${normalizeActivityText(activity.text).toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const timestamps = uniqueActivities
    .map((activity) => activity.timestamp)
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);
  const timestampDuration =
    timestamps.length >= 2 ? Math.max(...timestamps) - Math.min(...timestamps) : undefined;
  const toolDuration = (message.toolCalls || []).reduce((sum, toolCall) => {
    return sum + (toolCall.durationMs ?? parseDurationMs(toolCall.duration) ?? 0);
  }, 0);
  const workedMs = Math.max(
    0,
    timestampDuration && timestampDuration > 0 ? timestampDuration : toolDuration
  );

  return {
    workedDuration: formatMobileWorkedDuration(workedMs),
    activities: uniqueActivities,
  };
}

export function visibleChatMessages(messages: SessionMessageSummary[]): SessionMessageSummary[] {
  return messages.filter((message) => message.role !== "system");
}

export function latestVisibleChatMessages(
  messages: SessionMessageSummary[],
  limit = MOBILE_VISIBLE_CHAT_MESSAGE_LIMIT
): SessionMessageSummary[] {
  const visible: SessionMessageSummary[] = [];
  const boundedLimit = Math.max(1, Math.floor(limit));
  for (let index = messages.length - 1; index >= 0 && visible.length < boundedLimit; index -= 1) {
    const message = messages[index];
    if (message.role !== "system") {
      visible.push(message);
    }
  }
  return visible.reverse();
}

export function lastVisibleChatMessage(
  messages: SessionMessageSummary[]
): SessionMessageSummary | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "system") return message;
  }
  return undefined;
}

export function chatIsWaitingForAssistant(
  messages: SessionMessageSummary[],
  sending: boolean
): boolean {
  return sending || lastVisibleChatMessage(messages)?.role === "user";
}
