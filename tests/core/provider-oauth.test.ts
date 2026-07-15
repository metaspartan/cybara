import { describe, expect, test } from "bun:test";
import {
  createPkcePair,
  jwtExpiresAt,
  parseOAuthTokenPayload,
} from "../../src/core/provider-oauth";

function jwtWithExpiry(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `${header}.${payload}.signature`;
}

describe("provider OAuth primitives", () => {
  test("creates an S256 PKCE pair", async () => {
    const pair = await createPkcePair();
    expect(pair.verifier.length).toBe(64);
    expect(pair.challenge.length).toBeGreaterThan(30);
    expect(pair.challenge).not.toBe(pair.verifier);
  });

  test("reads expiry from JWT access tokens", () => {
    const exp = Math.floor(Date.now() / 1000) + 1800;
    expect(jwtExpiresAt(jwtWithExpiry(exp))).toBe(exp * 1000);
  });

  test("parses snake case, camel case, and single-token responses", () => {
    const standard = parseOAuthTokenPayload(
      { access_token: "access", refresh_token: "refresh", expires_in: 120 },
      {}
    );
    expect(standard?.accessToken).toBe("access");
    expect(standard?.refreshToken).toBe("refresh");
    expect(standard?.expiresAt || 0).toBeGreaterThan(Date.now());

    const cursor = parseOAuthTokenPayload(
      { accessToken: "cursor-access", refreshToken: "cursor-refresh" },
      { tokenAccessField: "accessToken", tokenRefreshField: "refreshToken" }
    );
    expect(cursor?.accessToken).toBe("cursor-access");
    expect(cursor?.refreshToken).toBe("cursor-refresh");

    const devin = parseOAuthTokenPayload(
      { token: "devin-token" },
      { tokenAccessField: "token", tokenRefreshField: "token" }
    );
    expect(devin?.refreshToken).toBe("devin-token");
  });

  test("rejects malformed responses", () => {
    expect(parseOAuthTokenPayload(null, {})).toBeNull();
    expect(parseOAuthTokenPayload([], {})).toBeNull();
    expect(parseOAuthTokenPayload({ access_token: "" }, {})).toBeNull();
    expect(parseOAuthTokenPayload({ access_token: 4 }, {})).toBeNull();
  });
});
