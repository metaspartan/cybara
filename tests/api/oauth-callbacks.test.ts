import { describe, expect, test } from "bun:test";
import {
  setOAuthCallback,
  consumeOAuthCallback,
  deleteOAuthCallback,
  oauthCallbackCount,
  MAX_OAUTH_CALLBACKS,
} from "../../src/api/oauth-callbacks";

describe("oauth-callbacks store", () => {
  test("pending entries are re-readable (not consumed)", () => {
    setOAuthCallback("s-pending", { status: "pending" });
    expect(consumeOAuthCallback("s-pending")?.status).toBe("pending");
    expect(consumeOAuthCallback("s-pending")?.status).toBe("pending");
    deleteOAuthCallback("s-pending");
  });

  test("success entries are consumed on first read (tokens not re-pollable)", () => {
    setOAuthCallback("s-success", { status: "success", access_token: "tok", refresh_token: "r" });
    const first = consumeOAuthCallback("s-success");
    expect(first?.status).toBe("success");
    expect(first?.access_token).toBe("tok");
    expect(consumeOAuthCallback("s-success")).toBeNull();
  });

  test("error entries are consumed on first read", () => {
    setOAuthCallback("s-error", { status: "error", error: "nope" });
    expect(consumeOAuthCallback("s-error")?.error).toBe("nope");
    expect(consumeOAuthCallback("s-error")).toBeNull();
  });

  test("unknown state returns null", () => {
    expect(consumeOAuthCallback("does-not-exist")).toBeNull();
  });

  test("updating an existing state does not grow the map", () => {
    const before = oauthCallbackCount();
    setOAuthCallback("s-update", { status: "pending" });
    setOAuthCallback("s-update", { status: "success", access_token: "x" });
    expect(oauthCallbackCount()).toBe(before + 1);
    deleteOAuthCallback("s-update");
  });

  test("map is bounded to MAX_OAUTH_CALLBACKS with FIFO eviction", () => {
    for (const s of [...Array(oauthCallbackCount()).keys()]) deleteOAuthCallback(`pre-${s}`);
    for (let i = 0; i < MAX_OAUTH_CALLBACKS + 25; i++) {
      setOAuthCallback(`bulk-${i}`, { status: "pending" });
    }
    expect(oauthCallbackCount()).toBeLessThanOrEqual(MAX_OAUTH_CALLBACKS);
    expect(consumeOAuthCallback("bulk-0")).toBeNull();
    expect(consumeOAuthCallback(`bulk-${MAX_OAUTH_CALLBACKS + 24}`)?.status).toBe("pending");
  });
});
