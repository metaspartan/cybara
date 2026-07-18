import { describe, expect, mock, spyOn, test } from "bun:test";
import {
  decodeMcpOAuthEnvironment,
  encodeMcpOAuthEnvironment,
  isHttpMcpUrl,
  normalizeRemoteMcpUrl,
  parseMcpHttpResponse,
  refreshMcpOAuthCredential,
  replaceMcpOAuthEnvironment,
} from "../../src/core/mcp-http";

describe("MCP HTTP response parsing", () => {
  test("parses a plain JSON response", () => {
    const r = parseMcpHttpResponse("application/json", '{"result":{"tools":[]}}');
    expect(r.result).toEqual({ tools: [] });
  });

  test("parses the last data frame of an SSE stream", () => {
    const sse = [
      "event: message",
      'data: {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"a"}]}}',
      "",
    ].join("\n");
    const r = parseMcpHttpResponse("text/event-stream; charset=utf-8", sse);
    expect((r.result as { tools: unknown[] }).tools).toHaveLength(1);
  });

  test("surfaces JSON-RPC errors", () => {
    const r = parseMcpHttpResponse(
      "application/json",
      '{"error":{"code":-32601,"message":"nope"}}'
    );
    expect(r.error?.message).toBe("nope");
  });

  test("returns empty on garbage", () => {
    expect(parseMcpHttpResponse("application/json", "not json")).toEqual({});
    expect(parseMcpHttpResponse("text/event-stream", "data: [DONE]")).toEqual({});
  });

  test("isHttpMcpUrl distinguishes URL vs command", () => {
    expect(isHttpMcpUrl("https://mcp.example.com/sse")).toBe(true);
    expect(isHttpMcpUrl("http://localhost:9000")).toBe(true);
    expect(isHttpMcpUrl("npx -y some-mcp")).toBe(false);
    expect(isHttpMcpUrl(undefined)).toBe(false);
  });

  test("normalizes remote URLs and requires credential-free HTTPS", () => {
    expect(normalizeRemoteMcpUrl(" https://service.example.com/mcp ")).toBe(
      "https://service.example.com/mcp"
    );
    expect(() => normalizeRemoteMcpUrl("http://service.example.com/mcp")).toThrow("must use HTTPS");
    expect(() => normalizeRemoteMcpUrl("https://user:pass@example.com/mcp")).toThrow(
      "embedded credentials"
    );
    expect(() => normalizeRemoteMcpUrl("https://service.example.com/mcp#token")).toThrow(
      "cannot contain fragments"
    );
  });

  test("replaces stored OAuth credentials without dropping other environment entries", () => {
    const first = encodeMcpOAuthEnvironment({
      accessToken: "old",
      tokenEndpoint: "https://auth.example.com/token",
      clientId: "client",
      resource: "https://mcp.example.com",
    });
    const replaced = replaceMcpOAuthEnvironment(`MODE=test,${first}`, {
      accessToken: "new",
      tokenEndpoint: "https://auth.example.com/token",
      clientId: "client",
      resource: "https://mcp.example.com",
    });
    expect(replaced.startsWith("MODE=test,")).toBe(true);
    expect(decodeMcpOAuthEnvironment(replaced)?.accessToken).toBe("new");
  });

  test("refreshes OAuth credentials and retains a rotated refresh token", async () => {
    const originalFetch = globalThis.fetch;
    spyOn(Bun.dns, "lookup").mockResolvedValue([{ address: "1.1.1.1", family: 4, ttl: 60 }]);
    globalThis.fetch = (async () =>
      Response.json({
        access_token: "next",
        refresh_token: "rotated",
        expires_in: 120,
      })) as typeof fetch;
    try {
      const refreshed = await refreshMcpOAuthCredential({
        accessToken: "old",
        refreshToken: "refresh",
        tokenEndpoint: "https://auth.example.com/token",
        clientId: "client",
        resource: "https://mcp.example.com",
      });
      expect(refreshed.accessToken).toBe("next");
      expect(refreshed.refreshToken).toBe("rotated");
      expect((refreshed.expiresAt || 0) > Date.now()).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      mock.restore();
    }
  });

  test("blocks private OAuth token endpoints before fetching", async () => {
    let fetched = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetched = true;
      return Response.json({ access_token: "unexpected" });
    }) as typeof fetch;
    try {
      await expect(
        refreshMcpOAuthCredential({
          accessToken: "old",
          refreshToken: "refresh",
          tokenEndpoint: "http://169.254.169.254/token",
          clientId: "client",
          resource: "https://mcp.example.com",
        })
      ).rejects.toThrow("blocked");
      expect(fetched).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
