export interface OAuthCallbackEntry {
  status: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  error?: string;
}

export const MAX_OAUTH_CALLBACKS = 100;
export const OAUTH_CALLBACK_TTL_MS = 10 * 60 * 1000;

interface StoredOAuthCallback {
  entry: OAuthCallbackEntry;
  owner: string;
  expiresAt: number;
}

const store = new Map<string, StoredOAuthCallback>();

function pruneExpired(now = Date.now()): void {
  for (const [state, callback] of store) {
    if (callback.expiresAt <= now) store.delete(state);
  }
}

export function setOAuthCallback(
  state: string,
  entry: OAuthCallbackEntry,
  owner = "unbound",
  ttlMs = OAUTH_CALLBACK_TTL_MS
): void {
  pruneExpired();
  if (!store.has(state)) {
    while (store.size >= MAX_OAUTH_CALLBACKS) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  }
  store.set(state, { entry, owner, expiresAt: Date.now() + Math.max(1, ttlMs) });
}

export function deleteOAuthCallback(state: string): void {
  store.delete(state);
}

export function consumeOAuthCallback(state: string, owner = "unbound"): OAuthCallbackEntry | null {
  pruneExpired();
  const callback = store.get(state);
  if (!callback || callback.owner !== owner) return null;
  if (callback.entry.status === "success" || callback.entry.status === "error") {
    store.delete(state);
  }
  return callback.entry;
}

export function oauthCallbackCount(): number {
  pruneExpired();
  return store.size;
}
