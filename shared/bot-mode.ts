export const BOT_SESSION_PREFIX = "bot:";

export function botSessionId(agentId: string): string {
  const normalized = agentId.trim();
  if (!normalized) throw new Error("Agent id is required");
  return `${BOT_SESSION_PREFIX}${normalized}`;
}

export function isBotSessionId(sessionId: string): boolean {
  return sessionId.startsWith(BOT_SESSION_PREFIX) && sessionId.length > BOT_SESSION_PREFIX.length;
}
