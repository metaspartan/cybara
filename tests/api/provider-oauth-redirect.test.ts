import { describe, expect, test } from "bun:test";
import { buildProviderOAuthTokenRequest } from "../../src/api/provider-oauth-redirect";

describe("redirect OAuth token exchange", () => {
  test("builds Anthropic JSON exchange with PKCE and state", () => {
    const request = buildProviderOAuthTokenRequest(
      {
        clientId: "client",
        tokenRequestFormat: "json",
        includeStateInTokenRequest: true,
      },
      "code",
      "verifier",
      "state",
      "http://localhost:54545/callback"
    );
    expect(request.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(String(request.body))).toEqual({
      code: "code",
      redirect_uri: "http://localhost:54545/callback",
      grant_type: "authorization_code",
      code_verifier: "verifier",
      client_id: "client",
      state: "state",
    });
  });

  test("builds Devin JSON exchange without an invented client id", () => {
    const request = buildProviderOAuthTokenRequest(
      { tokenRequestFormat: "json", tokenAccessField: "token" },
      "code",
      "verifier",
      "state",
      "http://127.0.0.1:59653/callback"
    );
    expect(JSON.parse(String(request.body))).toEqual({
      code: "code",
      redirect_uri: "http://127.0.0.1:59653/callback",
      grant_type: "authorization_code",
      code_verifier: "verifier",
    });
  });

  test("keeps standard OAuth exchanges form encoded", () => {
    const request = buildProviderOAuthTokenRequest(
      { clientId: "client", clientSecret: "secret" },
      "code",
      "verifier",
      "state",
      "http://localhost:8080/callback"
    );
    expect(request.headers).toMatchObject({
      "Content-Type": "application/x-www-form-urlencoded",
    });
    const body = new URLSearchParams(String(request.body));
    expect(body.get("client_id")).toBe("client");
    expect(body.get("client_secret")).toBe("secret");
    expect(body.get("state")).toBeNull();
  });
});
