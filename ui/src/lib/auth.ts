import { invoke } from "@tauri-apps/api/core";
import { isTauriDesktopRuntime } from "./desktopHost";

let desktopTokenHydration: Promise<string | null> | null = null;

function getWindowToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const search = typeof window.location?.search === "string" ? window.location.search : "";
  const query = new URLSearchParams(search);
  const fromQuery = query.get("api_key") || query.get("token");
  if (fromQuery) {
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

export function appendApiTokenParam(urlOrPath: string, token = getApiAuthToken()): string {
  if (!token) {
    return urlOrPath;
  }

  const hasQuery = urlOrPath.includes("?");
  const separator = hasQuery ? "&" : "?";
  return `${urlOrPath}${separator}token=${encodeURIComponent(token)}`;
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

  const response = await fetch(input, {
    ...init,
    headers: withApiAuthHeaders(init?.headers),
  });

  if (
    !explicitAuthorization &&
    (response.status === 401 || response.status === 403) &&
    !getApiAuthToken() &&
    (await hydrateTauriDesktopToken(true))
  ) {
    return fetch(input, {
      ...init,
      headers: withApiAuthHeaders(init?.headers),
    });
  }

  return response;
}
