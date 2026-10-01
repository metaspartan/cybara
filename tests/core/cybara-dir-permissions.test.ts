import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const WINDOWS = process.platform === "win32";

const SHARED_PRINCIPALS = /everyone|authenticated users|builtin\\users|guests/i;

function accessGrants(path: string): string {
  const listed = Bun.spawnSync(["icacls", path]);
  return `${listed.stdout.toString()}\n${listed.stderr.toString()}`;
}

function expectNoSharedAccess(path: string): void {
  expect(SHARED_PRINCIPALS.test(accessGrants(path))).toBe(false);
}

function mode(path: string): string {
  return (statSync(path).mode & 0o777).toString(8).padStart(3, "0");
}

function expectPrivateDir(path: string): void {
  if (WINDOWS) {
    expectNoSharedAccess(path);
    return;
  }
  expect(mode(path)).toBe("700");
}

function expectPrivateFile(path: string): void {
  if (WINDOWS) {
    expectNoSharedAccess(path);
    return;
  }
  expect(mode(path)).toBe("600");
}

function bootPathsModule(home: string): { code: number; stderr: string } {
  const result = Bun.spawnSync(
    ["bun", "-e", 'import("./src/core/paths.ts").then(() => process.exit(0));'],
    {
      cwd: join(import.meta.dirname, "..", ".."),
      env: { ...process.env, CYBARA_HOME: home },
    }
  );
  return { code: result.exitCode ?? 1, stderr: result.stderr.toString() };
}

describe("cybara home permissions", () => {
  test("repairs a pre-upgrade install that left directories world-readable", () => {
    const home = mkdtempSync(join(tmpdir(), "cybara-perms-"));

    for (const dir of ["data", "memory", "logs", "secure", "skills"]) {
      mkdirSync(join(home, dir), { recursive: true, mode: 0o700 });
    }
    for (const dir of [
      "channels",
      "browser",
      "artifacts",
      "screenshots",
      "cron",
      "plugins",
      "runtime",
      "cache",
      "temp",
    ]) {
      mkdirSync(join(home, dir), { recursive: true });
      chmodSync(join(home, dir), 0o755);
    }
    mkdirSync(join(home, "channels", "whatsapp-auth"), { recursive: true });
    chmodSync(join(home, "channels", "whatsapp-auth"), 0o755);
    mkdirSync(join(home, "browser", "profile-default"), { recursive: true });
    chmodSync(join(home, "browser", "profile-default"), 0o755);

    writeFileSync(join(home, "api_key"), "cybara_test_key_value");
    chmodSync(join(home, "api_key"), 0o644);
    writeFileSync(join(home, "security.json"), "{}");
    chmodSync(join(home, "security.json"), 0o644);

    const booted = bootPathsModule(home);
    expect(booted.code).toBe(0);

    expectPrivateDir(home);
    for (const dir of [
      "data",
      "memory",
      "logs",
      "secure",
      "skills",
      "channels",
      "browser",
      "artifacts",
      "screenshots",
      "cron",
      "plugins",
      "runtime",
      "cache",
      "temp",
    ]) {
      expectPrivateDir(join(home, dir));
    }

    expectPrivateDir(join(home, "channels", "whatsapp-auth"));
    expectPrivateDir(join(home, "browser", "profile-default"));

    expectPrivateFile(join(home, "api_key"));
    expectPrivateFile(join(home, "security.json"));
  });

  test("creates a fresh install private from the start", () => {
    const home = join(mkdtempSync(join(tmpdir(), "cybara-fresh-")), "nested-home");

    const booted = bootPathsModule(home);
    expect(booted.code).toBe(0);

    expectPrivateDir(home);
    for (const dir of ["data", "memory", "logs", "secure", "skills"]) {
      expectPrivateDir(join(home, dir));
    }
  });

  test("is idempotent and leaves an already-hardened install untouched", () => {
    const home = mkdtempSync(join(tmpdir(), "cybara-idem-"));
    mkdirSync(join(home, "channels"), { recursive: true, mode: 0o700 });

    expect(bootPathsModule(home).code).toBe(0);
    const first = WINDOWS ? accessGrants(join(home, "channels")) : mode(join(home, "channels"));
    expect(bootPathsModule(home).code).toBe(0);

    if (WINDOWS) {
      expect(accessGrants(join(home, "channels"))).toBe(first);
      expectNoSharedAccess(join(home, "channels"));
      return;
    }
    expect(mode(join(home, "channels"))).toBe(first);
    expect(first).toBe("700");
  });
});
