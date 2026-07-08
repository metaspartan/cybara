import type { MobileMessageImage, SessionMessageSummary } from "./api";

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0 || !Number.isFinite(bytes)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function mobilePendingImageBytes(image: MobileMessageImage): number {
  if (image.data) return Math.floor((image.data.length * 3) / 4);
  return 0;
}

export function mobileMediaSummaryLabel(images: MobileMessageImage[], maxImages: number): string {
  if (images.length === 0) return "";
  const parts = [`${images.length} image${images.length === 1 ? "" : "s"}`];
  const totalBytes = images.reduce((sum, image) => sum + mobilePendingImageBytes(image), 0);
  const size = formatBytes(totalBytes);
  let label = size ? `${parts.join(" · ")} · ${size}` : parts.join(" · ");
  if (images.length >= maxImages) label += ` · max ${maxImages} images`;
  return label;
}

export type MessageContentPart =
  | { type: "text"; content: string }
  | { type: "code"; language: string; content: string };

export type UnicodeTextRun = {
  type: "text" | "emoji" | "unicode";
  content: string;
};

export type MobileWorkActivityPhase = "start" | "result" | "error" | "blocked";

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

const REASONING_MARKUP_TOKEN_PATTERN =
  /<\/?(?:REASONING_SCRATCHPAD|antthinking|(?:antml:|mm:)?(?:thinking|think|thought)|reasoning|final)\b[^>]*>|\[\/?(?:thinking|reasoning)\]/gi;

/** Bare reasoning tag deltas (e.g. "</think>") must never render as activity text. */
export function stripReasoningTagTokens(value: string): string {
  return value.replace(REASONING_MARKUP_TOKEN_PATTERN, " ");
}

function normalizeActivityText(value: string): string {
  return stripReasoningTagTokens(value).trim().replace(/\s+/g, " ");
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
  if (normalized === "blocked") return "blocked";
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
  if (phase === "blocked") {
    return trimmed
      .replace(/^Exploring\b/i, "Read blocked")
      .replace(/^Searching\b/i, "Search blocked")
      .replace(/^Fetching\b/i, "Fetch blocked")
      .replace(/^Running\b/i, "Command blocked")
      .replace(/^Writing\b/i, "Edit blocked")
      .replace(/^Editing\b/i, "Edit blocked");
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
        return `${phase === "blocked" ? "Read blocked for" : "Read failed for"} ${displayPath}`;
      }
      if (phase === "start") return `Exploring ${displayPath}`;
      if (phase === "result") return `Explored ${displayPath}`;
      return `${phase === "blocked" ? "Read blocked for" : "Read failed for"} ${displayPath}`;
    }
    if (phase === "start") return "Exploring files...";
    if (phase === "result") return "Exploration complete";
    return phase === "blocked" ? "Read blocked" : "Read failed";
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

export function buildMobileWorkTimeline(
  message: SessionMessageSummary,
  nowMs = Date.now()
): {
  workedDuration: string;
  activities: MobileWorkActivity[];
} {
  const baseTimestamp = activityTimestamp(message.timestamp, 0);
  const activities: MobileWorkActivity[] = [];

  const thinkingText = message.thinking ? normalizeActivityText(message.thinking) : "";
  if (thinkingText) {
    activities.push({
      id: `${message.id}-thinking`,
      phase: "result",
      text: thinkingText,
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
  const hasActiveWork =
    uniqueActivities.some((activity) => activity.phase === "start") ||
    (message.toolCalls || []).some((toolCall) => toolPhase(toolCall.status) === "start");
  const firstTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : undefined;
  const workedMs = Math.max(
    0,
    hasActiveWork && firstTimestamp && firstTimestamp > 0
      ? nowMs - firstTimestamp
      : timestampDuration && timestampDuration > 0
        ? timestampDuration
        : toolDuration
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

// ── Lightweight Markdown (mobile) ────────────────────────────────────────────
// The RN client has no react-markdown (that renders DOM). This is a small,
// dependency-free GFM-subset parser so chat messages render with the same
// structure as the web/Tauri UI: headings, bold/italic, inline code, links,
// strikethrough, ordered/unordered lists, blockquotes, tables, and rules.
// Fenced code blocks are handled upstream by splitMessageContent().

export type MarkdownInline =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "code"; text: string }
  | { type: "strike"; text: string }
  | { type: "link"; text: string; href: string };

export type MarkdownBlock =
  | { type: "heading"; level: number; inline: MarkdownInline[] }
  | { type: "paragraph"; inline: MarkdownInline[] }
  | { type: "listItem"; ordered: boolean; marker: string; inline: MarkdownInline[] }
  | { type: "quote"; inline: MarkdownInline[] }
  | { type: "rule" }
  | { type: "table"; header: MarkdownInline[][]; rows: MarkdownInline[][][] };

/** Tokenize a single line of inline markdown into styled spans. */
export function parseInlineMarkdown(input: string): MarkdownInline[] {
  const tokens: MarkdownInline[] = [];
  let rest = input;
  // Ordered by precedence; each pattern captures its inner text.
  const patterns: Array<{ re: RegExp; make: (m: RegExpExecArray) => MarkdownInline }> = [
    { re: /`([^`]+)`/, make: (m) => ({ type: "code", text: m[1] }) },
    {
      re: /\[([^\]]+)\]\(([^)\s]+)[^)]*\)/,
      make: (m) => ({ type: "link", text: m[1], href: m[2] }),
    },
    { re: /\*\*([^*]+)\*\*/, make: (m) => ({ type: "bold", text: m[1] }) },
    { re: /__([^_]+)__/, make: (m) => ({ type: "bold", text: m[1] }) },
    { re: /~~([^~]+)~~/, make: (m) => ({ type: "strike", text: m[1] }) },
    { re: /(?<![*\w])\*([^*\n]+)\*(?![*\w])/, make: (m) => ({ type: "italic", text: m[1] }) },
    { re: /(?<![_\w])_([^_\n]+)_(?![_\w])/, make: (m) => ({ type: "italic", text: m[1] }) },
  ];

  let guard = 0;
  while (rest.length > 0 && guard++ < 5000) {
    let best: { index: number; length: number; token: MarkdownInline } | null = null;
    for (const { re, make } of patterns) {
      const m = re.exec(rest);
      if (m && (best === null || m.index < best.index)) {
        best = { index: m.index, length: m[0].length, token: make(m) };
      }
    }
    if (!best) {
      tokens.push({ type: "text", text: rest });
      break;
    }
    if (best.index > 0) tokens.push({ type: "text", text: rest.slice(0, best.index) });
    tokens.push(best.token);
    rest = rest.slice(best.index + best.length);
  }
  return tokens.length > 0 ? tokens : [{ type: "text", text: input }];
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** Parse a text block (no fenced code) into structured markdown blocks. */
export function parseMarkdownBlocks(input: string): MarkdownBlock[] {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(" ").trim();
    if (text) blocks.push({ type: "paragraph", inline: parseInlineMarkdown(text) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    // Horizontal rule.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      blocks.push({ type: "rule" });
      continue;
    }

    // Heading.
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: "heading",
        level: heading[1].length,
        inline: parseInlineMarkdown(heading[2].trim()),
      });
      continue;
    }

    // Table: a `|` row immediately followed by a separator row.
    if (trimmed.includes("|") && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1])) {
      flushParagraph();
      const header = splitTableRow(trimmed).map((cell) => parseInlineMarkdown(cell));
      const rows: MarkdownInline[][][] = [];
      i += 2; // skip header + separator
      while (i < lines.length && lines[i].trim().includes("|")) {
        rows.push(splitTableRow(lines[i]).map((cell) => parseInlineMarkdown(cell)));
        i++;
      }
      i--; // step back; outer loop will advance
      blocks.push({ type: "table", header, rows });
      continue;
    }

    // Blockquote.
    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      flushParagraph();
      blocks.push({ type: "quote", inline: parseInlineMarkdown(quote[1]) });
      continue;
    }

    // Ordered / unordered list item.
    const ordered = /^(\d+)[.)]\s+(.*)$/.exec(trimmed);
    if (ordered) {
      flushParagraph();
      blocks.push({
        type: "listItem",
        ordered: true,
        marker: `${ordered[1]}.`,
        inline: parseInlineMarkdown(ordered[2]),
      });
      continue;
    }
    const unordered = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (unordered) {
      flushParagraph();
      blocks.push({
        type: "listItem",
        ordered: false,
        marker: "•",
        inline: parseInlineMarkdown(unordered[1]),
      });
      continue;
    }

    paragraph.push(trimmed);
  }
  flushParagraph();
  return blocks;
}

const STREAM_REASONING_TAG =
  "(?:REASONING_SCRATCHPAD|antthinking|(?:antml:|mm:)?(?:thinking|think|thought)|reasoning)";
const STREAM_REASONING_BLOCK_PATTERN = new RegExp(
  `<${STREAM_REASONING_TAG}\\b[^>]*>[\\s\\S]*?</${STREAM_REASONING_TAG}>`,
  "gi"
);
const STREAM_REASONING_CLOSE_PATTERN = new RegExp(`</${STREAM_REASONING_TAG}\\b[^>]*>`, "gi");
const STREAM_REASONING_OPEN_PATTERN = new RegExp(`<${STREAM_REASONING_TAG}\\b[^>]*>`, "i");

/**
 * Hide reasoning inside a live streaming buffer: paired think blocks are
 * removed, an unpaired closing tag treats everything before it as reasoning
 * (implicit opener), and an unclosed opening tag hides the streaming tail.
 */
export function stripStreamingReasoningForDisplay(text: string): string {
  let result = text.replace(STREAM_REASONING_BLOCK_PATTERN, "");

  STREAM_REASONING_CLOSE_PATTERN.lastIndex = 0;
  let lastCloseEnd = -1;
  for (const match of result.matchAll(STREAM_REASONING_CLOSE_PATTERN)) {
    lastCloseEnd = (match.index ?? 0) + match[0].length;
  }
  if (lastCloseEnd >= 0) {
    result = result.slice(lastCloseEnd);
  }

  const openMatch = result.match(STREAM_REASONING_OPEN_PATTERN);
  if (openMatch && typeof openMatch.index === "number") {
    result = result.slice(0, openMatch.index);
  }

  return result.replace(/^\s+/, "");
}

// ── Codex-style tool-call grouping (parity with the web/Tauri timeline) ──────
export type MobileActivityGroupKind = "read" | "search" | "list";

export interface MobileActivityGroup {
  type: "group";
  id: string;
  kind: MobileActivityGroupKind;
  label: string;
  items: MobileWorkActivity[];
}

export interface MobileActivitySingle {
  type: "single";
  activity: MobileWorkActivity;
}

export type MobileActivityEntry = MobileActivityGroup | MobileActivitySingle;

type MobileGroupableKind = MobileActivityGroupKind | "command";

const MOBILE_GROUPABLE_TOOL_KINDS: Record<string, MobileGroupableKind> = {
  read: "read",
  grep: "search",
  file_search: "search",
  glob: "search",
  web_search: "search",
  ls: "list",
  list: "list",
};

const MOBILE_READ_ONLY_COMMAND_KINDS: Record<string, MobileGroupableKind> = {
  cat: "read",
  head: "read",
  tail: "read",
  bat: "read",
  less: "read",
  more: "read",
  ls: "list",
  find: "list",
  tree: "list",
  fd: "list",
  dir: "list",
  grep: "search",
  rg: "search",
  ag: "search",
  ack: "search",
  ripgrep: "search",
  wc: "command",
  cloc: "command",
  du: "command",
  stat: "command",
  file: "command",
  which: "command",
  pwd: "command",
  echo: "command",
  env: "command",
  printenv: "command",
  date: "command",
  whoami: "command",
  uname: "command",
  hostname: "command",
  cd: "command",
  pushd: "command",
  popd: "command",
  printf: "command",
  true: "command",
  ":": "command",
};

const MOBILE_READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "log",
  "status",
  "diff",
  "show",
  "branch",
  "blame",
  "remote",
  "config",
  "shortlog",
  "rev-parse",
  "rev-list",
  "describe",
  "ls-files",
  "ls-tree",
  "cat-file",
  "reflog",
  "whatchanged",
  "show-ref",
  "name-rev",
  "count-objects",
  "for-each-ref",
  "symbolic-ref",
  "merge-base",
  "grep",
  "tag",
  "stash",
]);

const MOBILE_COMMAND_PREFIX_WRAPPERS = new Set([
  "sudo",
  "command",
  "time",
  "nice",
  "nohup",
  "env",
  "xargs",
]);
const MOBILE_COMPOUND_STAGE_SPLIT = /\s*(?:&&|\|\||\||;|\n)\s*/;

function mobileClassifyShellStage(stage: string): MobileGroupableKind | null {
  const tokens = stage.trim().split(/\s+/);
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      index += 1;
      continue;
    }
    if (index > 0 && token.startsWith("-")) {
      index += 1;
      continue;
    }
    const stripped = token.split(/[\\/]/).pop()?.toLowerCase() || "";
    if (
      MOBILE_COMMAND_PREFIX_WRAPPERS.has(stripped) &&
      stripped !== "env" &&
      stripped !== "xargs"
    ) {
      index += 1;
      continue;
    }
    if (
      (stripped === "env" || stripped === "xargs") &&
      index + 1 < tokens.length &&
      !tokens[index + 1].startsWith("-")
    ) {
      index += 1;
      continue;
    }
    break;
  }
  const verb = tokens[index]?.split(/[\\/]/).pop()?.toLowerCase() || "";
  if (!verb) return null;
  if (verb === "git") {
    const sub = (tokens[index + 1] || "").toLowerCase();
    return MOBILE_READ_ONLY_GIT_SUBCOMMANDS.has(sub) ? "command" : null;
  }
  return MOBILE_READ_ONLY_COMMAND_KINDS[verb] ?? null;
}

function mobileClassifyShellCommand(command: string): MobileGroupableKind | null {
  const trimmed = command.trim().replace(/\s*\.\.\.$/, "");
  if (!trimmed) return null;
  const stages = trimmed
    .split(MOBILE_COMPOUND_STAGE_SPLIT)
    .map((stage) => stage.trim())
    .filter(Boolean);
  if (stages.length === 0) return null;
  const kinds: MobileGroupableKind[] = [];
  for (const stage of stages) {
    const kind = mobileClassifyShellStage(stage);
    if (kind === null) return null;
    kinds.push(kind);
  }
  return kinds.find((kind) => kind !== "command") ?? "command";
}

function mobileGroupKind(activity: MobileWorkActivity): MobileGroupableKind | null {
  if (activity.phase !== "result") return null;
  const toolName = activity.toolName?.toLowerCase() || "";
  if (toolName in MOBILE_GROUPABLE_TOOL_KINDS) return MOBILE_GROUPABLE_TOOL_KINDS[toolName];
  if (toolName === "exec" || toolName === "process" || toolName === "git" || !toolName) {
    const ranMatch = activity.text.match(/^Ran\s+(.+)$/s);
    if (ranMatch) return mobileClassifyShellCommand(ranMatch[1]);
    if (!toolName) {
      if (/^Explored /.test(activity.text)) return "read";
      if (/^Searched /.test(activity.text)) return "search";
    }
  }
  return null;
}

function mobileGroupLabel(kinds: MobileGroupableKind[], count: number): string {
  const unique = new Set(kinds);
  if (unique.size === 1) {
    const [only] = unique;
    if (only === "read") return `Read ${count} files`;
    if (only === "search") return `Ran ${count} searches`;
    if (only === "list") return `Listed ${count} locations`;
  }
  return `Ran ${count} commands`;
}

export function groupMobileActivities(activities: MobileWorkActivity[]): MobileActivityEntry[] {
  const entries: MobileActivityEntry[] = [];
  let run: { kinds: MobileGroupableKind[]; items: MobileWorkActivity[] } | null = null;

  const flush = () => {
    if (!run) return;
    if (run.kinds.length >= 2) {
      const unique = new Set(run.kinds);
      const specific = unique.size === 1 ? [...unique][0] : "command";
      entries.push({
        type: "group",
        id: `group-${run.items[0].id}-${run.items.length}`,
        kind: specific === "command" ? "list" : specific,
        label: mobileGroupLabel(run.kinds, run.kinds.length),
        items: run.items,
      });
    } else {
      for (const activity of run.items) entries.push({ type: "single", activity });
    }
    run = null;
  };

  for (const activity of activities) {
    if (activity.toolName === "__thought") {
      flush();
      entries.push({ type: "single", activity });
      continue;
    }
    const kind = mobileGroupKind(activity);
    if (kind === null) {
      flush();
      entries.push({ type: "single", activity });
      continue;
    }
    if (run) {
      run.kinds.push(kind);
      run.items.push(activity);
    } else {
      run = { kinds: [kind], items: [activity] };
    }
  }
  flush();
  return entries;
}
