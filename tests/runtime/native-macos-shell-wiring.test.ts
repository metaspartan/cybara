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
    expect(sidecarCore).not.toContain('environment["CYBARA_HOST"] = "127.0.0.1"');
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

  test("native settings follows the shared grouped settings navigation", () => {
    const settings = readFileSync(join(MACOS_APP_DIR, "NativeSettingsScreen.swift"), "utf8");

    for (const label of [
      'Label("General", systemImage: "switch.2")',
      'Label("Gateway", systemImage: "server.rack")',
      'Label("AI", systemImage: "brain")',
      'Label("Memory", systemImage: "memorychip")',
      'Label("Voice", systemImage: "waveform")',
      'Label("Safety", systemImage: "slider.horizontal.3")',
      'Label("Wallet", systemImage: "creditcard")',
      'Label("Migration", systemImage: "folder.badge.gearshape")',
      'Label("System", systemImage: "square.grid.3x3")',
    ]) {
      expect(settings).toContain(label);
    }

    expect(settings).toContain("WalletScreen(client: client).tabItem");
    expect(settings).toContain("appearanceSettingsCard");
    expect(settings).not.toContain("appearanceTab.tabItem");
    expect(settings).not.toContain('Label("Advanced"');
    expect(settings).not.toContain('case .wallet: return "Wallet"');
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
    expect(managementClient).toContain("gatewayPassword: String? = nil");
    expect(managementClient).toContain('"gatewayPassword"] = gatewayPassword');
    expect(managementClient).toContain('"clearGatewayPassword"] = true');
    expect(managementClient).toContain('request("api/auth/settings", method: "PUT"');
    expect(gatewayClient).toContain('"X-Cybara-Gateway-Password"');
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
    expect(settings).toContain("Gateway Password");
    expect(settings).toContain(
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
    expect(gatewayModels).toContain("let manualPlanEditable: Bool");
    expect(gatewayModels).toContain("let automaticTrackingLabel: String?");
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
    expect(nativeScreens).toContain("providerPlanStatus: ProviderPlanStatusResponse?");
    expect(nativeScreens).toContain("private var activeProviderPlan: ProviderPlanSnapshot?");
    expect(nativeScreens).toContain("private var providerPlanText: String?");
    expect(nativeScreens).toContain("private var providerPlanUsageRows");
    expect(nativeScreens).toContain("NativeContextProviderPlanUsageBar");
    expect(nativeScreens).toContain("nativeContextProviderPlanUsageTint");
    expect(nativeScreens).toContain("if percent < 40 { return .green }");
    expect(nativeScreens).toContain("if percent < 65 { return .blue }");
    expect(nativeScreens).toContain("if percent < 80 { return .yellow }");
    expect(nativeScreens).toContain("if percent < 95 { return .orange }");
    expect(nativeScreens).toContain("client.providerPlanStatus()");
    expect(nativeScreens).toContain("pendingAgentSessionID = selectedSessionID");
    expect(nativeScreens).toContain("private func changeChatAgent(_ agentID: String) async");
    expect(nativeScreens).toContain(
      "agentId: selectedChatAgentID.isEmpty ? nil : selectedChatAgentID"
    );
  });

  test("native provider plan editors respect automatic provider-managed plans", () => {
    const providersScreen = readFileSync(
      join(MACOS_APP_DIR, "NativeProvidersScreen.swift"),
      "utf8"
    );
    const configScreens = readFileSync(join(MACOS_APP_DIR, "NativeConfigScreens.swift"), "utf8");

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
      "Live provider usage is used for routing. No manual plan limits are needed."
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
    expect(metricsScreen).toContain("private struct NativeProviderPlanWindowRow");
    expect(metricsScreen).toContain("private struct MetricsPlanWindowList");
    expect(metricsScreen).toContain('Text("Automatic Plan Windows")');
    expect(metricsScreen).toContain('Label(row.unlimited ? "Unlimited"');
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
  });

  test("native journey uses glass timeline sections with loading and empty states", () => {
    const journeyScreen = readFileSync(join(MACOS_APP_DIR, "JourneyScreen.swift"), "utf8");

    expect(journeyScreen).toContain("ScreenHeader(");
    expect(journeyScreen).toContain("JourneyLoadingSkeleton()");
    expect(journeyScreen).toContain("JourneyStatsRow(counts: journey.counts)");
    expect(journeyScreen).toContain("JourneyTimeline(groups: grouped)");
    expect(journeyScreen).toContain("private struct JourneyDaySection");
    expect(journeyScreen).toContain("private struct JourneyTimelineRow");
    expect(journeyScreen).toContain("GlassCard {");
    expect(journeyScreen).toContain('Label(day, systemImage: "calendar")');
    expect(journeyScreen).toContain("Rectangle()");
    expect(journeyScreen).toContain("Color.primary.opacity(0.10)");
    expect(journeyScreen).toContain("private struct JourneyEmptyState");
  });

  test("native chat sidebar groups sessions compactly by workspace", () => {
    const nativeScreens = readFileSync(join(MACOS_APP_DIR, "NativeScreens.swift"), "utf8");

    expect(nativeScreens).toContain("private struct NativeSessionGroup");
    expect(nativeScreens).toContain("collapsedSessionGroupIDs");
    expect(nativeScreens).toContain("toggleSessionGroup(group.id)");
    expect(nativeScreens).toContain("if $0.kind == .workspace && $1.kind == .unassigned");
    expect(nativeScreens).toContain("private func sessionListTooltip(for session: GatewaySession)");
    expect(nativeScreens).toContain(".help(sessionListTooltip(for: session))");
    expect(nativeScreens).toContain("sessionListRow(for: session)");
    expect(nativeScreens).toContain(
      "compactRelativeTimestamp(session.updated_at ?? session.created_at)"
    );
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
    const gatewayModels = readFileSync(join(MACOS_APP_DIR, "GatewayModels.swift"), "utf8");
    const toolTimeline = readFileSync(join(MACOS_APP_DIR, "NativeToolTimeline.swift"), "utf8");
    const nativeScreens = readFileSync(join(MACOS_APP_DIR, "NativeScreens.swift"), "utf8");

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
