export interface SharedChatCapabilityOption {
  kind: string;
  token: string;
  name: string;
  description: string;
  source: string;
}

export interface ActiveCapabilityMention {
  start: number;
  end: number;
  query: string;
  trigger: "@" | "/";
}

export function findActiveCapabilityMention(
  value: string,
  cursor: number
): ActiveCapabilityMention | null {
  const boundedCursor = Math.max(0, Math.min(cursor, value.length));
  const prefix = value.slice(0, boundedCursor);
  const mentionMatch = prefix.match(/(^|\s)@([a-zA-Z0-9._/-]*)$/);
  if (mentionMatch?.index !== undefined) {
    const start = mentionMatch.index + (mentionMatch[1] || "").length;
    return {
      start,
      end: boundedCursor,
      query: (mentionMatch[2] || "").toLowerCase(),
      trigger: "@",
    };
  }
  const commandMatch = prefix.match(/^(\s*)\/([a-zA-Z0-9_-]*)$/);
  if (!commandMatch) return null;
  return {
    start: (commandMatch[1] || "").length,
    end: boundedCursor,
    query: (commandMatch[2] || "").toLowerCase(),
    trigger: "/",
  };
}

export function filterChatCapabilities<T extends SharedChatCapabilityOption>(
  options: T[],
  query: string,
  limit = 10,
  trigger: "@" | "/" = "@"
): T[] {
  const normalized = query.trim().toLowerCase();
  const kindRank: Record<string, number> = {
    command: 70,
    bot: 65,
    skill: 60,
    mcp_server: 50,
    mcp: 40,
    connector: 35,
    agent: 30,
    tool: 20,
  };
  return options
    .filter((option) => option.token.startsWith(trigger))
    .map((option) => {
      const token = option.token.slice(1).toLowerCase();
      const name = option.name.toLowerCase();
      const source = option.source.toLowerCase();
      const description = option.description.toLowerCase();
      const score = !normalized
        ? (kindRank[option.kind] ?? 10)
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
  return {
    value: nextValue,
    cursor: active.start + token.length + separator.length,
  };
}
