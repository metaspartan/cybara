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
    composerLines: narrow ? 3 : Math.max(4, Math.min(8, Math.floor(height / 7))),
    commandRows: narrow ? 4 : 6,
    messageLines: narrow ? (height < 28 ? 4 : 6) : 8,
    transcriptMessages:
      narrow && height < 28 ? 1 : Math.max(2, Math.min(8, Math.floor(height / (narrow ? 10 : 12)))),
  };
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
