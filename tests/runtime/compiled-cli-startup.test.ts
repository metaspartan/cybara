import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function currentBunTarget(): string {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  return `bun-${platform}-${process.arch}`;
}

describe("compiled CLI startup", () => {
  test("runs without an adjacent Transformers runtime", () => {
    const directory = mkdtempSync(join(tmpdir(), "cybara-compiled-cli-startup-"));
    const binary = join(directory, process.platform === "win32" ? "cybara.exe" : "cybara");
    const home = join(directory, "home");
    mkdirSync(home, { recursive: true });

    try {
      const build = Bun.spawnSync(
        [
          process.execPath,
          "build",
          join(process.cwd(), "src", "main.ts"),
          "--compile",
          `--target=${currentBunTarget()}`,
          `--outfile=${binary}`,
          "--external",
          "electron",
          "--external",
          "@aws-sdk/client-s3",
          "--external",
          "@huggingface/transformers",
          "--external",
          "kokoro-js",
          "--external",
          "onnxruntime-node",
          "--external",
          "onnxruntime-web",
        ],
        { cwd: process.cwd() }
      );
      expect(build.exitCode).toBe(0);

      const environment = { ...process.env, HOME: home, USERPROFILE: home };
      const version = Bun.spawnSync([binary, "version"], { cwd: directory, env: environment });
      expect(version.exitCode).toBe(0);
      expect(version.stdout.toString()).toMatch(/^cybara v\d+\.\d+\.\d+/);
      expect(version.stderr.toString()).not.toContain("Cannot find module");

      const help = Bun.spawnSync([binary, "help"], { cwd: directory, env: environment });
      expect(help.exitCode).toBe(0);
      expect(help.stdout.toString()).toContain("CYBARA CLI");
      expect(help.stderr.toString()).not.toContain("Cannot find module");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
