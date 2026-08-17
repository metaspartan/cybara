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
      cmd: ["bun", "run", "scripts/profile-cybara-macos.ts", "--duration", "0", "--json"],
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
    expect(report.sampleCount).toBe(1);
    expect(report.durationSeconds).toBe(0);
    expect(typeof report.peakRssBytes).toBe("number");
    expect(Array.isArray(report.samples)).toBe(true);
    expect(report.samples[0]).toHaveProperty("processes");
  }, 30_000);
});
