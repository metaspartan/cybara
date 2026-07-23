import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { parseWebSocketAuthProtocol } from "../../shared/websocket-auth";
import {
  apiFetch,
  clearApiAuthToken,
  createHydratedAuthenticatedWebSocket,
  getApiAuthToken,
  setApiAuthToken,
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
const originalWebSocket = globalThis.WebSocket;

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
    globalThis.WebSocket = originalWebSocket;
  });

  test("normal API auth ignores query tokens and prefers stored tokens", () => {
    (globalThis as unknown as { window: Window }).window = createWindow("?token=query-token", {
      cybara_api_key: "stored-token",
    }) as unknown as Window;

    expect(getApiAuthToken()).toBe("stored-token");
  });

  test("query tokens are not adopted for normal API auth", () => {
    (globalThis as unknown as { window: Window }).window = createWindow(
      "?api_key=query-key",
      {}
    ) as unknown as Window;

    expect(getApiAuthToken()).toBeNull();
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
    expect(window.localStorage.getItem("cybara_api_key")).toBeNull();
  });

  test("apiFetch replaces a stale Tauri token after an authorization failure", async () => {
    const win = createWindow("") as ReturnType<typeof createWindow> & {
      __TAURI_INTERNALS__: {
        invoke: (command: string) => Promise<string | null>;
      };
    };
    win.__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        expect(command).toBe("read_cybara_api_key");
        return "fresh-desktop-token";
      },
    };
    (globalThis as unknown as { window: Window }).window = win as unknown as Window;
    setApiAuthToken("stale-desktop-token");

    const authorizations: Array<string | null> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get("Authorization");
      authorizations.push(authorization);
      return new Response("{}", {
        status: authorization === "Bearer fresh-desktop-token" ? 200 : 401,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const response = await apiFetch("/api/info");

    expect(response.status).toBe(200);
    expect(authorizations).toEqual(["Bearer stale-desktop-token", "Bearer fresh-desktop-token"]);
    clearApiAuthToken();
    expect(getApiAuthToken()).toBeNull();
  });

  test("hydrates the Tauri token before opening an authenticated WebSocket", async () => {
    const win = createWindow("") as ReturnType<typeof createWindow> & {
      __TAURI_INTERNALS__: {
        invoke: (command: string) => Promise<string | null>;
      };
    };
    win.__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        expect(command).toBe("read_cybara_api_key");
        return "desktop-stream-token";
      },
    };
    (globalThis as unknown as { window: Window }).window = win as unknown as Window;
    const protocols: Array<string | string[] | undefined> = [];
    class CapturedWebSocket {
      constructor(_url: string | URL, protocolsOrProtocol?: string | string[]) {
        protocols.push(protocolsOrProtocol);
      }
    }
    globalThis.WebSocket = CapturedWebSocket as unknown as typeof WebSocket;
    clearApiAuthToken();

    await createHydratedAuthenticatedWebSocket("ws://127.0.0.1/stream");

    expect(protocols).toHaveLength(1);
    expect(String(protocols[0])).toStartWith("cybara.auth.");
  });

  test("refreshes a stale Tauri token before reconnecting a WebSocket", async () => {
    const win = createWindow("") as ReturnType<typeof createWindow> & {
      __TAURI_INTERNALS__: {
        invoke: () => Promise<string>;
      };
    };
    win.__TAURI_INTERNALS__ = {
      invoke: async () => "fresh-stream-token",
    };
    (globalThis as unknown as { window: Window }).window = win as unknown as Window;
    const protocols: string[] = [];
    class CapturedWebSocket {
      constructor(_url: string | URL, protocolsOrProtocol?: string | string[]) {
        if (typeof protocolsOrProtocol === "string") protocols.push(protocolsOrProtocol);
      }
    }
    globalThis.WebSocket = CapturedWebSocket as unknown as typeof WebSocket;
    setApiAuthToken("stale-stream-token");

    await createHydratedAuthenticatedWebSocket("ws://127.0.0.1/stream", true);

    expect(parseWebSocketAuthProtocol(protocols[0])?.token).toBe("fresh-stream-token");
  });
});
