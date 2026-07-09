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

function getQueryToken(): string | null {
  if (typeof window === "undefined") return null;
  const search = typeof window.location?.search === "string" ? window.location.search : "";
  const query = new URLSearchParams(search);
  return query.get("api_key") || query.get("token");
}

function getWindowToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const storage = window.localStorage;
  if (!storage) {
    return null;
  }

  return storage.getItem("cybara_api_key") || storage.getItem("CYBARA_API_KEY");
}

export function getGatewayAccessPassword(): string | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  return window.localStorage.getItem("cybara_gateway_password");
}

export function setGatewayAccessPassword(password: string): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  const trimmed = password.trim();
  if (trimmed) {
    window.localStorage.setItem("cybara_gateway_password", trimmed);
  }
}

export function clearGatewayAccessPassword(): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  window.localStorage.removeItem("cybara_gateway_password");
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

export function appendApiTokenParam(
  urlOrPath: string,
  token = getApiAuthToken() || getQueryToken()
): string {
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
  const password = getGatewayAccessPassword();
  if (password && !resolved.has("X-Cybara-Gateway-Password")) {
    resolved.set("X-Cybara-Gateway-Password", password);
  }
  return resolved;
}

async function fetchWithNetworkRetry(
  target: RequestInfo | URL,
  init: RequestInit
): Promise<Response> {
  const method = (init.method || "GET").toUpperCase();
  const idempotent = method === "GET" || method === "HEAD";
  const maxAttempts = idempotent ? 3 : 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fetch(target, init);
    } catch (error) {
      lastError = error;
      const aborted =
        (init.signal && init.signal.aborted) ||
        (error instanceof DOMException && error.name === "AbortError");
      if (aborted || attempt === maxAttempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
    }
  }
  throw lastError;
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

  const response = await fetchWithNetworkRetry(target, {
    ...init,
    headers: withApiAuthHeaders(init?.headers),
  });

  if (
    !explicitAuthorization &&
    (response.status === 401 || response.status === 403) &&
    !getApiAuthToken() &&
    (await hydrateTauriDesktopToken(true))
  ) {
    return fetchWithNetworkRetry(target, {
      ...init,
      headers: withApiAuthHeaders(init?.headers),
    });
  }

  return response;
}
