export const MULTI_CHAT_MAX_PANES = 4;
export const MULTI_CHAT_MIN_SLOTS = 2;
export const MULTI_CHAT_STORAGE_KEY = "cybara.chat.multiChatSessionIds";
export const MULTI_CHAT_DRAG_TYPE = "application/x-cybara-chat-session";

export function resolveActiveMultiChatDropIndex(
  currentIndex: number | null,
  targetIndex: number,
  active: boolean
): number | null {
  if (active) return targetIndex;
  return currentIndex === targetIndex ? null : currentIndex;
}

function normalizeSessionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 256 ? normalized : null;
}

export function normalizeMultiChatSessionIds(values: readonly unknown[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const sessionId = normalizeSessionId(value);
    if (!sessionId || seen.has(sessionId)) continue;
    seen.add(sessionId);
    unique.push(sessionId);
    if (unique.length === MULTI_CHAT_MAX_PANES) break;
  }
  return unique;
}

export function isMultiChatSearch(search: string): boolean {
  return new URLSearchParams(search).get("multi") === "1";
}

export function parseMultiChatSessionIds(search: string): string[] {
  return normalizeMultiChatSessionIds(new URLSearchParams(search).getAll("pane"));
}

export function buildMultiChatPath(sessionIds: readonly string[]): string {
  const params = new URLSearchParams({ multi: "1" });
  for (const sessionId of normalizeMultiChatSessionIds(sessionIds)) {
    params.append("pane", sessionId);
  }
  return `/chat?${params.toString()}`;
}

export function addMultiChatSession(sessionIds: readonly string[], sessionId: string): string[] {
  const normalizedId = normalizeSessionId(sessionId);
  if (!normalizedId) return normalizeMultiChatSessionIds(sessionIds);
  const current = normalizeMultiChatSessionIds(sessionIds);
  if (current.includes(normalizedId)) return current;
  return normalizeMultiChatSessionIds([...current, normalizedId]);
}

export function replaceMultiChatSession(
  sessionIds: readonly string[],
  index: number,
  sessionId: string
): string[] {
  const normalizedId = normalizeSessionId(sessionId);
  const current = normalizeMultiChatSessionIds(sessionIds);
  if (!normalizedId || index < 0 || index >= MULTI_CHAT_MAX_PANES) return current;
  const withoutTarget = current.filter((id, currentIndex) => currentIndex !== index);
  const withoutDuplicate = withoutTarget.filter((id) => id !== normalizedId);
  withoutDuplicate.splice(Math.min(index, withoutDuplicate.length), 0, normalizedId);
  return normalizeMultiChatSessionIds(withoutDuplicate);
}

export function reorderMultiChatSessions(
  sessionIds: readonly string[],
  sourceId: string,
  targetIndex: number
): string[] {
  const current = normalizeMultiChatSessionIds(sessionIds);
  const sourceIndex = current.indexOf(sourceId);
  if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= MULTI_CHAT_MAX_PANES) return current;
  const next = [...current];
  const [moved] = next.splice(sourceIndex, 1);
  if (!moved) return current;
  next.splice(Math.min(targetIndex, next.length), 0, moved);
  return next;
}

export function readPersistedMultiChatSessionIds(storage: Storage): string[] {
  try {
    const value = JSON.parse(storage.getItem(MULTI_CHAT_STORAGE_KEY) || "[]") as unknown;
    return Array.isArray(value) ? normalizeMultiChatSessionIds(value) : [];
  } catch {
    return [];
  }
}

export function persistMultiChatSessionIds(storage: Storage, sessionIds: readonly string[]): void {
  storage.setItem(MULTI_CHAT_STORAGE_KEY, JSON.stringify(normalizeMultiChatSessionIds(sessionIds)));
}
