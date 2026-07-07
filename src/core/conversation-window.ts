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

/**
 * Model-aware compaction trigger ratio (fraction of the context window at which
 * session summarization fires). Larger windows have more absolute headroom, so
 * they run closer to full before compacting. Mirrors Hermes PR #59814, which
 * raised large-context models to ~85% after they compacted prematurely at ~50%.
 * A user override can only RAISE the model default, never lower it (the PR's
 * never-lower semantics), and is clamped to a sane (0, 0.95] range.
 */
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
