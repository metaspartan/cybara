import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface RemoteReport {
  started: { success: boolean; error?: string };
  called: unknown;
  summary: Record<string, unknown>;
  requests: Array<{ method: string; id?: number; authorization?: string; protocol?: string }>;
}

const WORKER_SOURCE = `
const requests: Array<{ method: string; id?: number; authorization?: string; protocol?: string }> = [];
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body || "{}")) as { method?: string; id?: number };
  const headers = new Headers(init?.headers);
  requests.push({
    method: body.method || "",
    id: body.id,
    authorization: headers.get("authorization") || undefined,
    protocol: headers.get("mcp-protocol-version") || undefined,
  });
  if (body.method === "notifications/initialized") return new Response("", { status: 202 });
  if (body.method === "initialize") {
    return Response.json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18" } });
  }
  if (body.method === "tools/list") {
    return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "ping", inputSchema: { type: "object" } }] } });
  }
  return Response.json({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "pong" }] } });
}) as typeof fetch;

const { mcpManager } = await import("${join(ROOT_DIR, "src", "core", "mcp.ts").replace(/\\/g, "/")}");
const server = mcpManager.create({
  name: "Remote Test",
  url: "https://example.com/mcp",
  env: "Authorization=Bearer token-with-padding==",
});
const started = await mcpManager.start(server.id);
const called = await mcpManager.callTool(server.id, "ping", {});
const summary = mcpManager.list().find((entry) => entry.id === server.id) || {};
console.log("@@REPORT@@" + JSON.stringify({ started, called, summary, requests }));
`;

let tempHome = "";
let report: RemoteReport;

beforeAll(() => {
  tempHome = mkdtempSync(join(tmpdir(), "cybara-mcp-remote-"));
  const worker = join(tempHome, "worker.ts");
  writeFileSync(worker, WORKER_SOURCE, "utf8");
  const result = Bun.spawnSync([process.execPath, "run", worker], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      CYBARA_HOME: join(tempHome, ".cybara"),
    },
  });
  const output = result.stdout.toString();
  if (result.exitCode !== 0) throw new Error(result.stderr.toString() || output);
  const line = output.split("\n").find((entry) => entry.startsWith("@@REPORT@@"));
  if (!line) throw new Error(output);
  report = JSON.parse(line.slice("@@REPORT@@".length)) as RemoteReport;
});

afterAll(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
});

describe("remote MCP client lifecycle", () => {
  test("initializes, notifies, discovers tools, and calls tools", () => {
    expect(report.started.success).toBe(true);
    expect(report.called).toEqual({ content: [{ type: "text", text: "pong" }] });
    expect(report.requests.map((request) => request.method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/call",
    ]);
    expect(report.requests[1]?.id).toBeUndefined();
    expect(report.requests[2]?.protocol).toBe("2025-06-18");
    expect(
      report.requests.every((request) => request.authorization === "Bearer token-with-padding==")
    ).toBe(true);
  });

  test("redacts credentials from public summaries", () => {
    expect(report.summary.transport).toBe("http");
    expect(report.summary.hasCredentials).toBe(true);
    expect(report.summary.toolCount).toBe(1);
    expect(report.summary.env).toBeUndefined();
  });
});
