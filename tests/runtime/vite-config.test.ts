import { describe, expect, test } from "bun:test";

describe("Vite development gateway proxy", () => {
  test("uses the gateway IPv4 loopback binding for HTTP and WebSocket traffic", async () => {
    const source = await Bun.file("ui/vite.config.ts").text();

    expect(source).toContain('target: "http://127.0.0.1:4269"');
    expect(source).toContain('proxyReq.setHeader("origin", "http://127.0.0.1:4269")');
    expect(source).not.toContain('target: "http://localhost:4269"');
  });
});
