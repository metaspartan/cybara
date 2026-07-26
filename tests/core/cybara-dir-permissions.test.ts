import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function mode(path: string): string {
  return (statSync(path).mode & 0o777).toString(8).padStart(3, "0");
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

    expect(mode(home)).toBe("700");
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
      expect(`${dir}=${mode(join(home, dir))}`).toBe(`${dir}=700`);
    }

    expect(mode(join(home, "channels", "whatsapp-auth"))).toBe("700");
    expect(mode(join(home, "browser", "profile-default"))).toBe("700");

    expect(mode(join(home, "api_key"))).toBe("600");
    expect(mode(join(home, "security.json"))).toBe("600");
  });

  test("creates a fresh install private from the start", () => {
    const home = join(mkdtempSync(join(tmpdir(), "cybara-fresh-")), "nested-home");

    const booted = bootPathsModule(home);
    expect(booted.code).toBe(0);

    expect(mode(home)).toBe("700");
    for (const dir of ["data", "memory", "logs", "secure", "skills"]) {
      expect(`${dir}=${mode(join(home, dir))}`).toBe(`${dir}=700`);
    }
  });

  test("is idempotent and leaves an already-hardened install untouched", () => {
    const home = mkdtempSync(join(tmpdir(), "cybara-idem-"));
    mkdirSync(join(home, "channels"), { recursive: true, mode: 0o700 });

    expect(bootPathsModule(home).code).toBe(0);
    const first = mode(join(home, "channels"));
    expect(bootPathsModule(home).code).toBe(0);

    expect(mode(join(home, "channels"))).toBe(first);
    expect(first).toBe("700");
  });
});
