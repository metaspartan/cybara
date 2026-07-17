import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { gatewayRequestIdleTimeoutSeconds } from "../../src/api/gateway-request-timeout";

describe("gateway request idle timeouts", () => {
  test("keeps long chat turns and status streams connected", () => {
    expect(gatewayRequestIdleTimeoutSeconds("POST", "/api/chat")).toBe(0);
    expect(gatewayRequestIdleTimeoutSeconds("get", "/api/sse/status")).toBe(0);
    expect(gatewayRequestIdleTimeoutSeconds("post", "/api/subagents/wait")).toBe(0);
  });

  test("keeps a delayed chat response open past the server idle timeout", async () => {
    const server = Bun.serve({
      port: 0,
      idleTimeout: 1,
      async fetch(req, bunServer) {
        const url = new URL(req.url);
        const timeout = gatewayRequestIdleTimeoutSeconds(req.method, url.pathname);
        if (timeout !== null) bunServer.timeout(req, timeout);
        await Bun.sleep(1_250);
        return Response.json({ ok: true });
      },
    });

    try {
      const response = await fetch(new URL("/api/chat", server.url), { method: "POST" });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    } finally {
      await server.stop(true);
    }
  });

  test("leaves ordinary API and static requests bounded", () => {
    expect(gatewayRequestIdleTimeoutSeconds("GET", "/api/sessions")).toBeNull();
    expect(gatewayRequestIdleTimeoutSeconds("POST", "/api/providers")).toBeNull();
    expect(gatewayRequestIdleTimeoutSeconds("GET", "/")).toBeNull();
  });

  test("applies the route-specific timeout after base-path normalization", () => {
    const source = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    const basePathIndex = source.indexOf("if (basePath) {");
    const timeoutIndex = source.indexOf("gatewayRequestIdleTimeoutSeconds(req.method, pathname)");
    const headerIndex = source.indexOf("Object.fromEntries(req.headers.entries())");

    expect(basePathIndex).toBeGreaterThan(-1);
    expect(timeoutIndex).toBeGreaterThan(basePathIndex);
    expect(timeoutIndex).toBeLessThan(headerIndex);
    expect(source).toContain("server.timeout(req, requestIdleTimeout)");
  });
});
