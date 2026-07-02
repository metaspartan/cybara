import AppKit
import SwiftUI

// Accent palette shared with the web/Tauri and mobile UIs; the key is synced
// through gateway config so all clients highlight in the same color.
enum CybaraAccent {
    static let palette: [String: Color] = [
        "indigo": Color(red: 0.388, green: 0.400, blue: 0.945),
        "blue": Color(red: 0.231, green: 0.510, blue: 0.965),
        "cyan": Color(red: 0.024, green: 0.714, blue: 0.831),
        "teal": Color(red: 0.078, green: 0.722, blue: 0.651),
        "emerald": Color(red: 0.063, green: 0.725, blue: 0.506),
        "amber": Color(red: 0.961, green: 0.620, blue: 0.043),
        "orange": Color(red: 0.976, green: 0.451, blue: 0.086),
        "rose": Color(red: 0.957, green: 0.247, blue: 0.369),
        "pink": Color(red: 0.925, green: 0.282, blue: 0.600),
        "purple": Color(red: 0.659, green: 0.333, blue: 0.969),
    ]

    static func color(for key: String?) -> Color {
        guard let key, let color = palette[key.lowercased()] else { return .accentColor }
        return color
    }
}

private struct CybaraAccentKey: EnvironmentKey {
    static let defaultValue: Color = .accentColor
}

extension EnvironmentValues {
    /// The gateway-synced highlight color, matching web/Tauri and mobile.
    var cybaraAccent: Color {
        get { self[CybaraAccentKey.self] }
        set { self[CybaraAccentKey.self] = newValue }
    }
}

enum NativeDestination: String, CaseIterable, Identifiable {
    case dashboard
    case chat
    case mobile
    case agents
    case providers
    case tasks
    case memory
    case metrics
    case router
    case systemPrompt
    case channels
    case wallet
    case skills
    case logs
    case gateway
    case webUI

    var id: String { rawValue }

    var title: String {
        switch self {
        case .dashboard: return "Dashboard"
        case .chat: return "Chat"
        case .mobile: return "Mobile"
        case .agents: return "Agents"
        case .providers: return "Providers"
        case .tasks: return "Tasks"
        case .memory: return "Memory"
        case .metrics: return "Metrics"
        case .router: return "Model Router"
        case .systemPrompt: return "System Prompt"
        case .channels: return "Channels"
        case .wallet: return "Wallet"
        case .skills: return "Skills"
        case .logs: return "Logs"
        case .gateway: return "Gateway"
        case .webUI: return "Web UI"
        }
    }

    var systemImage: String {
        switch self {
        case .dashboard: return "square.grid.2x2"
        case .chat: return "bubble.left.and.bubble.right"
        case .mobile: return "iphone.gen3"
        case .agents: return "cpu"
        case .providers: return "shippingbox"
        case .tasks: return "calendar.badge.clock"
        case .memory: return "brain"
        case .metrics: return "chart.bar"
        case .router: return "point.3.connected.trianglepath.dotted"
        case .systemPrompt: return "sparkles"
        case .channels: return "link"
        case .wallet: return "creditcard"
        case .skills: return "wand.and.stars"
        case .logs: return "list.bullet.rectangle"
        case .gateway: return "server.rack"
        case .webUI: return "globe"
        }
    }
}

struct ContentView: View {
    @EnvironmentObject private var sidecar: SidecarManager
    @Environment(\.openURL) private var openURL
    @State private var destination: NativeDestination = .dashboard
    @State private var accent: Color = .accentColor

    private var client: GatewayClient {
        GatewayClient(baseURL: sidecar.serverURL)
    }

    var body: some View {
        NavigationSplitView {
            sidebar
                .navigationSplitViewColumnWidth(min: 210, ideal: 235, max: 280)
        } detail: {
            detail
        }
        .tint(accent)
        .environment(\.cybaraAccent, accent)
        .task(id: sidecar.isReady) {
            guard sidecar.isReady else { return }
            if let key = try? await client.themeAccent() {
                accent = CybaraAccent.color(for: key)
            }
        }
        .background(
            VisualEffectBackground()
                .ignoresSafeArea()
        )
        .onReceive(NotificationCenter.default.publisher(for: .cybaraRestartSidecar)) { _ in
            Task { await sidecar.restart() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .cybaraOpenInBrowser)) { _ in
            openURL(sidecar.serverURL)
        }
        .onReceive(NotificationCenter.default.publisher(for: .cybaraCopyURL)) { _ in
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(sidecar.serverURL.absoluteString, forType: .string)
        }
        .onOpenURL { url in
            switch SidecarCore.parseDeepLink(url) {
            case .focus:
                NSApplication.shared.activate(ignoringOtherApps: true)
            case .restart:
                Task { await sidecar.restart() }
            case .openBrowser:
                openURL(sidecar.serverURL)
            case .none:
                break
            }
        }
        .background(
            WindowAccessor { window in
                window.setFrameAutosaveName("CybaraMainWindow")
            }
        )
    }

    // ─── Sidebar ─────────────────────────────────────────────────────────────

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                CybaraLogo(size: 34)
                VStack(alignment: .leading, spacing: 0) {
                    Text("Cybara")
                        .font(.system(size: 18, weight: .bold, design: .rounded))
                    Text(sidecar.isReady ? "Gateway online" : "Starting…")
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(sidecar.isReady ? Color.green : Color.secondary)
                }
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 8)

            List(selection: $destination) {
                Section {
                    ForEach([NativeDestination.dashboard, .chat, .mobile, .agents, .providers, .tasks]) { item in
                        Label(item.title, systemImage: item.systemImage)
                            .tag(item)
                    }
                }
                Section("Intelligence") {
                    ForEach([NativeDestination.memory, .metrics, .router, .systemPrompt, .channels, .wallet, .skills]) { item in
                        Label(item.title, systemImage: item.systemImage)
                            .tag(item)
                    }
                }
                Section("System") {
                    ForEach([NativeDestination.logs, .gateway, .webUI]) { item in
                        Label(item.title, systemImage: item.systemImage)
                            .tag(item)
                    }
                }
            }
            .listStyle(.sidebar)
        }
    }

    // ─── Detail ──────────────────────────────────────────────────────────────

    @ViewBuilder
    private var detail: some View {
        if !sidecar.isReady && destination != .gateway {
            startingView
        } else {
            switch destination {
            case .dashboard:
                DashboardScreen(client: client)
            case .chat:
                ChatScreen(client: client)
            case .mobile:
                MobileScreen(client: client, defaultBaseURL: sidecar.serverURL)
            case .agents:
                AgentsScreen(client: client)
            case .providers:
                ProvidersScreen(client: client)
            case .tasks:
                TasksScreen(client: client)
            case .memory:
                MemoryScreen(client: client)
            case .metrics:
                MetricsScreen(client: client)
            case .router:
                RouterScreen(client: client)
            case .systemPrompt:
                SystemPromptScreen(client: client)
            case .channels:
                ChannelsScreen(client: client)
            case .wallet:
                WalletScreen(client: client)
            case .skills:
                SkillsScreen(client: client)
            case .logs:
                LogsScreen(client: client)
            case .gateway:
                GatewayScreen()
            case .webUI:
                webUIDetail
            }
        }
    }

    private var startingView: some View {
        VStack(spacing: 14) {
            CybaraLogo(size: 72)
            ProgressView()
                .progressViewStyle(.circular)
                .controlSize(.large)
            Text(sidecar.statusMessage)
                .font(.system(size: 15, weight: .medium, design: .rounded))
            Text("Waiting for the local Cybara gateway to come online.")
                .font(.system(size: 13, weight: .regular, design: .rounded))
                .foregroundStyle(.secondary)
        }
        .padding(32)
        .cybaraGlass(cornerRadius: 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var webUIDetail: some View {
        ZStack {
            if sidecar.isReady {
                CybaraWebView(
                    url: sidecar.serverURL,
                    gatewayPort: sidecar.port,
                    managesGateway: sidecar.managesGateway
                )
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .padding(14)
            } else {
                startingView
            }
        }
    }
}

// ─── Gateway (sidecar controls + logs) ───────────────────────────────────────

struct GatewayScreen: View {
    @EnvironmentObject private var sidecar: SidecarManager
    @Environment(\.openURL) private var openURL

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ScreenHeader(title: "Gateway", subtitle: "Local Cybara sidecar runtime")

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            StatusPill(status: sidecar.status)
                            Spacer()
                            Text(sidecar.serverURL.absoluteString)
                                .font(.system(size: 12, weight: .medium, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                        VStack(alignment: .leading, spacing: 8) {
                            Label(sidecar.binaryPath, systemImage: "shippingbox")
                                .font(.system(size: 12, weight: .medium, design: .monospaced))
                                .lineLimit(2)
                            Label(
                                sidecar.managesGateway ? "Managed gateway" : "Attached gateway",
                                systemImage: sidecar.managesGateway ? "server.rack" : "link"
                            )
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(.secondary)
                            Text(sidecar.statusMessage)
                                .font(.system(size: 13, weight: .regular, design: .rounded))
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Controls")
                            .font(.system(size: 16, weight: .semibold, design: .rounded))
                        HStack(spacing: 10) {
                            Button("Restart") {
                                Task { await sidecar.restart() }
                            }
                            .buttonStyle(.borderedProminent)
                            Button("Open Browser") {
                                openURL(sidecar.serverURL)
                            }
                            .buttonStyle(.bordered)
                            Button("Copy URL") {
                                NSPasteboard.general.clearContents()
                                NSPasteboard.general.setString(
                                    sidecar.serverURL.absoluteString, forType: .string)
                            }
                            .buttonStyle(.bordered)
                            Button("Reveal Binary") {
                                sidecar.revealBinary()
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Sidecar Logs")
                            .font(.system(size: 16, weight: .semibold, design: .rounded))
                        LazyVStack(alignment: .leading, spacing: 8) {
                            ForEach(sidecar.logs.indices, id: \.self) { index in
                                Text(sidecar.logs[index])
                                    .font(.system(size: 11, weight: .regular, design: .monospaced))
                                    .textSelection(.enabled)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }
                }
            }
            .padding(24)
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var sidecar: SidecarManager

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Cybara Settings")
                .font(.system(size: 22, weight: .bold, design: .rounded))

            Text("Set `CYBARA_NATIVE_SIDECAR_PATH` to point at a compiled Cybara binary or Tauri sidecar. Set `CYBARA_NATIVE_PORT` to override the local server port.")
                .font(.system(size: 13, weight: .regular, design: .rounded))
                .foregroundStyle(.secondary)

            GlassCard {
                VStack(alignment: .leading, spacing: 8) {
                    Label(sidecar.binaryPath, systemImage: "shippingbox")
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                    Label(sidecar.serverURL.absoluteString, systemImage: "network")
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                }
            }

            Spacer()
        }
        .padding(24)
        .frame(minWidth: 460, minHeight: 300)
    }
}

struct GlassCard<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .cybaraGlass(cornerRadius: 18)
    }
}

struct StatusPill: View {
    let status: SidecarManager.Status

    var body: some View {
        Label(label, systemImage: symbol)
            .font(.system(size: 12, weight: .semibold, design: .rounded))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(tint.opacity(0.2)))
            .foregroundStyle(tint)
    }

    private var label: String { status.title }

    private var symbol: String {
        switch status {
        case .idle: return "pause.circle"
        case .starting: return "clock"
        case .ready: return "checkmark.circle"
        case .stopped: return "stop.circle"
        case .failed: return "exclamationmark.triangle"
        }
    }

    private var tint: Color {
        switch status {
        case .idle, .stopped: return .secondary
        case .starting: return .orange
        case .ready: return .green
        case .failed: return .red
        }
    }
}
