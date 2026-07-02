import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { parseMcpHttpResponse, isHttpMcpUrl } from "../../src/core/mcp-http";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("isHttpMcpUrl transport detection", () => {
  test("accepts http and https urls, trimming surrounding whitespace", () => {
    expect(isHttpMcpUrl("http://localhost:8080/mcp")).toBe(true);
    expect(isHttpMcpUrl("https://api.example.com/mcp")).toBe(true);
    expect(isHttpMcpUrl("HTTPS://EXAMPLE.COM")).toBe(true);
    expect(isHttpMcpUrl("  https://spaced.example.com  ")).toBe(true);
  });

  test("rejects stdio commands, non-http schemes, and undefined", () => {
    expect(isHttpMcpUrl(undefined)).toBe(false);
    expect(isHttpMcpUrl("")).toBe(false);
    expect(isHttpMcpUrl("npx @modelcontextprotocol/server-filesystem")).toBe(false);
    expect(isHttpMcpUrl("ws://example.com")).toBe(false);
    expect(isHttpMcpUrl("ftp://example.com")).toBe(false);
    expect(isHttpMcpUrl("file:///bin/server")).toBe(false);
  });
});

describe("parseMcpHttpResponse JSON-RPC shaping", () => {
  test("parses a plain JSON tools/list result into capability tools", () => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: [
          { name: "read_file", description: "Read a file", inputSchema: { type: "object" } },
          { name: "write_file" },
        ],
      },
    });
    const parsed = parseMcpHttpResponse("application/json", body);
    expect(parsed.error).toBeUndefined();
    const result = parsed.result as { tools: Array<{ name: string }> };
    expect(result.tools).toHaveLength(2);
    expect(result.tools[0]!.name).toBe("read_file");
  });

  test("surfaces a JSON-RPC error object", () => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "Method not found" },
    });
    const parsed = parseMcpHttpResponse("application/json; charset=utf-8", body);
    expect(parsed.result).toBeUndefined();
    expect(parsed.error?.code).toBe(-32601);
    expect(parsed.error?.message).toBe("Method not found");
  });

  test("reads the last data frame from a text/event-stream body", () => {
    const body = [
      "event: message",
      'data: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18"}}',
      "",
      "event: message",
      'data: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"ping"}]}}',
      "",
    ].join("\n");
    const parsed = parseMcpHttpResponse("text/event-stream", body);
    const result = parsed.result as { tools: Array<{ name: string }> };
    expect(result.tools[0]!.name).toBe("ping");
  });

  test("ignores [DONE] sentinels and blank data frames in SSE", () => {
    const body = [
      'data: {"jsonrpc":"2.0","result":{"ok":true}}',
      "data: ",
      "data: [DONE]",
      "",
    ].join("\r\n");
    const parsed = parseMcpHttpResponse("text/event-stream", body);
    expect((parsed.result as { ok: boolean }).ok).toBe(true);
  });

  test("skips non-JSON data frames without throwing", () => {
    const body = [
      "data: not-json-garbage",
      'data: {"result":{"value":42}}',
      "data: {broken",
      "",
    ].join("\n");
    const parsed = parseMcpHttpResponse("text/event-stream", body);
    expect((parsed.result as { value: number }).value).toBe(42);
  });

  test("returns an empty object for malformed JSON bodies", () => {
    expect(parseMcpHttpResponse("application/json", "not json at all")).toEqual({});
    expect(parseMcpHttpResponse("application/json", "")).toEqual({});
  });

  test("returns an empty object for an SSE body with no data frames", () => {
    expect(parseMcpHttpResponse("text/event-stream", "event: ping\n\n")).toEqual({});
  });

  test("falls back to JSON parsing when the content-type is missing", () => {
    const parsed = parseMcpHttpResponse("", '{"result":{"tools":[]}}');
    expect((parsed.result as { tools: unknown[] }).tools).toEqual([]);
  });
});

interface ManagerOutcome {
  emptyList: unknown[];
  createdEnabledDefault: boolean;
  createdDisabled: boolean;
  toolCountBeforeStart: number;
  statusBeforeStart: string;
  getById: { name: string; command: string } | undefined;
  getMissing: unknown;
  statusMissing: unknown;
  updateExisting: boolean;
  updateMissing: boolean;
  nameAfterPartialUpdate: string;
  commandAfterPartialUpdate: string;
  listAfterUpdate: number;
  deleteExisting: boolean;
  deleteMissing: boolean;
  listAfterDelete: number;
  callMissingServerError: string;
  callNotRunningError: string;
  toolDefinitions: Array<{ name: string; description: string; mcp_server: { id: string } }>;
  namespacedToolName: string;
  allToolsWhenStopped: number;
}

let outcome: ManagerOutcome;
let tempHome = "";

const WORKER_SOURCE = `
import { mcpManager } from "${join(ROOT_DIR, "src", "core", "mcp.ts").replace(/\\/g, "/")}";

const emptyList = mcpManager.list();

const created = mcpManager.create({
  name: "fs-server",
  command: "npx server-filesystem",
  args: "--root /tmp",
  env: "TOKEN=abc,DEBUG=1",
});
const createdDisabled = mcpManager.create({
  name: "disabled-server",
  command: "echo hi",
  enabled: false,
});

const statusBefore = mcpManager.getStatus(created.id);
const getById = mcpManager.get(created.id);
const getMissing = mcpManager.get("does-not-exist");
const statusMissing = mcpManager.getStatus("does-not-exist");

const updateExisting = mcpManager.update(created.id, { name: "fs-renamed" });
const updateMissing = mcpManager.update("does-not-exist", { name: "nope" });
const afterUpdate = mcpManager.get(created.id);
const listAfterUpdate = mcpManager.list().length;

let callMissingServerError = "";
try {
  await mcpManager.callTool("does-not-exist", "tool", {});
} catch (e) {
  callMissingServerError = (e as Error).message;
}

let callNotRunningError = "";
try {
  await mcpManager.callTool(created.id, "tool", {});
} catch (e) {
  callNotRunningError = (e as Error).message;
}

const toolDefinitions = mcpManager.getToolDefinitions();
const namespacedToolName = "mcp_" + created.id.slice(0, 8) + "_sample_tool";
const allToolsWhenStopped = mcpManager.getAllTools().length;

const deleteMissing = mcpManager.delete("does-not-exist");
const deleteExisting = mcpManager.delete(created.id);
const listAfterDelete = mcpManager.list().length;

const out = {
  emptyList,
  createdEnabledDefault: created.enabled,
  createdDisabled: createdDisabled.enabled,
  toolCountBeforeStart: statusBefore ? statusBefore.tools.length : -1,
  statusBeforeStart: statusBefore ? statusBefore.status : "missing",
  getById: getById ? { name: getById.name, command: getById.command } : undefined,
  getMissing,
  statusMissing,
  updateExisting,
  updateMissing,
  nameAfterPartialUpdate: afterUpdate ? afterUpdate.name : "",
  commandAfterPartialUpdate: afterUpdate ? afterUpdate.command : "",
  listAfterUpdate,
  deleteExisting,
  deleteMissing,
  listAfterDelete,
  callMissingServerError,
  callNotRunningError,
  toolDefinitions,
  namespacedToolName,
  allToolsWhenStopped,
};
console.log("__MCP_RESULT__" + JSON.stringify(out));
`;

beforeAll(() => {
  tempHome = mkdtempSync(join(tmpdir(), "cybara-mcp-client-"));
  const workerPath = join(tempHome, "worker.ts");
  writeFileSync(workerPath, WORKER_SOURCE, "utf-8");

  const result = Bun.spawnSync([process.execPath, "run", workerPath], {
    cwd: ROOT_DIR,
    env: { ...process.env, CYBARA_HOME: tempHome, HOME: tempHome, USERPROFILE: tempHome },
  });
  const stdout = result.stdout.toString();
  if (result.exitCode !== 0) {
    throw new Error(`mcp worker failed: ${result.stderr.toString()}\n${stdout}`);
  }
  const marker = stdout.split("__MCP_RESULT__").at(-1) ?? "";
  outcome = JSON.parse(marker.trim().split("\n")[0]!) as ManagerOutcome;
});

afterAll(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
});

describe("MCPServerManager server-config lifecycle (DB-isolated worker)", () => {
  test("starts with an empty server list in a fresh CYBARA_HOME", () => {
    expect(outcome.emptyList).toEqual([]);
  });

  test("defaults enabled to true and honours an explicit enabled:false", () => {
    expect(outcome.createdEnabledDefault).toBe(true);
    expect(outcome.createdDisabled).toBe(false);
  });

  test("newly created servers are stopped with no tools", () => {
    expect(outcome.statusBeforeStart).toBe("stopped");
    expect(outcome.toolCountBeforeStart).toBe(0);
    expect(outcome.allToolsWhenStopped).toBe(0);
    expect(outcome.toolDefinitions).toEqual([]);
  });

  test("get and getStatus return undefined for unknown ids (clean degradation)", () => {
    expect(outcome.getById).toEqual({ name: "fs-server", command: "npx server-filesystem" });
    expect(outcome.getMissing).toBeUndefined();
    expect(outcome.statusMissing).toBeUndefined();
  });

  test("partial update preserves untouched fields and reports missing ids", () => {
    expect(outcome.updateExisting).toBe(true);
    expect(outcome.updateMissing).toBe(false);
    expect(outcome.nameAfterPartialUpdate).toBe("fs-renamed");
    expect(outcome.commandAfterPartialUpdate).toBe("npx server-filesystem");
    expect(outcome.listAfterUpdate).toBe(2);
  });

  test("delete removes existing servers and reports missing ids", () => {
    expect(outcome.deleteExisting).toBe(true);
    expect(outcome.deleteMissing).toBe(false);
    expect(outcome.listAfterDelete).toBe(1);
  });
});

describe("MCPServerManager error and namespacing paths", () => {
  test("callTool on an unknown server rejects with a not-found message", () => {
    expect(outcome.callMissingServerError).toBe("MCP server not found: does-not-exist");
  });

  test("callTool on a stopped server rejects with a not-running message", () => {
    expect(outcome.callNotRunningError).toContain("MCP server not running");
  });

  test("tool-name namespacing uses the mcp_<id8>_<name> prefix scheme", () => {
    expect(outcome.namespacedToolName).toMatch(/^mcp_[0-9a-f]{8}_sample_tool$/);
  });
});
