import AppKit
import SwiftUI

private enum NativeSettingsLayout {
    static let outerPadding = EdgeInsets(top: 20, leading: 22, bottom: 20, trailing: 22)
    static let contentInset = EdgeInsets(top: 10, leading: 2, bottom: 16, trailing: 2)
    static let cardSpacing: CGFloat = 12
    static let maxContentWidth: CGFloat = 900
}

private extension View {
    func nativeSettingsContentLayout() -> some View {
        self
            .padding(NativeSettingsLayout.contentInset)
            .frame(maxWidth: NativeSettingsLayout.maxContentWidth, alignment: .topLeading)
            .frame(maxWidth: .infinity, alignment: .top)
    }
}

struct NativeSettingsScreen: View {
    let client: GatewayClient
    var onAccentChanged: (String) -> Void = { _ in }

    @EnvironmentObject private var sidecar: SidecarManager

    @State private var selectedTab: SettingsTab = .general
    @State private var advancedSelection: SettingsAdvancedSection = .router
    @AppStorage("cybara.petEnabled") private var petEnabled = false
    @State private var health: GatewayHealth?
    @State private var config: [String: Any] = [:]
    @State private var providers: [GatewayProvider] = []
    @State private var agents: [GatewayAgent] = []
    @State private var backgroundAgentId = ""
    @State private var gatewayLogs: [GatewayLogEntry] = []
    @State private var gatewayRestarting = false
    @State private var selectedAccent = "indigo"
    @State private var defaultModel = ""
    @State private var reasoningEffort = ""
    @State private var terminalEnabled = false
    @State private var selfImprovingSkills = true
    @State private var dangerousPolicyEnabled = false
    @State private var dangerousPolicyMode = "audit"
    @State private var toolApprovalMode = "always_allow"
    @State private var sandboxEnabled = false
    @State private var sandboxProvider = "auto"
    @State private var sandboxNetwork = "deny"
    @State private var speechTTSProvider = "auto"
    @State private var speechTTSProviderId = ""
    @State private var speechTTSModel = ""
    @State private var speechTTSVoice = ""
    @State private var speechTTSFormat = "mp3"
    @State private var speechTTSFallback = true
    @State private var speechSTTProvider = "auto"
    @State private var speechSTTProviderId = ""
    @State private var speechSTTModel = ""
    @State private var speechSTTLanguage = ""
    @State private var memoryBackgroundReview = true
    @State private var memoryFlushEnabled = true
    @State private var memoryFlushThreshold = "4000"
    @State private var llmFirstTokenSeconds = "300"
    @State private var llmStallSeconds = "300"
    @State private var llmTotalSeconds = "0"
    @State private var llmNonStreamingSeconds = "1800"
    @State private var memoryProvider = "local"
    @State private var memoryAutoRecall = true
    @State private var memoryAutoCapture = true
    @State private var memoryProviderFields: [String: String] = [:]
    @State private var memoryTestResult: String?
    @State private var memoryTestOK = false
    @State private var memoryTesting = false
    @State private var indexEnabled = false
    @State private var indexSemantic = false
    @State private var indexHidden = false
    @State private var indexAutoReindex = false
    @State private var indexEmbeddingProvider = "auto"
    @State private var indexEmbeddingModel = ""
    @State private var savingKey: String?
    @State private var copiedURL = false
    @State private var error: String?
    @State private var authKeyPreview = ""
    @State private var authKeySource = ""
    @State private var authRequireLocalhost = false
    @State private var authRequireForced = false
    @State private var authGatewayPasswordEnabled = false
    @State private var gatewayPasswordDraft = ""
    @State private var gatewayPasswordConfirm = ""
    @State private var remoteAccessEnabled = false
    @State private var remoteAccessMode = "private_overlay"
    @State private var remoteAccessProvider = "tailscale"
    @State private var remoteAccessBaseURL = ""
    @State private var remoteAccessMessage = ""
    @State private var remoteAccessReady = false
    @State private var authAvailable = false
    @State private var authRevealedKey: String?
    @State private var authCopied = false
    @State private var authBusy = false
    @State private var showRotateConfirm = false
    @State private var defaultWorkspaceDir = ""
    @State private var cybaraDataDir = ""
    @State private var configuredCybaraDataDir = ""
    @State private var cybaraDataDirSource = "default"
    @State private var cybaraDataDirForced = false
    @State private var cybaraDataDirRestartRequired = false
    @State private var cybaraDataDirOverrideFile = ""
    @State private var defaultCybaraDataDir = ""
    @State private var migrationSources: [GatewayMigrationSource] = []
    @State private var migrationSourceKind = "openclaw"
    @State private var migrationSourcePath = ""
    @State private var migrationPreset = "user-data"
    @State private var migrationSkillConflict = "skip"
    @State private var migrationWorkspaceTarget = ""
    @State private var migrationImportSecrets = false
    @State private var migrationOverwrite = false
    @State private var migrationBusy = false
    @State private var migrationReport: GatewayMigrationReport?
    @State private var migrationMessage: String?

    private var availableModels: [String] {
        Array(Set(providers.flatMap { $0.models ?? [] })).sorted()
    }

    private var ttsProviderAccounts: [GatewayProvider] {
        providers.filter { provider in
            ["elevenlabs", "openai", "openai-codex"].contains(provider.providerType)
        }
    }

    private var sttProviderAccounts: [GatewayProvider] {
        providers.filter { provider in
            ["openai", "openai-codex"].contains(provider.providerType)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ScreenHeader(title: NativeI18n.t("nav.settings"), subtitle: NativeI18n.t("settings.subtitle"))

            TabView(selection: $selectedTab) {
                generalTab.tabItem { Label(NativeI18n.t("settings.general"), systemImage: "switch.2") }.tag(SettingsTab.general)
                gatewayTab.tabItem { Label(NativeI18n.t("settings.gateway"), systemImage: "server.rack") }.tag(SettingsTab.gateway)
                modelTab.tabItem { Label(NativeI18n.t("settings.ai"), systemImage: "brain") }.tag(SettingsTab.model)
                memoryTab.tabItem { Label(NativeI18n.t("nav.memory"), systemImage: "memorychip") }.tag(SettingsTab.memory)
                speechTab.tabItem { Label(NativeI18n.t("settings.voice"), systemImage: "waveform") }.tag(SettingsTab.speech)
                featuresTab.tabItem { Label(NativeI18n.t("settings.safety"), systemImage: "slider.horizontal.3") }.tag(SettingsTab.features)
                WalletScreen(client: client).tabItem { Label(NativeI18n.t("nav.wallet"), systemImage: "creditcard") }.tag(SettingsTab.wallet)
                migrationTab.tabItem { Label(NativeI18n.t("settings.migration"), systemImage: "folder.badge.gearshape") }.tag(SettingsTab.migration)
                advancedTab.tabItem { Label(NativeI18n.t("nav.system"), systemImage: "square.grid.3x3") }.tag(SettingsTab.advanced)
            }

            if let error {
                Text(error)
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(NativeSettingsLayout.outerPadding)
        .frame(maxWidth: NativeSettingsLayout.maxContentWidth, maxHeight: .infinity, alignment: .topLeading)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .task(id: sidecar.isReady) { await load() }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                guard sidecar.isReady, !authBusy else { continue }
                if let auth = try? await client.authSettings(), auth["success"] as? Bool == true {
                    readAuthSettings(auth)
                    authAvailable = true
                }
                if let page = try? await client.systemLogsPage(limit: 80) {
                    gatewayLogs = page.logs
                }
            }
        }
    }

    private var generalTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NativeSettingsLayout.cardSpacing) {
                GlassCard {
                    HStack(spacing: 14) {
                        CybaraLogo(size: 52)
                        VStack(alignment: .leading, spacing: 5) {
                            Text("Cybara")
                                .font(.system(size: 18, weight: .bold, design: .rounded))
                            Text(sidecar.isReady ? "Gateway online" : sidecar.statusMessage)
                                .font(.system(size: 12, design: .rounded))
                                .foregroundStyle(sidecar.isReady ? Color.green : Color.secondary)
                            Text(sidecar.serverURL.absoluteString)
                                .font(.system(size: 11, weight: .medium, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                        }
                        Spacer()
                        StatusPill(status: sidecar.status)
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Desktop")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        settingRow("Gateway status", sidecar.status.title)
                        settingRow("Gateway URL", sidecar.serverURL.absoluteString)
                        HStack(spacing: 10) {
                            Button {
                                NotificationCenter.default.post(name: .cybaraCheckForUpdates, object: nil)
                            } label: {
                                Label("Check for Updates", systemImage: "arrow.down.circle")
                            }
                            .buttonStyle(.borderedProminent)
                        }
                    }
                }

                appearanceSettingsCard
            }
            .nativeSettingsContentLayout()
        }
    }

    private var gatewayTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NativeSettingsLayout.cardSpacing) {
                GlassCard {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack(alignment: .top, spacing: 14) {
                            Image(systemName: sidecar.managesGateway ? "server.rack" : "link")
                                .font(.system(size: 22, weight: .semibold))
                                .foregroundStyle(.secondary)
                                .frame(width: 42, height: 42)
                                .background(Circle().fill(Color.primary.opacity(0.07)))

                            VStack(alignment: .leading, spacing: 5) {
                                Text(sidecar.managesGateway ? "Managed Gateway" : "Attached Gateway")
                                    .font(.system(size: 17, weight: .bold, design: .rounded))
                                Text(sidecar.statusMessage)
                                    .font(.system(size: 12, design: .rounded))
                                    .foregroundStyle(.secondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }

                            Spacer()
                            StatusPill(status: sidecar.status)
                        }

                        Divider().opacity(0.45)

                        settingRow("Server URL", sidecar.serverURL.absoluteString)
                        settingRow("Version", health?.version.map { "v\($0)" } ?? "Unavailable")
                        settingRow("Uptime", uptimeLabel)
                        settingRow("Launch mode", sidecar.managesGateway ? "Managed sidecar" : "Attached gateway")
                        settingRow("Binary", sidecar.binaryPath)
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("Default Workspace")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            Spacer()
                            if savingKey == "default_workspace_dir" {
                                ProgressView().controlSize(.small)
                            }
                        }
                        Text(
                            "New chats, agent prompts, skills status, and system prompt previews use this directory when no session workspace is selected."
                        )
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                        TextField("Default workspace directory", text: $defaultWorkspaceDir)
                            .textFieldStyle(.roundedBorder)
                            .onSubmit {
                                saveConfigPatch(
                                    ["default_workspace_dir": defaultWorkspaceDir],
                                    key: "default_workspace_dir"
                                )
                            }
                        ViewThatFits(in: .horizontal) {
                            HStack(spacing: 10) { defaultWorkspaceButtons }
                            VStack(alignment: .leading, spacing: 10) { defaultWorkspaceButtons }
                        }
                        Text(
                            "This field only changes the workspace default. Use Data Directory below for the gateway data root."
                        )
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.tertiary)
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack(spacing: 10) {
                            Text("Data Directory")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            if cybaraDataDirRestartRequired {
                                Text("Restart required")
                                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                                    .foregroundStyle(.orange)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 3)
                                    .background(Capsule().fill(Color.orange.opacity(0.12)))
                                    .overlay(Capsule().stroke(Color.orange.opacity(0.25), lineWidth: 1))
                            }
                            if cybaraDataDirForced {
                                Text("CYBARA_HOME")
                                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                                    .foregroundStyle(.cyan)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 3)
                                    .background(Capsule().fill(Color.cyan.opacity(0.12)))
                                    .overlay(Capsule().stroke(Color.cyan.opacity(0.25), lineWidth: 1))
                            }
                            Spacer()
                            if savingKey == "cybara_data_dir" {
                                ProgressView().controlSize(.small)
                            }
                        }
                        Text(
                            "Stores gateway config, database, API keys, memory, logs, skills, and local media."
                        )
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                        TextField("Configured data directory", text: $configuredCybaraDataDir)
                            .textFieldStyle(.roundedBorder)
                            .disabled(cybaraDataDirForced || savingKey == "cybara_data_dir")
                            .onSubmit {
                                saveCybaraDataDirectory()
                            }
                        ViewThatFits(in: .horizontal) {
                            HStack(spacing: 10) { dataDirectoryButtons }
                            VStack(alignment: .leading, spacing: 10) { dataDirectoryButtons }
                        }
                        Divider().opacity(0.45)
                        settingRow("Active now", cybaraDataDir.isEmpty ? "Unavailable" : cybaraDataDir)
                        if !configuredCybaraDataDir.isEmpty && configuredCybaraDataDir != cybaraDataDir {
                            settingRow("After restart", configuredCybaraDataDir)
                        }
                        settingRow("Source", cybaraDataDirSource)
                        if !defaultCybaraDataDir.isEmpty {
                            settingRow("Default", defaultCybaraDataDir)
                        }
                        if !cybaraDataDirOverrideFile.isEmpty && !cybaraDataDirForced {
                            settingRow("Override file", cybaraDataDirOverrideFile)
                        }
                        if cybaraDataDirForced {
                            Text("Unset CYBARA_HOME before launch to manage this path from Settings.")
                                .font(.system(size: 11, design: .rounded))
                                .foregroundStyle(.tertiary)
                        }
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Runtime Controls")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        Text(sidecar.managesGateway ? "Restart the managed sidecar process." : "Ask the attached gateway to restart itself, then wait for it to become healthy again.")
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                        ViewThatFits(in: .horizontal) {
                            HStack(spacing: 10) { gatewayControlButtons }
                            VStack(alignment: .leading, spacing: 10) { gatewayControlButtons }
                        }
                    }
                }

                if authAvailable {
                    GlassCard {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                Text("Gateway Auth")
                                    .font(.system(size: 15, weight: .bold, design: .rounded))
                                Spacer()
                                if authBusy { ProgressView().controlSize(.small) }
                            }
                            Text("Root API key used by native apps, the CLI, and remote clients. Paired mobile devices use their own scoped tokens.")
                                .font(.system(size: 11, design: .rounded))
                                .foregroundStyle(.secondary)

                            settingRow("API key", authRevealedKey ?? authKeyPreview)
                            settingRow(
                                "Source",
                                authKeySource == "env" ? "CYBARA_API_KEY environment variable" : "~/.cybara/api_key"
                            )

                            ViewThatFits(in: .horizontal) {
                                HStack(spacing: 10) { authControlButtons }
                                VStack(alignment: .leading, spacing: 10) { authControlButtons }
                            }

                            Divider().opacity(0.45)

                            VStack(alignment: .leading, spacing: 10) {
                                HStack {
                                    Text("Gateway Password")
                                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                                    Spacer()
                                    Text(authGatewayPasswordEnabled ? "Enabled" : "Off")
                                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                                        .foregroundStyle(authGatewayPasswordEnabled ? Color.green : Color.secondary)
                                }
                                Text("Optional second factor for remote root/UI access when the gateway is reachable outside this Mac.")
                                    .font(.system(size: 11, design: .rounded))
                                    .foregroundStyle(.secondary)
                                SecureField("New password", text: $gatewayPasswordDraft)
                                    .textFieldStyle(.roundedBorder)
                                    .disabled(authBusy)
                                SecureField("Confirm password", text: $gatewayPasswordConfirm)
                                    .textFieldStyle(.roundedBorder)
                                    .disabled(authBusy)
                                ViewThatFits(in: .horizontal) {
                                    HStack(spacing: 10) { gatewayPasswordButtons }
                                    VStack(alignment: .leading, spacing: 10) { gatewayPasswordButtons }
                                }
                            }

                            Divider().opacity(0.45)

                            VStack(alignment: .leading, spacing: 10) {
                                HStack {
                                    Text("Remote Access")
                                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                                    Spacer()
                                    Text(remoteAccessReady ? "Ready" : (remoteAccessEnabled ? "Setup needed" : "Off"))
                                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                                        .foregroundStyle(remoteAccessReady ? Color.green : (remoteAccessEnabled ? Color.orange : .secondary))
                                }
                                Text("Use a private mesh such as Tailscale, ZeroTier, or NetBird, or a password-protected HTTPS tunnel for a public domain.")
                                    .font(.system(size: 11, design: .rounded))
                                    .foregroundStyle(.secondary)
                                Toggle("Enable remote URL", isOn: $remoteAccessEnabled)
                                    .toggleStyle(.switch)
                                    .disabled(authBusy)
                                Picker("Access", selection: $remoteAccessMode) {
                                    Text("Private Mesh").tag("private_overlay")
                                    Text("Public HTTPS").tag("public_tunnel")
                                }
                                .pickerStyle(.segmented)
                                .disabled(authBusy)
                                Picker("Provider", selection: $remoteAccessProvider) {
                                    Text("Tailscale").tag("tailscale")
                                    Text("ZeroTier").tag("zerotier")
                                    Text("NetBird").tag("netbird")
                                    Text("Cloudflare").tag("cloudflare")
                                    Text("Custom").tag("custom")
                                }
                                .pickerStyle(.menu)
                                .disabled(authBusy)
                                TextField("https://name.tailnet.ts.net", text: $remoteAccessBaseURL)
                                    .textFieldStyle(.roundedBorder)
                                    .disabled(authBusy)
                                if !remoteAccessMessage.isEmpty {
                                    Text(remoteAccessMessage)
                                        .font(.system(size: 11, design: .rounded))
                                        .foregroundStyle(remoteAccessReady ? Color.green : Color.orange)
                                }
                                Button {
                                    Task { await saveRemoteAccess() }
                                } label: {
                                    Label("Save Remote Access", systemImage: "network")
                                }
                                .buttonStyle(.bordered)
                                .disabled(authBusy)
                            }

                            Divider().opacity(0.45)

                            toggleRow(
                                "Require API key for localhost",
                                detail: authRequireForced
                                    ? "Forced on by CYBARA_REQUIRE_AUTH or production mode"
                                    : "When off, same-origin local requests skip the API key",
                                isOn: $authRequireLocalhost
                            ) {
                                guard !authRequireForced else { return }
                                Task { await updateRequireLocalhostAuth() }
                            }
                            .disabled(authRequireForced || authBusy)
                        }
                    }
                    .confirmationDialog(
                        "Rotate API Key?",
                        isPresented: $showRotateConfirm,
                        titleVisibility: .visible
                    ) {
                        Button("Rotate Key", role: .destructive) {
                            Task { await rotateAuthKey() }
                        }
                        Button("Cancel", role: .cancel) {}
                    } message: {
                        Text("The current key stops working immediately. This app keeps working (it reads the key file), but other clients must be updated.")
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("Gateway Activity")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            Spacer()
                            Text("\(gatewayActivityEntries.count) entries")
                                .font(.system(size: 12, weight: .semibold, design: .rounded))
                                .foregroundStyle(.secondary)
                        }

                        Text("Live gateway and native sidecar events in one stream.")
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)

                        NativeLogTimeline(
                            entries: Array(gatewayActivityEntries.prefix(100)),
                            emptyMessage: "No gateway or sidecar log entries loaded.",
                            compact: true
                        )
                    }
                }
            }
            .nativeSettingsContentLayout()
        }
    }

    @ViewBuilder
    private var defaultWorkspaceButtons: some View {
        Button {
            chooseDefaultWorkspaceDirectory()
        } label: {
            Label("Choose Folder", systemImage: "folder")
        }
        .buttonStyle(.bordered)
        .disabled(savingKey == "default_workspace_dir")

        Button {
            saveConfigPatch(
                ["default_workspace_dir": defaultWorkspaceDir],
                key: "default_workspace_dir"
            )
        } label: {
            Label("Save Workspace", systemImage: "checkmark.circle")
        }
        .buttonStyle(.borderedProminent)
        .disabled(savingKey == "default_workspace_dir")
    }

    @ViewBuilder
    private var dataDirectoryButtons: some View {
        Button {
            chooseCybaraDataDirectory()
        } label: {
            Label("Choose Folder", systemImage: "folder")
        }
        .buttonStyle(.bordered)
        .disabled(cybaraDataDirForced || savingKey == "cybara_data_dir")

        Button {
            saveCybaraDataDirectory()
        } label: {
            Label("Save Data Directory", systemImage: "checkmark.circle")
        }
        .buttonStyle(.borderedProminent)
        .disabled(
            cybaraDataDirForced
                || savingKey == "cybara_data_dir"
                || configuredCybaraDataDir.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        )
    }

    @ViewBuilder
    private var authControlButtons: some View {
        Button {
            Task { await toggleRevealAuthKey() }
        } label: {
            Label(authRevealedKey == nil ? "Reveal" : "Hide", systemImage: authRevealedKey == nil ? "eye" : "eye.slash")
        }
        .buttonStyle(.bordered)
        .disabled(authBusy)

        Button {
            Task { await copyAuthKey() }
        } label: {
            Label(authCopied ? "Copied" : "Copy Key", systemImage: authCopied ? "checkmark" : "doc.on.doc")
        }
        .buttonStyle(.bordered)
        .disabled(authBusy)

        Button {
            showRotateConfirm = true
        } label: {
            Label("Rotate Key", systemImage: "arrow.triangle.2.circlepath")
        }
        .buttonStyle(.bordered)
        .disabled(authBusy || authKeySource == "env")
    }

    @ViewBuilder
    private var gatewayPasswordButtons: some View {
        Button {
            Task { await saveGatewayPassword() }
        } label: {
            Label(
                authGatewayPasswordEnabled ? "Update Password" : "Enable Password",
                systemImage: "lock.shield"
            )
        }
        .buttonStyle(.borderedProminent)
        .disabled(
            authBusy ||
                gatewayPasswordDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                gatewayPasswordConfirm.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        )

        Button {
            Task { await clearGatewayPassword() }
        } label: {
            Label("Clear Password", systemImage: "xmark.shield")
        }
        .buttonStyle(.bordered)
        .disabled(authBusy || !authGatewayPasswordEnabled)
    }

    @ViewBuilder
    private var gatewayControlButtons: some View {
        Button {
            Task { await restartGateway() }
        } label: {
            Label(gatewayRestarting ? "Restarting" : "Restart Gateway", systemImage: "arrow.clockwise")
        }
        .buttonStyle(.borderedProminent)
        .disabled(gatewayRestarting)

        Button {
            copyServerURL()
        } label: {
            Label(copiedURL ? "Copied" : "Copy URL", systemImage: copiedURL ? "checkmark" : "doc.on.doc")
        }
        .buttonStyle(.bordered)

        Button {
            sidecar.revealBinary()
        } label: {
            Label("Reveal Binary", systemImage: "shippingbox")
        }
        .buttonStyle(.bordered)
    }

    private var appearanceSettingsCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Appearance")
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                    Spacer()
                    progressLabel(for: "themeAccent", fallback: CybaraAccent.label(for: selectedAccent))
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 48, maximum: 58), spacing: 12)], spacing: 12) {
                    ForEach(CybaraAccent.orderedKeys, id: \.self) { key in
                        accentSwatch(key)
                    }
                }
                Divider()
                Toggle(isOn: $petEnabled) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Show floating pet")
                            .font(.system(size: 13, weight: .medium, design: .rounded))
                        Text("A draggable Cybara that floats above every app. Click it to jump back into chat.")
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                    }
                }
                .toggleStyle(.switch)
                .onChange(of: petEnabled) { _, enabled in
                    PetPanelController.shared.setVisible(enabled)
                }
            }
        }
    }

    private var modelTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NativeSettingsLayout.cardSpacing) {
                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Default Model")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        if !availableModels.isEmpty {
                            Picker("Known model", selection: $defaultModel) {
                                Text("Auto").tag("")
                                ForEach(availableModels, id: \.self) { model in
                                    Text(model).tag(model)
                                }
                            }
                            .pickerStyle(.menu)
                            .onChange(of: defaultModel) { _, value in
                                saveConfigPatch(["default_model": value], key: "default_model")
                            }
                        }
                        TextField("Default model", text: $defaultModel)
                            .textFieldStyle(.roundedBorder)
                            .onSubmit {
                                saveConfigPatch(["default_model": defaultModel], key: "default_model")
                            }
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Reasoning")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        Picker("Default reasoning effort", selection: $reasoningEffort) {
                            ForEach(nativeReasoningEfforts, id: \.value) { option in
                                Text(option.label).tag(option.value)
                            }
                        }
                        .pickerStyle(.segmented)
                        .onChange(of: reasoningEffort) { _, value in
                            saveConfigPatch(["reasoning_effort": value], key: "reasoning_effort")
                        }
                    }
                }
            }
            .nativeSettingsContentLayout()
        }
    }

    private var speechTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NativeSettingsLayout.cardSpacing) {
                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Image(systemName: "speaker.wave.2")
                                .foregroundStyle(.secondary)
                            Text("Text to Speech")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            Spacer()
                            progressLabel(for: "speech", fallback: speechTTSProviderLabel)
                        }
                        Picker("Provider", selection: $speechTTSProvider) {
                            Text("Auto").tag("auto")
                            Text("ElevenLabs").tag("elevenlabs")
                            Text("OpenAI").tag("openai")
                            Text("System").tag("system")
                        }
                        .pickerStyle(.segmented)
                        .onChange(of: speechTTSProvider) { _, _ in saveSpeechSettings() }

                        Picker("Provider account", selection: $speechTTSProviderId) {
                            Text("Auto").tag("")
                            ForEach(ttsProviderAccounts) { provider in
                                Text("\(provider.displayName) (\(provider.providerType))").tag(provider.id)
                            }
                        }
                        .pickerStyle(.menu)
                        .onChange(of: speechTTSProviderId) { _, _ in saveSpeechSettings() }

                        ViewThatFits(in: .horizontal) {
                            HStack(spacing: 12) { ttsTextFields }
                            VStack(alignment: .leading, spacing: 10) { ttsTextFields }
                        }

                        Picker("Format", selection: $speechTTSFormat) {
                            Text("MP3").tag("mp3")
                            Text("M4A").tag("m4a")
                            Text("WAV").tag("wav")
                            Text("Opus").tag("opus")
                            Text("AAC").tag("aac")
                            Text("AIFF").tag("aiff")
                        }
                        .pickerStyle(.segmented)
                        .onChange(of: speechTTSFormat) { _, _ in saveSpeechSettings() }

                        Toggle("Fallback to macOS system voice", isOn: $speechTTSFallback)
                            .onChange(of: speechTTSFallback) { _, _ in saveSpeechSettings() }
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Image(systemName: "mic")
                                .foregroundStyle(.secondary)
                            Text("Speech to Text")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            Spacer()
                        }
                        Picker("Mode", selection: $speechSTTProvider) {
                            Text("Auto").tag("auto")
                            Text("Native").tag("native")
                            Text("OpenAI").tag("openai")
                        }
                        .pickerStyle(.segmented)
                        .onChange(of: speechSTTProvider) { _, _ in saveSpeechSettings() }

                        Picker("Provider account", selection: $speechSTTProviderId) {
                            Text("Auto").tag("")
                            ForEach(sttProviderAccounts) { provider in
                                Text("\(provider.displayName) (\(provider.providerType))").tag(provider.id)
                            }
                        }
                        .pickerStyle(.menu)
                        .onChange(of: speechSTTProviderId) { _, _ in saveSpeechSettings() }

                        ViewThatFits(in: .horizontal) {
                            HStack(spacing: 12) { sttTextFields }
                            VStack(alignment: .leading, spacing: 10) { sttTextFields }
                        }
                    }
                }

                HStack {
                    Spacer()
                    Button {
                        saveSpeechSettings()
                    } label: {
                        Label("Save Speech", systemImage: "checkmark.circle")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(savingKey == "speech")
                }
            }
            .nativeSettingsContentLayout()
        }
    }

    private static let memoryProviderChoices: [(id: String, label: String)] = [
        ("local", "Built-in (local)"),
        ("supermemory", "Supermemory"),
        ("mem0", "Mem0"),
        ("honcho", "Honcho"),
        ("openviking", "OpenViking"),
        ("hindsight", "Hindsight"),
    ]

    private static let memoryProviderFieldSpecs: [String: [(key: String, label: String, secret: Bool, placeholder: String)]] = [
        "supermemory": [
            ("apiKey", "API key", true, ""),
            ("baseUrl", "Base URL", false, "https://api.supermemory.ai"),
            ("containerTag", "Container tag", false, "cybara"),
        ],
        "mem0": [
            ("apiKey", "API key", true, ""),
            ("baseUrl", "Base URL", false, "https://api.mem0.ai"),
            ("userId", "User ID", false, "cybara-user"),
            ("agentId", "Agent ID", false, "cybara"),
        ],
        "honcho": [
            ("apiKey", "API key", true, ""),
            ("baseUrl", "Base URL", false, "https://api.honcho.dev"),
            ("workspace", "Workspace", false, "cybara"),
            ("peer", "Peer", false, "user"),
        ],
        "openviking": [
            ("baseUrl", "Server URL", false, "http://127.0.0.1:1933"),
            ("apiKey", "API key", true, ""),
        ],
        "hindsight": [
            ("apiKey", "API key", true, ""),
            ("baseUrl", "Base URL", false, "https://api.hindsight.vectorize.io"),
            ("tenant", "Tenant", false, "default"),
            ("bankId", "Memory bank", false, "cybara"),
        ],
    ]

    private func memoryFieldBinding(_ provider: String, _ key: String) -> Binding<String> {
        Binding(
            get: { memoryProviderFields["\(provider).\(key)"] ?? "" },
            set: { memoryProviderFields["\(provider).\(key)"] = $0 }
        )
    }

    private var memoryTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NativeSettingsLayout.cardSpacing) {
                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Image(systemName: "brain.head.profile")
                                .foregroundStyle(.secondary)
                            Text("Memory")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            Spacer()
                        }
                        toggleRow(
                            "Background memory review",
                            detail: "After substantial responses, a silent reviewer saves durable preferences and facts.",
                            isOn: $memoryBackgroundReview
                        ) {
                            saveMemorySettings()
                        }
                        toggleRow(
                            "Flush before compaction",
                            detail: "Before a long chat compacts, the agent gets one chance to save durable memory.",
                            isOn: $memoryFlushEnabled
                        ) {
                            saveMemorySettings()
                        }
                        TextField("Flush threshold (tokens)", text: $memoryFlushThreshold)
                            .textFieldStyle(.roundedBorder)
                            .frame(maxWidth: 220)
                            .onSubmit { saveMemorySettings() }
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Image(systemName: "timer")
                                .foregroundStyle(.secondary)
                            Text("Agent Turn Watchdogs")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            Spacer()
                        }
                        Text("Timeouts trigger on provider silence, never on how long an agent works. Local model endpoints auto-relax these limits. Environment variables (CYBARA_LLM_*) override saved values.")
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                        HStack(spacing: 10) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("First token (s)").font(.system(size: 11, design: .rounded)).foregroundStyle(.secondary)
                                TextField("300", text: $llmFirstTokenSeconds)
                                    .textFieldStyle(.roundedBorder)
                                    .onSubmit { saveLlmTimeoutSettings() }
                            }
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Stall (s, 0 = off)").font(.system(size: 11, design: .rounded)).foregroundStyle(.secondary)
                                TextField("300", text: $llmStallSeconds)
                                    .textFieldStyle(.roundedBorder)
                                    .onSubmit { saveLlmTimeoutSettings() }
                            }
                        }
                        HStack(spacing: 10) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Total cap (s, 0 = ∞)").font(.system(size: 11, design: .rounded)).foregroundStyle(.secondary)
                                TextField("0", text: $llmTotalSeconds)
                                    .textFieldStyle(.roundedBorder)
                                    .onSubmit { saveLlmTimeoutSettings() }
                            }
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Non-streaming (s)").font(.system(size: 11, design: .rounded)).foregroundStyle(.secondary)
                                TextField("1800", text: $llmNonStreamingSeconds)
                                    .textFieldStyle(.roundedBorder)
                                    .onSubmit { saveLlmTimeoutSettings() }
                            }
                        }
                        Button("Save Watchdogs") { saveLlmTimeoutSettings() }
                            .buttonStyle(.borderedProminent)
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Image(systemName: "externaldrive.connected.to.line.below")
                                .foregroundStyle(.secondary)
                            Text("Memory Provider")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            Spacer()
                        }
                        Text("Built-in local memory (MEMORY.md + daily files) always runs. Selecting an external provider mirrors durable memories to it and blends its recall into agent context.")
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                        Picker("Provider", selection: $memoryProvider) {
                            ForEach(Self.memoryProviderChoices, id: \.id) { choice in
                                Text(choice.label).tag(choice.id)
                            }
                        }
                        .pickerStyle(.menu)
                        .onChange(of: memoryProvider) { _, _ in
                            memoryTestResult = nil
                            saveMemoryProviderSettings()
                        }
                        if memoryProvider != "local",
                           let fields = Self.memoryProviderFieldSpecs[memoryProvider] {
                            ForEach(fields, id: \.key) { field in
                                if field.secret {
                                    SecureField(field.label, text: memoryFieldBinding(memoryProvider, field.key))
                                        .textFieldStyle(.roundedBorder)
                                        .onSubmit { saveMemoryProviderSettings() }
                                } else {
                                    TextField(
                                        field.label,
                                        text: memoryFieldBinding(memoryProvider, field.key),
                                        prompt: Text(field.placeholder)
                                    )
                                    .textFieldStyle(.roundedBorder)
                                    .onSubmit { saveMemoryProviderSettings() }
                                }
                            }
                            toggleRow(
                                "Auto recall",
                                detail: "Blend provider memories into agent context.",
                                isOn: $memoryAutoRecall
                            ) {
                                saveMemoryProviderSettings()
                            }
                            toggleRow(
                                "Auto capture",
                                detail: "Mirror new durable memories to the provider.",
                                isOn: $memoryAutoCapture
                            ) {
                                saveMemoryProviderSettings()
                            }
                            HStack(spacing: 10) {
                                Button {
                                    testMemoryProviderConnection()
                                } label: {
                                    if memoryTesting {
                                        Label("Testing…", systemImage: "hourglass")
                                    } else {
                                        Label("Test Connection", systemImage: "bolt.horizontal")
                                    }
                                }
                                .buttonStyle(.bordered)
                                .disabled(memoryTesting)
                                if let memoryTestResult {
                                    Text(memoryTestResult)
                                        .font(.system(size: 11, design: .rounded))
                                        .foregroundStyle(memoryTestOK ? Color.green : Color.red)
                                }
                            }
                        }
                        HStack {
                            Spacer()
                            Button {
                                saveMemorySettings()
                                saveMemoryProviderSettings()
                            } label: {
                                Label("Save Memory", systemImage: "checkmark.circle")
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(savingKey == "memory" || savingKey == "memory_provider")
                        }
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Image(systemName: "square.grid.3x1.below.line.grid.1x2")
                                .foregroundStyle(.secondary)
                            Text("Indexing")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            Spacer()
                        }
                        Text("The embedding index that powers semantic search over memory, sessions, and workspace files. Separate from memory itself — memories persist even with indexing off.")
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                        toggleRow(
                            "Build search index",
                            detail: "Index memories, sessions, and workspace files for faster search.",
                            isOn: $indexEnabled
                        ) {
                            saveIndexingSettings()
                        }
                        toggleRow(
                            "Embedding search",
                            detail: "Use embeddings for similarity search.",
                            isOn: $indexSemantic
                        ) {
                            saveIndexingSettings()
                        }
                        toggleRow(
                            "Include hidden files",
                            detail: "Index dotfiles and hidden directories.",
                            isOn: $indexHidden
                        ) {
                            saveIndexingSettings()
                        }
                        toggleRow(
                            "Auto reindex on workspace change",
                            detail: "Rebuild the index when the agent workspace changes.",
                            isOn: $indexAutoReindex
                        ) {
                            saveIndexingSettings()
                        }
                        Picker("Embedding provider", selection: $indexEmbeddingProvider) {
                            Text("Auto (best available)").tag("auto")
                            Text("Local database (keyword only)").tag("local")
                            Text("Local Transformers.js").tag("transformers_js")
                            Text("Ollama (local)").tag("ollama")
                            Text("OpenAI").tag("openai")
                            Text("Voyage AI").tag("voyage")
                            Text("Gemini").tag("gemini")
                        }
                        .pickerStyle(.menu)
                        .onChange(of: indexEmbeddingProvider) { _, _ in saveIndexingSettings() }
                        TextField("Model override", text: $indexEmbeddingModel, prompt: Text("Auto"))
                            .textFieldStyle(.roundedBorder)
                            .frame(maxWidth: 320)
                            .onSubmit { saveIndexingSettings() }
                    }
                }
            }
            .nativeSettingsContentLayout()
        }
    }

    private var migrationTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NativeSettingsLayout.cardSpacing) {
                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Image(systemName: "folder.badge.gearshape")
                                .foregroundStyle(.secondary)
                            Text("Import legacy agent data")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            Spacer()
                            Button {
                                Task { await refreshMigrationSources() }
                            } label: {
                                Label("Refresh", systemImage: "arrow.clockwise")
                            }
                            .controlSize(.small)
                        }
                        Text("Preview memories, skills, persona, workspace instructions, and optional provider keys before applying changes.")
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)

                        if !migrationSources.filter({ $0.exists }).isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                ForEach(migrationSources.filter { $0.exists }) { source in
                                    Button {
                                        migrationSourceKind = source.kind
                                        migrationSourcePath = source.path
                                    } label: {
                                        HStack {
                                            VStack(alignment: .leading, spacing: 3) {
                                                Text(source.label)
                                                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                                                Text("\(source.detected.memoryFiles) memories, \(source.detected.skillCount) skills, \(source.detected.configFiles) config files")
                                                    .font(.system(size: 11, design: .rounded))
                                                    .foregroundStyle(.secondary)
                                                Text(source.path)
                                                    .font(.system(size: 10, design: .monospaced))
                                                    .foregroundStyle(.tertiary)
                                                    .lineLimit(1)
                                            }
                                            Spacer()
                                            if migrationSourcePath == source.path {
                                                Image(systemName: "checkmark.circle.fill")
                                                    .foregroundStyle(.green)
                                            }
                                        }
                                        .contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)
                                    .padding(10)
                                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                                }
                            }
                        }

                        Picker("Source", selection: $migrationSourceKind) {
                            Text("OpenClaw").tag("openclaw")
                            Text("Hermes").tag("hermes")
                        }
                        .pickerStyle(.segmented)

                        HStack(spacing: 8) {
                            TextField("Source directory", text: $migrationSourcePath)
                                .textFieldStyle(.roundedBorder)
                            Button("Browse") {
                                chooseMigrationSourceDirectory()
                            }
                        }
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Options")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        HStack(spacing: 12) {
                            Picker("Preset", selection: $migrationPreset) {
                                Text("User Data").tag("user-data")
                                Text("Full").tag("full")
                            }
                            .pickerStyle(.menu)
                            Picker("Skill conflicts", selection: $migrationSkillConflict) {
                                Text("Skip").tag("skip")
                                Text("Rename").tag("rename")
                                Text("Overwrite").tag("overwrite")
                            }
                            .pickerStyle(.menu)
                        }
                        Toggle("Import provider keys", isOn: $migrationImportSecrets)
                        Toggle("Allow overwrite", isOn: $migrationOverwrite)
                        HStack(spacing: 8) {
                            TextField("Workspace target for AGENTS.md", text: $migrationWorkspaceTarget)
                                .textFieldStyle(.roundedBorder)
                            Button("Browse") {
                                chooseMigrationWorkspaceDirectory()
                            }
                        }
                        HStack(spacing: 10) {
                            Button {
                                Task { await previewMigration() }
                            } label: {
                                Label("Preview", systemImage: "doc.text.magnifyingglass")
                            }
                            .buttonStyle(.bordered)
                            .disabled(migrationBusy)

                            Button {
                                Task { await applyMigration() }
                            } label: {
                                Label("Run Migration", systemImage: "arrow.down.doc")
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(migrationBusy)

                            if migrationBusy {
                                ProgressView().controlSize(.small)
                            }
                        }
                        if let migrationMessage {
                            Text(migrationMessage)
                                .font(.system(size: 12, design: .rounded))
                                .foregroundStyle(migrationMessage.lowercased().contains("failed") ? .red : .secondary)
                        }
                    }
                }

                if let migrationReport {
                    GlassCard {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                Text(migrationReport.dryRun ? "Preview Report" : "Migration Report")
                                    .font(.system(size: 15, weight: .bold, design: .rounded))
                                Spacer()
                                Text("\(migrationReport.summary["migrated"] ?? 0) migrated, \(migrationReport.summary["conflict"] ?? 0) conflicts")
                                    .font(.system(size: 11, weight: .medium, design: .rounded))
                                    .foregroundStyle(.secondary)
                            }
                            if !migrationReport.warnings.isEmpty {
                                Text(migrationReport.warnings.joined(separator: " "))
                                    .font(.system(size: 11, design: .rounded))
                                    .foregroundStyle(.orange)
                            }
                            VStack(alignment: .leading, spacing: 6) {
                                ForEach(migrationReport.items.prefix(24)) { item in
                                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                                        Text(item.status)
                                            .font(.system(size: 11, weight: .semibold, design: .rounded))
                                            .foregroundStyle(migrationStatusColor(item.status))
                                            .frame(width: 72, alignment: .leading)
                                        Text(item.category)
                                            .font(.system(size: 11, design: .rounded))
                                            .foregroundStyle(.secondary)
                                            .frame(width: 80, alignment: .leading)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(item.name)
                                                .font(.system(size: 12, weight: .medium, design: .rounded))
                                                .lineLimit(1)
                                            if let detail = item.detail {
                                                Text(detail)
                                                    .font(.system(size: 10, design: .rounded))
                                                    .foregroundStyle(.secondary)
                                                    .lineLimit(1)
                                            }
                                        }
                                    }
                                }
                            }
                            if let reportPath = migrationReport.reportPath {
                                Text(reportPath)
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundStyle(.tertiary)
                                    .textSelection(.enabled)
                            }
                        }
                    }
                }
            }
            .nativeSettingsContentLayout()
        }
    }

    private var featuresTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NativeSettingsLayout.cardSpacing) {
                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Safety Controls")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        toggleRow("Web Terminal", detail: "Enable browser-based terminal access.", isOn: $terminalEnabled) {
                            saveConfigPatch(["terminal_enabled": terminalEnabled], key: "terminal_enabled")
                        }
                        toggleRow("Self-improving skills", detail: "Allow agents to save reusable skills.", isOn: $selfImprovingSkills) {
                            saveConfigPatch(["self_improving_skills_enabled": selfImprovingSkills], key: "self_improving_skills_enabled")
                        }
                        if !agents.isEmpty {
                            Picker("Background model", selection: $backgroundAgentId) {
                                Text("Same agent as the turn (default)").tag("")
                                ForEach(agents) { agent in
                                    Text(agent.model.map { "\(agent.name) — \($0)" } ?? agent.name).tag(agent.id)
                                }
                            }
                            .onChange(of: backgroundAgentId) { _, value in
                                saveConfigPatch(["background_agent_id": value], key: "background_agent_id")
                            }
                            Text("Memory and skill review run silently after most turns. Point them at a cheaper agent to cut cost over time.")
                                .font(.system(size: 11, design: .rounded))
                                .foregroundStyle(.secondary)
                        }
                        toggleRow("Dangerous tool policy", detail: "Audit or block high-risk tool requests.", isOn: $dangerousPolicyEnabled) {
                            saveDangerousPolicy()
                        }
                        Picker("Policy mode", selection: $dangerousPolicyMode) {
                            Text("Audit").tag("audit")
                            Text("Block").tag("block")
                        }
                        .pickerStyle(.segmented)
                        .disabled(!dangerousPolicyEnabled)
                        .onChange(of: dangerousPolicyMode) { _, _ in saveDangerousPolicy() }
                        Picker("Tool approvals", selection: $toolApprovalMode) {
                            Text("Always Allow").tag("always_allow")
                            Text("Ask Me").tag("ask")
                        }
                        .pickerStyle(.segmented)
                        .onChange(of: toolApprovalMode) { _, value in
                            saveConfigPatch(["tool_approval_mode": value], key: "tool_approval_mode")
                        }
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Sandbox Runtime")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        Toggle("Enable sandbox runtime", isOn: $sandboxEnabled)
                            .onChange(of: sandboxEnabled) { _, _ in saveSandboxRuntime() }
                        Picker("Provider", selection: $sandboxProvider) {
                            Text("Auto").tag("auto")
                            Text("Apple Sandbox").tag("apple_sandbox")
                            Text("Podman").tag("podman")
                            Text("Docker").tag("docker")
                        }
                        .pickerStyle(.menu)
                        .disabled(!sandboxEnabled)
                        .onChange(of: sandboxProvider) { _, _ in saveSandboxRuntime() }
                        Picker("Network", selection: $sandboxNetwork) {
                            Text("Deny").tag("deny")
                            Text("Allow").tag("allow")
                        }
                        .pickerStyle(.segmented)
                        .disabled(!sandboxEnabled)
                        .onChange(of: sandboxNetwork) { _, _ in saveSandboxRuntime() }
                    }
                }
            }
            .nativeSettingsContentLayout()
        }
    }

    @ViewBuilder
    private var ttsTextFields: some View {
        TextField("Model", text: $speechTTSModel)
            .textFieldStyle(.roundedBorder)
            .onSubmit { saveSpeechSettings() }
        TextField("Voice ID or name", text: $speechTTSVoice)
            .textFieldStyle(.roundedBorder)
            .onSubmit { saveSpeechSettings() }
    }

    @ViewBuilder
    private var sttTextFields: some View {
        TextField("Model", text: $speechSTTModel)
            .textFieldStyle(.roundedBorder)
            .onSubmit { saveSpeechSettings() }
        TextField("Language", text: $speechSTTLanguage)
            .textFieldStyle(.roundedBorder)
            .onSubmit { saveSpeechSettings() }
            .frame(maxWidth: 160)
    }

    private var advancedTab: some View {
        HStack(spacing: 0) {
            List(selection: $advancedSelection) {
                ForEach(SettingsAdvancedSection.allCases) { section in
                    Label(section.title, systemImage: section.systemImage)
                        .tag(section)
                }
            }
            .listStyle(.sidebar)
            .frame(width: 190)

            Divider().opacity(0.35)

            advancedContent
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(.top, 10)
        .padding(.bottom, 16)
    }

    @ViewBuilder
    private var advancedContent: some View {
        switch advancedSelection {
        case .router:
            RouterScreen(client: client)
        case .systemPrompt:
            SystemPromptScreen(client: client)
        case .memory:
            MemoryScreen(client: client)
        case .channels:
            ChannelsScreen(client: client)
        case .skills:
            NativeSkillsScreen(client: client)
        case .logs:
            LogsScreen(client: client)
        }
    }

    private var uptimeLabel: String {
        guard let uptime = health?.uptime, uptime > 0 else { return "Starting" }
        let minutes = Int(uptime) / 60
        if minutes < 60 { return "\(minutes)m" }
        return "\(minutes / 60)h \(minutes % 60)m"
    }

    private var speechTTSProviderLabel: String {
        switch speechTTSProvider {
        case "elevenlabs": return "ElevenLabs"
        case "openai": return "OpenAI"
        case "system": return "System"
        default: return "Auto"
        }
    }

    private var gatewayActivityEntries: [NativeLogEntryDisplay] {
        nativeLogEntries(gatewayLogs: gatewayLogs, sidecarLogs: sidecar.logs, sidecarLimit: 40)
    }

    private func settingRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(.system(size: 12, design: .rounded)).foregroundStyle(.secondary)
            Spacer(minLength: 20)
            Text(value)
                .font(.system(size: 12, weight: .semibold, design: value.count > 42 ? .monospaced : .rounded))
                .lineLimit(2)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
    }

    private func toggleRow(
        _ title: String,
        detail: String,
        isOn: Binding<Bool>,
        onChange: @escaping () -> Void
    ) -> some View {
        Toggle(isOn: isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 13, weight: .semibold, design: .rounded))
                Text(detail).font(.system(size: 11, design: .rounded)).foregroundStyle(.secondary)
            }
        }
        .onChange(of: isOn.wrappedValue) { _, _ in onChange() }
    }

    private func progressLabel(for key: String, fallback: String) -> some View {
        Group {
            if savingKey == key {
                ProgressView().controlSize(.small)
            } else {
                Text(fallback).font(.system(size: 12, weight: .semibold, design: .rounded)).foregroundStyle(.secondary)
            }
        }
    }

    private func accentSwatch(_ key: String) -> some View {
        let color = CybaraAccent.palette[key] ?? .accentColor
        return Button {
            selectedAccent = key
            onAccentChanged(key)
            saveConfigPatch(["themeAccent": key], key: "themeAccent") {
                NotificationCenter.default.post(name: .cybaraThemeAccentChanged, object: key)
            }
        } label: {
            ZStack {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(color)
                    .frame(width: 46, height: 46)
                if selectedAccent == key {
                    Image(systemName: "checkmark")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)
                        .shadow(radius: 2)
                }
            }
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(selectedAccent == key ? Color.white.opacity(0.85) : Color.white.opacity(0.16), lineWidth: 2)
            )
        }
        .buttonStyle(.plain)
        .disabled(savingKey == "themeAccent")
        .help(CybaraAccent.label(for: key))
    }

    private func saveDangerousPolicy() {
        saveConfigPatch(
            ["dangerous_tool_policy": ["enabled": dangerousPolicyEnabled, "mode": dangerousPolicyMode]],
            key: "dangerous_tool_policy"
        )
    }

    private func saveSandboxRuntime() {
        saveConfigPatch(
            [
                "sandbox_runtime": [
                    "enabled": sandboxEnabled,
                    "provider": sandboxProvider,
                    "network": sandboxNetwork,
                ],
            ],
            key: "sandbox_runtime"
        )
    }

    private func saveSpeechSettings() {
        saveConfigPatch(
            [
                "speech": [
                    "tts": [
                        "provider": speechTTSProvider,
                        "providerId": speechTTSProviderId,
                        "model": speechTTSModel,
                        "voice": speechTTSVoice,
                        "outputFormat": speechTTSFormat,
                        "fallbackToSystem": speechTTSFallback,
                    ],
                    "stt": [
                        "provider": speechSTTProvider,
                        "providerId": speechSTTProviderId,
                        "model": speechSTTModel,
                        "language": speechSTTLanguage,
                    ],
                ],
            ],
            key: "speech"
        )
    }

    private func saveMemorySettings() {
        var memory = config["memory"] as? [String: Any] ?? [:]
        memory["backgroundReviewEnabled"] = memoryBackgroundReview
        memory["memoryFlushEnabled"] = memoryFlushEnabled
        memory["memoryFlushSoftThresholdTokens"] = max(500, Int(memoryFlushThreshold) ?? 4000)
        saveConfigPatch(["memory": memory], key: "memory")
    }

    private func saveLlmTimeoutSettings() {
        let payload: [String: Any] = [
            "firstTokenSeconds": max(10, Int(llmFirstTokenSeconds) ?? 300),
            "stallSeconds": max(0, Int(llmStallSeconds) ?? 300),
            "totalSeconds": max(0, Int(llmTotalSeconds) ?? 0),
            "nonStreamingSeconds": max(60, Int(llmNonStreamingSeconds) ?? 1800),
        ]
        saveConfigPatch(["llm_timeouts": payload], key: "llm_timeouts")
    }

    private func saveMemoryProviderSettings() {
        var payload: [String: Any] = [
            "provider": memoryProvider,
            "autoRecall": memoryAutoRecall,
            "autoCapture": memoryAutoCapture,
        ]
        for (provider, fields) in Self.memoryProviderFieldSpecs {
            var section: [String: Any] = [:]
            for field in fields {
                section[field.key] = memoryProviderFields["\(provider).\(field.key)"] ?? ""
            }
            payload[provider] = section
        }
        saveConfigPatch(["memory_provider": payload], key: "memory_provider")
    }

    private func saveIndexingSettings() {
        var indexer = config["workspace_indexer"] as? [String: Any] ?? [:]
        indexer["enabled"] = indexEnabled
        indexer["semanticEnabled"] = indexSemantic
        indexer["includeHidden"] = indexHidden
        indexer["autoReindexOnWorkspaceSet"] = indexAutoReindex
        indexer["embeddingProvider"] = indexEmbeddingProvider
        indexer["embeddingModel"] = indexEmbeddingModel
        saveConfigPatch(["workspace_indexer": indexer], key: "workspace_indexer")
    }

    private func testMemoryProviderConnection() {
        var settings: [String: Any] = [
            "provider": memoryProvider,
            "autoRecall": memoryAutoRecall,
            "autoCapture": memoryAutoCapture,
        ]
        for (provider, fields) in Self.memoryProviderFieldSpecs {
            var section: [String: Any] = [:]
            for field in fields {
                section[field.key] = memoryProviderFields["\(provider).\(field.key)"] ?? ""
            }
            settings[provider] = section
        }
        guard let body = try? JSONSerialization.data(
            withJSONObject: ["provider": memoryProvider, "settings": settings]
        ) else { return }
        memoryTesting = true
        memoryTestResult = nil
        Task {
            do {
                let result = try await client.testMemoryProvider(body)
                let ok = result["ok"] as? Bool ?? false
                let detail = result["detail"] as? String ?? (ok ? "Connected" : "Failed")
                memoryTestOK = ok
                memoryTestResult = "\(ok ? "Connected" : "Failed") — \(detail)"
            } catch {
                memoryTestOK = false
                memoryTestResult = "Failed — \(error.localizedDescription)"
            }
            memoryTesting = false
        }
    }

    private func saveConfigPatch(
        _ patch: [String: Any],
        key: String,
        onSuccess: (() -> Void)? = nil
    ) {
        guard let body = try? JSONSerialization.data(withJSONObject: patch) else { return }
        savingKey = key
        Task {
            do {
                try await client.updateAppConfig(body)
                for (patchKey, value) in patch { config[patchKey] = value }
                onSuccess?()
                error = nil
            } catch {
                self.error = error.localizedDescription
            }
            savingKey = nil
        }
    }

    private func saveCybaraDataDirectory() {
        let path = configuredCybaraDataDir.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !path.isEmpty,
              let body = try? JSONSerialization.data(withJSONObject: ["cybara_data_dir": path])
        else { return }
        savingKey = "cybara_data_dir"
        Task {
            do {
                try await client.updateAppConfig(body)
                let refreshed = try await client.appConfig()
                config = refreshed
                readConfig(refreshed)
                error = nil
            } catch {
                self.error = error.localizedDescription
            }
            savingKey = nil
        }
    }

    private func copyServerURL() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(sidecar.serverURL.absoluteString, forType: .string)
        copiedURL = true
        Task {
            try? await Task.sleep(for: .seconds(1.4))
            copiedURL = false
        }
    }

    private func restartGateway() async {
        gatewayRestarting = true
        defer { gatewayRestarting = false }

        if sidecar.managesGateway {
            await sidecar.restart()
            await load()
            return
        }

        do {
            let response = try await client.restartGateway()
            if response["success"] as? Bool == false {
                throw GatewayClientError.invalidResponse
            }
            await sidecar.waitForAttachedGatewayRestart()
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func refreshGatewayLogs() async {
        guard sidecar.isReady else {
            gatewayLogs = []
            return
        }
        if let page = try? await client.systemLogsPage(limit: 80) {
            gatewayLogs = page.logs
        }
    }

    private func load() async {
        guard sidecar.isReady else {
            health = nil
            config = [:]
            providers = []
            gatewayLogs = []
            migrationSources = []
            error = nil
            return
        }

        do {
            async let h = client.health()
            async let cfg = client.appConfig()
            async let p = client.providers()
            health = try await h
            config = try await cfg
            providers = try await p
            readConfig(config)
            error = nil
            if let loadedAgents = try? await client.agents() {
                agents = loadedAgents
            }
        } catch {
            self.error = error.localizedDescription
        }

        if let auth = try? await client.authSettings(), auth["success"] as? Bool == true {
            readAuthSettings(auth)
            authAvailable = true
        } else {
            authAvailable = false
        }

        await refreshGatewayLogs()
        await refreshMigrationSources()
    }

    private func refreshMigrationSources() async {
        guard sidecar.isReady else {
            migrationSources = []
            return
        }
        if let sources = try? await client.migrationSources() {
            migrationSources = sources
            if migrationSourcePath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
               let detected = sources.first(where: { $0.exists }) {
                migrationSourceKind = detected.kind
                migrationSourcePath = detected.path
            }
        }
    }

    private func migrationPayloadData() -> Data? {
        var payload: [String: Any] = [
            "sourceKind": migrationSourceKind,
            "preset": migrationPreset,
            "migrateSecrets": migrationImportSecrets,
            "overwrite": migrationOverwrite,
            "skillConflict": migrationSkillConflict,
        ]
        let source = migrationSourcePath.trimmingCharacters(in: .whitespacesAndNewlines)
        if !source.isEmpty { payload["sourcePath"] = source }
        let workspace = migrationWorkspaceTarget.trimmingCharacters(in: .whitespacesAndNewlines)
        if !workspace.isEmpty { payload["workspaceTarget"] = workspace }
        return try? JSONSerialization.data(withJSONObject: payload)
    }

    private func previewMigration() async {
        guard let body = migrationPayloadData() else { return }
        migrationBusy = true
        defer { migrationBusy = false }
        do {
            migrationReport = try await client.previewMigration(body: body)
            migrationMessage = "Preview ready"
        } catch {
            migrationMessage = "Preview failed: \(error.localizedDescription)"
        }
    }

    private func applyMigration() async {
        guard let body = migrationPayloadData() else { return }
        migrationBusy = true
        defer { migrationBusy = false }
        do {
            migrationReport = try await client.runMigration(body: body)
            migrationMessage = "Migration complete"
            await refreshMigrationSources()
        } catch {
            migrationMessage = "Migration failed: \(error.localizedDescription)"
        }
    }

    private func chooseMigrationSourceDirectory() {
        chooseMigrationDirectory(title: "Choose Legacy Agent Directory") { path in
            migrationSourcePath = path
        }
    }

    private func chooseMigrationWorkspaceDirectory() {
        chooseMigrationDirectory(title: "Choose Workspace Directory") { path in
            migrationWorkspaceTarget = path
        }
    }

    private func chooseDefaultWorkspaceDirectory() {
        chooseMigrationDirectory(title: "Choose Default Workspace") { path in
            defaultWorkspaceDir = path
        }
    }

    private func chooseCybaraDataDirectory() {
        chooseMigrationDirectory(title: "Choose Cybara Data Directory") { path in
            configuredCybaraDataDir = path
        }
    }

    private func chooseMigrationDirectory(title: String, update: (String) -> Void) {
        let panel = NSOpenPanel()
        panel.title = title
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url {
            update(url.path)
        }
    }

    private func migrationStatusColor(_ status: String) -> Color {
        switch status.lowercased() {
        case "migrated":
            return .green
        case "planned":
            return .blue
        case "conflict", "error":
            return .red
        case "archived":
            return .orange
        default:
            return .secondary
        }
    }

    private func readAuthSettings(_ auth: [String: Any]) {
        authKeyPreview = auth["apiKeyPreview"] as? String ?? "No API key configured"
        authKeySource = auth["apiKeySource"] as? String ?? ""
        authRequireLocalhost = auth["requireAuthForLocalhost"] as? Bool ?? false
        authRequireForced = auth["requireAuthForLocalhostForced"] as? Bool ?? false
        authGatewayPasswordEnabled = auth["gatewayPasswordEnabled"] as? Bool ?? false
        if let remote = auth["remoteAccess"] as? [String: Any] {
            remoteAccessEnabled = remote["enabled"] as? Bool ?? false
            remoteAccessMode = remote["mode"] as? String ?? "private_overlay"
            remoteAccessProvider = remote["provider"] as? String ?? "tailscale"
            remoteAccessBaseURL = remote["baseUrl"] as? String ?? ""
            remoteAccessMessage = remote["message"] as? String ?? ""
            remoteAccessReady = remote["ready"] as? Bool ?? false
        }
    }

    private func toggleRevealAuthKey() async {
        if authRevealedKey != nil {
            authRevealedKey = nil
            return
        }
        authBusy = true
        defer { authBusy = false }
        if let key = try? await client.revealAuthKey() {
            authRevealedKey = key
        }
    }

    private func copyAuthKey() async {
        authBusy = true
        defer { authBusy = false }
        let key: String?
        if let revealed = authRevealedKey {
            key = revealed
        } else {
            key = try? await client.revealAuthKey()
        }
        guard let key, !key.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(key, forType: .string)
        authCopied = true
        Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            authCopied = false
        }
    }

    private func rotateAuthKey() async {
        authBusy = true
        defer { authBusy = false }
        do {
            if let key = try await client.rotateAuthKey() {
                authRevealedKey = key
            }
            if let auth = try? await client.authSettings() {
                readAuthSettings(auth)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func updateRequireLocalhostAuth() async {
        authBusy = true
        defer { authBusy = false }
        do {
            let auth = try await client.updateAuthSettings(
                requireAuthForLocalhost: authRequireLocalhost
            )
            readAuthSettings(auth)
        } catch {
            self.error = error.localizedDescription
            if let auth = try? await client.authSettings() {
                readAuthSettings(auth)
            }
        }
    }

    private func saveRemoteAccess() async {
        authBusy = true
        defer { authBusy = false }
        do {
            let auth = try await client.updateAuthSettings(
                remoteAccess: [
                    "enabled": remoteAccessEnabled,
                    "mode": remoteAccessMode,
                    "provider": remoteAccessProvider,
                    "baseUrl": remoteAccessBaseURL.trimmingCharacters(in: .whitespacesAndNewlines),
                ]
            )
            readAuthSettings(auth)
        } catch {
            self.error = error.localizedDescription
            if let auth = try? await client.authSettings() {
                readAuthSettings(auth)
            }
        }
    }

    private func saveGatewayPassword() async {
        let password = gatewayPasswordDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard password.count >= 12 else {
            error = "Gateway password must be at least 12 characters"
            return
        }
        guard password == gatewayPasswordConfirm.trimmingCharacters(in: .whitespacesAndNewlines)
        else {
            error = "Gateway password confirmation does not match"
            return
        }
        authBusy = true
        defer { authBusy = false }
        do {
            let auth = try await client.updateAuthSettings(gatewayPassword: password)
            UserDefaults.standard.set(password, forKey: "cybara_gateway_password")
            gatewayPasswordDraft = ""
            gatewayPasswordConfirm = ""
            readAuthSettings(auth)
        } catch {
            self.error = error.localizedDescription
            if let auth = try? await client.authSettings() {
                readAuthSettings(auth)
            }
        }
    }

    private func clearGatewayPassword() async {
        authBusy = true
        defer { authBusy = false }
        do {
            let auth = try await client.updateAuthSettings(clearGatewayPassword: true)
            UserDefaults.standard.removeObject(forKey: "cybara_gateway_password")
            readAuthSettings(auth)
        } catch {
            self.error = error.localizedDescription
            if let auth = try? await client.authSettings() {
                readAuthSettings(auth)
            }
        }
    }

    private func readConfig(_ config: [String: Any]) {
        selectedAccent = readAccentKey(from: config) ?? "indigo"
        onAccentChanged(selectedAccent)
        defaultModel = config["default_model"] as? String ?? ""
        defaultWorkspaceDir = config["default_workspace_dir"] as? String ?? defaultWorkspaceDir
        cybaraDataDir = config["cybara_data_dir"] as? String ?? cybaraDataDir
        configuredCybaraDataDir =
            config["configured_cybara_data_dir"] as? String ?? cybaraDataDir
        cybaraDataDirSource = config["cybara_data_dir_source"] as? String ?? "default"
        cybaraDataDirForced = config["cybara_data_dir_forced"] as? Bool ?? false
        cybaraDataDirRestartRequired =
            config["cybara_data_dir_restart_required"] as? Bool
            ?? (cybaraDataDir != configuredCybaraDataDir)
        cybaraDataDirOverrideFile = config["cybara_data_dir_override_file"] as? String ?? ""
        defaultCybaraDataDir = config["default_cybara_data_dir"] as? String ?? ""
        reasoningEffort = config["reasoning_effort"] as? String ?? ""
        backgroundAgentId = config["background_agent_id"] as? String ?? ""
        terminalEnabled = config["terminal_enabled"] as? Bool ?? false
        selfImprovingSkills = (config["self_improving_skills_enabled"] as? Bool) ?? true
        let policy = config["dangerous_tool_policy"] as? [String: Any] ?? [:]
        dangerousPolicyEnabled = policy["enabled"] as? Bool ?? false
        dangerousPolicyMode = policy["mode"] as? String == "block" ? "block" : "audit"
        toolApprovalMode = config["tool_approval_mode"] as? String == "ask" ? "ask" : "always_allow"
        let sandbox = config["sandbox_runtime"] as? [String: Any] ?? [:]
        sandboxEnabled = sandbox["enabled"] as? Bool ?? false
        sandboxProvider = sandbox["provider"] as? String ?? "auto"
        sandboxNetwork = sandbox["network"] as? String == "allow" ? "allow" : "deny"
        let speech = config["speech"] as? [String: Any] ?? [:]
        let tts = speech["tts"] as? [String: Any] ?? [:]
        let stt = speech["stt"] as? [String: Any] ?? [:]
        let provider = tts["provider"] as? String ?? "auto"
        speechTTSProvider = ["auto", "system", "elevenlabs", "openai"].contains(provider) ? provider : "auto"
        speechTTSProviderId = tts["providerId"] as? String ?? ""
        speechTTSModel = tts["model"] as? String ?? ""
        speechTTSVoice = tts["voice"] as? String ?? ""
        speechTTSFormat = tts["outputFormat"] as? String ?? "mp3"
        speechTTSFallback = tts["fallbackToSystem"] as? Bool ?? true
        let sttProvider = stt["provider"] as? String ?? "auto"
        speechSTTProvider = ["auto", "native", "openai"].contains(sttProvider) ? sttProvider : "auto"
        speechSTTProviderId = stt["providerId"] as? String ?? ""
        speechSTTModel = stt["model"] as? String ?? ""
        speechSTTLanguage = stt["language"] as? String ?? ""
        let memory = config["memory"] as? [String: Any] ?? [:]
        memoryBackgroundReview = memory["backgroundReviewEnabled"] as? Bool ?? true
        memoryFlushEnabled = memory["memoryFlushEnabled"] as? Bool ?? true
        memoryFlushThreshold = String(memory["memoryFlushSoftThresholdTokens"] as? Int ?? 4000)
        let timeouts = config["llm_timeouts"] as? [String: Any] ?? [:]
        llmFirstTokenSeconds = String(timeouts["firstTokenSeconds"] as? Int ?? 300)
        llmStallSeconds = String(timeouts["stallSeconds"] as? Int ?? 300)
        llmTotalSeconds = String(timeouts["totalSeconds"] as? Int ?? 0)
        llmNonStreamingSeconds = String(timeouts["nonStreamingSeconds"] as? Int ?? 1800)
        let memoryProviderConfig = config["memory_provider"] as? [String: Any] ?? [:]
        let providerId = memoryProviderConfig["provider"] as? String ?? "local"
        memoryProvider = Self.memoryProviderChoices.contains { $0.id == providerId } ? providerId : "local"
        memoryAutoRecall = memoryProviderConfig["autoRecall"] as? Bool ?? true
        memoryAutoCapture = memoryProviderConfig["autoCapture"] as? Bool ?? true
        var fieldValues: [String: String] = [:]
        for (provider, fields) in Self.memoryProviderFieldSpecs {
            let section = memoryProviderConfig[provider] as? [String: Any] ?? [:]
            for field in fields {
                let fallback = field.key == "apiKey" ? "" : field.placeholder
                fieldValues["\(provider).\(field.key)"] = section[field.key] as? String ?? fallback
            }
        }
        memoryProviderFields = fieldValues
        let indexer = config["workspace_indexer"] as? [String: Any] ?? [:]
        indexEnabled = indexer["enabled"] as? Bool ?? false
        indexSemantic = indexer["semanticEnabled"] as? Bool ?? false
        indexHidden = indexer["includeHidden"] as? Bool ?? false
        indexAutoReindex = indexer["autoReindexOnWorkspaceSet"] as? Bool ?? false
        let embedding = indexer["embeddingProvider"] as? String ?? "auto"
        indexEmbeddingProvider = ["auto", "local", "transformers_js", "openai", "voyage", "gemini", "ollama"].contains(embedding) ? embedding : "auto"
        indexEmbeddingModel = indexer["embeddingModel"] as? String ?? ""
    }

    private func readAccentKey(from config: [String: Any]) -> String? {
        for key in ["themeAccent", "theme_accent", "theme", "accent", "ui_accent"] {
            if let value = config[key] as? String,
               CybaraAccent.palette[value.lowercased()] != nil {
                return value.lowercased()
            }
        }
        return nil
    }

    private enum SettingsTab {
        case general
        case gateway
        case model
        case speech
        case memory
        case wallet
        case migration
        case features
        case advanced
    }

    private enum SettingsAdvancedSection: String, CaseIterable, Identifiable {
        case router
        case systemPrompt
        case memory
        case channels
        case skills
        case logs

        var id: String { rawValue }

        var title: String {
            switch self {
            case .router: return "Model Router"
            case .systemPrompt: return "System Prompt"
            case .memory: return "Memory"
            case .channels: return "Channels"
            case .skills: return "Skills"
            case .logs: return "Logs"
            }
        }

        var systemImage: String {
            switch self {
            case .router: return "point.3.connected.trianglepath.dotted"
            case .systemPrompt: return "sparkles"
            case .memory: return "brain"
            case .channels: return "link"
            case .skills: return "wand.and.stars"
            case .logs: return "list.bullet.rectangle"
            }
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var sidecar: SidecarManager

    var body: some View {
        NativeSettingsScreen(client: GatewayClient(baseURL: sidecar.serverURL))
            .environmentObject(sidecar)
            .frame(width: 760, height: 680)
    }
}
