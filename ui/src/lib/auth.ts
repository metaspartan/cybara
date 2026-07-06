import { invoke } from "@tauri-apps/api/core";
import { isTauriDesktopRuntime } from "./desktopHost";

declare global {
  interface Window {
    __CYBARA_BASE_PATH__?: string;
  }
}

/**
 * Optional URL prefix the gateway serves under (e.g. "/cybara"), injected into
 * index.html by the gateway. Empty when served at the root or in Vite dev.
 */
export function getGatewayBasePath(): string {
  if (typeof window === "undefined" || typeof document === "undefined") return "";
  const meta = document.querySelector('meta[name="cybara-base-path"]');
  const fromMeta = meta?.getAttribute("content") || "";
  const base = fromMeta || window.__CYBARA_BASE_PATH__ || "";
  return typeof base === "string" && base.startsWith("/") && base !== "/" ? base : "";
}

/** Prefix a root-relative API path with the gateway base path. */
export function withGatewayBasePath(path: string): string {
  const base = getGatewayBasePath();
  if (!base || !path.startsWith("/") || path.startsWith(`${base}/`)) return path;
  return `${base}${path}`;
}

let desktopTokenHydration: Promise<string | null> | null = null;

function getWindowToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const search = typeof window.location?.search === "string" ? window.location.search : "";
  const query = new URLSearchParams(search);
  const fromQuery = query.get("api_key") || query.get("token");
  if (fromQuery) {
    // Tokenized launch links (printed by the gateway at startup) hand the key
    // to the UI once; persist it and scrub it from the address bar/history so
    // it doesn't linger in screenshots or shared URLs.
    persistWindowToken(fromQuery);
    try {
      query.delete("api_key");
      query.delete("token");
      const rest = query.toString();
      const cleaned = `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`;
      window.history.replaceState(window.history.state, "", cleaned);
    } catch {
      // History API unavailable — keep the param rather than break auth.
    }
    return fromQuery;
  }

  const storage = window.localStorage;
  if (!storage) {
    return null;
  }

  return storage.getItem("cybara_api_key") || storage.getItem("CYBARA_API_KEY");
}

function persistWindowToken(token: string): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  window.localStorage.setItem("cybara_api_key", token);
}

async function hydrateTauriDesktopToken(force = false): Promise<string | null> {
  const existing = getWindowToken();
  if (existing && !force) {
    return existing;
  }
  if (!isTauriDesktopRuntime()) {
    return existing;
  }
  if (!force && desktopTokenHydration) {
    return desktopTokenHydration;
  }

  desktopTokenHydration = invoke<string | null>("read_cybara_api_key")
    .then((token) => {
      const trimmed = typeof token === "string" ? token.trim() : "";
      if (!trimmed) {
        return null;
      }
      persistWindowToken(trimmed);
      return trimmed;
    })
    .catch(() => null);

  return desktopTokenHydration;
}

function hasExplicitAuthorization(headers?: HeadersInit): boolean {
  return new Headers(headers).has("Authorization");
}

export function getApiAuthToken(): string | null {
  return getWindowToken();
}

/** Adopt a new key (e.g. right after rotation) so the UI keeps working. */
export function setApiAuthToken(token: string): void {
  if (token.trim()) {
    persistWindowToken(token.trim());
  }
}

export function appendApiTokenParam(urlOrPath: string, token = getApiAuthToken()): string {
  // Callers hand this root-relative API paths destined for fetch/WebSocket;
  // apply the gateway base path here so they stay prefix-agnostic.
  const prefixed = urlOrPath.startsWith("/") ? withGatewayBasePath(urlOrPath) : urlOrPath;
  if (!token) {
    return prefixed;
  }

  const hasQuery = prefixed.includes("?");
  const separator = hasQuery ? "&" : "?";
  return `${prefixed}${separator}token=${encodeURIComponent(token)}`;
}

export function withApiAuthHeaders(headers?: HeadersInit, token = getApiAuthToken()): Headers {
  const resolved = new Headers(headers);
  if (token && !resolved.has("Authorization")) {
    resolved.set("Authorization", `Bearer ${token}`);
  }
  return resolved;
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const explicitAuthorization = hasExplicitAuthorization(init?.headers);
  if (!explicitAuthorization && !getApiAuthToken()) {
    await hydrateTauriDesktopToken();
  }

  // Root-relative paths get the gateway base path here, at the single fetch
  // choke point, so no call site needs to know about the prefix.
  const target =
    typeof input === "string" && input.startsWith("/") ? withGatewayBasePath(input) : input;

  const response = await fetch(target, {
    ...init,
    headers: withApiAuthHeaders(init?.headers),
  });

  if (
    !explicitAuthorization &&
    (response.status === 401 || response.status === 403) &&
    !getApiAuthToken() &&
    (await hydrateTauriDesktopToken(true))
  ) {
    return fetch(target, {
      ...init,
      headers: withApiAuthHeaders(init?.headers),
    });
  }

  return response;
}
