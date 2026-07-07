import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT_DIR = join(import.meta.dir, "..", "..");

describe("macOS performance profiler", () => {
  test("package exposes a Bun-only profiler command", () => {
    const packageJson = JSON.parse(readFileSync(join(ROOT_DIR, "package.json"), "utf8"));
    expect(packageJson.scripts["profile:macos"]).toBe("bun run scripts/profile-cybara-macos.ts");
  });

  test("profiler emits parseable bounded JSON", async () => {
    const proc = Bun.spawn({
      cmd: ["bun", "run", "scripts/profile-cybara-macos.ts", "--duration", "0", "--json"],
      cwd: ROOT_DIR,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(stderr.trim()).toBe("");
    expect(exitCode).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.sampleCount).toBe(1);
    expect(report.durationSeconds).toBe(0);
    expect(typeof report.peakRssBytes).toBe("number");
    expect(Array.isArray(report.samples)).toBe(true);
    expect(report.samples[0]).toHaveProperty("processes");
  });
});
