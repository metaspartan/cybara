import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  appendApiTokenParam,
  apiFetch,
  getApiAuthToken,
  withApiAuthHeaders,
} from "../../ui/src/lib/auth";

type StorageMap = Map<string, string>;

function createWindow(search: string, initialStorage: Record<string, string> = {}) {
  const store: StorageMap = new Map(Object.entries(initialStorage));
  return {
    location: { search },
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    },
  };
}

const originalWindow = (globalThis as { window?: Window }).window;
const originalFetch = globalThis.fetch;

describe("UI auth token helpers", () => {
  beforeEach(() => {
    (globalThis as unknown as { window: Window }).window = createWindow("") as unknown as Window;
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: Window }).window;
    } else {
      (globalThis as { window?: Window }).window = originalWindow;
    }
    globalThis.fetch = originalFetch;
  });

  test("normal API auth ignores query tokens and prefers stored tokens", () => {
    (globalThis as unknown as { window: Window }).window = createWindow("?token=query-token", {
      cybara_api_key: "stored-token",
    }) as unknown as Window;

    expect(getApiAuthToken()).toBe("stored-token");
  });

  test("query token is only used as a stream URL compatibility fallback", () => {
    (globalThis as unknown as { window: Window }).window = createWindow(
      "?api_key=query-key",
      {}
    ) as unknown as Window;

    expect(getApiAuthToken()).toBeNull();
    expect(appendApiTokenParam("/api/sse/status")).toBe("/api/sse/status?token=query-key");
  });

  test("falls back to localStorage token keys", () => {
    (globalThis as unknown as { window: Window }).window = createWindow("", {
      CYBARA_API_KEY: "legacy-token",
    }) as unknown as Window;
    expect(getApiAuthToken()).toBe("legacy-token");

    (globalThis as unknown as { window: Window }).window = createWindow("", {
      cybara_api_key: "preferred-token",
      CYBARA_API_KEY: "legacy-token",
    }) as unknown as Window;
    expect(getApiAuthToken()).toBe("preferred-token");
  });

  test("appendApiTokenParam preserves existing query and encodes token", () => {
    (globalThis as unknown as { window: Window }).window = createWindow(
      "?token=a%20b%2F%2B",
      {}
    ) as unknown as Window;

    expect(appendApiTokenParam("/api/sse/status")).toBe("/api/sse/status?token=a%20b%2F%2B");
    expect(appendApiTokenParam("/api/terminal/ws?session=abc")).toBe(
      "/api/terminal/ws?session=abc&token=a%20b%2F%2B"
    );
  });

  test("appendApiTokenParam returns original URL when no token is available", () => {
    (globalThis as unknown as { window: Window }).window = createWindow("") as unknown as Window;
    expect(getApiAuthToken()).toBeNull();
    expect(appendApiTokenParam("/api/sse/status")).toBe("/api/sse/status");
  });

  test("getApiAuthToken returns null when window is unavailable", () => {
    delete (globalThis as { window?: Window }).window;
    expect(getApiAuthToken()).toBeNull();
  });

  test("withApiAuthHeaders injects bearer token when not set", () => {
    const headers = withApiAuthHeaders({ "Content-Type": "application/json" }, "secret-token");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer secret-token");
  });

  test("withApiAuthHeaders preserves explicit Authorization header", () => {
    const headers = withApiAuthHeaders({ Authorization: "Bearer explicit" }, "secret-token");
    expect(headers.get("Authorization")).toBe("Bearer explicit");
  });

  test("apiFetch does not adopt query tokens for REST auth", async () => {
    (globalThis as unknown as { window: Window }).window = createWindow(
      "?token=query-token"
    ) as unknown as Window;

    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await apiFetch("/api/health");
    const headers = new Headers(capturedInit?.headers);
    expect(headers.get("Authorization")).toBeNull();
  });

  test("apiFetch keeps explicit Authorization header", async () => {
    (globalThis as unknown as { window: Window }).window = createWindow(
      "?token=query-token"
    ) as unknown as Window;

    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await apiFetch("/api/health", {
      headers: { Authorization: "Bearer explicit-token" },
    });
    const headers = new Headers(capturedInit?.headers);
    expect(headers.get("Authorization")).toBe("Bearer explicit-token");
  });

  test("apiFetch does not inject Authorization when token is unavailable", async () => {
    delete (globalThis as { window?: Window }).window;

    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await apiFetch("/api/health");
    const headers = new Headers(capturedInit?.headers);
    expect(headers.get("Authorization")).toBeNull();
  });

  test("apiFetch hydrates Tauri desktop API key and retries denied protected requests", async () => {
    let invokeCalls = 0;
    const win = createWindow("") as ReturnType<typeof createWindow> & {
      __TAURI_INTERNALS__: {
        invoke: (command: string) => Promise<string | null>;
      };
    };
    win.__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        expect(command).toBe("read_cybara_api_key");
        invokeCalls += 1;
        return invokeCalls === 1 ? null : "desktop-token";
      },
    };
    (globalThis as unknown as { window: Window }).window = win as unknown as Window;

    const capturedInits: RequestInit[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInits.push(init || {});
      return new Response("{}", {
        status: capturedInits.length === 1 ? 403 : 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const response = await apiFetch("/api/config", { method: "PUT" });

    expect(response.status).toBe(200);
    expect(invokeCalls).toBe(2);
    expect(capturedInits).toHaveLength(2);
    expect(new Headers(capturedInits[0].headers).get("Authorization")).toBeNull();
    expect(new Headers(capturedInits[1].headers).get("Authorization")).toBe("Bearer desktop-token");
    expect(window.localStorage.getItem("cybara_api_key")).toBe("desktop-token");
  });
});
