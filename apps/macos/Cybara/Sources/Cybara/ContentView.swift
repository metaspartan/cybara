import AppKit
import SwiftUI

enum CybaraAccent {
    static let orderedKeys = [
        "indigo",
        "blue",
        "cyan",
        "teal",
        "emerald",
        "amber",
        "orange",
        "rose",
        "pink",
        "purple",
    ]

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

    static func label(for key: String) -> String {
        key.split(separator: "-")
            .map { $0.capitalized }
            .joined(separator: " ")
    }
}

private struct CybaraAccentKey: EnvironmentKey {
    static let defaultValue: Color = .accentColor
}

extension EnvironmentValues {
    var cybaraAccent: Color {
        get { self[CybaraAccentKey.self] }
        set { self[CybaraAccentKey.self] = newValue }
    }
}

enum NativeDestination: String, CaseIterable, Identifiable {
    case dashboard
    case chat
    case agents
    case providers
    case router
    case channels
    case mobile
    case voice
    case plugins
    case mcp
    case lsp
    case ide
    case sessions
    case usage
    case evals
    case skills
    case tools
    case terminal
    case memory
    case journey
    case wallet
    case artifacts
    case tasks
    case metrics
    case logs
    case settings

    var id: String { rawValue }

    var title: String {
        NativeI18n.t(titleKey)
    }

    var titleKey: String {
        switch self {
        case .dashboard: return "nav.dashboard"
        case .chat: return "nav.chat"
        case .agents: return "nav.agents"
        case .providers: return "nav.providers"
        case .router: return "nav.router"
        case .channels: return "nav.channels"
        case .mobile: return "nav.mobile"
        case .voice: return "settings.voice"
        case .plugins: return "nav.plugins"
        case .mcp: return "nav.mcp"
        case .lsp: return "nav.lsp"
        case .ide: return "nav.ide"
        case .sessions: return "nav.sessions"
        case .usage: return "nav.usage"
        case .evals: return "nav.evals"
        case .skills: return "nav.skills"
        case .tools: return "nav.tools"
        case .terminal: return "nav.terminal"
        case .memory: return "nav.memory"
        case .journey: return "nav.journey"
        case .wallet: return "nav.wallet"
        case .artifacts: return "nav.artifacts"
        case .tasks: return "nav.tasks"
        case .metrics: return "nav.metrics"
        case .logs: return "nav.logs"
        case .settings: return "nav.settings"
        }
    }

    var systemImage: String {
        switch self {
        case .dashboard: return "square.grid.2x2"
        case .chat: return "bubble.left.and.bubble.right"
        case .agents: return "cpu"
        case .providers: return "server.rack"
        case .router: return "point.3.connected.trianglepath.dotted"
        case .channels: return "link"
        case .mobile: return "iphone.gen3"
        case .voice: return "waveform.circle"
        case .plugins: return "puzzlepiece.extension"
        case .mcp: return "network"
        case .lsp: return "curlybraces.square"
        case .ide: return "folder"
        case .sessions: return "bubble.left.and.text.bubble.right"
        case .usage: return "gauge.with.dots.needle.67percent"
        case .evals: return "flask"
        case .skills: return "wand.and.stars"
        case .tools: return "wrench.and.screwdriver"
        case .terminal: return "terminal"
        case .memory: return "brain"
        case .journey: return "sparkles"
        case .wallet: return "creditcard"
        case .artifacts: return "doc.text"
        case .tasks: return "calendar.badge.clock"
        case .metrics: return "chart.bar"
        case .logs: return "list.bullet.rectangle"
        case .settings: return "gearshape"
        }
    }
}

struct ContentView: View {
    @EnvironmentObject private var sidecar: SidecarManager
    @Environment(\.openURL) private var openURL
    @State private var destination: NativeDestination = .dashboard
    @State private var accent: Color = .accentColor
    @State private var selectedChatSessionID: String?
    @State private var settingsTab = NativeSettingsTab.general
    @State private var chatSearchPresented = false

    private var client: GatewayClient {
        GatewayClient(baseURL: sidecar.serverURL)
    }

    var body: some View {
        NavigationSplitView {
            sidebar
                .navigationSplitViewColumnWidth(min: 196, ideal: 220, max: 272)
        } detail: {
            detail
        }
        .navigationSplitViewStyle(.balanced)
        .tint(accent)
        .environment(\.cybaraAccent, accent)
        .task(id: sidecar.isReady) {
            guard sidecar.isReady else { return }
            if let key = try? await client.themeAccent() {
                accent = CybaraAccent.color(for: key)
            }
        }
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
        .onReceive(NotificationCenter.default.publisher(for: .cybaraThemeAccentChanged)) { notification in
            guard let key = notification.object as? String else { return }
            accent = CybaraAccent.color(for: key)
        }
        .onReceive(NotificationCenter.default.publisher(for: .cybaraPetOpenChat)) { _ in
            destination = .chat
        }
        .onReceive(NotificationCenter.default.publisher(for: .cybaraOpenChat)) { _ in
            destination = .chat
            selectedChatSessionID = nil
        }
        .onReceive(NotificationCenter.default.publisher(for: .cybaraOpenUsage)) { _ in
            destination = .usage
        }
        .onReceive(NotificationCenter.default.publisher(for: .cybaraOpenSettings)) { _ in
            destination = .settings
        }
        .onAppear {
            PetPanelController.shared.setVisible(PetPanelController.isEnabled)
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
                window.identifier = NSUserInterfaceItemIdentifier("CybaraMainWindow")
                window.setFrameAutosaveName("CybaraMainWindow")
                window.setFrameUsingName("CybaraMainWindow")
            }
        )
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                CybaraLogo(size: 34)
                Text("Cybara")
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                Spacer()
                Button {
                    chatSearchPresented = true
                } label: {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 14, weight: .medium))
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help("Search chats")
                .keyboardShortcut("k", modifiers: .command)
                .popover(isPresented: $chatSearchPresented, arrowEdge: .top) {
                    NativeChatSearchPopover(client: client) { sessionID in
                        selectedChatSessionID = sessionID
                        destination = .chat
                        chatSearchPresented = false
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 8)

            VStack(spacing: 2) {
                Button {
                    selectedChatSessionID = nil
                    destination = .chat
                } label: {
                    Label("New Chat", systemImage: "square.and.pencil")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 6)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.secondary)

                ForEach([NativeDestination.dashboard, .usage]) { item in
                    Button {
                        destination = item
                    } label: {
                        Label(item.title, systemImage: item.systemImage)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .background(destination == item ? accent.opacity(0.14) : Color.clear, in: RoundedRectangle(cornerRadius: 7))
                }

                Menu {
                    ForEach([NativeDestination.ide, .voice, .evals, .terminal, .lsp, .sessions, .journey, .wallet, .artifacts, .metrics, .tasks]) { item in
                        Button {
                            destination = item
                        } label: {
                            Label(item.title, systemImage: item.systemImage)
                        }
                    }
                } label: {
                    Label("More", systemImage: "ellipsis")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 6)
                }
                .menuStyle(.borderlessButton)
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 6)

            Divider()

            NativePrimarySessionList(client: client, selectedSessionID: $selectedChatSessionID) {
                destination = .chat
            }

            Divider()

            Button {
                destination = .settings
            } label: {
                Label(NativeDestination.settings.title, systemImage: NativeDestination.settings.systemImage)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 7)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(destination == .settings ? Color.primary : Color.secondary)
            .background {
                if destination == .settings {
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .fill(accent.opacity(0.16))
                }
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 8)
        }
    }

    @ViewBuilder
    private var detail: some View {
        if !sidecar.isReady && destination != .settings {
            startingView
        } else {
            switch destination {
            case .dashboard:
                DashboardScreen(client: client) { session in
                    selectedChatSessionID = session.id
                    destination = .chat
                }
            case .chat:
                ChatScreen(
                    client: client,
                    selectedSessionID: $selectedChatSessionID,
                    showsSessionList: false,
                    openCybaraIDEWorkspace: { workspace in
                        UserDefaults.standard.set(workspace, forKey: "cybara.ide.pendingWorkspacePath")
                        destination = .ide
                    }
                )
            case .mobile:
                MobileScreen(client: client, defaultBaseURL: sidecar.serverURL)
            case .voice:
                NativeVoiceScreen(client: client) {
                    settingsTab = .speech
                    destination = .settings
                }
            case .plugins:
                PluginsScreen(client: client)
            case .agents:
                AgentsScreen(client: client)
            case .providers:
                ProvidersScreen(client: client)
            case .router:
                RouterScreen(client: client)
            case .channels:
                ChannelsScreen(client: client)
            case .mcp:
                MCPScreen(client: client)
            case .lsp:
                LSPScreen(client: client)
            case .ide:
                IDEScreen(client: client)
            case .sessions:
                SessionsManagementScreen(client: client) { session in
                    selectedChatSessionID = session.id
                    destination = .chat
                }
            case .usage:
                UsageScreen(client: client)
            case .evals:
                NativeEvalsScreen(client: client)
            case .tools:
                ToolsScreen(client: client)
            case .terminal:
                TerminalScreen(client: client)
            case .artifacts:
                ArtifactsScreen(client: client)
            case .tasks:
                TasksScreen(client: client) { sessionID in
                    selectedChatSessionID = sessionID
                    destination = .chat
                }
            case .metrics:
                MetricsScreen(client: client)
            case .memory:
                MemoryScreen(client: client)
            case .journey:
                JourneyScreen(client: client)
            case .wallet:
                WalletScreen(client: client)
            case .skills:
                NativeSkillsScreen(client: client)
            case .logs:
                LogsScreen(client: client)
            case .settings:
                NativeSettingsScreen(client: client, initialTab: settingsTab) { key in
                    accent = CybaraAccent.color(for: key)
                }
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
            Text(NativeI18n.t("status.waitingGateway"))
                .font(.system(size: 13, weight: .regular, design: .rounded))
                .foregroundStyle(.secondary)
        }
        .padding(32)
        .cybaraGlass(cornerRadius: 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct NativePrimarySessionList: View {
    let client: GatewayClient
    @Binding var selectedSessionID: String?
    let openChat: () -> Void

    @State private var sessions: [GatewaySession] = []
    @State private var collapsedGroupIDs: Set<String> = []

    var body: some View {
        VStack(spacing: 0) {
            List {
                if sessions.isEmpty {
                    Text("No chats yet")
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.secondary)
                }
                ForEach(nativeSessionGroups(sessions)) { group in
                    Section {
                        if group.kind == .pinned || !collapsedGroupIDs.contains(group.id) {
                            ForEach(group.sessions) { session in
                                Button {
                                    selectedSessionID = session.id
                                    openChat()
                                } label: {
                                    HStack(spacing: 6) {
                                        if session.pinned == true {
                                            Image(systemName: "pin.fill")
                                                .font(.system(size: 9))
                                                .foregroundStyle(.secondary)
                                        }
                                        Text(session.displayTitle)
                                            .font(.system(size: 12, weight: .medium, design: .rounded))
                                            .lineLimit(1)
                                        Spacer(minLength: 4)
                                        Text(compactRelativeTimestamp(session.updated_at ?? session.created_at))
                                            .font(.system(size: 10, design: .rounded))
                                            .foregroundStyle(.tertiary)
                                    }
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    } header: {
                        Button {
                            guard group.kind != .pinned else { return }
                            if collapsedGroupIDs.contains(group.id) {
                                collapsedGroupIDs.remove(group.id)
                            } else {
                                collapsedGroupIDs.insert(group.id)
                            }
                        } label: {
                            HStack(spacing: 5) {
                                if group.kind != .pinned {
                                    Image(systemName: collapsedGroupIDs.contains(group.id) ? "chevron.right" : "chevron.down")
                                        .font(.system(size: 9, weight: .semibold))
                                }
                                if group.kind == .workspace {
                                    Image(systemName: "folder")
                                }
                                Text(group.label).lineLimit(1)
                                Spacer(minLength: 4)
                                Text("\(group.sessions.count)")
                            }
                            .font(.system(size: 10, weight: .medium, design: .rounded))
                            .foregroundStyle(.secondary)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .listStyle(.sidebar)
        }
        .task {
            while !Task.isCancelled {
                if let loaded = try? await client.sessions(limit: 150) {
                    sessions = loaded
                }
                try? await Task.sleep(nanoseconds: 4_000_000_000)
            }
        }
    }
}

private struct NativeChatSearchPopover: View {
    let client: GatewayClient
    let selectSession: (String) -> Void

    @State private var sessions: [GatewaySession] = []
    @State private var query = ""
    @State private var loading = true
    @FocusState private var searchFocused: Bool

    private var results: [GatewaySession] {
        let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !normalized.isEmpty else { return sessions }
        return sessions.filter { session in
            session.displayTitle.lowercased().contains(normalized)
                || (session.workspace_dir ?? "").lowercased().contains(normalized)
                || (session.last_message?.preview ?? "").lowercased().contains(normalized)
                || session.id.lowercased().contains(normalized)
        }
    }

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.tertiary)
                TextField("Search chats", text: $query)
                    .textFieldStyle(.plain)
                    .font(.system(size: 13, design: .rounded))
                    .focused($searchFocused)
                    .onSubmit {
                        if let first = results.first {
                            selectSession(first.id)
                        }
                    }
                if !query.isEmpty {
                    Button {
                        query = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.tertiary)
                    }
                    .buttonStyle(.plain)
                    .help("Clear search")
                }
            }
            .padding(.horizontal, 11)
            .frame(height: 38)
            .background(.quaternary.opacity(0.55), in: RoundedRectangle(cornerRadius: 10, style: .continuous))

            ScrollView {
                LazyVStack(spacing: 3) {
                    if loading {
                        ProgressView()
                            .controlSize(.small)
                            .frame(maxWidth: .infinity, minHeight: 96)
                    } else if results.isEmpty {
                        Text(query.isEmpty ? "No chats yet" : "No matching chats")
                            .font(.system(size: 12, design: .rounded))
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, minHeight: 96)
                    } else {
                        ForEach(results) { session in
                            Button {
                                selectSession(session.id)
                            } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: "bubble.left")
                                        .font(.system(size: 12, weight: .medium))
                                        .foregroundStyle(.tertiary)
                                        .frame(width: 18)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(session.displayTitle)
                                            .font(.system(size: 12, weight: .semibold, design: .rounded))
                                            .lineLimit(1)
                                        Text(session.workspaceLabel ?? "No workspace")
                                            .font(.system(size: 10, design: .rounded))
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
                                            .truncationMode(.middle)
                                    }
                                    Spacer(minLength: 8)
                                    Text(compactRelativeTimestamp(session.updated_at ?? session.created_at))
                                        .font(.system(size: 10, design: .rounded))
                                        .foregroundStyle(.tertiary)
                                }
                                .padding(.horizontal, 9)
                                .padding(.vertical, 7)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .frame(maxHeight: 330)
        }
        .padding(10)
        .frame(width: 390)
        .task {
            loading = true
            sessions = (try? await client.sessions(limit: 150)) ?? []
            loading = false
            searchFocused = true
        }
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
