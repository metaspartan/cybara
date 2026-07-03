import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function runVerifier(manifestPath: string): {
  exitCode: number | null;
  stderr: string;
  stdout: string;
} {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "run",
      join(ROOT_DIR, "scripts", "verify-tauri-updater-manifest.ts"),
      manifestPath,
    ],
    {
      cwd: ROOT_DIR,
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  return {
    exitCode: result.exitCode,
    stderr: new TextDecoder().decode(result.stderr),
    stdout: new TextDecoder().decode(result.stdout),
  };
}

describe("Tauri updater manifest verifier script", () => {
  test("accepts a complete Windows updater latest.json manifest", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cybara-tauri-updater-"));
    try {
      const manifestPath = join(tempDir, "latest.json");
      writeFileSync(
        manifestPath,
        JSON.stringify(
          {
            version: "1.0.582",
            platforms: {
              "windows-x86_64": {
                signature: "msi-signature",
                url: "https://example.com/cybara.msi",
              },
              "windows-x86_64-msi": {
                signature: "msi-signature",
                url: "https://example.com/cybara.msi",
              },
              "windows-x86_64-nsis": {
                signature: "nsis-signature",
                url: "https://example.com/cybara-setup.exe",
              },
            },
          },
          null,
          2
        ),
        "utf8"
      );

      const result = runVerifier(manifestPath);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Tauri updater manifest 1.0.582 is ready");
      expect(result.stdout).toContain("windows-x86_64-msi");
      expect(result.stdout).toContain("windows-x86_64");
      expect(result.stdout).toContain("windows-x86_64-nsis");
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  test("fails closed when latest.json is missing Windows updater fallback platforms", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cybara-tauri-updater-"));
    try {
      const manifestPath = join(tempDir, "latest.json");
      writeFileSync(
        manifestPath,
        JSON.stringify(
          {
            version: "1.0.582",
            platforms: {
              "linux-x86_64": {
                signature: "linux-signature",
                url: "https://example.com/cybara.deb",
              },
            },
          },
          null,
          2
        ),
        "utf8"
      );

      const result = runVerifier(manifestPath);

      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Tauri updater manifest is not ready");
      expect(result.stderr).toContain("windows-x86_64-msi");
      expect(result.stderr).toContain("windows-x86_64");
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});
