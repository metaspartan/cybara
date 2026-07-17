import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  readGatewayModelsSource,
  readGatewayModelTestsSource,
  readNativeChatSource,
  readNativeConfigSource,
  readNativePlatformSource,
  readNativeSettingsSource,
} from "../shared/source-bundles";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MACOS_APP_DIR = join(ROOT_DIR, "apps", "macos", "Cybara", "Sources", "Cybara");

describe("native macOS shell wiring", () => {
  test("restores and persists the main window frame after AppKit attachment", () => {
    const liquidGlass = readFileSync(
      join(ROOT_DIR, "apps", "macos", "Cybara", "Sources", "Cybara", "LiquidGlass.swift"),
      "utf8"
    );
    const contentView = readFileSync(
      join(ROOT_DIR, "apps", "macos", "Cybara", "Sources", "Cybara", "ContentView.swift"),
      "utf8"
    );

    expect(liquidGlass).toContain("override func viewDidMoveToWindow()");
    expect(liquidGlass).toContain("window !== resolvedWindow");
    expect(contentView).toContain('setFrameAutosaveName("CybaraMainWindow")');
    expect(contentView).toContain('setFrameUsingName("CybaraMainWindow")');
  });

  test("sidecar manager reuses gateway port 4269 and configures a managed local launch", () => {
    const sidecarManager = readFileSync(join(MACOS_APP_DIR, "SidecarManager.swift"), "utf8");
    const sidecarCore = readFileSync(join(MACOS_APP_DIR, "SidecarCore.swift"), "utf8");

    expect(sidecarManager).toContain("CYBARA_NATIVE_PORT");
    expect(sidecarManager).toContain("SidecarCore.port(fromEnv:");
    expect(sidecarCore).toContain("public static let defaultPort = 4269");
    expect(sidecarManager).toContain("Attached to existing Cybara gateway");
    expect(sidecarCore).toContain('environment["PORT"] = String(port)');
    expect(sidecarCore).not.toContain('environment["CYBARA_HOST"] = "127.0.0.1"');
    expect(sidecarManager).toContain('arguments = ["start"]');
    expect(sidecarManager).not.toContain('arguments = ["start", "--enable-terminal"]');
    expect(sidecarCore).toContain("ancestorDirectories(from: currentDirectory)");
    expect(sidecarCore).toContain("ancestorDirectories(from: executableDirectory)");
    expect(sidecarCore).toContain('bundledSidecar.appendingPathComponent("cybara").path');
    expect(sidecarManager).toContain("gatewayMode = .managed");
    expect(sidecarManager).toContain("gatewayMode = .attached");
  });

  test("native shell does not embed the web UI as a detail pane", () => {
    const contentView = readFileSync(join(MACOS_APP_DIR, "ContentView.swift"), "utf8");
    const app = readFileSync(join(MACOS_APP_DIR, "CybaraApp.swift"), "utf8");

    expect(existsSync(join(MACOS_APP_DIR, "CybaraWebView.swift"))).toBe(false);
    expect(contentView).not.toContain("CybaraWebView");
    expect(contentView).not.toContain("webBackedDetail");
    expect(contentView).not.toContain("webRoute");
    expect(contentView).not.toContain("webUI");
    expect(contentView).not.toContain("Web UI");
    expect(app).not.toContain("cybaraReloadWebView");
    expect(app).toContain('Button("New Chat")');
    expect(app).toContain('.keyboardShortcut("n", modifiers: .command)');
  });

  test("native workspace open targets use a stable optical icon column", () => {
    const screens = readNativeChatSource();
    const icon = readFileSync(join(MACOS_APP_DIR, "NativeWorkspaceOpenTargetIcon.swift"), "utf8");

    expect(screens).toContain("NativeWorkspaceOpenTargetIcon(target: target)");
    expect(icon).toContain(".frame(width: 12, height: 12)");
    expect(icon).toContain(".frame(width: 16, height: 16)");
    expect(icon).toContain(".symbolRenderingMode(.monochrome)");
  });

  test("native app exposes a template menu bar icon with usage and lifecycle controls", () => {
    const app = readFileSync(join(MACOS_APP_DIR, "CybaraApp.swift"), "utf8");
    const menu = readFileSync(join(MACOS_APP_DIR, "CybaraMenuBar.swift"), "utf8");

    expect(app).toContain("MenuBarExtra");
    expect(app).toContain("applicationShouldTerminateAfterLastWindowClosed");
    expect(app).toContain("-> Bool {\n        false");
    expect(menu).toContain("CybaraBrand.menuBarTemplateImage()");
    expect(menu).toContain(".frame(width: 16, height: 16)");
    expect(menu).toContain('Button("Show Cybara")');
    expect(menu).toContain('Button("New Chat")');
    expect(menu).toContain('Menu("Usage")');
    expect(menu).toContain('Button("Quit Cybara")');
    expect(menu).toContain("model.refresh(baseURL: sidecar.serverURL)");
  });

  test("native logo loading does not call SwiftPM Bundle.module at app startup", () => {
    const brand = readFileSync(join(MACOS_APP_DIR, "CybaraBrand.swift"), "utf8");
    const pet = readFileSync(join(MACOS_APP_DIR, "PetPanel.swift"), "utf8");

    expect(brand).not.toContain("Bundle.module");
    expect(pet).not.toContain("Bundle.module");
    expect(pet).toContain("CybaraBrand.logoImage");
    expect(brand).toContain('appendingPathComponent("Resources"');
    expect(brand).toContain("Cybara_Cybara.bundle");
    expect(brand).toContain("logoURLCandidates");
  });

  test("native terminal presents an enable action instead of a disabled endpoint error", () => {
    const screens = readNativePlatformSource();

    expect(screens).toContain('Label("Terminal Disabled", systemImage: "terminal")');
    expect(screens).toContain('Button("Enable Terminal")');
    expect(screens).toContain('["terminal_enabled": true]');
  });

  test("native chat workspace provides an editable IDE surface with LSP status", () => {
    const workspace = readFileSync(join(MACOS_APP_DIR, "NativeChatWorkspacePanel.swift"), "utf8");

    expect(workspace).toContain('case .files: "IDE"');
    expect(workspace).toContain("TextEditor(text: $fileContent)");
    expect(workspace).toContain("client.writeIDEFile(path: path, content: fileContent)");
    expect(workspace).toContain("client.lspStatus()");
  });

  test("native shell exposes major web and Tauri destinations as SwiftUI screens", () => {
    const contentView = readFileSync(join(MACOS_APP_DIR, "ContentView.swift"), "utf8");
    const app = readFileSync(join(ROOT_DIR, "ui", "src", "App.tsx"), "utf8");
    const nativePlatformScreens = readNativePlatformSource();
    const nativeScreens = readNativeChatSource();

    for (const route of [
      "/agents",
      "/providers",
      "/router",
      "/channels",
      "/mobile",
      "/voice",
      "/plugins",
      "/mcp",
      "/lsp",
      "/ide",
      "/sessions",
      "/usage",
      "/skills",
      "/tools",
      "/terminal",
      "/memory",
      "/journey",
      "/wallet",
      "/artifacts",
      "/metrics",
      "/tasks",
      "/logs",
      "/settings",
    ]) {
      expect(app).toContain(`path="${route}"`);
    }

    for (const nativeScreen of [
      "RouterScreen(client: client)",
      "ChannelsScreen(client: client)",
      "NativeVoiceScreen(client: client)",
      "PluginsScreen(client: client)",
      "MCPScreen(client: client)",
      "LSPScreen(client: client)",
      "IDEScreen(client: client)",
      "SessionsManagementScreen(client: client)",
      "UsageScreen(client: client)",
      "ToolsScreen(client: client)",
      "TerminalScreen(client: client)",
      "MemoryScreen(client: client)",
      "WalletScreen(client: client)",
      "ArtifactsScreen(client: client)",
      "NativeSkillsScreen(client: client)",
      "LogsScreen(client: client)",
    ]) {
      expect(contentView).toContain(nativeScreen);
    }

    expect(nativePlatformScreens).toContain("let active: [NativeActiveLSPServer]?");
    expect(nativePlatformScreens).toContain("let preinstalled: Bool?");
    expect(nativePlatformScreens).toContain("(status?.active ?? []).filter(\\.initialized)");
    expect(nativePlatformScreens).toContain('label: included ? "Included"');

    for (const gatewayRoute of [
      '"api/mcp"',
      '"api/lsp/status"',
      '"api/ide/index/status"',
      '"api/ide/browse"',
      '"api/ide/read"',
      '"api/ide/write"',
      '"api/ide/create"',
      '"api/ide/rename"',
      '"api/ide/search"',
      '"api/ide/replace"',
      '"api/ide/replace/preview"',
      '"api/ide/reveal"',
      '"api/ide/open-terminal"',
      '"api/ide/permalink"',
      '"api/sessions/\\(',
      '"api/tools"',
      '"api/terminal/sessions"',
      '"api/artifacts"',
      '"api/skills/status"',
      '"api/skills/registry/browse"',
      '"api/skills/registry/search"',
      '"api/skills/install"',
    ]) {
      const source = gatewayRoute.includes("skills")
        ? readFileSync(join(MACOS_APP_DIR, "GatewayClient.swift"), "utf8")
        : nativePlatformScreens;
      expect(source).toContain(gatewayRoute);
    }

    expect(contentView).toContain('Label("New Chat", systemImage: "square.and.pencil")');
    expect(contentView).toContain("ForEach([NativeDestination.dashboard, .usage])");
    expect(contentView).toContain("ForEach([NativeDestination.ide, .voice, .evals");
    expect(contentView).not.toContain(".buttonStyle(.borderedProminent)");
    expect(contentView).not.toContain('NativeI18n.t("status.gatewayOnline")');
    expect(contentView).not.toContain('TextField("Search chats", text: $searchText)');
    expect(contentView).toContain("NativeChatSearchPopover(client: client)");
    expect(contentView).toContain('.keyboardShortcut("k", modifiers: .command)');
    expect(contentView).toContain('Label("More", systemImage: "ellipsis")');
    expect(contentView).toContain("NativePrimarySessionList(");
    expect(contentView).toContain("destination = .settings");
    expect(contentView).toContain(".navigationSplitViewStyle(.balanced)");
    expect(nativeScreens).toContain("if selectedSessionID == nil && messages.isEmpty");
    expect(nativeScreens).toContain('Text("Start a conversation")');
    expect(nativeScreens).toContain("newChatWorkspaceBar");
    expect(nativeScreens).toContain("composerContent");
    expect(nativeScreens).toContain('Text(activeSession?.displayTitle ?? "Untitled chat")');
    expect(nativeScreens).toContain('.help("Chat options")');
    expect(nativeScreens).not.toContain("Circle().fill(accentTint.opacity(0.14))");
    expect(nativeScreens).toContain(".trim(from: 0, to: contextUsageProgress)");
    expect(nativeScreens).not.toContain(
      'Text(activeContextUsage.map { "\\(Int($0.usedPercent.rounded()))" } ?? "?")'
    );
    expect(nativeScreens).toContain('.accessibilityLabel("Attachments")');
    expect(nativeScreens).toContain('.help("Attach images or text files")');
    expect(nativeScreens).toContain('NativeEnvironmentSection(title: "Context and usage")');
    expect(nativeScreens).toContain('NativeEnvironmentUsageStat(label: "Cache read"');
    expect(nativeScreens).toContain('NativeEnvironmentUsageStat(label: "First token"');
    expect(nativeScreens).not.toContain('NativeEnvironmentSection(title: "Provider plan")');
    expect(nativeScreens).toContain("GridItem(.adaptive(minimum: 168)");
    expect(nativeScreens).toContain(".font(.title2.weight(.semibold))");
  });

  test("native voice workspace uses gateway speech contracts without embedding web content", () => {
    const contentView = readFileSync(join(MACOS_APP_DIR, "ContentView.swift"), "utf8");
    const voice = readFileSync(join(MACOS_APP_DIR, "NativeVoiceScreen.swift"), "utf8");
    const packaging = readFileSync(join(ROOT_DIR, "scripts", "package-native-macos.ts"), "utf8");

    expect(contentView).toContain("case voice");
    expect(contentView).toContain("NativeVoiceScreen(client: client)");
    expect(voice).toContain('request("api/speech/status")');
    expect(voice).toContain('"api/speech/dictate"');
    expect(voice).toContain('"api/speech/synthesize"');
    expect(voice).toContain('"api/media"');
    expect(voice).toContain("AVCaptureDevice.requestAccess(for: .audio)");
    expect(voice).toContain("SFSpeechURLRecognitionRequest");
    expect(voice).toContain('@SceneStorage("cybara.voice.sessionID")');
    expect(voice).not.toContain("WKWebView");
    expect(packaging).toContain("NSSpeechRecognitionUsageDescription");
  });

  test("native LSP operations expose an explicit progress label", () => {
    const platformScreens = readNativePlatformSource();

    expect(platformScreens).toContain(
      'installed?.installed == true ? "Removing..." : "Installing..."'
    );
    expect(platformScreens).toContain("ProgressView().controlSize(.small)");
  });

  test("native IDE screen provides browser editor and search replace controls", () => {
    const nativePlatformScreens = readNativePlatformSource();
    const nativeScreens = readNativeChatSource();

    for (const snippet of [
      "NativeIDEBrowseResult",
      "NativeIDEReadResult",
      "NativeIDESearchResult",
      "NativeIDEReplacePreviewResult",
      "TextEditor(text: $fileContent)",
      "Create Item",
      "Rename Item",
      "browseIDE(path:",
      "readIDEFile(path:",
      "writeIDEFile(path: selectedFilePath",
      "createIDEItem(parentPath:",
      "renameIDEItem(path:",
      "searchIDE(",
      "previewIDEReplace(",
      "applyIDEReplace(",
      "revealIDEPath",
      "openIDETerminal",
      "idePermalink",
      'Text("Chat").tag("chat")',
      "ChatScreen(",
      "preferredWorkspaceDir: firstNonEmptyGatewayString",
    ]) {
      expect(nativePlatformScreens).toContain(snippet);
    }
    expect(nativeScreens).toContain("var preferredWorkspaceDir: String? = nil");
    expect(nativeScreens).toContain("preferredWorkspaceDir,");
  });

  test("native settings centers its content column and keeps cards left-aligned", () => {
    const settings = readNativeSettingsSource();
    const i18n = readFileSync(join(MACOS_APP_DIR, "NativeI18n.swift"), "utf8");

    expect(settings).toContain("static let maxContentWidth: CGFloat = 900");
    expect(settings).toContain(
      "static let contentInset = EdgeInsets(top: 16, leading: 16, bottom: 18, trailing: 16)"
    );
    expect(settings).toContain(".frame(width: 860, height: 720)");
    expect(settings).toContain(
      ".clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))"
    );
    expect(i18n).toContain('"settings.accessibility": "Accessibility"');
    expect(settings).toContain(
      ".frame(maxWidth: NativeSettingsLayout.maxContentWidth, maxHeight: .infinity, alignment: .topLeading)"
    );
    expect(settings).toContain(
      ".frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)"
    );
    expect(settings).toContain(".frame(maxWidth: .infinity, alignment: .top)");
    expect(settings).not.toContain(".frame(maxWidth: .infinity, alignment: .topLeading)");
  });

  test("system settings expose native backup and restore controls", () => {
    const settings = readNativeSettingsSource();
    const backups = readFileSync(join(MACOS_APP_DIR, "NativeBackupsScreen.swift"), "utf8");

    expect(settings).toContain("case .backups:");
    expect(settings).toContain("NativeBackupsScreen(client: client)");
    expect(backups).toContain('Text("Backup & Restore")');
    expect(backups).toContain('Label("Create Backup", systemImage: "plus.circle")');
    expect(backups).toContain('Button("Restore & Restart", role: .destructive)');
  });

  test("native settings has a Memory tab with provider picker and indexing split", () => {
    const settings = readNativeSettingsSource();
    const gatewayClient = readFileSync(join(MACOS_APP_DIR, "GatewayClient.swift"), "utf8");

    expect(settings).toContain("case .memory:");
    expect(settings).toContain("MemoryScreen(client: client)");
    for (const provider of ["supermemory", "mem0", "honcho", "openviking", "hindsight"]) {
      expect(settings).toContain(`"${provider}"`);
    }
    // Memory, provider, and indexing write the same config keys as the web UI.
    expect(settings).toContain('saveConfigPatch(["memory": memory], key: "memory")');
    expect(settings).toContain(
      'saveConfigPatch(["memory_provider": payload], key: "memory_provider")'
    );
    expect(settings).toContain(
      'saveConfigPatch(["workspace_indexer": indexer], key: "workspace_indexer")'
    );
    // Connection test goes through the gateway test route.
    expect(gatewayClient).toContain('request("api/memory/providers/test", method: "POST"');
    expect(settings).toContain("client.testMemoryProvider(body)");
  });

  test("native settings follows the shared grouped settings navigation", () => {
    const settings = readNativeSettingsSource();

    for (const tab of [
      "general",
      "accessibility",
      "gateway",
      "model",
      "agents",
      "providers",
      "router",
      "channels",
      "mobile",
      "plugins",
      "mcp",
      "skills",
      "tools",
      "memory",
      "speech",
      "features",
      "wallet",
      "migration",
      "logs",
      "advanced",
    ]) {
      expect(settings).toContain(`case ${tab}`);
    }

    expect(settings).toContain("ForEach(NativeSettingsTab.allCases)");
    expect(settings).toContain("case .wallet: WalletScreen(client: client)");
    expect(settings).toContain("appearanceSettingsCard");
    expect(settings).not.toContain("appearanceTab.tabItem");
    expect(settings).not.toContain('Label("Advanced"');
    expect(settings).not.toContain('case .wallet: return "Wallet"');
  });

  test("native logs use bounded paged gateway reads instead of full log downloads", () => {
    const gatewayClient = readFileSync(join(MACOS_APP_DIR, "GatewayClient.swift"), "utf8");
    const gatewayModels = readGatewayModelsSource();
    const configScreens = readNativeConfigSource();

    expect(gatewayClient).toContain("func systemLogsPage(limit: Int = 200, offset: Int = 0)");
    expect(gatewayClient).toContain('URLQueryItem(name: "limit"');
    expect(gatewayClient).toContain('URLQueryItem(name: "offset"');
    expect(gatewayClient).toContain('URLQueryItem(name: "includeTotal", value: "1")');
    expect(gatewayModels).toContain("struct GatewayLogPage");
    expect(configScreens).toContain("private let logLimit = 200");
    expect(configScreens).toContain("client.systemLogsPage(limit: logLimit)");
    expect(configScreens).toContain("logSummary");
  });

  test("native settings exposes gateway restart, auth, and logs through GatewayClient", () => {
    const gatewayClient = readFileSync(join(MACOS_APP_DIR, "GatewayClient.swift"), "utf8");
    const managementClient = readFileSync(
      join(MACOS_APP_DIR, "GatewayManagementClient.swift"),
      "utf8"
    );
    const settings = readNativeSettingsSource();
    const sidecarManager = readFileSync(join(MACOS_APP_DIR, "SidecarManager.swift"), "utf8");

    expect(gatewayClient).toContain("func restartGateway() async throws -> [String: Any]");
    expect(gatewayClient).toContain('request("api/system/restart", method: "POST")');
    expect(managementClient).toContain("extension GatewayClient");
    expect(managementClient).toContain("func authSettings() async throws -> [String: Any]");
    expect(managementClient).toContain('rawObject("api/auth/settings")');
    expect(managementClient).toContain("gatewayPassword: String? = nil");
    expect(managementClient).toContain('"gatewayPassword"] = gatewayPassword');
    expect(managementClient).toContain('"clearGatewayPassword"] = true');
    expect(managementClient).toContain('request("api/auth/settings", method: "PUT"');
    expect(gatewayClient).toContain('"X-Cybara-Gateway-Password"');
    expect(managementClient).toContain("func revealAuthKey() async throws -> String?");
    expect(managementClient).toContain('rawObject("api/auth/key")');
    expect(managementClient).toContain("func rotateAuthKey() async throws -> String?");
    expect(managementClient).toContain('request("api/auth/rotate-key", method: "POST")');
    expect(settings).toContain('Text("Gateway Activity")');
    expect(settings).toContain("NativeLogTimeline(");
    expect(settings).toContain("client.systemLogsPage(limit: 80)");
    expect(settings).toContain("Task { await restartGateway() }");
    expect(settings).toContain("try await client.restartGateway()");
    expect(settings).toContain("await sidecar.waitForAttachedGatewayRestart()");
    expect(settings).toContain("Gateway Auth");
    expect(settings).toContain("Gateway Password");
    expect(settings).toContain("try GatewayPasswordStore.validateWrite(password)");
    expect(settings).toContain("try GatewayPasswordStore.save(password)");
    expect(settings).toContain("try GatewayPasswordStore.clear()");
    expect(settings).not.toContain(
      'UserDefaults.standard.set(password, forKey: "cybara_gateway_password")'
    );
    expect(settings).toContain("Rotate Key");
    expect(settings).toContain('Text("Default Workspace")');
    expect(settings).toContain('["default_workspace_dir": defaultWorkspaceDir]');
    expect(settings).toContain("chooseDefaultWorkspaceDirectory()");
    expect(settings).toContain('chooseMigrationDirectory(title: "Choose Default Workspace")');
    expect(settings).toContain('Text("Data Directory")');
    expect(settings).toContain('["cybara_data_dir": path]');
    expect(settings).toContain("configured_cybara_data_dir");
    expect(settings).toContain("chooseCybaraDataDirectory()");
    expect(settings).toContain('chooseMigrationDirectory(title: "Choose Cybara Data Directory")');
    expect(sidecarManager).toContain("func waitForAttachedGatewayRestart() async");
    expect(sidecarManager).toContain("Waiting for attached Cybara gateway to restart");
  });

  test("native agent lists use summaries and fetch full detail only for editing", () => {
    const client = readFileSync(join(MACOS_APP_DIR, "GatewayClient.swift"), "utf8");
    const agents = readFileSync(join(MACOS_APP_DIR, "NativeAgentsScreen.swift"), "utf8");
    expect(client).toContain('getList("api/agents/summary"');
    expect(client).toContain('get("api/agents/\\(encoded)"');
    expect(agents).toContain("client.agent(agent.id)");
  });

  test("native settings exposes supported migration controls", () => {
    const gatewayClient = readFileSync(
      join(MACOS_APP_DIR, "GatewayManagementClient.swift"),
      "utf8"
    );
    const gatewayModels = readGatewayModelsSource();
    const settings = readNativeSettingsSource();

    expect(gatewayModels).toContain("struct GatewayMigrationSource");
    expect(gatewayModels).toContain("struct GatewayMigrationReport");
    expect(gatewayClient).toContain("func migrationSources() async throws");
    expect(gatewayClient).toContain('request("api/migrations/sources"');
    expect(gatewayClient).toContain("func previewMigration(body: Data)");
    expect(gatewayClient).toContain('request("api/migrations/preview", method: "POST"');
    expect(gatewayClient).toContain("func runMigration(body: Data)");
    expect(gatewayClient).toContain('request("api/migrations/run", method: "POST"');
    expect(settings).toContain("case .migration: migrationTab");
    expect(settings).toContain('Text("OpenClaw").tag("openclaw")');
    expect(settings).toContain('Text("Hermes").tag("hermes")');
    expect(settings).toContain("migrationImportSecrets");
    expect(settings).toContain("migrationOverwrite");
    expect(settings).toContain("client.previewMigration(body: body)");
    expect(settings).toContain("client.runMigration(body: body)");
    expect(settings).toContain("NSOpenPanel()");
  });

  test("native chat pending queue exposes reorder, edit, and delete controls", () => {
    const gatewayClient = readFileSync(join(MACOS_APP_DIR, "GatewayClient.swift"), "utf8");
    const nativeScreens = readNativeChatSource();
    const toolTimeline = readFileSync(join(MACOS_APP_DIR, "NativeToolTimeline.swift"), "utf8");
    const gatewayModels = readGatewayModelsSource();

    expect(gatewayClient).toContain("func reorderPendingMessages(");
    expect(gatewayClient).toContain("func updatePendingMessage(");
    expect(gatewayClient).toContain("func deletePendingMessage(");
    expect(gatewayClient).toContain("func stopChatSession(");
    expect(gatewayClient).toContain("processActivities: [GatewayProcessActivityPayload] = []");
    expect(gatewayClient).toContain(
      "GatewaySteerPendingBody(processActivities: processActivities)"
    );
    expect(gatewayClient).toContain('"pendingMessageIds": pendingIds');
    expect(gatewayClient).toContain('pending/reorder"');
    expect(gatewayClient).toContain('method: "POST"');
    expect(gatewayClient).toContain('method: "PATCH"');
    expect(gatewayClient).toContain('method: "DELETE"');
    expect(gatewayModels).toContain("struct GatewayProcessActivityPayload: Encodable");
    expect(toolTimeline).toContain("func nativeSteeringProcessActivityPayloads(");
    expect(nativeScreens).toContain('Image(systemName: "chevron.up")');
    expect(nativeScreens).toContain('Image(systemName: "chevron.down")');
    expect(nativeScreens).toContain('Image(systemName: "pencil")');
    expect(nativeScreens).toContain('Image(systemName: "trash")');
    expect(nativeScreens).toContain("Move queued message up");
    expect(nativeScreens).toContain("Move queued message down");
    expect(nativeScreens).toContain("Edit queued message");
    expect(nativeScreens).toContain("await movePending(message, direction: -1)");
    expect(nativeScreens).toContain("await movePending(message, direction: 1)");
    expect(nativeScreens).toContain("pendingIds: nextMessages.map(\\.id)");
    expect(nativeScreens).toContain("await updatePending(message, content: editingPendingDraft)");
    expect(nativeScreens).toContain("await deletePending(message)");
    expect(nativeScreens).toContain("await stopResponse()");
    expect(nativeScreens).toContain('"stop.circle.fill"');
    expect(nativeScreens).toContain("activeSessionIDs.remove(sessionID)");
    const stopResponseIndex = nativeScreens.indexOf("func stopResponse");
    const stoppedReloadIndex = nativeScreens.indexOf(
      "await loadMessages(sessionID)",
      stopResponseIndex
    );
    const stoppedResetIndex = nativeScreens.indexOf(
      "resetLiveTimeline(clearStartedAt: true)",
      stopResponseIndex
    );
    expect(stoppedReloadIndex).toBeGreaterThan(stopResponseIndex);
    expect(stoppedResetIndex).toBeGreaterThan(stoppedReloadIndex);
    expect(nativeScreens).toContain(
      "processActivities: nativeSteeringProcessActivityPayloads(from: liveActivities)"
    );
  });

  test("native chat prunes live tool rows after persisted steering reloads", () => {
    const nativeScreens = readNativeChatSource();
    const toolTimeline = readFileSync(join(MACOS_APP_DIR, "NativeToolTimeline.swift"), "utf8");

    expect(toolTimeline).toContain("func nativePrunePersistedLiveActivities(");
    expect(toolTimeline).toContain("nativeActivityDedupeKey(");
    expect(nativeScreens).toContain("let detail = try await client.sessionDetail(id)");
    expect(nativeScreens).toContain("liveActivities = nativePrunePersistedLiveActivities(");
    expect(nativeScreens).toContain("await loadMessages(selectedSessionID)");
    expect(nativeScreens).not.toContain("messages.append(response.message");
  });

  test("native chat keeps long-running tool completions in their start position", () => {
    const toolTimeline = readFileSync(join(MACOS_APP_DIR, "NativeToolTimeline.swift"), "utf8");
    const mergeBlock = toolTimeline.slice(
      toolTimeline.indexOf("func nativeMergeLiveActivity("),
      toolTimeline.indexOf("func nativeMergeLiveActivities(")
    );

    expect(mergeBlock).not.toContain("60_000");
    expect(mergeBlock).toContain("timestamp: next[index].timestamp");
  });

  test("native chat keeps visible live work when queued snapshots are activity-empty", () => {
    const nativeScreens = readNativeChatSource();

    expect(nativeScreens).toContain(
      "let snapshotActivities = nativeLiveActivities(from: snapshot)"
    );
    expect(nativeScreens).toContain(
      "let preservingLocalLiveActivities = snapshotActivities.isEmpty && !liveActivities.isEmpty"
    );
    expect(nativeScreens).toContain("!preservingLocalLiveActivities,");
    expect(nativeScreens).toContain('"queued follow-up"');
  });

  test("native chat only shows live work for a sending or server-active session", () => {
    const nativeScreens = readNativeChatSource();

    expect(nativeScreens).toContain(
      "sending || selectedSessionID.map { activeSessionIDs.contains($0) } == true"
    );
    expect(nativeScreens).not.toContain("!liveActivities.isEmpty ||");
    expect(nativeScreens).not.toContain("streamingContent != nil ||");
  });

  test("native chat includes live and persisted edit activities in file changes", () => {
    const nativeScreens = readNativeChatSource();

    expect(nativeScreens).toContain(
      "summarizeNativeChatFileChanges(messages, liveActivities: liveActivities)"
    );
    expect(nativeScreens).toContain("func nativeActivityFileChange");
    expect(nativeScreens).toContain('parts.first?.lowercased() == "edited"');
    expect(nativeScreens).toContain(
      "for activity in messages.flatMap({ $0.process_activities ?? [] })"
    );
    expect(nativeScreens).toContain("for activity in liveActivities");
    expect(nativeScreens).toContain(
      "nativeChatFilePathDisplay(file.path, workspaceDir: activeWorkspaceDir)"
    );
    expect(nativeScreens).toContain("struct NativeChatFilePathDisplay");
    expect(nativeScreens).toContain('"Outside workspace"');
    expect(nativeScreens).toContain(".help(display.fullPath)");
  });

  test("native chat composer exposes agent switching and context usage", () => {
    const gatewayClient = readFileSync(join(MACOS_APP_DIR, "GatewayClient.swift"), "utf8");
    const gatewayModels = readGatewayModelsSource();
    const nativeScreens = readNativeChatSource();
    const nativePlatform = readNativePlatformSource();
    const nativeArtifacts = readFileSync(
      join(MACOS_APP_DIR, "NativeArtifactsScreen.swift"),
      "utf8"
    );
    const configScreens = readNativeConfigSource();
    const settings = readNativeSettingsSource();

    expect(gatewayModels).toContain("struct GatewaySessionContextUsage");
    expect(gatewayModels).toContain("let contextUsage: GatewaySessionContextUsage?");
    expect(gatewayModels).toContain("struct GatewaySessionTokenUsage");
    expect(gatewayModels).toContain("let tokenUsage: GatewaySessionTokenUsage?");
    expect(gatewayModels).toContain("let manualPlanEditable: Bool");
    expect(gatewayModels).toContain("let automaticTrackingLabel: String?");
    expect(gatewayModels).toContain("let messagesList: [GatewaySessionMessage]?");
    expect(gatewayClient).toContain("func sessionDetail(_ id: String)");
    expect(gatewayClient).toContain("func updateSessionAgent(");
    expect(gatewayClient).toContain("useModelRouter: Bool = false");
    expect(gatewayClient).toContain("timeoutInterval: TimeInterval = 120");
    expect(gatewayClient).toContain("timeoutInterval: 86_400");
    expect(gatewayClient).toContain('payload["useModelRouter"] = true');
    expect(nativePlatform).toContain('request("api/plugins/\\(pathSegment(id))"');
    expect(nativeScreens).toContain("subagentsLoadingSessionID");
    expect(nativeScreens).toContain(
      "guard selectedSessionID == requestedSessionID else { return }"
    );
    expect(nativeScreens).toContain(
      "nativeMergeLiveActivities(liveActivities, incoming: snapshotActivities)"
    );
    expect(nativeArtifacts).toContain(
      "content = try await client.readArtifact(artifact)\n            error = nil"
    );
    expect(gatewayClient).toContain('request("api/sessions/\\(id)/agent", method: "PUT"');
    expect(nativeScreens).toContain("var composerControls: some View");
    expect(nativeScreens).toContain("var activeTokenUsage: GatewaySessionTokenUsage?");
    expect(nativeScreens).toContain("Session tokens:");
    expect(nativeScreens).toContain('NativeEnvironmentUsageStat(label: "Input"');
    expect(nativeScreens).toContain(".trim(from: 0, to: contextUsageProgress)");
    expect(nativeScreens).toContain("var composerSecurityControls: some View");
    expect(nativeScreens).toContain('Label("Always Allow", systemImage: "exclamationmark.shield")');
    expect(nativeScreens).toContain('Label("Ask Me", systemImage: "questionmark.circle")');
    expect(settings).toContain('"follow_up_behavior_enabled": followUpBehaviorEnabled');
    expect(settings).toContain('"Queue / Steer follow-ups"');
    expect(nativeScreens).toContain("guard !chatBusy || followUpBehaviorEnabled else { return }");
    expect(nativeScreens).toContain('config["follow_up_behavior_enabled"] as? Bool ?? true');
    expect(nativeScreens).toContain("var toolApprovalIconName: String");
    expect(nativeScreens).toContain("var toolApprovalColor: Color");
    expect(nativeScreens).toContain("try await client.updateAppConfig(body)");
    expect(nativeScreens).toContain('"tool_approval_mode": normalized');
    expect(configScreens).toContain("Compact structured tool results");
    expect(configScreens).toContain('"token_optimization"');
    expect(configScreens).toContain('"toonStructuredDataEnabled": newValue');
    expect(nativeScreens).toContain('Picker("Agent", selection: agentSelectionBinding)');
    expect(nativeScreens).toContain('Text("Model Router").tag(nativeModelRouterSelectorValue)');
    expect(nativeScreens).toContain("let router = try await client.routerConfig()");
    expect(nativeScreens).toContain("useModelRouter: useModelRouter");
    expect(nativeScreens).toContain("ViewThatFits(in: .horizontal)");
    expect(nativeScreens).toContain("composerAgentPicker(compact: true)");
    expect(nativeScreens).toContain("nativeChatAgentLabel(name: agent.name");
    expect(nativeScreens).toContain("var reasoningEffortPopover: some View");
    expect(nativeScreens).toContain("client.updateAgentReasoning");
    expect(nativeScreens).toContain('Image(systemName: "brain")');
    expect(nativeScreens).toContain("var contextUsageText: String");
    expect(nativeScreens).toContain("var contextUsagePopover: some View");
    expect(nativeScreens).toContain("providerPlanStatus: ProviderPlanStatusResponse?");
    expect(nativeScreens).toContain("var activeProviderPlan: ProviderPlanSnapshot?");
    expect(nativeScreens).toContain("var providerPlanText: String?");
    expect(nativeScreens).toContain("var providerPlanUsageRows");
    expect(nativeScreens).toContain("NativeContextProviderPlanUsageBar");
    expect(nativeScreens).toContain("nativeContextProviderPlanUsageTint");
    expect(nativeScreens).toContain("if percent < 40 { return .green }");
    expect(nativeScreens).toContain("if percent < 65 { return .blue }");
    expect(nativeScreens).toContain("if percent < 80 { return .yellow }");
    expect(nativeScreens).toContain("if percent < 95 { return .orange }");
    expect(nativeScreens).toContain("client.providerPlanStatus()");
    expect(nativeScreens).toContain("pendingAgentSessionID = selectedSessionID");
    expect(nativeScreens).toContain("func changeChatAgent(_ agentID: String) async");
    expect(nativeScreens).toContain(
      "agentId: selectedConcreteChatAgentID.isEmpty ? nil : selectedConcreteChatAgentID"
    );
    expect(nativeScreens).toContain("useModelRouter: useModelRouter");
  });

  test("native macOS exposes replayable eval management without web-backed views", () => {
    const content = readFileSync(join(MACOS_APP_DIR, "ContentView.swift"), "utf8");
    const client = readFileSync(join(MACOS_APP_DIR, "GatewayClient.swift"), "utf8");
    const screen = readFileSync(join(MACOS_APP_DIR, "NativeEvalsScreen.swift"), "utf8");

    expect(content).toContain("case evals");
    expect(content).toContain("NativeEvalsScreen(client: client)");
    expect(client).toContain("func exportEvals(format: String, sanitize: Bool)");
    expect(client).toContain("func importEvals(_ bundleData: Data)");
    expect(screen).toContain('Button("Suite Backup")');
    expect(screen).toContain('Button("Redacted Trajectory JSONL")');
    expect(screen).toContain("GridItem(.adaptive(minimum: 150)");
    expect(screen).toContain(".padding(24)");
    expect(screen).toContain(".foregroundStyle(.secondary)");
    expect(screen).not.toContain("WKWebView");
  });

  test("native provider plan editors respect automatic provider-managed plans", () => {
    const providersScreen = readFileSync(
      join(MACOS_APP_DIR, "NativeProvidersScreen.swift"),
      "utf8"
    );
    const configScreens = readNativeConfigSource();

    expect(providersScreen).toContain("planManualEditable");
    expect(providersScreen).toContain("Plan usage is automatic");
    expect(providersScreen).toContain("ProviderPlanUsageCapsule");
    expect(providersScreen).toContain('providerPlanWindowValue(plan, kind: "rolling_5h")');
    expect(providersScreen).toContain('ProviderPlanUsageValue(text: "∞"');
    expect(providersScreen).toContain("providerPlanResetText(window.resetsAt)");
    expect(providersScreen).toContain("ceil(window.usedPercent");
    expect(providersScreen).toContain("RoundedRectangle(cornerRadius: 8, style: .continuous)");
    expect(providersScreen).toContain(".padding(.horizontal, 10)");
    expect(providersScreen).toContain(".padding(.vertical, 7)");
    expect(providersScreen).toContain(".frame(height: 5)");
    expect(providersScreen).toContain("if percent < 40 { return .green }");
    expect(providersScreen).toContain("if percent < 65 { return .blue }");
    expect(providersScreen).toContain("if percent < 80 { return .yellow }");
    expect(providersScreen).toContain("if percent < 95 { return .orange }");
    expect(providersScreen).toContain("if !planManualEditable");
    expect(configScreens).toContain("let manualPlanEditable = plan?.manualPlanEditable ?? true");
    expect(configScreens).toContain(
      "Automatic usage tracking is active. Routing uses live provider limits."
    );
    expect(configScreens).toContain(
      "if manualPlanEditable, let plan, !plan.presetSuggestions.isEmpty"
    );
  });

  test("native metrics renders automatic provider plan windows as colored progress rows", () => {
    const metricsScreen = readFileSync(join(MACOS_APP_DIR, "NativeMetricsScreen.swift"), "utf8");

    expect(metricsScreen).toContain("nativeProviderPlanWindowMetric(plan: plan, kind: kind)");
    expect(metricsScreen).toContain('("5h", "rolling_5h")');
    expect(metricsScreen).toContain('("Weekly", "rolling_week")');
    expect(metricsScreen).toContain("private struct NativeProviderPlanCard");
    expect(metricsScreen).toContain("private struct NativeProviderPlanWindowRow");
    expect(metricsScreen).toContain("private struct MetricsPlanWindowList");
    expect(metricsScreen).toContain("private struct MetricsPlanWindowPill");
    expect(metricsScreen).toContain("LazyVGrid(columns: columns");
    expect(metricsScreen).toContain("let cards: [NativeProviderPlanCard]");
    expect(metricsScreen).toContain('Text("Automatic Plan Windows")');
    expect(metricsScreen).toContain("nativeProviderPlanUsageTint(progress:");
    expect(metricsScreen).toContain("let tint: Color?");
    expect(metricsScreen).toContain("let progress: Double?");
    expect(metricsScreen).toContain("row.tint ?? tint");
    expect(metricsScreen).toContain("row.progress ?? row.value");
    expect(metricsScreen).toContain("if unlimited || progress < 40 { return .green }");
    expect(metricsScreen).toContain("if progress < 65 { return .blue }");
    expect(metricsScreen).toContain("if progress < 80 { return .yellow }");
    expect(metricsScreen).toContain("if progress < 95 { return .orange }");
  });

  test("native usage screen is a native provider plan surface", () => {
    const usageScreen = readFileSync(join(MACOS_APP_DIR, "NativeUsageScreen.swift"), "utf8");
    const presentation = readFileSync(
      join(MACOS_APP_DIR, "ProviderUsagePresentation.swift"),
      "utf8"
    );
    const contentView = readFileSync(join(MACOS_APP_DIR, "ContentView.swift"), "utf8");

    expect(contentView).toContain("case usage");
    expect(contentView).toContain("UsageScreen(client: client)");
    expect(usageScreen).toContain("struct UsageScreen: View");
    expect(usageScreen).toContain("try await client.providerPlanStatus()");
    expect(usageScreen).toContain("NativeUsageProviderCard");
    expect(usageScreen).toContain('NativeUsageWindow(label: "5h"');
    expect(usageScreen).toContain('NativeUsageWindow(label: "Weekly"');
    expect(presentation).toContain('NativeUsageWindowValue(text: "∞"');
    expect(usageScreen).toContain("if percent < 65 { return .blue }");
    expect(usageScreen).not.toContain("WebView");
  });

  test("native metrics loads fast and keeps a polished glass loading state", () => {
    const metricsScreen = readFileSync(join(MACOS_APP_DIR, "NativeMetricsScreen.swift"), "utf8");

    expect(metricsScreen).toContain("private struct MetricsLoadingSkeleton");
    expect(metricsScreen).toContain("private struct MetricsInsightStrip");
    expect(metricsScreen).toContain("MetricsInsightCard(");
    expect(metricsScreen).toContain("async let overviewFetch = client.metricsOverview()");
    expect(metricsScreen).toContain("let overview = try await overviewFetch");
    expect(metricsScreen).toContain("lastUpdated = Date()");
    expect(metricsScreen).toContain(".cybaraGlass(cornerRadius: 18)");
    expect(metricsScreen).toContain(".redacted(reason: .placeholder)");
    expect(metricsScreen).toContain("NativeSessionRuntimePagination");
    expect(metricsScreen).toContain("loadSessionRuntime(page: page)");
    expect(metricsScreen).toContain("pagination.hasNextPage");
  });

  test("native journey uses glass timeline sections with loading and empty states", () => {
    const journeyScreen = readFileSync(join(MACOS_APP_DIR, "JourneyScreen.swift"), "utf8");

    expect(journeyScreen).toContain("ScreenHeader(");
    expect(journeyScreen).toContain("JourneyLoadingSkeleton()");
    expect(journeyScreen).toContain("recentCount: journey.events.filter");
    expect(journeyScreen).toContain("accentTint: accentTint");
    expect(journeyScreen).toContain("JourneyTimeline(groups: grouped, accentTint: accentTint)");
    expect(journeyScreen).toContain("private struct JourneyDaySection");
    expect(journeyScreen).toContain("private struct JourneyTimelineRow");
    expect(journeyScreen).toContain("GlassCard {");
    expect(journeyScreen).toContain('Label(day, systemImage: "calendar")');
    expect(journeyScreen).toContain("Rectangle()");
    expect(journeyScreen).toContain("Color.primary.opacity(0.10)");
    expect(journeyScreen).toContain("private struct JourneyEmptyState");
  });

  test("native skills screen supports status, local creation, registry browse, and install parity", () => {
    const contentView = readFileSync(join(MACOS_APP_DIR, "ContentView.swift"), "utf8");
    const gatewayModels = readGatewayModelsSource();
    const gatewayClient = readFileSync(join(MACOS_APP_DIR, "GatewayClient.swift"), "utf8");
    const skillsScreen = readFileSync(join(MACOS_APP_DIR, "NativeSkillsScreen.swift"), "utf8");

    expect(contentView).toContain("NativeSkillsScreen(client: client)");
    expect(gatewayModels).toContain("struct GatewaySkillStatus");
    expect(gatewayModels).toContain("struct GatewaySkillsStatusResponse");
    expect(gatewayModels).toContain("struct GatewayRegistrySkill");
    expect(gatewayModels).toContain("struct GatewaySkillInstallResult");
    expect(gatewayClient).toContain("func skillsStatus()");
    expect(gatewayClient).toContain('get("api/skills/status"');
    expect(gatewayClient).toContain("func createSkill(");
    expect(gatewayClient).toContain('request("api/skills", method: "POST"');
    expect(gatewayClient).toContain("func skillsRegistryBrowse(");
    expect(gatewayClient).toContain('"api/skills/registry/browse"');
    expect(gatewayClient).toContain("func skillsRegistrySearch(");
    expect(gatewayClient).toContain('"api/skills/registry/search"');
    expect(gatewayClient).toContain("func installSkill(");
    expect(gatewayClient).toContain('"api/skills/install"');
    expect(skillsScreen).toContain('Label("Installed", systemImage: "wand.and.stars")');
    expect(skillsScreen).toContain('Label("Registry", systemImage: "shippingbox")');
    expect(skillsScreen).toContain("NativeAddSkillSheet");
    expect(skillsScreen).toContain("NativeSkillDetailSheet");
    expect(skillsScreen).toContain("NativeRegistrySkillRow");
    expect(skillsScreen).toContain("Install Anyway");
    expect(skillsScreen).toContain("Missing Requirements");
    expect(skillsScreen).toContain("client.skillsStatus()");
    expect(skillsScreen).toContain("client.skillsRegistryBrowse(");
    expect(skillsScreen).toContain("client.skillsRegistrySearch(");
    expect(skillsScreen).toContain("client.installSkill(");
    expect(skillsScreen).toContain("client.createSkill(");
    expect(skillsScreen).not.toContain("CybaraWebView");
  });

  test("native chat sidebar groups sessions compactly by workspace", () => {
    const nativeScreens = readNativeChatSource();

    expect(nativeScreens).toContain("struct NativeSessionGroup");
    expect(nativeScreens).toContain("collapsedSessionGroupIDs");
    expect(nativeScreens).toContain("toggleSessionGroup(group.id)");
    expect(nativeScreens).toContain("if $0.kind == .workspace && $1.kind == .unassigned");
    expect(nativeScreens).toContain("func sessionListTooltip(for session: GatewaySession)");
    expect(nativeScreens).toContain(".help(sessionListTooltip(for: session))");
    expect(nativeScreens).toContain("sessionListRow(for: session)");
    expect(nativeScreens).toContain(
      "compactRelativeTimestamp(session.updated_at ?? session.created_at)"
    );
    expect(nativeScreens).toContain("loadActiveGitBranch()");
    expect(nativeScreens).toContain("activeGitBranchLabel");
    expect(nativeScreens).toContain("gitBranchPicker");
    expect(nativeScreens).toContain("Search branches");
    expect(nativeScreens).toContain("New branch name");
    expect(nativeScreens).toContain("changeGitBranch(");
    expect(nativeScreens).toContain('parts.append("Branch \\(branch)")');
    expect(nativeScreens).toContain(".task(id: activeWorkspaceDir)");
    expect(nativeScreens).toContain("activeSessionIDs: Set<String>");
    expect(nativeScreens).toContain("updateActiveSessionIDs(from: event)");
    expect(nativeScreens).toContain("activeSessionIDs.contains(session.id)");
    expect(nativeScreens).toContain("pinnedWorkspaceGroupIDs");
    expect(nativeScreens).toContain("hoveredSessionGroupID");
    expect(nativeScreens).toContain(".onHover { hovering in");
    expect(nativeScreens).toContain("toggleWorkspaceProjectPin(group.id)");
    expect(nativeScreens).toContain("revealWorkspaceProject(workspaceDir)");
    expect(nativeScreens).toContain(
      "NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: workspaceDir)"
    );
    expect(nativeScreens).not.toContain("Text(sessionListDetail(for: session");
  });

  test("native chat environment reads git branch through the gateway client", () => {
    const gatewayClient = readFileSync(join(MACOS_APP_DIR, "GatewayClient.swift"), "utf8");
    const gatewayModels = readGatewayModelsSource();

    expect(gatewayClient).toContain("func gitBranch(path: String) async throws -> String?");
    expect(gatewayClient).toContain("func gitBranches(path: String) async throws");
    expect(gatewayClient).toContain("func checkoutGitBranch(");
    expect(gatewayClient).toContain('"api/git/branches"');
    expect(gatewayClient).toContain('"api/git/branch"');
    expect(gatewayClient).toContain('URLQueryItem(name: "path", value: workspace)');
    expect(gatewayModels).toContain("struct GatewayGitBranchResponse");
    expect(gatewayModels).toContain("struct GatewayGitBranchesResponse");
    expect(gatewayModels).toContain("struct GatewayGitBranchCheckoutResponse");
    expect(gatewayModels).toContain("let branch: String?");
  });

  test("native chat file changes dedupe activity and structured tool paths", () => {
    const nativeScreens = readNativeChatSource();

    expect(nativeScreens).toContain("func pathKey(_ path: String) -> String");
    expect(nativeScreens).toContain("func matchingKey(_ path: String) -> String?");
    expect(nativeScreens).toContain('resultObject?["change"].flatMap');
    expect(nativeScreens).toContain('key.hasSuffix("/\\(candidate)")');
    expect(nativeScreens).toContain("existing.added + existing.removed > 0");
  });

  test("gateway model labels trim blank titles before falling back", () => {
    const gatewayModels = readGatewayModelsSource();
    const modelTests = readGatewayModelTestsSource();

    expect(gatewayModels).toContain("func firstNonEmptyGatewayString");
    expect(gatewayModels).toContain("var displayTitle: String {");
    expect(gatewayModels).toContain("gatewaySessionDisplayTitle(");
    expect(gatewayModels).toContain("prefixes: [agent_name, agent_id],");
    expect(gatewayModels).toContain("func gatewaySessionDisplayTitle(");
    expect(gatewayModels).toContain(
      "var displayName: String { firstNonEmptyGatewayString(name, provider, id) ?? id }"
    );
    expect(gatewayModels).toContain(
      "var displayName: String { firstNonEmptyGatewayString(name, type, id) ?? id }"
    );
    expect(modelTests).toContain("testSessionDisplayTitleFallsBackForBlankOrMissingTitle");
    expect(modelTests).toContain("testProviderDisplayNamePrefersFirstNonEmptyGatewayLabel");
    expect(modelTests).toContain("testChannelDisplayNamePrefersFirstNonEmptyGatewayLabel");
  });

  test("native chat requests complete tool call payloads for transcripts", () => {
    const gatewayClient = readFileSync(join(MACOS_APP_DIR, "GatewayClient.swift"), "utf8");
    const gatewayModels = readGatewayModelsSource();
    const toolTimeline = readFileSync(join(MACOS_APP_DIR, "NativeToolTimeline.swift"), "utf8");
    const nativeScreens = readNativeChatSource();

    expect(gatewayClient).toContain('URLQueryItem(name: "includeFullToolCalls", value: "1")');
    expect(gatewayModels).toContain("let tool_calls: [GatewayToolCall]?");
    expect(gatewayModels).toContain("let process_activities: [GatewayProcessActivity]?");
    expect(toolTimeline).toContain("func nativeOrderedToolCalls");
    expect(toolTimeline).toContain("func nativeToolActivities");
    expect(nativeScreens).toContain("NativeToolTimelineView(");
    expect(nativeScreens).toContain("message: message,");
  });

  test("native chat activity rows render markdown thoughts with neutral icons", () => {
    const toolTimeline = readFileSync(join(MACOS_APP_DIR, "NativeToolTimeline.swift"), "utf8");

    expect(toolTimeline).toContain("private func nativeActivityMarkdownText");
    expect(toolTimeline).toContain("nativeActivityMarkdownText(activity.text)");
    expect(toolTimeline).toContain("nativeActivityMarkdownText(displayCurrentStep)");
    expect(toolTimeline).toContain("Circle()");
    expect(toolTimeline).toContain(".fill(.secondary)");
    expect(toolTimeline).toContain(".foregroundStyle(.secondary)");
    expect(toolTimeline).not.toContain('if activity.toolName == "__thought" { return "sparkles" }');
    expect(toolTimeline).not.toContain(".foregroundStyle(.green)");
    expect(toolTimeline).toContain('return "pencil"');
    expect(toolTimeline).toContain('return "doc.text"');
    expect(toolTimeline).toContain('return "magnifyingglass"');
    expect(toolTimeline).toContain('return "terminal"');
    expect(toolTimeline).toContain("Image(systemName: nativeGroupIcon(items))");
  });

  test("native chat strips assistant reasoning markup without altering user messages", () => {
    const gatewayModels = readGatewayModelsSource();
    const markdown = readFileSync(join(MACOS_APP_DIR, "NativeMarkdown.swift"), "utf8");
    const markdownViews = readFileSync(join(MACOS_APP_DIR, "NativeMarkdownViews.swift"), "utf8");
    const nativeScreens = readNativeChatSource();

    expect(markdown).toContain("stripAssistantMarkupTags");
    expect(markdown).toContain("NativeAssistantMarkupResult");
    expect(markdownViews).toContain("NativeMarkdown.parse(content, stripAssistantMarkup: !isUser)");
    expect(gatewayModels).toContain("normalizedContentAndThinking(role:");
    expect(gatewayModels).toContain('guard role.lowercased() == "assistant"');
    // The live streamed-answer body is no longer rendered during a run (only the
    // timeline/status shows), so there is no streamingContent markdown view to
    // strip; assistant reasoning markup is stripped on the persisted message
    // via NativeMarkdown.parse(stripAssistantMarkup:) above.
    expect(nativeScreens).not.toContain("NativeMarkdownView(content: visibleStreamingContent");
  });

  test("native memory screen uses gateway CRUD/search routes with encoded filenames", () => {
    const gatewayClient = readFileSync(join(MACOS_APP_DIR, "GatewayClient.swift"), "utf8");
    const gatewayModels = readGatewayModelsSource();
    const configScreens = readNativeConfigSource();
    const modelTests = readGatewayModelTestsSource();

    expect(gatewayClient).toContain("func pathSegment");
    expect(gatewayClient).toContain('allowed.remove(charactersIn: "/")');
    expect(gatewayClient).toContain('try await get("api/memory", as: GatewayMemoryList.self)');
    expect(gatewayClient).toContain('"api/memory/search"');
    expect(gatewayClient).toContain("GatewayMemorySearchResponse.self");
    expect(gatewayClient).toContain('"api/memory/\\(pathSegment(file))"');
    expect(gatewayClient).toContain('method: "PUT"');
    expect(gatewayClient).toContain('method: "DELETE"');

    expect(gatewayModels).toContain("struct GatewayMemoryEntry");
    expect(gatewayModels).toContain("struct GatewayMemoryList");
    expect(gatewayModels).toContain("struct GatewayMemorySearchResponse");
    expect(gatewayModels).toContain("struct GatewayMemoryCreateResponse");

    expect(configScreens).toContain('TextField("Search memory"');
    expect(configScreens).toContain('Button(saving ? "Saving..." : "Add Entry")');
    expect(configScreens).toContain("editingEntry = MemoryEditDraft");
    expect(configScreens).toContain("client.updateMemory(file: draft.file, index: draft.index");
    expect(configScreens).toContain("client.deleteMemory(file: file, index: index)");
    expect(configScreens).toContain("MemoryEditSheet");

    expect(modelTests).toContain("testMemoryListDecodesFilesAndEntries");
    expect(modelTests).toContain("testMemorySearchResponseDecodesGatewayResults");
    expect(modelTests).toContain("testMemoryCreateResponseDecodesGatewaySuccessShape");
  });

  test("native wallet screen exposes user send routes with confirmation", () => {
    const gatewayClient = readFileSync(join(MACOS_APP_DIR, "GatewayClient.swift"), "utf8");
    const configScreens = readNativeConfigSource();

    expect(gatewayClient).toContain('request("api/wallet/send", method: "POST"');
    expect(gatewayClient).toContain('request("api/wallet/send-token", method: "POST"');
    expect(configScreens).toContain('Text("Send")');
    expect(configScreens).toContain('TextField("Recipient address"');
    expect(configScreens).toContain('TextField("Token address or mint"');
    expect(configScreens).toContain('Button(sendingWallet ? "Sending..." : "Review Send")');
    expect(configScreens).toContain("confirmationDialog(");
    expect(configScreens).toContain("client.sendWallet(body)");
    expect(configScreens).toContain("client.sendWalletToken(body)");
  });

  test("native mobile pairing uses gateway connect-info before QR creation", () => {
    const gatewayClient = readFileSync(join(MACOS_APP_DIR, "GatewayClient.swift"), "utf8");
    const gatewayModels = readGatewayModelsSource();
    const mobileScreen = readFileSync(join(MACOS_APP_DIR, "MobileScreen.swift"), "utf8");
    const modelTests = readGatewayModelTestsSource();

    expect(gatewayClient).toContain(
      "func mobileConnectInfo() async throws -> GatewayMobileConnectInfo"
    );
    expect(gatewayClient).toContain('get("api/mobile/connect-info"');
    expect(gatewayModels).toContain("struct GatewayMobileConnectInfo");
    expect(gatewayModels).toContain("let lanAccessEnabled: Bool");
    expect(gatewayModels).toContain("struct GatewayMobileRemoteAccessInfo");
    expect(mobileScreen).toContain("@State private var connectInfo: GatewayMobileConnectInfo?");
    expect(mobileScreen).toContain("private var canCreatePairing: Bool");
    expect(mobileScreen).toContain("client.mobileConnectInfo()");
    expect(mobileScreen).toContain("Network access required");
    expect(mobileScreen).toContain("!canCreatePairing");
    expect(mobileScreen).toContain("Detected URLs");
    expect(modelTests).toContain("testMobileConnectInfoDecodesGatewayReachability");
  });
});
