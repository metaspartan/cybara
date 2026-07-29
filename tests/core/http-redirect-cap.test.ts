import { describe, expect, test } from "bun:test";
import { handleHttp } from "../../src/core/tools/handlers/http";

function redirectResponse(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { location },
  });
}

describe("handleHttp redirect handling (SSRF hardening)", () => {
  test("caps redirect chains instead of recursing forever", async () => {
    let calls = 0;
    const fetchUrl = async (): Promise<Response> => {
      calls++;
      return redirectResponse("https://example.org/next");
    };

    await expect(
      handleHttp({ url: "https://example.com/start" }, undefined, fetchUrl)
    ).rejects.toThrow(/too many redirects/i);
    expect(calls).toBeLessThanOrEqual(7);
  });

  test("re-validates each redirect target and blocks a hop to an internal host", async () => {
    const fetchUrl = async (): Promise<Response> =>
      redirectResponse("http://169.254.169.254/latest/meta-data/");

    await expect(
      handleHttp({ url: "https://example.com/start" }, undefined, fetchUrl)
    ).rejects.toThrow(/blocked/i);
  });
});
