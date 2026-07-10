import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import {
  completeMcpOAuth,
  finishMcpOAuth,
  getMcpOAuthStatus,
  startMcpOAuth,
} from "../../src/core/mcp-oauth";
import { decodeMcpOAuthEnvironment } from "../../src/core/mcp-http";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("MCP OAuth authorization", () => {
  test("discovers guarded endpoints and exchanges a PKCE authorization code", async () => {
    const validated: string[] = [];
    let tokenBody = "";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://agent.example.com/mcp") {
        return new Response("", {
          status: 401,
          headers: {
            "WWW-Authenticate":
              'Bearer resource_metadata="https://agent.example.com/.well-known/oauth-protected-resource/mcp"',
          },
        });
      }
      if (url.includes("oauth-protected-resource")) {
        return Response.json({
          resource: "https://agent.example.com/mcp",
          authorization_servers: ["https://auth.example.com/provider"],
          scopes_supported: ["trading", "profile"],
        });
      }
      if (url.includes("oauth-authorization-server")) {
        return Response.json({
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://api.example.com/token",
          registration_endpoint: "https://auth.example.com/register",
        });
      }
      if (url === "https://auth.example.com/register") {
        return Response.json({ client_id: "client-123" });
      }
      if (url === "https://api.example.com/token") {
        tokenBody = String(init?.body || "");
        return Response.json({
          access_token: "access-123",
          refresh_token: "refresh-123",
          expires_in: 3600,
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const started = await startMcpOAuth(
      "server-123",
      "https://agent.example.com/mcp",
      async (url) => {
        validated.push(url);
      }
    );
    const authorization = new URL(started.authUrl);
    expect(authorization.origin).toBe("https://auth.example.com");
    expect(authorization.searchParams.get("client_id")).toBe("client-123");
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.get("scope")).toBe("trading profile");
    expect(getMcpOAuthStatus(started.state)?.status).toBe("pending");

    const completed = await finishMcpOAuth(started.state, "code-123");
    const tokenRequest = new URLSearchParams(tokenBody);
    const verifier = tokenRequest.get("code_verifier") || "";
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(
      authorization.searchParams.get("code_challenge")
    );
    expect(tokenRequest.get("resource")).toBe("https://agent.example.com/mcp");
    expect(decodeMcpOAuthEnvironment(completed.env)?.accessToken).toBe("access-123");
    expect(getMcpOAuthStatus(started.state)?.status).toBe("pending");
    completeMcpOAuth(started.state);
    expect(getMcpOAuthStatus(started.state)?.status).toBe("connected");
    expect(validated).toEqual([
      "https://agent.example.com/mcp",
      "https://agent.example.com/.well-known/oauth-protected-resource/mcp",
      "https://auth.example.com/provider",
      "https://auth.example.com/.well-known/oauth-authorization-server/provider",
      "https://auth.example.com/authorize",
      "https://api.example.com/token",
      "https://auth.example.com/register",
    ]);
  });
});
