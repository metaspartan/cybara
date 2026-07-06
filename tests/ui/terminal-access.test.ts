import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { checkTerminalAccess, enableTerminalAccess } from "../../ui/src/lib/terminal-access";

const originalFetch = globalThis.fetch;

describe("terminal access UI helper", () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  beforeEach(() => {
    calls.length = 0;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("checks terminal access through the terminal sessions endpoint", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return Response.json([]);
    }) as typeof fetch;

    const access = await checkTerminalAccess();

    expect(access).toEqual({ enabled: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/terminal/sessions");
  });

  test("returns the gateway error when terminal access is blocked", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return Response.json({ error: "Terminal disabled" }, { status: 403 });
    }) as typeof fetch;

    const access = await checkTerminalAccess();

    expect(access).toEqual({ enabled: false, error: "Terminal disabled" });
  });

  test("enables terminal access through the gateway config endpoint", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return Response.json({ success: true });
    }) as typeof fetch;

    await enableTerminalAccess();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/config");
    expect(calls[0].init?.method).toBe("PUT");
    expect(new Headers(calls[0].init?.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ terminal_enabled: true });
  });

  test("surfaces config update failures", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return Response.json({ error: "manage scope required" }, { status: 403 });
    }) as typeof fetch;

    await expect(enableTerminalAccess()).rejects.toThrow("manage scope required");
  });
});
