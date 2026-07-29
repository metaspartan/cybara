import { describe, expect, test } from "bun:test";
import { resolveHttpRedirect } from "../../src/core/tools/handlers/http";

describe("HTTP redirect handling (SSRF hardening)", () => {
  test("caps redirect chains instead of recursing forever", async () => {
    let state = { url: "https://example.com/start", redirectHops: 0 };
    for (let index = 0; index < 5; index++) {
      state = await resolveHttpRedirect(state.url, "https://example.org/next", state.redirectHops);
    }

    await expect(
      resolveHttpRedirect(state.url, "https://example.org/next", state.redirectHops)
    ).rejects.toThrow(/too many redirects/i);
  });

  test("re-validates each redirect target and blocks a hop to an internal host", async () => {
    await expect(
      resolveHttpRedirect(
        "https://example.com/start",
        "http://169.254.169.254/latest/meta-data/",
        0
      )
    ).rejects.toThrow(/blocked/i);
  });
});
