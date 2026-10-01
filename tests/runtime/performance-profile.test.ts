import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isCybaraProfileProcess } from "../../scripts/cybara-process-match";
import { readSubprocessStreamAsText } from "../../src/core/subprocess-output";

const ROOT_DIR = join(import.meta.dir, "..", "..");

describe("macOS performance profiler", () => {
  test("includes product processes without counting unrelated repo tooling", () => {
    expect(isCybaraProfileProcess("bun src/index.ts", ROOT_DIR)).toBe(true);
    expect(
      isCybaraProfileProcess(`${ROOT_DIR}/ui/node_modules/.bin/vite --port 5200`, ROOT_DIR)
    ).toBe(true);
    expect(
      isCybaraProfileProcess(
        "/Applications/Google Chrome.app/Chrome --user-data-dir=/Users/test/.cybara/browser/default",
        ROOT_DIR
      )
    ).toBe(true);
    expect(
      isCybaraProfileProcess(
        `${ROOT_DIR}/node_modules/typescript/lib/tsserver.js --useNodeIpc`,
        ROOT_DIR
      )
    ).toBe(false);
    expect(
      isCybaraProfileProcess(
        "/Applications/Google Chrome.app/Chrome --user-data-dir=/Users/test/.cybara/channels/whatsapp-auth",
        ROOT_DIR
      )
    ).toBe(false);
  });

  test("package exposes a Bun-only profiler command", () => {
    const packageJson = JSON.parse(readFileSync(join(ROOT_DIR, "package.json"), "utf8"));
    expect(packageJson.scripts["profile:macos"]).toBe("bun run scripts/profile-cybara-macos.ts");
  });

  test("profiler emits parseable bounded JSON", async () => {
    const proc = Bun.spawn({
      cmd: [
        process.execPath,
        "run",
        "scripts/profile-cybara-macos.ts",
        "--duration",
        "0",
        "--json",
      ],
      cwd: ROOT_DIR,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      readSubprocessStreamAsText(proc.stdout),
      readSubprocessStreamAsText(proc.stderr),
      proc.exited,
    ]);
    expect(stderr.trim()).toBe("");
    expect(exitCode).toBe(0);
    const report = JSON.parse(stdout);
    const expectedSource = process.platform === "win32" ? "cim" : "ps";
    expect(report.metricsSource).toBe(expectedSource);
    expect(typeof report.cpuPercentAvailable).toBe("boolean");
    expect(report.sampleCount).toBe(1);
    expect(report.durationSeconds).toBe(0);
    expect(report.peakRssBytes).toBeGreaterThanOrEqual(0);
    expect(typeof report.peakRssBytes).toBe("number");
    expect(Array.isArray(report.samples)).toBe(true);
    expect(report.samples[0]).toHaveProperty("processes");
    expect(report.samples[0].metricsSource).toBe(expectedSource);
    expect(report.samples[0].sampledAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    for (const entry of report.samples[0].processes) {
      expect(entry.pid).toBeGreaterThan(0);
      expect(entry.rssBytes).toBeGreaterThanOrEqual(0);
      expect(typeof entry.command).toBe("string");
      expect(isCybaraProfileProcess(entry.command, ROOT_DIR)).toBe(true);
    }
  }, 60_000);
});
