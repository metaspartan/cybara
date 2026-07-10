import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface RegistryReport {
  results: Array<Record<string, unknown>>;
  ranked: Array<Record<string, unknown>>;
  cached: Record<string, unknown> | null;
  installed: { success: boolean; id?: string; error?: string };
  summary: Record<string, unknown> | null;
  fetchCalls: number;
}

const WORKER_SOURCE = `
let fetchCalls = 0;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  fetchCalls += 1;
  const url = String(input);
  if (url.includes("registry.modelcontextprotocol.io")) {
    return Response.json({
      servers: [{
        server: {
          name: "com.example/remote-tools",
          title: "Remote Tools",
          description: "Remote test tools",
          remotes: [{ type: "streamable-http", url: "https://mcp.example.com/tools" }],
        },
      }],
    });
  }
  return Response.json({ objects: [] });
}) as typeof fetch;

const { mcpRegistry } = await import("${join(ROOT_DIR, "src", "core", "mcp-registry.ts").replace(/\\/g, "/")}");
const { mcpManager } = await import("${join(ROOT_DIR, "src", "core", "mcp.ts").replace(/\\/g, "/")}");
const results = await mcpRegistry.search("remote-tools", "official");
const ranked = await mcpRegistry.search("remote-tools");
const cached = mcpRegistry.getDetails("com.example/remote-tools") || null;
const installed = cached ? await mcpRegistry.installServer(cached) : { success: false };
const summary = installed.id ? mcpManager.list().find((entry) => entry.id === installed.id) || null : null;
console.log("@@REPORT@@" + JSON.stringify({ results, ranked, cached, installed, summary, fetchCalls }));
`;

let tempHome = "";
let report: RegistryReport;

beforeAll(() => {
  tempHome = mkdtempSync(join(tmpdir(), "cybara-mcp-registry-remote-"));
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
  report = JSON.parse(line.slice("@@REPORT@@".length)) as RegistryReport;
});

afterAll(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
});

describe("official MCP registry remote entries", () => {
  test("maps and caches remote search results for later installation", () => {
    expect(report.fetchCalls).toBe(2);
    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.url).toBe("https://mcp.example.com/tools");
    expect(report.results[0]?.installType).toBe("remote");
    expect(report.cached?.id).toBe("com.example/remote-tools");
    expect(report.ranked[0]?.registry).toBe("official");
    expect(report.ranked[0]?.installType).toBe("remote");
  });

  test("installs cached remote results as HTTP servers", () => {
    expect(report.installed.success).toBe(true);
    expect(report.summary?.url).toBe("https://mcp.example.com/tools");
    expect(report.summary?.transport).toBe("http");
    expect(report.summary?.command).toBe("");
  });
});
