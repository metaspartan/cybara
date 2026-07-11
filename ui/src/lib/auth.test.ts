import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  appendApiTokenParam,
  clearGatewayAccessPassword,
  getApiAuthToken,
  getGatewayAccessPassword,
  setGatewayAccessPassword,
  withApiAuthHeaders,
} from "./auth";

const g = globalThis as { window?: unknown };
let hadWindow: boolean;
let originalWindow: unknown;

function makeStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

function setWindow(search: string, storage?: ReturnType<typeof makeStorage> | null) {
  g.window = {
    location: { search },
    localStorage: storage === undefined ? makeStorage() : storage,
    sessionStorage: makeStorage(),
  };
}

beforeEach(() => {
  hadWindow = "window" in g;
  originalWindow = g.window;
});

afterEach(() => {
  if (hadWindow) {
    g.window = originalWindow;
  } else {
    delete g.window;
  }
});

describe("getApiAuthToken", () => {
  test("no window returns null", () => {
    delete g.window;
    expect(getApiAuthToken()).toBe(null);
  });

  test("ignores api_key query string for normal API auth", () => {
    setWindow("?api_key=q123", makeStorage({ cybara_api_key: "stored" }));
    expect(getApiAuthToken()).toBe("stored");
  });

  test("ignores token query param for normal API auth", () => {
    setWindow("?token=tok", null);
    expect(getApiAuthToken()).toBe(null);
  });

  test("falls back to localStorage cybara_api_key", () => {
    const local = makeStorage({ cybara_api_key: "lsk" });
    setWindow("", local);
    expect(getApiAuthToken()).toBe("lsk");
    expect(local.getItem("cybara_api_key")).toBeNull();
  });

  test("falls back to uppercase localStorage key", () => {
    setWindow("", makeStorage({ CYBARA_API_KEY: "upper" }));
    expect(getApiAuthToken()).toBe("upper");
  });

  test("missing storage returns null", () => {
    setWindow("", null);
    expect(getApiAuthToken()).toBe(null);
  });

  test("no token anywhere returns null", () => {
    setWindow("", makeStorage());
    expect(getApiAuthToken()).toBe(null);
  });
});

describe("appendApiTokenParam", () => {
  test("no token leaves path unchanged", () => {
    expect(appendApiTokenParam("/api/x", null)).toBe("/api/x");
  });

  test("appends with ? when no existing query", () => {
    expect(appendApiTokenParam("/api/x", "tok")).toBe("/api/x?token=tok");
  });

  test("appends with & when query already present", () => {
    expect(appendApiTokenParam("/api/x?a=1", "tok")).toBe("/api/x?a=1&token=tok");
  });

  test("url-encodes the token", () => {
    expect(appendApiTokenParam("/api/x", "a b/c")).toBe("/api/x?token=a%20b%2Fc");
  });

  test("uses query token only for URL-param compatibility fallback", () => {
    setWindow("?token=fromwin", null);
    expect(appendApiTokenParam("/api/x")).toBe("/api/x?token=fromwin");
  });
});

describe("withApiAuthHeaders", () => {
  test("adds a Bearer Authorization header when token present", () => {
    const headers = withApiAuthHeaders(undefined, "tok");
    expect(headers.get("Authorization")).toBe("Bearer tok");
  });

  test("no token leaves headers without Authorization", () => {
    const headers = withApiAuthHeaders(undefined, null);
    expect(headers.has("Authorization")).toBe(false);
  });

  test("does not overwrite an existing Authorization header", () => {
    const headers = withApiAuthHeaders({ Authorization: "Bearer existing" }, "tok");
    expect(headers.get("Authorization")).toBe("Bearer existing");
  });

  test("preserves other provided headers", () => {
    const headers = withApiAuthHeaders({ "Content-Type": "application/json" }, "tok");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer tok");
  });
});

describe("gateway access password", () => {
  test("keeps the password in session storage instead of persistent local storage", () => {
    const local = makeStorage();
    setWindow("", local);

    setGatewayAccessPassword(" remote-secret ");

    expect(getGatewayAccessPassword()).toBe("remote-secret");
    expect(local.getItem("cybara_gateway_password")).toBeNull();
  });

  test("migrates and removes a legacy local-storage password", () => {
    const local = makeStorage({ cybara_gateway_password: "legacy-secret" });
    setWindow("", local);

    expect(getGatewayAccessPassword()).toBe("legacy-secret");
    expect(local.getItem("cybara_gateway_password")).toBeNull();
    clearGatewayAccessPassword();
    expect(getGatewayAccessPassword()).toBeNull();
  });
});
