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
    expect(serverSource).toContain(
      'process.env.CYBARA_HOST || (isExposeFlagSet ? "0.0.0.0" : configuredHost)'
    );
    expect(serverSource).toContain("let runtimeHost = HOST");
    expect(serverSource).toContain(': "127.0.0.1";');
  });

  test("terminal and insecure startup modes require explicit operator action", () => {
    const serverSource = readFileSync(join(ROOT_DIR, "src", "index.ts"), "utf8");
    const configSource = readFileSync(join(ROOT_DIR, "src", "core", "config.ts"), "utf8");

    expect(configSource).not.toContain("terminal_enabled: true");
    expect(serverSource).toContain("function isTerminalEnabled");
    expect(serverSource).toContain('process.argv.includes("--enable-terminal")');
    expect(serverSource).toContain('config.get<boolean>("terminal_enabled") === true');
    expect(serverSource).toContain("function printStartupSecurityWarnings");
    expect(serverSource).toContain("Web terminal is enabled");
    expect(serverSource).toContain("Gateway is listening on all interfaces");
    expect(serverSource).toContain("isAllInterfaceHost(runtimeHost)");
    expect(serverSource).not.toContain("?token=${gatewayKey}");
  });

  test("core, CLI, speech, and plugins storage paths use shared Cybara home resolver", () => {
    const homeSource = readFileSync(join(ROOT_DIR, "src", "core", "cybara-home.ts"), "utf8");
    const pathsSource = readFileSync(join(ROOT_DIR, "src", "core", "paths.ts"), "utf8");
    const mainSource = readFileSync(join(ROOT_DIR, "src", "main.ts"), "utf8");
    const cliSource = readFileSync(join(ROOT_DIR, "src", "cli.tsx"), "utf8");
    const speechSource = readFileSync(join(ROOT_DIR, "src", "core", "speech.ts"), "utf8");
    const pluginsSource = readFileSync(
      join(ROOT_DIR, "src", "core", "plugins", "index.ts"),
      "utf8"
    );

    expect(homeSource).toContain('cybaraHomeOverrideFile = join(runtimeHomeDir, ".cybara_home")');
    expect(homeSource).toContain("process.env.CYBARA_HOME?.trim()");
    expect(homeSource).toContain("export function setCybaraHomeOverride");
    expect(pathsSource).toContain("const cybaraHome = resolveCybaraHome()");
    expect(mainSource).toContain("resolveCybaraHome().dir");
    expect(cliSource).toContain("resolveCybaraHome().dir");
    expect(speechSource).toContain('join(resolveCybaraHome().dir, "media")');
    expect(pluginsSource).toContain("resolveCybaraHome().dir");
    expect(speechSource).toContain("chmodSync(aiffPath, 0o600)");
  });
});
