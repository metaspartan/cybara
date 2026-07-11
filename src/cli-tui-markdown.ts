export interface TerminalInlineSegment {
  text: string;
  bold?: boolean;
  code?: boolean;
  dim?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
}

export type TerminalListItem =
  | { kind: "task"; indent: string; content: string; checked: boolean }
  | { kind: "bullet"; indent: string; content: string }
  | { kind: "ordered"; indent: string; content: string; number: string };

export function splitTerminalInline(line: string): TerminalInlineSegment[] {
  const parts: TerminalInlineSegment[] = [];
  const pattern =
    /(\*\*[^*]+\*\*|~~[^~]+~~|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\)|(?<!\*)\*[^*]+\*(?!\*)|_[^_]+_)/g;
  let offset = 0;
  for (const match of line.matchAll(pattern)) {
    if (match.index === undefined) continue;
    if (match.index > offset) parts.push({ text: line.slice(offset, match.index) });
    const token = match[0];
    if (token.startsWith("**")) parts.push({ text: token.slice(2, -2), bold: true });
    else if (token.startsWith("~~")) parts.push({ text: token.slice(2, -2), strikethrough: true });
    else if (token.startsWith("`")) parts.push({ text: token.slice(1, -1), code: true });
    else if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/.exec(token);
      if (link) {
        parts.push({ text: link[1] || "link", bold: true });
        parts.push({ text: ` (${link[2]})`, dim: true });
      }
    } else parts.push({ text: token.slice(1, -1), italic: true });
    offset = match.index + token.length;
  }
  if (offset < line.length) parts.push({ text: line.slice(offset) });
  return parts.length ? parts : [{ text: line || " " }];
}

export function parseTerminalListItem(line: string): TerminalListItem | null {
  const task = /^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line);
  if (task) {
    return {
      kind: "task",
      indent: task[1] || "",
      checked: task[2]?.toLowerCase() === "x",
      content: task[3] || "",
    };
  }
  const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line);
  if (bullet) {
    return { kind: "bullet", indent: bullet[1] || "", content: bullet[2] || "" };
  }
  const ordered = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line);
  if (ordered) {
    return {
      kind: "ordered",
      indent: ordered[1] || "",
      number: ordered[2] || "1",
      content: ordered[3] || "",
    };
  }
  return null;
}
