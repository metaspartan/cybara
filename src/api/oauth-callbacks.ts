export interface OAuthCallbackEntry {
  status: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  error?: string;
}

export const MAX_OAUTH_CALLBACKS = 100;

const store = new Map<string, OAuthCallbackEntry>();

export function setOAuthCallback(state: string, entry: OAuthCallbackEntry): void {
  if (!store.has(state)) {
    while (store.size >= MAX_OAUTH_CALLBACKS) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  }
  store.set(state, entry);
}

export function deleteOAuthCallback(state: string): void {
  store.delete(state);
}

export function consumeOAuthCallback(state: string): OAuthCallbackEntry | null {
  const entry = store.get(state);
  if (!entry) return null;
  if (entry.status === "success" || entry.status === "error") {
    store.delete(state);
  }
  return entry;
}

export function oauthCallbackCount(): number {
  return store.size;
}
