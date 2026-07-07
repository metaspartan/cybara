import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MACOS_APP_DIR = join(ROOT_DIR, "apps", "macos", "Cybara", "Sources", "Cybara");

describe("native macOS shell wiring", () => {
  test("sidecar manager reuses gateway port 4269 and configures a managed local launch", () => {
    const sidecarManager = readFileSync(join(MACOS_APP_DIR, "SidecarManager.swift"), "utf8");
    const sidecarCore = readFileSync(join(MACOS_APP_DIR, "SidecarCore.swift"), "utf8");

    expect(sidecarManager).toContain("CYBARA_NATIVE_PORT");
    expect(sidecarManager).toContain("SidecarCore.port(fromEnv:");
    expect(sidecarCore).toContain("public static let defaultPort = 4269");
    expect(sidecarManager).toContain("Attached to existing Cybara gateway");
    expect(sidecarCore).toContain('environment["PORT"] = String(port)');
    expect(sidecarCore).toContain('environment["CYBARA_HOST"] = "127.0.0.1"');
    expect(sidecarManager).toContain('arguments = ["start"]');
    expect(sidecarManager).not.toContain('arguments = ["start", "--enable-terminal"]');
    expect(sidecarCore).toContain("ancestorDirectories(from: currentDirectory)");
    expect(sidecarCore).toContain("ancestorDirectories(from: executableDirectory)");
    expect(sidecarCore).toContain('bundledSidecar.appendingPathComponent("cybara").path');
    expect(sidecarManager).toContain("gatewayMode = .managed");
    expect(sidecarManager).toContain("gatewayMode = .attached");
  });

  test("webview injects the cybara native runtime bridge and notification support", () => {
    const webView = readFileSync(join(MACOS_APP_DIR, "CybaraWebView.swift"), "utf8");

    expect(webView).toContain("__CYBARA_NATIVE__");
    expect(webView).toContain('runtime: "cybara-native"');
    expect(webView).toContain("requestNotificationPermission");
    expect(webView).toContain("notificationPermission");
    expect(webView).toContain("openDirectoryDialog");
    expect(webView).toContain("NSOpenPanel");
    expect(webView).toContain("UNUserNotificationCenter");
    expect(webView).toContain('document.documentElement.dataset.runtime = "cybara-native"');
  });

  test("native logo loading does not call SwiftPM Bundle.module at app startup", () => {
    const brand = readFileSync(join(MACOS_APP_DIR, "CybaraBrand.swift"), "utf8");

    expect(brand).not.toContain("Bundle.module");
    expect(brand).toContain('appendingPathComponent("Resources"');
    expect(brand).toContain("Cybara_Cybara.bundle");
    expect(brand).toContain("logoURLCandidates");
  });

  test("native settings centers its content column and keeps cards left-aligned", () => {
    const settings = readFileSync(join(MACOS_APP_DIR, "NativeSettingsScreen.swift"), "utf8");

    expect(settings).toContain("static let maxContentWidth: CGFloat = 900");
    expect(settings).toContain(
      ".frame(maxWidth: NativeSettingsLayout.maxContentWidth, maxHeight: .infinity, alignment: .topLeading)"
    );
    expect(settings).toContain(
      ".frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)"
    );
    expect(settings).toContain(".frame(maxWidth: .infinity, alignment: .top)");
    expect(settings).not.toContain(".frame(maxWidth: .infinity, alignment: .topLeading)");
  });

  test("native settings has a Memory tab with provider picker and indexing split", () => {
    const settings = readFileSync(join(MACOS_APP_DIR, "NativeSettingsScreen.swift"), "utf8");
    const gatewayClient = readFileSync(join(MACOS_APP_DIR, "GatewayClient.swift"), "utf8");

    expect(settings).toContain('memoryTab.tabItem { Label("Memory", systemImage: "memorychip") }');
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

  test("native logs use bounded paged gateway reads instead of full log downloads", () => {
    const gatewayClient = readFileSync(join(MACOS_APP_DIR, "GatewayClient.swift"), "utf8");
    const gatewayModels = readFileSync(join(MACOS_APP_DIR, "GatewayModels.swift"), "utf8");
    const configScreens = readFileSync(join(MACOS_APP_DIR, "NativeConfigScreens.swift"), "utf8");

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
    const settings = readFileSync(join(MACOS_APP_DIR, "NativeSettingsScreen.swift"), "utf8");
    const sidecarManager = readFileSync(join(MACOS_APP_DIR, "SidecarManager.swift"), "utf8");

    expect(gatewayClient).toContain("func restartGateway() async throws -> [String: Any]");
    expect(gatewayClient).toContain('request("api/system/restart", method: "POST")');
    expect(managementClient).toContain("extension GatewayClient");
    expect(managementClient).toContain("func authSettings() async throws -> [String: Any]");
    expect(managementClient).toContain('rawObject("api/auth/settings")');
    expect(managementClient).toContain("func updateAuthSettings(requireAuthForLocalhost: Bool)");
    expect(managementClient).toContain('request("api/auth/settings", method: "PUT"');
    expect(managementClient).toContain("func revealAuthKey() async throws -> String?");
    expect(managementClient).toContain('rawObject("api/auth/key")');
    expect(managementClient).toContain("func rotateAuthKey() async throws -> String?");
    expect(managementClient).toContain('request("api/auth/rotate-key", method: "POST")');
    expect(settings).toContain('Text("Gateway Logs")');
    expect(settings).toContain("client.systemLogsPage(limit: 80)");
    expect(settings).toContain("Task { await restartGateway() }");
    expect(settings).toContain("try await client.restartGateway()");
    expect(settings).toContain("await sidecar.waitForAttachedGatewayRestart()");
    expect(settings).toContain("Gateway Auth");
    expect(settings).toContain("Rotate Key");
    expect(sidecarManager).toContain("func waitForAttachedGatewayRestart() async");
    expect(sidecarManager).toContain("Waiting for attached Cybara gateway to restart");
  });

  test("native settings exposes OpenClaw and Hermes migration controls", () => {
    const gatewayClient = readFileSync(
      join(MACOS_APP_DIR, "GatewayManagementClient.swift"),
      "utf8"
    );
    const gatewayModels = readFileSync(join(MACOS_APP_DIR, "GatewayModels.swift"), "utf8");
    const settings = readFileSync(join(MACOS_APP_DIR, "NativeSettingsScreen.swift"), "utf8");

    expect(gatewayModels).toContain("struct GatewayMigrationSource");
    expect(gatewayModels).toContain("struct GatewayMigrationReport");
    expect(gatewayClient).toContain("func migrationSources() async throws");
    expect(gatewayClient).toContain('request("api/migrations/sources"');
    expect(gatewayClient).toContain("func previewMigration(body: Data)");
    expect(gatewayClient).toContain('request("api/migrations/preview", method: "POST"');
    expect(gatewayClient).toContain("func runMigration(body: Data)");
    expect(gatewayClient).toContain('request("api/migrations/run", method: "POST"');
    expect(settings).toContain('migrationTab.tabItem { Label("Migration"');
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
    const nativeScreens = readFileSync(join(MACOS_APP_DIR, "NativeScreens.swift"), "utf8");
    const toolTimeline = readFileSync(join(MACOS_APP_DIR, "NativeToolTimeline.swift"), "utf8");
    const gatewayModels = readFileSync(join(MACOS_APP_DIR, "GatewayModels.swift"), "utf8");

    expect(gatewayClient).toContain("func reorderPendingMessages(");
    expect(gatewayClient).toContain("func updatePendingMessage(");
    expect(gatewayClient).toContain("func deletePendingMessage(");
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
    expect(nativeScreens).toContain(
      "processActivities: nativeSteeringProcessActivityPayloads(from: liveActivities)"
    );
  });

  test("native chat prunes live tool rows after persisted steering reloads", () => {
    const nativeScreens = readFileSync(join(MACOS_APP_DIR, "NativeScreens.swift"), "utf8");
    const toolTimeline = readFileSync(join(MACOS_APP_DIR, "NativeToolTimeline.swift"), "utf8");

    expect(toolTimeline).toContain("func nativePrunePersistedLiveActivities(");
    expect(toolTimeline).toContain("nativeActivityDedupeKey(");
    expect(nativeScreens).toContain("let detail = try await client.sessionDetail(id)");
    expect(nativeScreens).toContain("liveActivities = nativePrunePersistedLiveActivities(");
    expect(nativeScreens).toContain("await loadMessages(selectedSessionID)");
    expect(nativeScreens).not.toContain("messages.append(response.message");
  });

  test("native chat keeps visible live work when queued snapshots are activity-empty", () => {
    const nativeScreens = readFileSync(join(MACOS_APP_DIR, "NativeScreens.swift"), "utf8");

    expect(nativeScreens).toContain(
      "let snapshotActivities = nativeLiveActivities(from: snapshot)"
    );
    expect(nativeScreens).toContain(
      "let preservingLocalLiveActivities = snapshotActivities.isEmpty && !liveActivities.isEmpty"
    );
    expect(nativeScreens).toContain("!preservingLocalLiveActivities,");
    expect(nativeScreens).toContain('"queued follow-up"');
  });

  test("native chat composer exposes agent switching and context usage", () => {
    const gatewayClient = readFileSync(join(MACOS_APP_DIR, "GatewayClient.swift"), "utf8");
    const gatewayModels = readFileSync(join(MACOS_APP_DIR, "GatewayModels.swift"), "utf8");
    const nativeScreens = readFileSync(join(MACOS_APP_DIR, "NativeScreens.swift"), "utf8");

    expect(gatewayModels).toContain("struct GatewaySessionContextUsage");
    expect(gatewayModels).toContain("let contextUsage: GatewaySessionContextUsage?");
    expect(gatewayModels).toContain("let messagesList: [GatewaySessionMessage]?");
    expect(gatewayClient).toContain("func sessionDetail(_ id: String)");
    expect(gatewayClient).toContain("func updateSessionAgent(");
    expect(gatewayClient).toContain('request("api/sessions/\\(id)/agent", method: "PUT"');
    expect(nativeScreens).toContain("private var composerControls: some View");
    expect(nativeScreens).toContain("private var composerSecurityControls: some View");
    expect(nativeScreens).toContain('Label("Always Allow", systemImage: "exclamationmark.shield")');
    expect(nativeScreens).toContain('Label("Ask Me", systemImage: "questionmark.circle")');
    expect(nativeScreens).toContain("private var toolApprovalIconName: String");
    expect(nativeScreens).toContain("private var toolApprovalColor: Color");
    expect(nativeScreens).toContain("try await client.updateAppConfig(body)");
    expect(nativeScreens).toContain('"tool_approval_mode": normalized');
    expect(nativeScreens).toContain('Picker("Agent", selection: agentSelectionBinding)');
    expect(nativeScreens).toContain(".frame(width: 176)");
    expect(nativeScreens).toContain("private var contextUsageText: String");
    expect(nativeScreens).toContain("private var contextUsagePopover: some View");
    expect(nativeScreens).toContain("pendingAgentSessionID = selectedSessionID");
    expect(nativeScreens).toContain("private func changeChatAgent(_ agentID: String) async");
    expect(nativeScreens).toContain(
      "agentId: selectedChatAgentID.isEmpty ? nil : selectedChatAgentID"
    );
  });

  test("gateway model labels trim blank titles before falling back", () => {
    const gatewayModels = readFileSync(join(MACOS_APP_DIR, "GatewayModels.swift"), "utf8");
    const modelTests = readFileSync(
      join(
        ROOT_DIR,
        "apps",
        "macos",
        "Cybara",
        "Tests",
        "CybaraTests",
        "GatewayClientModelTests.swift"
      ),
      "utf8"
    );

    expect(gatewayModels).toContain("func firstNonEmptyGatewayString");
    expect(gatewayModels).toContain(
      "var displayTitle: String { firstNonEmptyGatewayString(title) ?? String(id.prefix(8)) }"
    );
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
    const gatewayModels = readFileSync(join(MACOS_APP_DIR, "GatewayModels.swift"), "utf8");
    const toolTimeline = readFileSync(join(MACOS_APP_DIR, "NativeToolTimeline.swift"), "utf8");
    const nativeScreens = readFileSync(join(MACOS_APP_DIR, "NativeScreens.swift"), "utf8");

    expect(gatewayClient).toContain('URLQueryItem(name: "includeFullToolCalls", value: "1")');
    expect(gatewayModels).toContain("let tool_calls: [GatewayToolCall]?");
    expect(gatewayModels).toContain("let process_activities: [GatewayProcessActivity]?");
    expect(toolTimeline).toContain("func nativeOrderedToolCalls");
    expect(toolTimeline).toContain("func nativeToolActivities");
    expect(nativeScreens).toContain("NativeToolTimelineView(message: message)");
  });

  test("native chat strips assistant reasoning markup without altering user messages", () => {
    const gatewayModels = readFileSync(join(MACOS_APP_DIR, "GatewayModels.swift"), "utf8");
    const markdown = readFileSync(join(MACOS_APP_DIR, "NativeMarkdown.swift"), "utf8");
    const markdownViews = readFileSync(join(MACOS_APP_DIR, "NativeMarkdownViews.swift"), "utf8");
    const nativeScreens = readFileSync(join(MACOS_APP_DIR, "NativeScreens.swift"), "utf8");

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
    const gatewayModels = readFileSync(join(MACOS_APP_DIR, "GatewayModels.swift"), "utf8");
    const configScreens = readFileSync(join(MACOS_APP_DIR, "NativeConfigScreens.swift"), "utf8");
    const modelTests = readFileSync(
      join(
        ROOT_DIR,
        "apps",
        "macos",
        "Cybara",
        "Tests",
        "CybaraTests",
        "GatewayClientModelTests.swift"
      ),
      "utf8"
    );

    expect(gatewayClient).toContain("private func pathSegment");
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
    const configScreens = readFileSync(join(MACOS_APP_DIR, "NativeConfigScreens.swift"), "utf8");

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
});
