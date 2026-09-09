import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { config } from "../../src/core/config";
import { handleRead } from "../../src/core/tools/handlers/file";
import { readablePathOptions, sensitiveReadMode } from "../../src/core/tools/sensitive-read-policy";

const directory = mkdtempSync(join(tmpdir(), "cybara-sensitive-read-"));
const envPath = join(directory, ".env");
const examplePath = join(directory, ".env.example");
const keyPath = join(directory, "id_ed25519");
const originalPolicy = config.getSensitiveFilePolicy();

describe("sensitive file read policy", () => {
  beforeAll(() => {
    writeFileSync(envPath, "API_KEY=secret-value\n");
    writeFileSync(examplePath, "API_KEY=\n");
    writeFileSync(keyPath, "-----BEGIN OPENSSH PRIVATE KEY-----\n");
  });

  afterAll(() => {
    config.setSensitiveFilePolicy(originalPolicy);
    rmSync(directory, { recursive: true, force: true });
  });

  test("maps the stored policy onto a read mode", () => {
    expect(
      sensitiveReadMode({ allow_env_file_reads: false, allow_all_sensitive_reads: false })
    ).toBe("blocked");
    expect(
      sensitiveReadMode({ allow_env_file_reads: true, allow_all_sensitive_reads: false })
    ).toBe("env-files");
    expect(
      sensitiveReadMode({ allow_env_file_reads: false, allow_all_sensitive_reads: true })
    ).toBe("all");
    expect(readablePathOptions({ confineToWorkspace: true }).confineToWorkspace).toBe(true);
  });

  test("blocks .env by default but always allows .env.example, and the denial names the setting", async () => {
    config.setSensitiveFilePolicy({});
    expect((await handleRead({ path: examplePath })).content).toContain("API_KEY=");
    await expect(handleRead({ path: envPath })).rejects.toThrow("Settings → Safety");
  });

  test("the .env switch opens env files only", async () => {
    config.setSensitiveFilePolicy({ allow_env_file_reads: true });
    expect((await handleRead({ path: envPath })).content).toContain("secret-value");
    await expect(handleRead({ path: keyPath })).rejects.toThrow("Refused");
  });

  test("the all-sensitive switch opens key files too, while Cybara's own data stays blocked", async () => {
    config.setSensitiveFilePolicy({ allow_all_sensitive_reads: true });
    expect((await handleRead({ path: keyPath })).content).toContain("PRIVATE KEY");
    await expect(handleRead({ path: "~/.cybara/secure/storage.key" })).rejects.toThrow("Refused");
  });

  test("normalizes stored policy values", () => {
    expect(
      config.setSensitiveFilePolicy({ allow_env_file_reads: "yes", allow_all_sensitive_reads: 1 })
    ).toEqual({
      allow_env_file_reads: false,
      allow_all_sensitive_reads: false,
    });
    expect(config.setSensitiveFilePolicy(null)).toEqual({
      allow_env_file_reads: false,
      allow_all_sensitive_reads: false,
    });
  });
});
