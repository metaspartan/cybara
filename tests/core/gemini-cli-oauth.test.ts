import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  clearGeminiCliOAuthClientCacheForTests,
  resolveGeminiCliOAuthClientConfig,
} from "../../src/core/gemini-cli-oauth";

const PATH_KEY = "PATH";
const BIN_HINTS_KEY = "CYBARA_GEMINI_CLI_BIN_HINTS";
const CLIENT_ID_ENV_KEYS = [
  "CYBARA_GEMINI_OAUTH_CLIENT_ID",
  "GEMINI_CLI_OAUTH_CLIENT_ID",
] as const;
const CLIENT_SECRET_ENV_KEYS = [
  "CYBARA_GEMINI_OAUTH_CLIENT_SECRET",
  "GEMINI_CLI_OAUTH_CLIENT_SECRET",
] as const;

const originalPath = process.env[PATH_KEY];
const originalBinHints = process.env[BIN_HINTS_KEY];
const originalClientIdEnv = new Map<string, string | undefined>();
const originalClientSecretEnv = new Map<string, string | undefined>();

for (const key of CLIENT_ID_ENV_KEYS) {
  originalClientIdEnv.set(key, process.env[key]);
}
for (const key of CLIENT_SECRET_ENV_KEYS) {
  originalClientSecretEnv.set(key, process.env[key]);
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const key of CLIENT_ID_ENV_KEYS) {
    const value = originalClientIdEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const key of CLIENT_SECRET_ENV_KEYS) {
    const value = originalClientSecretEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  if (originalPath === undefined) delete process.env[PATH_KEY];
  else process.env[PATH_KEY] = originalPath;
  if (originalBinHints === undefined) delete process.env[BIN_HINTS_KEY];
  else process.env[BIN_HINTS_KEY] = originalBinHints;

  clearGeminiCliOAuthClientCacheForTests();

  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Gemini CLI OAuth client config resolution", () => {
  test("uses env overrides when provided", () => {
    process.env.CYBARA_GEMINI_OAUTH_CLIENT_ID = "123456789-abcd.apps.googleusercontent.com";
    process.env.CYBARA_GEMINI_OAUTH_CLIENT_SECRET = "GOCSPX-env-secret";
    process.env[PATH_KEY] = "";

    const config = resolveGeminiCliOAuthClientConfig();
    expect(config).toEqual({
      clientId: "123456789-abcd.apps.googleusercontent.com",
      clientSecret: "GOCSPX-env-secret",
      source: "env",
    });
  });

  test("returns null when no env vars or Gemini CLI binary exist", () => {
    process.env[PATH_KEY] = join(tmpdir(), `cybara-missing-gemini-${Date.now()}`);

    const config = resolveGeminiCliOAuthClientConfig();
    expect(config).toBeNull();
  });

  test("extracts credentials from installed Gemini CLI oauth2.js", () => {
    const root = mkdtempSync(join(tmpdir(), "cybara-gemini-cli-oauth-"));
    tempDirs.push(root);

    const binDir = join(root, "bin");
    const cliDistDir = join(root, "lib", "node_modules", "@google", "gemini-cli", "dist");
    const oauthDir = join(
      root,
      "lib",
      "node_modules",
      "@google",
      "gemini-cli",
      "node_modules",
      "@google",
      "gemini-cli-core",
      "dist",
      "src",
      "code_assist"
    );

    mkdirSync(binDir, { recursive: true });
    mkdirSync(cliDistDir, { recursive: true });
    mkdirSync(oauthDir, { recursive: true });

    const realGeminiPath = join(cliDistDir, "index.js");
    writeFileSync(realGeminiPath, "console.log('gemini');\n", "utf8");

    const oauth2Path = join(oauthDir, "oauth2.js");
    writeFileSync(
      oauth2Path,
      [
        'const clientId = "999999999-xyz.apps.googleusercontent.com";',
        'const clientSecret = "GOCSPX-binary-secret";',
      ].join("\n"),
      "utf8"
    );

    const shimPath = join(binDir, "gemini");
    symlinkSync(realGeminiPath, shimPath);
    chmodSync(shimPath, 0o755);

    process.env[PATH_KEY] = binDir;

    const config = resolveGeminiCliOAuthClientConfig();
    expect(config).toEqual({
      clientId: "999999999-xyz.apps.googleusercontent.com",
      clientSecret: "GOCSPX-binary-secret",
      source: "gemini-cli",
    });
  });

  test("discovers Gemini CLI from CYBARA_GEMINI_CLI_BIN_HINTS when PATH is restricted", () => {
    const root = mkdtempSync(join(tmpdir(), "cybara-gemini-cli-oauth-hint-"));
    tempDirs.push(root);

    const binDir = join(root, "bin");
    const cliDistDir = join(root, "lib", "node_modules", "@google", "gemini-cli", "dist");
    const oauthDir = join(
      root,
      "lib",
      "node_modules",
      "@google",
      "gemini-cli",
      "node_modules",
      "@google",
      "gemini-cli-core",
      "dist",
      "src",
      "code_assist"
    );

    mkdirSync(binDir, { recursive: true });
    mkdirSync(cliDistDir, { recursive: true });
    mkdirSync(oauthDir, { recursive: true });

    const realGeminiPath = join(cliDistDir, "index.js");
    writeFileSync(realGeminiPath, "console.log('gemini');\n", "utf8");
    const oauth2Path = join(oauthDir, "oauth2.js");
    writeFileSync(
      oauth2Path,
      [
        'const clientId = "111111111-abc.apps.googleusercontent.com";',
        'const clientSecret = "GOCSPX-hint-secret";',
      ].join("\n"),
      "utf8"
    );

    const shimPath = join(binDir, "gemini");
    symlinkSync(realGeminiPath, shimPath);
    chmodSync(shimPath, 0o755);

    process.env[PATH_KEY] = join(tmpdir(), `cybara-empty-path-${Date.now()}`);
    process.env[BIN_HINTS_KEY] = binDir;

    const config = resolveGeminiCliOAuthClientConfig();
    expect(config).toEqual({
      clientId: "111111111-abc.apps.googleusercontent.com",
      clientSecret: "GOCSPX-hint-secret",
      source: "gemini-cli",
    });
  });
});
