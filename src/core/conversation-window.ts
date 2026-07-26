export interface WindowMessage {
  role: string;
  content: string;
}

export function estimateConversationChars(convo: WindowMessage[]): number {
  return convo.reduce(
    (sum, message) => sum + (typeof message.content === "string" ? message.content.length : 0) + 32,
    0
  );
}

export function resolveCompactionTriggerRatio(
  contextWindowTokens: number,
  userRatio?: number
): number {
  const tokens = Math.max(1024, Math.floor(contextWindowTokens || 0));
  const modelDefault = tokens >= 200_000 ? 0.85 : tokens >= 100_000 ? 0.8 : 0.72;
  const user =
    Number.isFinite(userRatio) && (userRatio ?? 0) > 0 ? Math.min(userRatio ?? 0, 0.95) : 0;
  return Math.max(modelDefault, user);
}

export function resolveMaxConversationMessages(contextWindowTokens: number): number {
  const tokens = Math.max(1024, Math.floor(contextWindowTokens || 0));
  return Math.min(4000, Math.max(60, Math.round(tokens / 400)));
}

export function resolveKeepRecentMessages(contextWindowTokens: number): number {
  const tokens = Math.max(1024, Math.floor(contextWindowTokens || 0));
  return Math.min(80, Math.max(16, Math.round(tokens / 4000)));
}

export function conversationNeedsCompaction(opts: {
  convoLength: number;
  convoChars: number;
  threshold: number;
  maxMessages: number;
  keepRecent: number;
}): boolean {
  if (opts.convoLength <= opts.keepRecent + 2) return false;
  return opts.convoChars > opts.threshold || opts.convoLength > opts.maxMessages;
}

export function planCompactionCut(convo: WindowMessage[], keepRecent: number): number {
  let cut = convo.length - keepRecent;
  if (cut <= 0) return 0;
  if (convo[cut]?.role === "user" && cut + 1 < convo.length) cut += 1;
  return cut;
}

export function buildCompactedConversation<T extends WindowMessage>(
  system: T[],
  recent: T[],
  summaryText: string,
  prefix: string
): T[] {
  const summaryBody = `${prefix}\n${summaryText}`;
  if (recent[0]?.role === "user") {
    const [first, ...rest] = recent;
    return [...system, { ...first, content: `${summaryBody}\n\n---\n\n${first.content}` }, ...rest];
  }
  return [...system, { role: "user", content: summaryBody } as T, ...recent];
}
