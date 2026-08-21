import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("compiled Transformers.js worker asset", () => {
  test("remains readable from a standalone executable", () => {
    const directory = mkdtempSync(join(tmpdir(), "cybara-transformers-worker-asset-"));
    const binary = join(directory, process.platform === "win32" ? "probe.exe" : "probe");
    const source = join(directory, "probe.ts");
    try {
      writeFileSync(
        source,
        `import workerPath from ${JSON.stringify(join(process.cwd(), "src", "core", "memory", "transformers-embedding-worker.mjs"))} with { type: "file" };
const source = await Bun.file(workerPath).text();
if (!source.includes("Managed Transformers.js worker")) process.exit(1);
console.log("transformers-worker-asset-ok");
`
      );
      const build = Bun.spawnSync(
        [process.execPath, "build", source, "--compile", "--outfile", binary],
        { cwd: process.cwd() }
      );
      expect(build.exitCode).toBe(0);
      if (process.platform === "darwin") {
        const sign = Bun.spawnSync(["codesign", "--force", "--sign", "-", binary]);
        expect(sign.exitCode).toBe(0);
      }
      const run = Bun.spawnSync([binary], { cwd: directory });
      expect(run.exitCode).toBe(0);
      expect(run.stdout.toString()).toContain("transformers-worker-asset-ok");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 60_000);
});
