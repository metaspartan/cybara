import { invoke } from "@tauri-apps/api/core";
import { createWebSocketAuthProtocol } from "../../../shared/websocket-auth";
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
let desktopToken: string | null = null;
const volatileCredentials = new WeakMap<object, { token?: string; password?: string }>();

function currentVolatileCredentials(): { token?: string; password?: string } | null {
  if (typeof window === "undefined" || typeof window !== "object") return null;
  const existing = volatileCredentials.get(window);
  if (existing) return existing;
  const created: { token?: string; password?: string } = {};
  volatileCredentials.set(window, created);
  return created;
}

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

  if (isTauriDesktopRuntime()) {
    window.localStorage?.removeItem("cybara_api_key");
    window.localStorage?.removeItem("CYBARA_API_KEY");
    return desktopToken;
  }
  const volatile = currentVolatileCredentials();
  if (volatile?.token) return volatile.token;
  const storage = window.sessionStorage;
  const stored = storage?.getItem("cybara_api_key") || storage?.getItem("CYBARA_API_KEY");
  if (stored) return stored;
  const legacy =
    window.localStorage?.getItem("cybara_api_key") ||
    window.localStorage?.getItem("CYBARA_API_KEY");
  if (!legacy) return null;
  if (volatile) volatile.token = legacy;
  storage?.setItem("cybara_api_key", legacy);
  window.localStorage.removeItem("cybara_api_key");
  window.localStorage.removeItem("CYBARA_API_KEY");
  return legacy;
}

export function getGatewayAccessPassword(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const volatile = currentVolatileCredentials();
  if (volatile?.password) return volatile.password;
  const stored = window.sessionStorage?.getItem("cybara_gateway_password");
  if (stored) return stored;
  const legacy = window.localStorage?.getItem("cybara_gateway_password");
  if (!legacy) return null;
  if (volatile) volatile.password = legacy;
  window.sessionStorage?.setItem("cybara_gateway_password", legacy);
  window.localStorage.removeItem("cybara_gateway_password");
  return legacy;
}

export function setGatewayAccessPassword(password: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const trimmed = password.trim();
  if (trimmed) {
    const volatile = currentVolatileCredentials();
    if (volatile) volatile.password = trimmed;
    window.sessionStorage?.setItem("cybara_gateway_password", trimmed);
    window.localStorage?.removeItem("cybara_gateway_password");
  }
}

export function clearGatewayAccessPassword(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage?.removeItem("cybara_gateway_password");
  window.localStorage?.removeItem("cybara_gateway_password");
  const volatile = currentVolatileCredentials();
  if (volatile) delete volatile.password;
}

function persistWindowToken(token: string): void {
  if (typeof window === "undefined") {
    return;
  }
  if (isTauriDesktopRuntime()) {
    desktopToken = token;
    window.localStorage?.removeItem("cybara_api_key");
    window.localStorage?.removeItem("CYBARA_API_KEY");
    return;
  }
  const volatile = currentVolatileCredentials();
  if (volatile) volatile.token = token;
  window.sessionStorage?.setItem("cybara_api_key", token);
  window.localStorage?.removeItem("cybara_api_key");
  window.localStorage?.removeItem("CYBARA_API_KEY");
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

export function clearApiAuthToken(): void {
  desktopToken = null;
  desktopTokenHydration = null;
  if (typeof window === "undefined" || isTauriDesktopRuntime()) return;
  window.sessionStorage?.removeItem("cybara_api_key");
  window.sessionStorage?.removeItem("CYBARA_API_KEY");
  window.localStorage?.removeItem("cybara_api_key");
  window.localStorage?.removeItem("CYBARA_API_KEY");
  const volatile = currentVolatileCredentials();
  if (volatile) delete volatile.token;
}

export function createAuthenticatedWebSocket(url: string): WebSocket {
  const authProtocol = createWebSocketAuthProtocol({
    token: getApiAuthToken() || getQueryToken() || undefined,
    password: getGatewayAccessPassword() || undefined,
  });
  return authProtocol ? new WebSocket(url, authProtocol) : new WebSocket(url);
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
    (isTauriDesktopRuntime() || !getApiAuthToken()) &&
    (await hydrateTauriDesktopToken(true))
  ) {
    return fetchWithNetworkRetry(target, {
      ...init,
      headers: withApiAuthHeaders(init?.headers),
    });
  }

  return response;
}
