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

export function withApiAuthHeaders(
  headers?: HeadersInit,
  token = getApiAuthToken()
): Headers {
  const resolved = new Headers(headers);
  if (token && !resolved.has("Authorization")) {
    resolved.set("Authorization", `Bearer ${token}`);
  }
  return resolved;
}

export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, {
    ...init,
    headers: withApiAuthHeaders(init?.headers),
  });
}
