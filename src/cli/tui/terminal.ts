import React from "react";

export interface TerminalLayout {
  columns: number;
  rows: number;
  narrow: boolean;
  compact: boolean;
  composerLines: number;
  commandRows: number;
  messageLines: number;
  transcriptMessages: number;
}

export interface TranscriptLine {
  text: string;
  code: boolean;
  fence?: "open" | "close";
  language?: string;
  hidden?: boolean;
}

export interface TerminalScreenSequence {
  enter: string;
  exit: string;
}

export interface TerminalChatInspectorLayout {
  contentColumns: number;
  sidebar: boolean;
  width: number;
}

export interface TerminalSelectionWindow {
  count: number;
  start: number;
}

export type ChatEscapeAction = "close_panel" | "clear_draft" | "keep_run" | "back";

export function chatEscapeAction(
  hasPanel: boolean,
  hasDraft: boolean,
  activeRun = false
): ChatEscapeAction {
  if (hasPanel) return "close_panel";
  if (hasDraft) return "clear_draft";
  if (activeRun) return "keep_run";
  return "back";
}

export function terminalScreenSequence(
  isTTY: boolean,
  env: NodeJS.ProcessEnv
): TerminalScreenSequence | null {
  if (!isTTY || env.TERM === "dumb" || env.CYBARA_TUI_ALT_SCREEN === "0") return null;
  return {
    enter: "\u001B[?1049h\u001B[2J\u001B[H\u001B[?25l",
    exit: "\u001B[?25h\u001B[?1049l",
  };
}

export function useTerminalScreen(): void {
  React.useEffect(() => {
    const sequence = terminalScreenSequence(Boolean(process.stdout.isTTY), process.env);
    if (!sequence) return;
    process.stdout.write(sequence.enter);
    return () => {
      process.stdout.write(sequence.exit);
    };
  }, []);
}

export function resolveTerminalLayout(columns?: number, rows?: number): TerminalLayout {
  const width = Math.max(40, columns || 80);
  const height = Math.max(18, rows || 32);
  const narrow = width < 72;
  const compact = width < 100;
  return {
    columns: width,
    rows: height,
    narrow,
    compact,
    composerLines: height <= 24 ? 1 : narrow ? 3 : Math.max(4, Math.min(8, Math.floor(height / 7))),
    commandRows: narrow ? 4 : 6,
    messageLines: height <= 24 ? 3 : narrow ? (height < 28 ? 4 : 6) : 8,
    transcriptMessages:
      height < 34 ? 1 : Math.max(2, Math.min(8, Math.floor(height / (narrow ? 10 : 12)))),
  };
}

export function resolveTerminalChatInspector(columns: number): TerminalChatInspectorLayout {
  const safeColumns = Math.max(40, columns);
  if (safeColumns < 118) {
    return { contentColumns: safeColumns, sidebar: false, width: 0 };
  }
  const width = Math.max(34, Math.min(44, Math.floor(safeColumns * 0.28)));
  return {
    contentColumns: safeColumns - width - 1,
    sidebar: true,
    width,
  };
}

export function terminalSelectionWindow(
  itemCount: number,
  selectedIndex: number,
  availableRows: number
): TerminalSelectionWindow {
  const count = Math.min(Math.max(0, itemCount), Math.max(1, availableRows));
  if (count === 0) return { count: 0, start: 0 };
  const selected = Math.min(Math.max(0, selectedIndex), itemCount - 1);
  const start = Math.max(0, Math.min(itemCount - count, selected - Math.floor(count / 2)));
  return { count, start };
}

export function transcriptMessageLimit(layoutLimit: number, expanded: boolean): number {
  return expanded ? 1 : Math.max(1, layoutLimit);
}

export function useTerminalLayout(): TerminalLayout {
  const [size, setSize] = React.useState(() => ({
    columns: process.stdout.columns,
    rows: process.stdout.rows,
  }));
  React.useEffect(() => {
    const update = () => setSize({ columns: process.stdout.columns, rows: process.stdout.rows });
    process.stdout.on("resize", update);
    return () => {
      process.stdout.off("resize", update);
    };
  }, []);
  return React.useMemo(
    () => resolveTerminalLayout(size.columns, size.rows),
    [size.columns, size.rows]
  );
}

export function composerWindow(value: string, cursor: number, maxLines: number): string[] {
  const safeCursor = Math.max(0, Math.min(value.length, cursor));
  const before = value.slice(0, safeCursor);
  const cursorLine = before.split("\n").length - 1;
  const rendered = `${value.slice(0, safeCursor)}▏${value.slice(safeCursor) || " "}`.split("\n");
  if (rendered.length <= maxLines) return rendered;
  const half = Math.floor(maxLines / 2);
  const start = Math.max(0, Math.min(rendered.length - maxLines, cursorLine - half));
  const window = rendered.slice(start, start + maxLines);
  if (start > 0) window[0] = `… ${start} line${start === 1 ? "" : "s"} above`;
  const below = rendered.length - start - maxLines;
  if (below > 0) window[window.length - 1] = `… ${below} line${below === 1 ? "" : "s"} below`;
  return window;
}

function terminalLineRows(line: TranscriptLine, maxColumns: number): number {
  if (!Number.isFinite(maxColumns)) return 1;
  return Math.max(1, Math.ceil(Math.max(1, Array.from(line.text).length) / maxColumns));
}

function terminalLineFragment(
  line: TranscriptLine,
  maxColumns: number,
  rows: number,
  tail: boolean
): TranscriptLine {
  const characters = Math.max(1, maxColumns * rows);
  const values = Array.from(line.text);
  if (values.length <= characters) return line;
  if (characters === 1) return { ...line, text: "…" };
  return {
    ...line,
    text: tail
      ? `…${values.slice(-(characters - 1)).join("")}`
      : `${values.slice(0, characters - 1).join("")}…`,
  };
}

function terminalWindowSide(
  lines: TranscriptLine[],
  maxColumns: number,
  rowBudget: number,
  tail: boolean
): TranscriptLine[] {
  if (rowBudget <= 0) return [];
  const selected: TranscriptLine[] = [];
  let remaining = rowBudget;
  const indexes = tail
    ? Array.from({ length: lines.length }, (_, index) => lines.length - index - 1)
    : Array.from({ length: lines.length }, (_, index) => index);
  for (const index of indexes) {
    const line = lines[index];
    if (!line) continue;
    const rows = terminalLineRows(line, maxColumns);
    if (rows <= remaining) {
      selected.push(line);
      remaining -= rows;
    } else {
      selected.push(terminalLineFragment(line, maxColumns, remaining, tail));
      remaining = 0;
    }
    if (remaining <= 0) break;
  }
  return tail ? selected.reverse() : selected;
}

export function transcriptWindow(
  content: string,
  maxLines: number,
  maxColumns = Number.POSITIVE_INFINITY,
  hiddenText = "… more content hidden · /expand shows more"
): TranscriptLine[] {
  let inCode = false;
  const sourceLines = content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((text): TranscriptLine => {
      const fence = text.match(/^\s*```(\w*)\s*$/);
      if (!fence) return { text, code: inCode };
      const opening = !inCode;
      inCode = opening;
      return {
        text,
        code: false,
        fence: opening ? "open" : "close",
        language: fence[1] || undefined,
      };
    });
  const limit = Math.max(1, maxLines);
  const columns = Number.isFinite(maxColumns) ? Math.max(12, Math.floor(maxColumns)) : maxColumns;
  const renderedRows = sourceLines.reduce(
    (total, line) => total + terminalLineRows(line, columns),
    0
  );
  if (renderedRows <= limit) return sourceLines;
  const contentRows = Math.max(1, limit - 1);
  const headRows = Math.ceil(contentRows / 2);
  const tailRows = Math.floor(contentRows / 2);
  const head = terminalWindowSide(sourceLines, columns, headRows, false);
  const usedHeadIndexes = new Set(
    head.map((line) => sourceLines.indexOf(line)).filter((index) => index >= 0)
  );
  const tailSource = sourceLines.filter((_, index) => !usedHeadIndexes.has(index));
  const tail = terminalWindowSide(tailSource, columns, tailRows, true);
  return [
    ...head,
    {
      text: hiddenText,
      code: false,
      hidden: true,
    },
    ...tail,
  ];
}

export function clipboardCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[][] {
  if (platform === "darwin") return [["pbcopy"]];
  if (platform === "win32") return [["clip.exe"], ["clip"]];
  const candidates: string[][] = [];
  if (env.WAYLAND_DISPLAY) candidates.push(["wl-copy"]);
  candidates.push(["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"]);
  return candidates;
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  for (const command of clipboardCandidates(process.platform, process.env)) {
    const executable = Bun.which(command[0] || "");
    if (!executable) continue;
    const child = Bun.spawn([executable, ...command.slice(1)], {
      stdin: new Blob([text]),
      stdout: "ignore",
      stderr: "ignore",
    });
    if ((await child.exited) === 0) return true;
  }
  return false;
}
