import AppKit
import SwiftUI

enum NativeDestination: String, CaseIterable, Identifiable {
    case dashboard
    case chat
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
        .background(
            VisualEffectBackground()
                .overlay(
                    LinearGradient(
                        colors: [
                            Color(red: 0.05, green: 0.08, blue: 0.16).opacity(0.72),
                            Color(red: 0.02, green: 0.05, blue: 0.10).opacity(0.72),
                            Color(red: 0.02, green: 0.10, blue: 0.18).opacity(0.72),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
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
                Image(systemName: "hexagon.fill")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(Color.accentColor)
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
                    ForEach([NativeDestination.dashboard, .chat, .agents, .providers, .tasks]) { item in
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
            .scrollContentBackground(.hidden)
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
