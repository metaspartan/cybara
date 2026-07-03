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

/**
 * Index in `convo` where the retained window begins. Nudged forward by one when
 * it would land on a user turn, so a user-role summary message alternates
 * cleanly with the retained window. Returns 0 when nothing should be cut.
 */
export function planCompactionCut(convo: WindowMessage[], keepRecent: number): number {
  let cut = convo.length - keepRecent;
  if (cut <= 0) return 0;
  if (convo[cut]?.role === "user" && cut + 1 < convo.length) cut += 1;
  return cut;
}

/**
 * Rebuild the message list as: system prompt(s), a single summary of the older
 * turns, then the retained recent turns. If the retained window opens on a user
 * turn, the summary is folded into it to avoid two consecutive user messages.
 */
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
