import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { openExternal } from "../../ui/src/utils/openExternal";

type OpenCall = {
  url: string;
  target?: string;
  features?: string;
};

const originalFetch = globalThis.fetch;
const originalWindow = (globalThis as { window?: Window }).window;

describe("openExternal utility", () => {
  let openCalls: OpenCall[] = [];

  beforeEach(() => {
    openCalls = [];

    (globalThis as unknown as { window: { open: typeof window.open } }).window = {
      open: ((url?: string | URL, target?: string, features?: string) => {
        openCalls.push({
          url: typeof url === "string" ? url : url?.toString() || "",
          target,
          features,
        });
        return null;
      }) as typeof window.open,
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;

    if (originalWindow === undefined) {
      delete (globalThis as { window?: Window }).window;
    } else {
      (globalThis as { window?: Window }).window = originalWindow;
    }
  });

  test("uses backend /api/open-url endpoint when available", async () => {
    const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({
        input: typeof input === "string" ? input : input.toString(),
        init,
      });
      return new Response("", { status: 200 });
    }) as typeof fetch;

    await openExternal("https://example.com/docs");

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].input).toBe("/api/open-url");
    expect(fetchCalls[0].init?.method).toBe("POST");
    const headers = new Headers(fetchCalls[0].init?.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(fetchCalls[0].init?.body))).toEqual({
      url: "https://example.com/docs",
    });
    expect(openCalls).toHaveLength(0);
  });

  test("uses the native macOS bridge before gateway or browser fallbacks", async () => {
    const opened: string[] = [];
    const fetchCalls: string[] = [];
    (globalThis as unknown as { window: Window }).window = {
      ...((globalThis as { window?: Window }).window as Window),
      __CYBARA_NATIVE__: {
        runtime: "cybara-native",
        platform: "macos",
        bridgeVersion: 1,
        gatewayPort: 4269,
        managedGateway: true,
        supportsDesktopUpdater: false,
        openExternal: (url: string) => opened.push(url),
      },
      open: ((url?: string | URL, target?: string, features?: string) => {
        openCalls.push({
          url: typeof url === "string" ? url : url?.toString() || "",
          target,
          features,
        });
        return null;
      }) as typeof window.open,
    };
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetchCalls.push(typeof input === "string" ? input : input.toString());
      return new Response("", { status: 200 });
    }) as typeof fetch;

    await openExternal("https://example.com/native");

    expect(opened).toEqual(["https://example.com/native"]);
    expect(fetchCalls).toEqual([]);
    expect(openCalls).toEqual([]);
  });

  test("falls back to window.open when backend returns non-OK", async () => {
    globalThis.fetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;

    await openExternal("https://example.com/fallback");

    expect(openCalls).toHaveLength(1);
    expect(openCalls[0].url).toBe("https://example.com/fallback");
    expect(openCalls[0].target).toBe("_blank");
    expect(openCalls[0].features).toBe("noopener,noreferrer");
  });

  test("falls back to window.open when backend request throws", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network offline");
    }) as typeof fetch;

    await openExternal("https://example.com/error");

    expect(openCalls).toHaveLength(1);
    expect(openCalls[0].url).toBe("https://example.com/error");
  });
});
