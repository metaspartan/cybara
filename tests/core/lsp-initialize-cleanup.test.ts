import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { LSPManager } from "../../src/core/lsp/manager";

const cybaraHome = process.env.CYBARA_HOME ?? join(process.env.HOME ?? "", ".cybara");
const configPath = join(cybaraHome, "lsp.json");
const originalConfig = existsSync(configPath) ? readFileSync(configPath, "utf8") : null;

afterEach(() => {
  if (originalConfig === null) rmSync(configPath, { force: true });
  else writeFileSync(configPath, originalConfig);
});

async function waitForExit(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      process.kill(pid, 0);
      await Bun.sleep(25);
    } catch {
      return true;
    }
  }
  return false;
}

describe("LSP initialization cleanup", () => {
  test("terminates a server that rejects initialize", async () => {
    const root = process.env.HOME ?? process.cwd();
    const scriptPath = join(root, "rejecting-lsp.ts");
    const pidPath = join(root, "rejecting-lsp.pid");
    writeFileSync(
      scriptPath,
      `import { writeFileSync } from "fs";
writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
let input = "";
process.stdin.on("data", (data) => {
  input += data.toString();
  if (!input.includes('"method":"initialize"')) return;
  const payload = JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32603, message: "rejected" } });
  process.stdout.write("Content-Length: " + Buffer.byteLength(payload) + "\\r\\n\\r\\n" + payload);
  input = "";
});
setInterval(() => {}, 1000);
`
    );
    writeFileSync(
      configPath,
      JSON.stringify({ lsp: { python: { command: process.execPath, args: [scriptPath] } } })
    );

    const manager = new LSPManager(root);
    expect(await manager.getClient("python")).toBeNull();
    const pid = Number(readFileSync(pidPath, "utf8"));
    expect(Number.isInteger(pid)).toBe(true);
    expect(await waitForExit(pid)).toBe(true);
    await manager.shutdown();
    rmSync(scriptPath, { force: true });
    rmSync(pidPath, { force: true });
  });
});
