import { describe, expect, test } from "bun:test";
import { runMcpStdioServer } from "../../src/core/mcp-host-server";

describe("MCP host server", () => {
  test("module exports runMcpStdioServer", () => {
    expect(typeof runMcpStdioServer).toBe("function");
  });

  test("runMcpStdioServer is async", () => {
    const result = runMcpStdioServer();
    expect(result).toBeInstanceOf(Promise);
    result.catch(() => {});
  });
});
