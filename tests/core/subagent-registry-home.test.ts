import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("subagent registry storage", () => {
  test("stores production registry state inside CYBARA_HOME", async () => {
    const cybaraHome = mkdtempSync(join(tmpdir(), "cybara-subagent-home-"));
    const script = [
      'const registry = await import("./src/core/subagent-registry.ts")',
      'registry.registerSubagentRun({ childSessionKey: "child", requesterSessionKey: "parent", task: "persist" })',
    ].join(";");
    try {
      const child = Bun.spawn([process.execPath, "-e", script], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: "production",
          CYBARA_HOME: cybaraHome,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await child.exited;
      const stderr = await new Response(child.stderr).text();

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(existsSync(join(cybaraHome, "subagent-registry.json"))).toBe(true);
    } finally {
      rmSync(cybaraHome, { recursive: true, force: true });
    }
  });
});
