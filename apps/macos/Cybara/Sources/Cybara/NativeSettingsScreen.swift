import AppKit
import SwiftUI

enum NativeSettingsLayout {
    static let outerPadding = EdgeInsets(top: 20, leading: 22, bottom: 20, trailing: 22)
    static let contentInset = EdgeInsets(top: 16, leading: 16, bottom: 18, trailing: 16)
    static let cardSpacing: CGFloat = 12
    static let maxContentWidth: CGFloat = 900
}

extension View {
    func nativeSettingsContentLayout() -> some View {
        self
            .padding(NativeSettingsLayout.contentInset)
            .frame(maxWidth: NativeSettingsLayout.maxContentWidth, alignment: .topLeading)
            .frame(maxWidth: .infinity, alignment: .top)
    }
}

enum NativeSettingsTab: String, CaseIterable, Identifiable {
    case general
    case accessibility
    case gateway
    case model
    case speech
    case memory
    case lab
    case wallet
    case updates
    case migration
    case features
    case advanced
    case agents
    case providers
    case router
    case channels
    case mobile
    case plugins
    case mcp
    case skills
    case tools
    case logs

    var id: String { rawValue }

    var titleKey: String {
        switch self {
        case .general: return "settings.general"
        case .accessibility: return "settings.accessibility"
        case .gateway: return "settings.gateway"
        case .model: return "settings.ai"
        case .speech: return "settings.voice"
        case .memory: return "nav.memory"
        case .lab: return "settings.lab"
        case .wallet: return "nav.wallet"
        case .updates: return "settings.updates"
        case .migration: return "settings.migration"
        case .features: return "settings.safety"
        case .advanced: return "nav.system"
        case .agents: return "nav.agents"
        case .providers: return "nav.providers"
        case .router: return "nav.router"
        case .channels: return "nav.channels"
        case .mobile: return "nav.mobile"
        case .plugins: return "nav.plugins"
        case .mcp: return "nav.mcp"
        case .skills: return "nav.skills"
        case .tools: return "nav.tools"
        case .logs: return "nav.logs"
        }
    }

    var systemImage: String {
        switch self {
        case .general: return "switch.2"
        case .accessibility: return "accessibility"
        case .gateway: return "server.rack"
        case .model: return "brain"
        case .speech: return "waveform"
        case .memory: return "memorychip"
        case .lab: return "flask"
        case .wallet: return "creditcard"
        case .updates: return "arrow.down.circle"
        case .migration: return "folder.badge.gearshape"
        case .features: return "checkmark.shield"
        case .advanced: return "gearshape.2"
        case .agents: return "cpu"
        case .providers: return "server.rack"
        case .router: return "point.3.connected.trianglepath.dotted"
        case .channels: return "link"
        case .mobile: return "iphone.gen3"
        case .plugins: return "puzzlepiece.extension"
        case .mcp: return "network"
        case .skills: return "wand.and.stars"
        case .tools: return "wrench.and.screwdriver"
        case .logs: return "list.bullet.rectangle"
        }
    }
}

struct NativeSettingsScreen: View {
    let client: GatewayClient
    var onAccentChanged: (String) -> Void = { _ in }

    @EnvironmentObject var sidecar: SidecarManager
    @EnvironmentObject var updateChecker: UpdateChecker

    @State var selectedTab: NativeSettingsTab
    @State var advancedSelection: SettingsAdvancedSection = .router
    @AppStorage("cybara.petEnabled") var petEnabled = false
    @State var health: GatewayHealth?
    @State var buildInfo: GatewayBuildInfo?
    @State var config: [String: Any] = [:]
    @State var providers: [GatewayProvider] = []
    @State var agents: [GatewayAgent] = []
    @State var defaultAgentId = ""
    @State var backgroundAgentId = ""
    @State var visionFallbackAgentId = ""
    @State var gatewayLogs: [GatewayLogEntry] = []
    @State var gatewayRestarting = false
    @State var selectedAccent = "indigo"
    @State var defaultModel = ""
    @State var reasoningEffort = ""
    @State var followUpBehaviorEnabled = true
    @State var chatAppearance = NativeChatAppearanceSettings()
    @State var terminalEnabled = false
    @State var acpEnabled = true
    @State var selfImprovingSkills = true
    @State var webPolicyEnabled = false
    @State var webFetchHosts = ""
    @State var webSearchHosts = ""
    @State var computerUseStatus: GatewayComputerUseStatus?
    @State var computerUseDriverPath = ""
    @State var computerUseBusy = false
    @State var dangerousPolicyEnabled = false
    @State var dangerousPolicyMode = "audit"
    @State var toolApprovalMode = "always_allow"
    @State var sandboxEnabled = false
    @State var sandboxProvider = "auto"
    @State var sandboxNetwork = "deny"
    @State var sandboxRemoteURL = ""
    @State var sandboxRemoteAPIKey = ""
    @State var sandboxRemoteAPIKeyConfigured = false
    @State var speechTTSProvider = "auto"
    @State var speechTTSProviderId = ""
    @State var speechTTSModel = ""
    @State var speechTTSVoice = ""
    @State var speechTTSFormat = "mp3"
    @State var speechTTSFallback = true
    @State var speechSTTProvider = "auto"
    @State var speechSTTProviderId = ""
    @State var speechSTTModel = ""
    @State var speechSTTLanguage = ""
    @State var speechRealtimeProvider = "managed"
    @State var speechRealtimeProviderId = ""
    @State var speechRealtimeModel = ""
    @State var speechRealtimeVoice = ""
    @State var speechRealtimeServerURL = ""
    @State var speechRealtimeBargeIn = true
    @State var speechRealtimeSilence = "700"
    @State var memoryBackgroundReview = true
    @State var memoryFlushEnabled = true
    @State var memoryFlushThreshold = "4000"
    @State var llmFirstTokenSeconds = "300"
    @State var llmStallSeconds = "300"
    @State var llmTotalSeconds = "0"
    @State var llmNonStreamingSeconds = "1800"
    @State var memoryProvider = "local"
    @State var memoryAutoRecall = true
    @State var memoryAutoCapture = true
    @State var memoryProviderFields: [String: String] = [:]
    @State var memoryTestResult: String?
    @State var labEnabled = true
    @State var labGoldenTurnsEnabled = true
    @State var labTrajectoryCaptureEnabled = true
    @State var labSanitizeExportsByDefault = true
    @State var labDefaultExportFormat = "distillation_sft"
    @State var memoryTestOK = false
    @State var memoryTesting = false
    @State var indexEnabled = false
    @State var indexSemantic = false
    @State var indexHidden = false
    @State var indexAutoReindex = false
    @State var indexEmbeddingProvider = "auto"
    @State var indexEmbeddingModel = ""
    @State var savingKey: String?
    @State var copiedURL = false
    @State var error: String?
    @State var authKeyPreview = ""
    @State var authKeySource = ""
    @State var authRequireLocalhost = false
    @State var authRequireForced = false
    @State var authGatewayPasswordEnabled = false
    @State var gatewayPasswordDraft = ""
    @State var gatewayPasswordConfirm = ""
    @State var remoteAccessEnabled = false
    @State var remoteAccessMode = "private_overlay"
    @State var remoteAccessProvider = "tailscale"
    @State var remoteAccessBaseURL = ""
    @State var remoteAccessMessage = ""
    @State var remoteAccessReady = false
    @State var authAvailable = false
    @State var authRevealedKey: String?
    @State var authCopied = false
    @State var authBusy = false
    @State var showRotateConfirm = false
    @State var defaultWorkspaceDir = ""
    @State var cybaraDataDir = ""
    @State var configuredCybaraDataDir = ""
    @State var cybaraDataDirSource = "default"
    @State var cybaraDataDirForced = false
    @State var cybaraDataDirRestartRequired = false
    @State var cybaraDataDirOverrideFile = ""
    @State var defaultCybaraDataDir = ""
    @State var migrationSources: [GatewayMigrationSource] = []
    @State var migrationSourceKind = "openclaw"
    @State var migrationSourcePath = ""
    @State var migrationPreset = "user-data"
    @State var migrationSkillConflict = "skip"
    @State var migrationWorkspaceTarget = ""
    @State var migrationImportSecrets = false
    @State var migrationOverwrite = false
    @State var migrationBusy = false
    @State var migrationReport: GatewayMigrationReport?
    @State var migrationMessage: String?

    var availableModels: [String] {
        Array(Set(providers.flatMap { $0.models ?? [] })).sorted()
    }

    var ttsProviderAccounts: [GatewayProvider] {
        providers.filter { provider in
            ["elevenlabs", "openai", "openai-codex"].contains(provider.providerType)
        }
    }

    var sttProviderAccounts: [GatewayProvider] {
        providers.filter { provider in
            ["openai", "openai-codex"].contains(provider.providerType)
        }
    }

    var realtimeProviderAccounts: [GatewayProvider] {
        providers.filter { provider in
            if speechRealtimeProvider == "openai" { return provider.providerType == "openai" }
            return ["google", "gemini", "google-ai", "google_ai"].contains(provider.providerType)
        }
    }

    init(
        client: GatewayClient,
        initialTab: NativeSettingsTab = .general,
        onAccentChanged: @escaping (String) -> Void = { _ in }
    ) {
        self.client = client
        self.onAccentChanged = onAccentChanged
        _selectedTab = State(initialValue: initialTab)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ScreenHeader(title: NativeI18n.t("nav.settings"), subtitle: NativeI18n.t("settings.subtitle"))

            HStack(spacing: 0) {
                ScrollView {
                    LazyVStack(spacing: 2) {
                        ForEach(NativeSettingsTab.allCases) { tab in
                            Button {
                                selectedTab = tab
                            } label: {
                                Label(NativeI18n.t(tab.titleKey), systemImage: tab.systemImage)
                                    .font(.system(size: 12, weight: .medium, design: .rounded))
                                    .foregroundStyle(selectedTab == tab ? Color.primary : Color.secondary)
                                    .lineLimit(1)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 7)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .background {
                                if selectedTab == tab {
                                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                                        .fill(Color.accentColor.opacity(0.14))
                                }
                            }
                            .help(NativeI18n.t(tab.titleKey))
                        }
                    }
                    .padding(8)
                }
                .frame(width: 180)

                Divider()

                settingsDetail
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

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

    @ViewBuilder
    var settingsDetail: some View {
        switch selectedTab {
        case .general: generalTab
        case .accessibility: accessibilityTab
        case .gateway: gatewayTab
        case .model: modelTab
        case .speech: speechTab
        case .memory:
            TabView {
                memoryTab
                    .tabItem { Label("Behavior", systemImage: "slider.horizontal.3") }
                MemoryScreen(client: client)
                    .tabItem { Label("Stored Memory", systemImage: "tray.full") }
            }
        case .lab: labTab
        case .wallet: WalletScreen(client: client)
        case .updates: updatesTab
        case .migration: migrationTab
        case .features:
            TabView {
                featuresTab
                    .tabItem { Label("Runtime", systemImage: "checkmark.shield") }
                NativeToolCapabilitySettingsScreen(client: client)
                    .tabItem { Label("Capabilities", systemImage: "key.horizontal") }
                NativeBrowserSupervisionSettingsScreen(client: client)
                    .tabItem { Label("Browser", systemImage: "globe") }
            }
        case .advanced: advancedTab
        case .agents: AgentsScreen(client: client)
        case .providers: ProvidersScreen(client: client)
        case .router: RouterScreen(client: client)
        case .channels: ChannelsScreen(client: client)
        case .mobile: MobileScreen(client: client, defaultBaseURL: sidecar.serverURL)
        case .plugins: PluginsScreen(client: client)
        case .mcp: MCPScreen(client: client)
        case .skills: NativeSkillsScreen(client: client)
        case .tools: ToolsScreen(client: client)
        case .logs: LogsScreen(client: client)
        }
    }

}
