import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const REPO_ROOT = join(import.meta.dir, "..", "..");

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
let tempHome: string;
let stdoutReader: ReadableStreamDefaultReader<Uint8Array>;
let buffered = "";

async function readResponse(timeoutMs = 15000): Promise<JsonRpcResponse> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const nl = buffered.indexOf("\n");
    if (nl !== -1) {
      const line = buffered.slice(0, nl).trim();
      buffered = buffered.slice(nl + 1);
      if (!line) continue;
      return JSON.parse(line) as JsonRpcResponse;
    }
    if (Date.now() > deadline) throw new Error("Timed out waiting for MCP response");
    const chunk = await Promise.race([
      stdoutReader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("read timeout")), deadline - Date.now())
      ),
    ]);
    if (chunk.done) throw new Error("MCP server closed stdout");
    buffered += new TextDecoder().decode(chunk.value);
  }
}

function send(message: Record<string, unknown>): void {
  proc.stdin.write(`${JSON.stringify(message)}\n`);
  proc.stdin.flush();
}

beforeAll(() => {
  tempHome = mkdtempSync(join(tmpdir(), "cybara-mcp-stdio-"));
  proc = Bun.spawn(["bun", join(REPO_ROOT, "src", "cli.tsx"), "mcp", "serve"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      HOME: tempHome,
      CYBARA_HOME: join(tempHome, ".cybara"),
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  stdoutReader = proc.stdout.getReader();
});

afterAll(() => {
  try {
    proc.kill();
  } catch {
    void 0;
  }
  rmSync(tempHome, { recursive: true, force: true });
});

describe("MCP stdio host server", () => {
  test("initialize handshake returns protocol version and capabilities", async () => {
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "e2e-test", version: "0.0.1" },
      },
    });
    const response = await readResponse(30000);
    expect(response.id).toBe(1);
    expect(response.error).toBeUndefined();
    const result = response.result as {
      protocolVersion: string;
      serverInfo: { name: string };
      capabilities: Record<string, unknown>;
    };
    expect(result.protocolVersion).toBe("2024-11-05");
    expect(result.serverInfo.name).toBe("cybara");
    expect(result.capabilities).toHaveProperty("tools");

    send({ jsonrpc: "2.0", method: "notifications/initialized" });
  }, 40000);

  test("ping round-trips", async () => {
    send({ jsonrpc: "2.0", id: 2, method: "ping" });
    const response = await readResponse();
    expect(response.id).toBe(2);
    expect(response.error).toBeUndefined();
  }, 20000);

  test("tools/list enumerates cybara tools with JSON schemas", async () => {
    send({ jsonrpc: "2.0", id: 3, method: "tools/list" });
    const response = await readResponse();
    expect(response.id).toBe(3);
    const tools = (response.result as { tools: Array<{ name: string; inputSchema: unknown }> })
      .tools;
    expect(tools.length).toBeGreaterThan(30);
    const names = tools.map((t) => t.name);
    expect(names).toContain("calc");
    expect(names).toContain("read");
    for (const tool of tools.slice(0, 5)) {
      expect(tool.inputSchema).toHaveProperty("type");
    }
  }, 20000);

  test("tools/call executes calc and returns text content", async () => {
    send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "calc", arguments: { expression: "6*7" } },
    });
    const response = await readResponse();
    expect(response.id).toBe(4);
    const result = response.result as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
    expect(result.isError).toBe(false);
    expect(result.content[0]?.type).toBe("text");
    expect(result.content[0]?.text).toContain("42");
  }, 20000);

  test("tools/call with an unknown tool returns an in-band error, not a crash", async () => {
    send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "definitely_not_a_tool", arguments: {} },
    });
    const response = await readResponse();
    expect(response.id).toBe(5);
    const errored =
      response.error !== undefined ||
      (response.result as { isError?: boolean } | undefined)?.isError === true;
    expect(errored).toBe(true);
  }, 20000);

  test("unknown method returns METHOD_NOT_FOUND", async () => {
    send({ jsonrpc: "2.0", id: 6, method: "resources/read" });
    const response = await readResponse();
    expect(response.id).toBe(6);
    expect(response.error?.code).toBe(-32601);
  }, 20000);

  test("malformed JSON line yields a parse error without killing the server", async () => {
    proc.stdin.write("{this is not json}\n");
    proc.stdin.flush();
    const parseError = await readResponse();
    expect(parseError.error?.code).toBe(-32700);

    send({ jsonrpc: "2.0", id: 7, method: "ping" });
    const afterwards = await readResponse();
    expect(afterwards.id).toBe(7);
    expect(afterwards.error).toBeUndefined();
  }, 20000);
});
