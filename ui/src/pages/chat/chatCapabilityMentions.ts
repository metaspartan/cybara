import type { ChatCapabilityOption } from "@/lib/api";

export interface ActiveCapabilityMention {
  start: number;
  end: number;
  query: string;
}

export function findActiveCapabilityMention(
  value: string,
  cursor: number
): ActiveCapabilityMention | null {
  const boundedCursor = Math.max(0, Math.min(cursor, value.length));
  const prefix = value.slice(0, boundedCursor);
  const match = prefix.match(/(^|\s)@([a-zA-Z0-9._/-]*)$/);
  if (!match || match.index === undefined) return null;
  const start = match.index + match[1].length;
  return { start, end: boundedCursor, query: match[2].toLowerCase() };
}

export function filterChatCapabilities(
  options: ChatCapabilityOption[],
  query: string,
  limit = 10
): ChatCapabilityOption[] {
  const normalized = query.trim().toLowerCase();
  return options
    .map((option) => {
      const token = option.token.slice(1).toLowerCase();
      const name = option.name.toLowerCase();
      const source = option.source.toLowerCase();
      const description = option.description.toLowerCase();
      const kindRank: Record<string, number> = {
        skill: 50,
        mcp_server: 40,
        mcp: 30,
        agent: 20,
        tool: 10,
      };
      const score = !normalized
        ? (kindRank[option.kind] ?? 5)
        : token === normalized
          ? 100
          : token.startsWith(normalized)
            ? 80
            : name.startsWith(normalized)
              ? 60
              : token.includes(normalized) || source.includes(normalized)
                ? 40
                : description.includes(normalized)
                  ? 20
                  : 0;
      return { option, score };
    })
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.option.token.localeCompare(right.option.token)
    )
    .slice(0, Math.max(1, limit))
    .map((entry) => entry.option);
}

export function insertChatCapabilityMention(
  value: string,
  active: ActiveCapabilityMention,
  token: string
): { value: string; cursor: number } {
  const suffix = value.slice(active.end);
  const separator = suffix.length === 0 || !/^\s/.test(suffix) ? " " : "";
  const nextValue = `${value.slice(0, active.start)}${token}${separator}${suffix}`;
  return { value: nextValue, cursor: active.start + token.length + separator.length };
}
