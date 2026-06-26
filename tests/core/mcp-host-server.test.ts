import { describe, expect, test } from "bun:test";
import { runMcpStdioServer } from "../../src/core/mcp-host-server";

describe("MCP host server", () => {
  test("module exports runMcpStdioServer", () => {
    expect(typeof runMcpStdioServer).toBe("function");
  });

  test("runMcpStdioServer is async", () => {
    // Verify it returns a Promise without actually running it.
    const result = runMcpStdioServer();
    expect(result).toBeInstanceOf(Promise);
    // Abort it immediately so it doesn't hang waiting on stdin.
    result.catch(() => {});
  });
});
