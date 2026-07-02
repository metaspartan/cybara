import SwiftUI

// ─── Shared bits ─────────────────────────────────────────────────────────────

struct ScreenHeader: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 26, weight: .bold, design: .rounded))
            Text(subtitle)
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct LoadFailedView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(.secondary)
            Text(message)
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Retry", action: retry)
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(32)
    }
}

func relativeTimestamp(_ iso: String?) -> String {
    guard let iso else { return "" }
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = fractional.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else {
        return ""
    }
    let formatter = RelativeDateTimeFormatter()
    formatter.unitsStyle = .abbreviated
    return formatter.localizedString(for: date, relativeTo: Date())
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

struct DashboardScreen: View {
    let client: GatewayClient
    @EnvironmentObject private var sidecar: SidecarManager

    @State private var health: GatewayHealth?
    @State private var agents: [GatewayAgent] = []
    @State private var sessions: [GatewaySession] = []
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ScreenHeader(title: "Dashboard", subtitle: "Local gateway status and activity")

                HStack(spacing: 14) {
                    statTile(
                        label: "Gateway",
                        value: health?.status?.capitalized ?? "…",
                        detail: sidecar.serverURL.absoluteString,
                        systemImage: "server.rack"
                    )
                    statTile(
                        label: "Version",
                        value: health?.version.map { "v\($0)" } ?? "…",
                        detail: uptimeLabel,
                        systemImage: "shippingbox"
                    )
                    statTile(
                        label: "Agents",
                        value: "\(agents.count)",
                        detail: "\(agents.filter(\.isRunning).count) running",
                        systemImage: "cpu"
                    )
                    statTile(
                        label: "Chats",
                        value: "\(sessions.count)",
                        detail: sessions.first?.displayTitle ?? "No recent chat",
                        systemImage: "bubble.left.and.bubble.right"
                    )
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text("Recent chats")
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                    if sessions.isEmpty {
                        Text("No chats yet — start one from the Chat tab.")
                            .font(.system(size: 13, design: .rounded))
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(sessions.prefix(6)) { session in
                            HStack {
                                Image(systemName: "bubble.left")
                                    .foregroundStyle(.secondary)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(session.displayTitle)
                                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                                        .lineLimit(1)
                                    Text("\(session.message_count ?? 0) messages · \(relativeTimestamp(session.updated_at))")
                                        .font(.system(size: 11, design: .rounded))
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
                .padding(18)
                .frame(maxWidth: .infinity, alignment: .leading)
                .cybaraGlass(cornerRadius: 18)

                if let error {
                    Text(error)
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.red)
                }
            }
            .padding(24)
        }
        .task { await load() }
        .refreshableIfAvailable { await load() }
    }

    private var uptimeLabel: String {
        guard let uptime = health?.uptime, uptime > 0 else { return "starting" }
        let minutes = Int(uptime) / 60
        if minutes < 60 { return "up \(minutes)m" }
        return "up \(minutes / 60)h \(minutes % 60)m"
    }

    private func statTile(label: String, value: String, detail: String, systemImage: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(label, systemImage: systemImage)
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
            Text(value)
                .font(.system(size: 22, weight: .bold, design: .rounded))
            Text(detail)
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cybaraGlass(cornerRadius: 16)
    }

    private func load() async {
        do {
            async let h = client.health()
            async let a = client.agents()
            async let s = client.sessions()
            health = try await h
            agents = try await a
            sessions = try await s
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// ─── Chat ────────────────────────────────────────────────────────────────────

struct ChatScreen: View {
    let client: GatewayClient

    @State private var sessions: [GatewaySession] = []
    @State private var selectedSession: String?
    @State private var messages: [GatewaySessionMessage] = []
    @State private var draft = ""
    @State private var sending = false
    @State private var error: String?

    var body: some View {
        HSplitView {
            sessionList
                .frame(minWidth: 220, idealWidth: 260, maxWidth: 340)
            transcript
                .frame(minWidth: 380, maxWidth: .infinity)
        }
        .task { await loadSessions() }
    }

    private var sessionList: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Chats")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                Spacer()
                Button {
                    selectedSession = nil
                    messages = []
                } label: {
                    Image(systemName: "square.and.pencil")
                }
                .buttonStyle(.borderless)
                .help("New chat")
            }
            .padding(14)

            List(selection: $selectedSession) {
                ForEach(sessions) { session in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(session.displayTitle)
                            .font(.system(size: 13, weight: .semibold, design: .rounded))
                            .lineLimit(1)
                        Text("\(session.message_count ?? 0) messages · \(relativeTimestamp(session.updated_at))")
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                    }
                    .tag(session.id)
                }
            }
            .listStyle(.sidebar)
            .scrollContentBackground(.hidden)
        }
        .cybaraGlass(cornerRadius: 0)
        .onChange(of: selectedSession) { _, newValue in
            guard let newValue else { return }
            Task { await loadMessages(newValue) }
        }
    }

    private var transcript: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if messages.isEmpty {
                            Text(selectedSession == nil
                                ? "Start a new conversation with your gateway agent."
                                : "No stored messages in this chat yet.")
                                .font(.system(size: 13, design: .rounded))
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .center)
                                .padding(.top, 60)
                        }
                        ForEach(visibleMessages) { message in
                            messageBubble(message)
                                .id(message.id)
                        }
                    }
                    .padding(20)
                }
                .onChange(of: messages) { _, newValue in
                    if let last = newValue.last {
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
            }

            composer
        }
    }

    private var visibleMessages: [GatewaySessionMessage] {
        messages.filter { $0.role == "user" || $0.role == "assistant" }
    }

    private func messageBubble(_ message: GatewaySessionMessage) -> some View {
        let isUser = message.role == "user"
        return HStack {
            if isUser { Spacer(minLength: 60) }
            Text(message.content)
                .font(.system(size: 13, design: .rounded))
                .textSelection(.enabled)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(isUser ? Color.accentColor.opacity(0.28) : Color.white.opacity(0.06))
                )
            if !isUser { Spacer(minLength: 60) }
        }
        .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
    }

    private var composer: some View {
        VStack(spacing: 8) {
            if let error {
                Text(error)
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(alignment: .bottom, spacing: 10) {
                TextField("Message Cybara…", text: $draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1 ... 6)
                    .font(.system(size: 13, design: .rounded))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(Color.white.opacity(0.06))
                    )
                    .onSubmit { Task { await send() } }
                Button {
                    Task { await send() }
                } label: {
                    if sending {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 24))
                    }
                }
                .buttonStyle(.borderless)
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending)
            }
        }
        .padding(14)
        .cybaraGlass(cornerRadius: 0)
    }

    private func loadSessions() async {
        do {
            sessions = try await client.sessions()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func loadMessages(_ id: String) async {
        do {
            messages = try await client.sessionMessages(id)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !sending else { return }
        sending = true
        error = nil
        draft = ""
        messages.append(GatewaySessionMessage(role: "user", content: text, timestamp: nil))
        do {
            let result = try await client.sendChat(message: text, sessionId: selectedSession, agentId: nil)
            if let reply = result.response, !reply.isEmpty {
                messages.append(GatewaySessionMessage(role: "assistant", content: reply, timestamp: nil))
            }
            if selectedSession == nil, let newId = result.sessionId {
                selectedSession = newId
                await loadSessions()
            }
        } catch {
            self.error = error.localizedDescription
        }
        sending = false
    }
}

// ─── Agents ──────────────────────────────────────────────────────────────────

struct AgentsScreen: View {
    let client: GatewayClient

    @State private var agents: [GatewayAgent] = []
    @State private var busyAgent: String?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ScreenHeader(title: "Agents", subtitle: "Configured gateway agents")

                if let error {
                    LoadFailedView(message: error) { Task { await load() } }
                } else {
                    ForEach(agents) { agent in
                        agentRow(agent)
                    }
                }
            }
            .padding(24)
        }
        .task { await load() }
    }

    private func agentRow(_ agent: GatewayAgent) -> some View {
        HStack(spacing: 14) {
            Image(systemName: "cpu")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(agent.isRunning ? Color.green : Color.secondary)
                .frame(width: 36, height: 36)
                .background(Circle().fill(Color.white.opacity(0.06)))

            VStack(alignment: .leading, spacing: 3) {
                Text(agent.name)
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                Text([agent.type, agent.model].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()

            if busyAgent == agent.id {
                ProgressView().controlSize(.small)
            } else {
                Button(agent.isRunning ? "Stop" : "Start") {
                    Task { await toggle(agent) }
                }
                .buttonStyle(.bordered)
            }
        }
        .padding(16)
        .cybaraGlass(cornerRadius: 16)
    }

    private func load() async {
        do {
            agents = try await client.agents()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func toggle(_ agent: GatewayAgent) async {
        busyAgent = agent.id
        do {
            if agent.isRunning {
                try await client.stopAgent(agent.id)
            } else {
                try await client.startAgent(agent.id)
            }
            await load()
        } catch {
            self.error = error.localizedDescription
        }
        busyAgent = nil
    }
}

// ─── Providers ───────────────────────────────────────────────────────────────

struct ProvidersScreen: View {
    let client: GatewayClient

    @State private var providers: [GatewayProvider] = []
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ScreenHeader(title: "Providers", subtitle: "Model providers configured on the gateway")

                if let error {
                    LoadFailedView(message: error) { Task { await load() } }
                } else {
                    ForEach(providers) { provider in
                        HStack(spacing: 14) {
                            Image(systemName: "shippingbox")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(provider.enabled == false ? Color.secondary : Color.accentColor)
                                .frame(width: 36, height: 36)
                                .background(Circle().fill(Color.white.opacity(0.06)))
                            VStack(alignment: .leading, spacing: 3) {
                                Text(provider.displayName)
                                    .font(.system(size: 14, weight: .bold, design: .rounded))
                                Text(provider.provider ?? provider.id)
                                    .font(.system(size: 12, design: .rounded))
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(provider.enabled == false ? "Disabled" : "Enabled")
                                .font(.system(size: 11, weight: .semibold, design: .rounded))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 4)
                                .background(
                                    Capsule().fill(
                                        provider.enabled == false
                                            ? Color.secondary.opacity(0.15)
                                            : Color.green.opacity(0.18)
                                    )
                                )
                        }
                        .padding(16)
                        .cybaraGlass(cornerRadius: 16)
                    }
                }
            }
            .padding(24)
        }
        .task { await load() }
    }

    private func load() async {
        do {
            providers = try await client.providers()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

struct TasksScreen: View {
    let client: GatewayClient

    @State private var tasks: [GatewayTask] = []
    @State private var busyTask: String?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ScreenHeader(title: "Tasks", subtitle: "Scheduled agent automations")

                if let error {
                    LoadFailedView(message: error) { Task { await load() } }
                } else if tasks.isEmpty {
                    Text("No scheduled tasks yet.")
                        .font(.system(size: 13, design: .rounded))
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(tasks) { task in
                        HStack(spacing: 14) {
                            Image(systemName: "calendar.badge.clock")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(task.isRunning ? Color.green : Color.secondary)
                                .frame(width: 36, height: 36)
                                .background(Circle().fill(Color.white.opacity(0.06)))
                            VStack(alignment: .leading, spacing: 3) {
                                Text(task.name)
                                    .font(.system(size: 14, weight: .bold, design: .rounded))
                                Text([task.schedule, task.status].compactMap { $0 }.joined(separator: " · "))
                                    .font(.system(size: 12, design: .rounded))
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            if busyTask == task.id {
                                ProgressView().controlSize(.small)
                            } else {
                                Button("Run now") {
                                    Task { await run(task) }
                                }
                                .buttonStyle(.bordered)
                            }
                        }
                        .padding(16)
                        .cybaraGlass(cornerRadius: 16)
                    }
                }
            }
            .padding(24)
        }
        .task { await load() }
    }

    private func load() async {
        do {
            tasks = try await client.tasks()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func run(_ task: GatewayTask) async {
        busyTask = task.id
        do {
            try await client.runTask(task.id)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
        busyTask = nil
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

extension View {
    /// `.refreshable` is iOS-flavored on macOS scroll views; keep the call site
    /// tidy and no-op where unsupported.
    @ViewBuilder
    func refreshableIfAvailable(_ action: @escaping @Sendable () async -> Void) -> some View {
        self.refreshable { await action() }
    }
}
