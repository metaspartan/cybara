import { describe, expect, test } from "bun:test";
import { parseMcpHttpResponse, isHttpMcpUrl } from "../../src/core/mcp-http";

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
});
