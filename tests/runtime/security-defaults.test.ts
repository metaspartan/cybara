import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("security-sensitive runtime defaults", () => {
  test("fresh config defaults to loopback host and ask-mode tool approvals", () => {
    const configSource = readFileSync(join(ROOT_DIR, "src", "core", "config.ts"), "utf8");

    expect(configSource).toContain('DEFAULT_TOOL_APPROVAL_MODE: ToolApprovalMode = "ask"');
    expect(configSource).toContain('host: "127.0.0.1"');
  });

  test("server expose flag overrides loopback only when explicitly requested", () => {
    const serverSource = readFileSync(join(ROOT_DIR, "src", "index.ts"), "utf8");

    expect(serverSource).toContain('process.argv.includes("--expose")');
    expect(serverSource).toContain("function isAllInterfaceHost");
    expect(serverSource).toContain('host === "0.0.0.0"');
    expect(serverSource).toContain('host === "::"');
    expect(serverSource).toContain("isAllInterfaceHost(configuredHost)");
    expect(serverSource).toContain('? "127.0.0.1"');
  });

  test("core and CLI storage paths honor CYBARA_HOME", () => {
    const pathsSource = readFileSync(join(ROOT_DIR, "src", "core", "paths.ts"), "utf8");
    const mainSource = readFileSync(join(ROOT_DIR, "src", "main.ts"), "utf8");
    const cliSource = readFileSync(join(ROOT_DIR, "src", "cli.tsx"), "utf8");
    const speechSource = readFileSync(join(ROOT_DIR, "src", "core", "speech.ts"), "utf8");

    expect(pathsSource).toContain("process.env.CYBARA_HOME?.trim()");
    expect(mainSource).toContain('process.env.CYBARA_HOME || join(USER_HOME, ".cybara")');
    expect(cliSource).toContain('process.env.CYBARA_HOME || join(home, ".cybara")');
    expect(speechSource).toContain("process.env.CYBARA_HOME?.trim()");
    expect(speechSource).toContain('join(cybaraHome, "media")');
    expect(speechSource).toContain("chmodSync(aiffPath, 0o600)");
  });
});
