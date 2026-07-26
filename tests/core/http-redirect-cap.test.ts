import { afterEach, describe, expect, test } from "bun:test";
import { handleHttp } from "../../src/core/tools/handlers/http";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function redirectResponse(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { location },
  });
}

describe("handleHttp redirect handling (SSRF hardening)", () => {
  test("caps redirect chains instead of recursing forever", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return redirectResponse("https://example.org/next");
    }) as typeof fetch;

    await expect(handleHttp({ url: "https://example.com/start" })).rejects.toThrow(
      /too many redirects/i
    );
    expect(calls).toBeLessThanOrEqual(7);
  });

  test("re-validates each redirect target and blocks a hop to an internal host", async () => {
    globalThis.fetch = (async () =>
      redirectResponse("http://169.254.169.254/latest/meta-data/")) as typeof fetch;

    await expect(handleHttp({ url: "https://example.com/start" })).rejects.toThrow(/blocked/i);
  });
});
