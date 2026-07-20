import { describe, expect, test } from "bun:test";
import { dirname, join } from "path";
import { resolveUiPath } from "../../src/core/runtime/ui-path";

function existsFrom(paths: string[]): (candidate: string) => boolean {
  const set = new Set(paths);
  return (candidate: string) => set.has(candidate);
}

describe("resolveUiPath", () => {
  test("returns development ui path when not compiled", () => {
    const moduleDir = "/workspace/dist";

    const result = resolveUiPath({
      isCompiledBinary: false,
      execPath: "/usr/local/bin/bun",
      moduleDir,
    });

    expect(result).toBe(join(moduleDir, "..", "ui", "dist"));
  });

  test("prefers release ui path for compiled binaries", () => {
    const execPath = "/opt/cybara/release/cybara";
    const execDir = dirname(execPath);
    const releaseUi = join(execDir, "ui", "dist");

    const result = resolveUiPath({
      isCompiledBinary: true,
      execPath,
      moduleDir: "/virtual/bundle",
      existsSyncFn: existsFrom([releaseUi]),
    });

    expect(result).toBe(releaseUi);
  });

  test("uses Tauri macOS resource path when present", () => {
    const execPath = "/Applications/Cybara.app/Contents/MacOS/cybara";
    const execDir = dirname(execPath);
    const tauriMacUi = join(execDir, "..", "Resources", "ui", "dist");

    const result = resolveUiPath({
      isCompiledBinary: true,
      execPath,
      moduleDir: "/virtual/bundle",
      existsSyncFn: existsFrom([tauriMacUi]),
    });

    expect(result).toBe(tauriMacUi);
  });

  test("supports the legacy Tauri macOS resource path", () => {
    const execPath = "/Applications/Cybara.app/Contents/MacOS/cybara";
    const execDir = dirname(execPath);
    const tauriMacUi = join(execDir, "..", "Resources", "_up_", "ui", "dist");

    const result = resolveUiPath({
      isCompiledBinary: true,
      execPath,
      moduleDir: "/virtual/bundle",
      existsSyncFn: existsFrom([tauriMacUi]),
    });

    expect(result).toBe(tauriMacUi);
  });

  test("uses Tauri linux lib/share paths with app name", () => {
    const execPath = "/usr/bin/cybara";
    const execDir = dirname(execPath);
    const linuxLib = join(execDir, "..", "lib", "cybara", "ui", "dist");

    const libResult = resolveUiPath({
      isCompiledBinary: true,
      execPath,
      moduleDir: "/virtual/bundle",
      appName: "cybara",
      existsSyncFn: existsFrom([linuxLib]),
    });
    expect(libResult).toBe(linuxLib);

    const linuxShare = join(execDir, "..", "share", "cybara", "ui", "dist");
    const shareResult = resolveUiPath({
      isCompiledBinary: true,
      execPath,
      moduleDir: "/virtual/bundle",
      appName: "cybara",
      existsSyncFn: existsFrom([linuxShare]),
    });
    expect(shareResult).toBe(linuxShare);
  });

  test("falls back to repo-relative ui path for compiled binaries", () => {
    const execPath = "/workspace/release/cybara";
    const execDir = dirname(execPath);
    const repoUi = join(execDir, "..", "ui", "dist");

    const result = resolveUiPath({
      isCompiledBinary: true,
      execPath,
      moduleDir: "/virtual/bundle",
      existsSyncFn: existsFrom([repoUi]),
    });

    expect(result).toBe(repoUi);
  });

  test("uses tauri dev sidecar repo path when sidecar is in src-tauri/bin", () => {
    const execPath = "/workspace/src-tauri/bin/cybara-aarch64-apple-darwin";
    const execDir = dirname(execPath);
    const tauriDevRepoUi = join(execDir, "..", "..", "ui", "dist");

    const result = resolveUiPath({
      isCompiledBinary: true,
      execPath,
      moduleDir: "/virtual/bundle",
      existsSyncFn: existsFrom([tauriDevRepoUi]),
    });

    expect(result).toBe(tauriDevRepoUi);
  });

  test("falls back to development path when no compiled path exists", () => {
    const moduleDir = "/workspace/dist";

    const result = resolveUiPath({
      isCompiledBinary: true,
      execPath: "/workspace/release/cybara",
      moduleDir,
      existsSyncFn: () => false,
    });

    expect(result).toBe(join(moduleDir, "..", "ui", "dist"));
  });
});
