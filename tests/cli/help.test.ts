import { describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { rawHelp } from "../../src/cli/commands/help";

const rootDir = join(import.meta.dir, "../..");

describe("CLI help", () => {
  test("renders telemetry and permissions as top-level commands", () => {
    const lines: string[] = [];
    const log = spyOn(console, "log").mockImplementation((value?: unknown) => {
      lines.push(String(value ?? ""));
    });

    try {
      rawHelp("1.0.0", "http://127.0.0.1:4269");
    } finally {
      log.mockRestore();
    }

    expect(lines).toContain("  telemetry   External telemetry commands");
    expect(lines).toContain("  permissions Manage agent capability access");
    expect(lines).not.toContain("    telemetry   External telemetry commands");
    expect(lines).not.toContain("    permissions Manage agent capability access");
  });

  test("prints help without initializing persistent state", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "cybara-cli-help-"));

    try {
      const proc = Bun.spawn([process.execPath, "run", "src/cli/index.tsx", "--help"], {
        cwd: rootDir,
        env: { ...process.env, CYBARA_HOME: homeDir },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toStartWith("CYBARA CLI\n");
      expect(`${stdout}\n${stderr}`).not.toContain("[Database]");
      expect(existsSync(join(homeDir, "data", "platform.db"))).toBe(false);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
