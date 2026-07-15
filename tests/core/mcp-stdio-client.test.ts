import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { STRICT_MCP_FIXTURE_MARKER } from "../fixtures/strict-mcp-server";

interface StdioClientOutcome {
  started: { success: boolean; error?: string };
  startupMs: number;
  status: string;
  toolNames: string[];
  results: unknown[];
  stopped: boolean;
}

const root = join(import.meta.dir, "..", "..");
let tempHome = "";
let outcome: StdioClientOutcome;

beforeAll(() => {
  tempHome = mkdtempSync(join(tmpdir(), "cybara-mcp-stdio-client-"));
  const modulePath = join(root, "src", "core", "mcp.ts").replaceAll("\\", "/");
  const fixturePath = join(root, "tests", "fixtures", "strict-mcp-server.ts").replaceAll("\\", "/");
  const workerPath = join(tempHome, "worker.ts");
  writeFileSync(
    workerPath,
    `
import { mcpManager } from ${JSON.stringify(modulePath)};
const server = mcpManager.create({
  name: "strict-test",
  command: process.execPath,
  args: ${JSON.stringify(fixturePath)},
});
const startedAt = performance.now();
const started = await mcpManager.start(server.id);
const startupMs = performance.now() - startedAt;
const status = mcpManager.getStatus(server.id);
const results = await Promise.all(
  Array.from({ length: 24 }, (_, index) =>
    mcpManager.callTool(server.id, "uppercase", { text: "request-" + index })
  )
);
const stopped = await mcpManager.stop(server.id);
mcpManager.delete(server.id);
console.log("__RESULT__" + JSON.stringify({
  started,
  startupMs,
  status: status?.status ?? "missing",
  toolNames: status?.tools.map((tool) => tool.name) ?? [],
  results,
  stopped,
}));
`,
    "utf8"
  );
  const processResult = Bun.spawnSync([process.execPath, "run", workerPath], {
    cwd: root,
    env: { ...process.env, CYBARA_HOME: tempHome, HOME: tempHome, USERPROFILE: tempHome },
  });
  if (processResult.exitCode !== 0) {
    throw new Error(
      `MCP stdio client worker failed: ${processResult.stderr.toString()}\n${processResult.stdout.toString()}`
    );
  }
  const marker = processResult.stdout.toString().split("__RESULT__").at(-1)?.split("\n")[0];
  if (!marker) throw new Error("MCP stdio client worker did not return a result");
  outcome = JSON.parse(marker) as StdioClientOutcome;
});

afterAll(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
});

describe("MCP stdio client", () => {
  test("completes initialization and delayed tool discovery before reporting running", () => {
    expect(outcome.started).toEqual({ success: true });
    expect(outcome.status).toBe("running");
    expect(outcome.toolNames).toEqual(["uppercase"]);
    expect(outcome.startupMs).toBeGreaterThanOrEqual(100);
    expect(outcome.startupMs).toBeLessThan(2_000);
  });

  test("dispatches concurrent tool responses by request id", () => {
    expect(outcome.results).toHaveLength(24);
    for (let index = 0; index < outcome.results.length; index++) {
      expect(outcome.results[index]).toEqual({
        content: [{ type: "text", text: `${STRICT_MCP_FIXTURE_MARKER}:REQUEST-${index}` }],
      });
    }
    expect(outcome.stopped).toBe(true);
  });
});
