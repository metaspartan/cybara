import React from "react";
import { Box, Text } from "ink";
import { basename, resolve } from "path";

export interface TUITranscriptMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface TUITranscriptSearchMatch {
  messageIndex: number;
  role: "user" | "assistant";
  excerpt: string;
}

export interface TUIConversationExportOptions {
  title: string;
  sessionId: string;
  workspaceDir: string;
  model: string;
}

export interface TUITerminalDiagnosticsOptions {
  columns: number;
  rows: number;
  isTTY: boolean;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  clipboardCommand: string | null;
}

interface TranscriptSearchPanelProps {
  query: string;
  matches: TUITranscriptSearchMatch[];
  selectedIndex: number;
  compact: boolean;
}

function searchTerms(query: string): string[] {
  return query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

function excerptAroundMatch(
  content: string,
  terms: string[],
  maxLength: number,
): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  const lower = normalized.toLocaleLowerCase();
  const firstMatch = terms.reduce((earliest, term) => {
    const index = lower.indexOf(term);
    return index >= 0 ? Math.min(earliest, index) : earliest;
  }, normalized.length);
  const half = Math.floor(maxLength / 2);
  const start = Math.max(
    0,
    Math.min(normalized.length - maxLength, firstMatch - half),
  );
  const excerpt = normalized.slice(start, start + maxLength).trim();
  return `${start > 0 ? "…" : ""}${excerpt}${start + maxLength < normalized.length ? "…" : ""}`;
}

export function searchTUITranscript(
  messages: TUITranscriptMessage[],
  query: string,
  limit = 40,
): TUITranscriptSearchMatch[] {
  const terms = searchTerms(query);
  if (terms.length === 0 || limit <= 0) return [];
  const matches: TUITranscriptSearchMatch[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role === "system") continue;
    const lower = message.content.toLocaleLowerCase();
    if (!terms.every((term) => lower.includes(term))) continue;
    matches.push({
      messageIndex: index,
      role: message.role,
      excerpt: excerptAroundMatch(message.content, terms, 112),
    });
    if (matches.length >= limit) break;
  }
  return matches;
}

export function nextTUITranscriptSearchIndex(
  current: number,
  direction: -1 | 1,
  count: number,
): number {
  if (count <= 0) return 0;
  return (current + direction + count) % count;
}

export function transcriptOffsetForMessage(
  messageIndex: number,
  messageCount: number,
  visibleLimit: number,
): number {
  if (messageCount <= 0) return 0;
  const boundedIndex = Math.max(0, Math.min(messageCount - 1, messageIndex));
  const maximumOffset = Math.max(0, messageCount - Math.max(1, visibleLimit));
  return Math.min(maximumOffset, Math.max(0, messageCount - boundedIndex - 1));
}

export function nthLatestAssistantResponse(
  messages: TUITranscriptMessage[],
  position: number,
): string | null {
  if (!Number.isInteger(position) || position < 1) return null;
  let remaining = position;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    remaining -= 1;
    if (remaining === 0) return message.content;
  }
  return null;
}

export function formatTUIConversationExport(
  messages: TUITranscriptMessage[],
  options: TUIConversationExportOptions,
): string {
  const heading = options.title.trim() || "Cybara conversation";
  const metadata = [
    options.sessionId ? `- Session: \`${options.sessionId}\`` : "",
    options.workspaceDir ? `- Workspace: \`${options.workspaceDir}\`` : "",
    options.model ? `- Model: ${options.model}` : "",
  ].filter(Boolean);
  const turns = messages
    .filter((message) => message.role !== "system" && message.content.trim())
    .map((message) => {
      const label = message.role === "user" ? "User" : "Assistant";
      return `## ${label}\n\n${message.content.trim()}`;
    });
  return (
    [`# ${heading}`, metadata.join("\n"), ...turns]
      .filter(Boolean)
      .join("\n\n") + "\n"
  );
}

export function defaultTUIConversationExportPath(
  sessionId: string,
  directory: string,
  timestamp: number,
): string {
  const date = new Date(timestamp).toISOString().replace(/[:.]/g, "-");
  const identifier =
    sessionId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 12) || "new";
  return resolve(directory, `cybara-${identifier}-${date}.md`);
}

export function resolveTUIConversationExportPath(
  path: string,
  directory: string,
): string {
  return resolve(directory, path);
}

function terminalName(env: NodeJS.ProcessEnv): string {
  if (env.TERM_PROGRAM) return env.TERM_PROGRAM;
  if (env.WT_SESSION) return "Windows Terminal";
  if (env.TERM) return env.TERM;
  return "unknown";
}

function terminalColorMode(env: NodeJS.ProcessEnv): string {
  if (env.COLORTERM) return env.COLORTERM;
  if (env.TERM?.includes("256color")) return "256 colors";
  if (env.TERM === "dumb") return "plain text";
  return "standard colors";
}

export function tuiTerminalDiagnosticLines(
  options: TUITerminalDiagnosticsOptions,
): string[] {
  const session = options.env.TMUX
    ? "tmux"
    : options.env.SSH_CONNECTION
      ? "SSH"
      : "local";
  return [
    `Terminal ${terminalName(options.env)} · ${options.platform} · ${session}`,
    `Viewport ${options.columns}x${options.rows} · ${terminalColorMode(options.env)} · ${options.isTTY ? "interactive" : "not a TTY"}`,
    `Clipboard ${options.clipboardCommand || "unavailable"} · alternate screen ${options.env.CYBARA_TUI_ALT_SCREEN === "0" ? "off" : "on"}`,
  ];
}

export function TranscriptSearchPanel({
  query,
  matches,
  selectedIndex,
  compact,
}: TranscriptSearchPanelProps): React.ReactElement {
  const rowLimit = compact ? 3 : 5;
  const maximumStart = Math.max(0, matches.length - rowLimit);
  const windowStart = Math.min(
    maximumStart,
    Math.max(0, selectedIndex - Math.floor(rowLimit / 2)),
  );
  const visibleMatches = matches.slice(windowStart, windowStart + rowLimit);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      marginTop={1}
      flexShrink={0}
    >
      <Text>
        <Text bold color="cyan">
          Find
        </Text>
        <Text> {query || "Type to search"}▏</Text>
        <Text color="gray">
          {" "}
          · {matches.length} result{matches.length === 1 ? "" : "s"}
        </Text>
      </Text>
      {visibleMatches.map((match, index) => {
        const absoluteIndex = windowStart + index;
        const selected = absoluteIndex === selectedIndex;
        return (
          <Text key={`${match.messageIndex}-${match.role}`} inverse={selected}>
            <Text color={selected ? "white" : "cyan"}>
              {selected ? "› " : "  "}
              {match.role === "user" ? "You" : "Cybara"}
            </Text>
            <Text color={selected ? "white" : "gray"}> · {match.excerpt}</Text>
          </Text>
        );
      })}
      <Text color="gray">
        ↑/↓ select · Enter jump · Esc close · Ctrl+U clear
      </Text>
    </Box>
  );
}

export function exportNotice(path: string): string {
  return `Conversation exported to ${basename(path)}.`;
}
