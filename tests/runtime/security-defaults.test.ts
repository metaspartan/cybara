import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { readIdeUiSource } from "../source-fixtures";
import { readNativeSettingsSource } from "../shared/source-bundles";

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

  test("API responses disable caching for sensitive and live data", () => {
    const serverSource = readFileSync(join(ROOT_DIR, "src", "index.ts"), "utf8");
    const apiResponseStart = serverSource.indexOf(
      'response.raw ? String(response.body ?? "") : JSON.stringify(response.body)'
    );
    expect(apiResponseStart).toBeGreaterThan(0);
    expect(serverSource.slice(apiResponseStart, apiResponseStart + 500)).toContain(
      '"Cache-Control": "no-store"'
    );
  });

  test("workspace indexing does not start automatically by default", () => {
    const configSource = readFileSync(join(ROOT_DIR, "src", "core", "config.ts"), "utf8");
    const ideConstantsSource = readFileSync(
      join(ROOT_DIR, "ui", "src", "pages", "ide", "ideConstants.ts"),
      "utf8"
    );
    const ideSource = readIdeUiSource();
    const settingsSource = readFileSync(
      join(ROOT_DIR, "ui", "src", "pages", "settings", "MemoryBehaviorSettings.tsx"),
      "utf8"
    );
    const mobileHelpersSource = readFileSync(
      join(ROOT_DIR, "apps", "mobile", "src", "screens", "dashboardHelpers.ts"),
      "utf8"
    );
    const nativeSettingsSource = readNativeSettingsSource();
    const indexerSource = readFileSync(
      join(ROOT_DIR, "src", "core", "workspace-indexer.ts"),
      "utf8"
    );

    expect(configSource).toContain("DEFAULT_WORKSPACE_INDEXER_SETTINGS: WorkspaceIndexerSettings");
    expect(configSource).toContain("enabled: false");
    expect(configSource).toContain("autoReindexOnWorkspaceSet: false");
    expect(configSource).toContain("semanticEnabled: false");
    expect(ideConstantsSource).toContain(
      "DEFAULT_INDEXER_SETTINGS_DRAFT: WorkspaceIndexerSettings"
    );
    expect(ideConstantsSource).toContain("enabled: false");
    expect(ideConstantsSource).toContain("autoReindexOnWorkspaceSet: false");
    expect(ideConstantsSource).toContain("semanticEnabled: false");
    expect(ideSource).toContain("if (!autoAssignIndexerWorkspace) return;");
    expect(settingsSource).toContain("const defaultMemoryRecallSettings");
    expect(settingsSource).toContain("autoReindexOnWorkspaceSet: false");
    expect(mobileHelpersSource).toContain('boolSetting(indexer, "enabled", false)');
    expect(mobileHelpersSource).toContain('boolSetting(indexer, "semanticEnabled", false)');
    expect(mobileHelpersSource).toContain(
      'boolSetting(indexer, "autoReindexOnWorkspaceSet", false)'
    );
    expect(nativeSettingsSource).toContain("@State var indexEnabled = false");
    expect(nativeSettingsSource).toContain("@State var indexSemantic = false");
    expect(nativeSettingsSource).toContain("@State var indexAutoReindex = false");
    expect(nativeSettingsSource).toContain('indexer["enabled"] as? Bool ?? false');
    expect(nativeSettingsSource).toContain('indexer["semanticEnabled"] as? Bool ?? false');
    expect(nativeSettingsSource).toContain(
      'indexer["autoReindexOnWorkspaceSet"] as? Bool ?? false'
    );
    expect(indexerSource).toContain("settings.enabled && settings.autoReindexOnWorkspaceSet");
  });

  test("memory remains enabled even when optional indexing is off by default", () => {
    const configSource = readFileSync(join(ROOT_DIR, "src", "core", "config.ts"), "utf8");
    const providerSource = readFileSync(
      join(ROOT_DIR, "src", "core", "memory", "providers.ts"),
      "utf8"
    );
    const webSettingsSource = readFileSync(
      join(ROOT_DIR, "ui", "src", "pages", "settings", "MemoryBehaviorSettings.tsx"),
      "utf8"
    );
    const mobileSettingsSource = [
      "dashboardSettingsPanels.tsx",
      "dashboardAdvancedSettingsPanels.tsx",
    ]
      .map((file) => readFileSync(join(ROOT_DIR, "apps", "mobile", "src", "screens", file), "utf8"))
      .join("\n");
    const nativeSettingsSource = readNativeSettingsSource();

    expect(configSource).toContain("DEFAULT_MEMORY_BEHAVIOR_SETTINGS: MemoryBehaviorSettings");
    expect(configSource).toContain("backgroundReviewEnabled: true");
    expect(configSource).toContain("memoryFlushEnabled: true");
    expect(providerSource).toContain('provider: "local"');
    expect(providerSource).toContain("autoRecall: true");
    expect(providerSource).toContain("autoCapture: true");
    expect(webSettingsSource).toContain("Separate from memory itself");
    expect(webSettingsSource).toContain("Build search index");
    expect(mobileSettingsSource).toContain("Separate from memory itself");
    expect(mobileSettingsSource).toContain("Build search index");
    expect(nativeSettingsSource).toContain("Separate from memory itself");
    expect(nativeSettingsSource).toContain("Build search index");
  });

  test("legacy chat session listing stays bounded for older clients", () => {
    const routesSource = readFileSync(join(ROOT_DIR, "src", "api", "routes.ts"), "utf8");

    expect(routesSource).toContain('"GET /api/chat/sessions": (_body, params) =>');
    expect(routesSource).toContain("limit: parseBoundedQueryNumber(params?.limit, 1, 500) ?? 150");
    expect(routesSource).toContain(
      "offset: parseBoundedQueryNumber(params?.offset, 0, 100000) ?? 0"
    );
  });

  test("core, CLI, speech, and plugins storage paths use shared Cybara home resolver", () => {
    const homeSource = readFileSync(join(ROOT_DIR, "src", "core", "cybara-home.ts"), "utf8");
    const pathsSource = readFileSync(join(ROOT_DIR, "src", "core", "paths.ts"), "utf8");
    const mainSource = readFileSync(join(ROOT_DIR, "src", "main.ts"), "utf8");
    const cliClientSource = readFileSync(join(ROOT_DIR, "src", "cli", "client.ts"), "utf8");
    const speechSource = readFileSync(join(ROOT_DIR, "src", "core", "speech.ts"), "utf8");
    const systemSpeechSource = readFileSync(
      join(ROOT_DIR, "src", "core", "system-speech.ts"),
      "utf8"
    );
    const pluginsSource = readFileSync(
      join(ROOT_DIR, "src", "core", "plugins", "index.ts"),
      "utf8"
    );

    expect(homeSource).toContain('cybaraHomeOverrideFile = join(runtimeHomeDir, ".cybara_home")');
    expect(homeSource).toContain("process.env.CYBARA_HOME?.trim()");
    expect(homeSource).toContain("export function setCybaraHomeOverride");
    expect(pathsSource).toContain("const cybaraHome = resolveCybaraHome()");
    expect(mainSource).toContain("resolveCybaraHome().dir");
    expect(cliClientSource).toContain("resolveCybaraHome().dir");
    expect(speechSource).toContain('join(resolveCybaraHome().dir, "media")');
    expect(pluginsSource).toContain("resolveCybaraHome().dir");
    expect(speechSource).toContain("chmodSync(audioPath, 0o600)");
    expect(systemSpeechSource).toContain("chmodSync(input.outputPath, 0o600)");
  });
});
