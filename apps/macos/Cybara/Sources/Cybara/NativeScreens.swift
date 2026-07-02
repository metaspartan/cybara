import AppKit
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
    guard let date = parseGatewayDate(iso) else { return "" }
    let formatter = RelativeDateTimeFormatter()
    formatter.unitsStyle = .abbreviated
    return formatter.localizedString(for: date, relativeTo: Date())
}

func absoluteTimestamp(_ iso: String?) -> String {
    guard let date = parseGatewayDate(iso) else { return "" }
    let formatter = DateFormatter()
    formatter.dateStyle = .medium
    formatter.timeStyle = .short
    return formatter.string(from: date)
}

func gatewayTimestampNow() -> String {
    ISO8601DateFormatter().string(from: Date())
}

private func parseGatewayDate(_ iso: String?) -> Date? {
    guard let iso else { return nil }
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) {
        return date
    }
    let sqlite = DateFormatter()
    sqlite.locale = Locale(identifier: "en_US_POSIX")
    sqlite.timeZone = TimeZone(secondsFromGMT: 0)
    sqlite.dateFormat = "yyyy-MM-dd HH:mm:ss"
    return sqlite.date(from: iso)
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

struct DashboardScreen: View {
    let client: GatewayClient
    let openChat: (GatewaySession) -> Void
    @EnvironmentObject private var sidecar: SidecarManager

    @State private var health: GatewayHealth?
    @State private var agents: [GatewayAgent] = []
    @State private var providers: [GatewayProvider] = []
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
                            Button {
                                openChat(session)
                            } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: "bubble.left")
                                        .foregroundStyle(.secondary)
                                        .frame(width: 18)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(session.displayTitle)
                                            .font(.system(size: 13, weight: .semibold, design: .rounded))
                                            .lineLimit(1)
                                        Text(dashboardSessionDetail(for: session))
                                            .font(.system(size: 11, design: .rounded))
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.system(size: 10, weight: .semibold))
                                        .foregroundStyle(.tertiary)
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .padding(.vertical, 5)
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

    private func dashboardSessionDetail(for session: GatewaySession) -> String {
        let timestamp = relativeTimestamp(session.updated_at ?? session.created_at)
        var parts = [
            gatewaySessionRouteSummary(session, agents: agents, providers: providers),
            session.workspaceLabel.map { "Workspace \($0)" },
            "\(session.message_count ?? 0) messages",
        ].compactMap { $0 }
        if !timestamp.isEmpty { parts.append(timestamp) }
        return parts.joined(separator: " · ")
    }

    private func load() async {
        do {
            async let h = client.health()
            async let a = client.agents()
            async let p = client.providers()
            async let s = client.sessions()
            health = try await h
            agents = try await a
            providers = try await p
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
    @Binding var selectedSessionID: String?
    @Environment(\.cybaraAccent) private var accentTint

    @State private var sessions: [GatewaySession] = []
    @State private var agents: [GatewayAgent] = []
    @State private var providers: [GatewayProvider] = []
    @State private var messages: [GatewaySessionMessage] = []
    @State private var searchText = ""
    @State private var draft = ""
    @State private var sending = false
    @State private var error: String?
    @State private var renameTarget: GatewaySession?
    @State private var renameDraft = ""
    @State private var deleteTarget: GatewaySession?
    @State private var pendingWorkspaceDir = ""
    @State private var workspaceSaving = false
    @AppStorage("cybara.chat.lastWorkspaceDir") private var lastWorkspaceDir = ""
    @StateObject private var statusStream = GatewayStatusStream()

    var body: some View {
        HSplitView {
            sessionList
                .frame(minWidth: 220, idealWidth: 260, maxWidth: 340)
            transcript
                .frame(minWidth: 380, maxWidth: .infinity)
        }
        .task {
            statusStream.start(baseURL: client.baseURL)
            await loadSessions()
        }
        .task(id: selectedSessionID) {
            guard let selectedSessionID else {
                messages = []
                return
            }
            await loadMessages(selectedSessionID)
        }
        .onDisappear { statusStream.stop() }
        .alert("Rename chat", isPresented: renameAlertBinding) {
            TextField("Title", text: $renameDraft)
            Button("Rename") {
                if let target = renameTarget {
                    Task { await rename(target, to: renameDraft) }
                }
            }
            Button("Cancel", role: .cancel) { renameTarget = nil }
        }
        .confirmationDialog(
            "Delete “\(deleteTarget?.displayTitle ?? "chat")”?",
            isPresented: deleteDialogBinding,
            titleVisibility: .visible
        ) {
            Button("Delete Chat", role: .destructive) {
                if let target = deleteTarget {
                    Task { await remove(target) }
                }
            }
            Button("Cancel", role: .cancel) { deleteTarget = nil }
        } message: {
            Text("This removes the chat from the gateway.")
        }
    }

    private var renameAlertBinding: Binding<Bool> {
        Binding(
            get: { renameTarget != nil },
            set: { if !$0 { renameTarget = nil } }
        )
    }

    private var deleteDialogBinding: Binding<Bool> {
        Binding(
            get: { deleteTarget != nil },
            set: { if !$0 { deleteTarget = nil } }
        )
    }

    private var activeSession: GatewaySession? {
        guard let selectedSessionID else { return nil }
        return sessions.first { $0.id == selectedSessionID }
    }

    private var filteredSessions: [GatewaySession] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return sessions }
        return sessions.filter { session in
            session.displayTitle.lowercased().contains(query)
                || routeSummary(for: session).lowercased().contains(query)
                || (session.workspace_dir ?? "").lowercased().contains(query)
                || (session.last_message?.preview ?? "").lowercased().contains(query)
                || session.id.lowercased().contains(query)
        }
    }

    private var sessionList: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Chats")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                Spacer()
                Button {
                    startNewChat()
                } label: {
                    Image(systemName: "square.and.pencil")
                }
                .buttonStyle(.borderless)
                .help("New chat")
            }
            .padding(14)

            if !sessions.isEmpty {
                TextField("Search chats", text: $searchText)
                    .textFieldStyle(.roundedBorder)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 10)
            }

            List(selection: $selectedSessionID) {
                if filteredSessions.isEmpty {
                    Text("No matching chats")
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.secondary)
                        .padding(.vertical, 8)
                }
                ForEach(filteredSessions) { session in
                    HStack(spacing: 6) {
                        if session.pinned == true {
                            Image(systemName: "pin.fill")
                                .font(.system(size: 9))
                                .foregroundStyle(.orange)
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Text(session.displayTitle)
                                .font(.system(size: 13, weight: .semibold, design: .rounded))
                                .lineLimit(1)
                            Text(sessionListDetail(for: session))
                                .font(.system(size: 11, design: .rounded))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    .tag(session.id)
                    .contextMenu {
                        Button("Rename…") {
                            renameDraft = session.title ?? ""
                            renameTarget = session
                        }
                        Button(session.pinned == true ? "Unpin" : "Pin") {
                            Task { await togglePin(session) }
                        }
                        Button("Set Workspace…") {
                            Task { await chooseWorkspace(for: session) }
                        }
                        if firstNonEmptyGatewayString(session.workspace_dir) != nil {
                            Button("Clear Workspace") {
                                Task { await applyWorkspace(nil, to: session) }
                            }
                        }
                        Divider()
                        Button("Delete…", role: .destructive) {
                            deleteTarget = session
                        }
                    }
                }
            }
            .listStyle(.sidebar)
        }
    }

    private var transcript: some View {
        VStack(spacing: 0) {
            transcriptHeader
            Divider().opacity(0.35)

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if messages.isEmpty {
                            Text(selectedSessionID == nil
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
                        if sending {
                            thinkingBubble
                                .id("thinking")
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

    private var transcriptHeader: some View {
        HStack(spacing: 12) {
            Image(systemName: selectedSessionID == nil ? "bubble.left.and.text.bubble.right" : "bubble.left")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(accentTint)
                .frame(width: 34, height: 34)
                .background(Circle().fill(accentTint.opacity(0.14)))
            VStack(alignment: .leading, spacing: 3) {
                Text(activeSession?.displayTitle ?? "New chat")
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .lineLimit(1)
                Text(sessionDetailLine)
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            Button {
                Task { await chooseWorkspace(for: activeSession) }
            } label: {
                if workspaceSaving {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: "folder")
                }
            }
            .buttonStyle(.borderless)
            .disabled(workspaceSaving)
            .help(workspaceHelpText)

            Button {
                Task {
                    await loadSessions()
                    if let selectedSessionID {
                        await loadMessages(selectedSessionID)
                    }
                }
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(.borderless)
            .help("Refresh chat")

            Button {
                startNewChat()
            } label: {
                Image(systemName: "square.and.pencil")
            }
            .buttonStyle(.borderless)
            .help("New chat")
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 13)
    }

    private var sessionDetailLine: String {
        guard let activeSession else {
            if let workspaceLabel = activeWorkspaceLabel {
                return "New chat · Workspace \(workspaceLabel)"
            }
            return "New chat · Local gateway routing decides the provider and model"
        }
        let count = activeSession.message_count ?? messages.count
        let timestamp = relativeTimestamp(activeSession.updated_at)
        let route = routeSummary(for: activeSession)
        var parts = [route]
        if let workspaceLabel = activeWorkspaceLabel {
            parts.append("Workspace \(workspaceLabel)")
        }
        parts.append("\(count) messages")
        if !timestamp.isEmpty { parts.append(timestamp) }
        return parts.joined(separator: " · ")
    }

    private func sessionListDetail(for session: GatewaySession) -> String {
        let timestamp = relativeTimestamp(session.updated_at)
        var parts = [
            routeSummary(for: session),
            session.workspaceLabel.map { "Workspace \($0)" },
            "\(session.message_count ?? 0) messages",
        ].compactMap { $0 }
        if !timestamp.isEmpty { parts.append(timestamp) }
        return parts.joined(separator: " · ")
    }

    private func routeSummary(for session: GatewaySession) -> String {
        gatewaySessionRouteSummary(session, agents: agents, providers: providers)
    }

    private var visibleMessages: [GatewaySessionMessage] {
        messages.filter { $0.role == "user" || $0.role == "assistant" }
    }

    private var activeWorkspaceDir: String? {
        if let activeSession {
            return firstNonEmptyGatewayString(activeSession.workspace_dir)
        }
        if selectedSessionID != nil { return nil }
        return firstNonEmptyGatewayString(
            pendingWorkspaceDir,
            lastWorkspaceDir,
            FileManager.default.homeDirectoryForCurrentUser.path
        )
    }

    private var activeWorkspaceLabel: String? {
        gatewayWorkspaceLabel(activeWorkspaceDir, maxLength: 42)
    }

    private var workspaceHelpText: String {
        if let activeWorkspaceDir {
            return "Switch workspace: \(activeWorkspaceDir)"
        }
        return "Select workspace folder for this chat"
    }

    /// Live status while a reply generates, fed by the gateway's SSE stream
    /// ("Thinking…", tool activity), scoped to the active session.
    private var thinkingBubble: some View {
        let event = statusStream.latest
        let relevant = event?.sessionId == nil || event?.sessionId == selectedSessionID
        let detail = (relevant ? event?.detail : nil) ?? "Thinking…"
        return HStack(spacing: 8) {
            ProgressView().controlSize(.small)
            Text(detail)
                .font(.system(size: 12, design: .rounded))
                .foregroundStyle(.secondary)
            Spacer(minLength: 60)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    private func messageBubble(_ message: GatewaySessionMessage) -> some View {
        let isUser = message.role == "user"
        return HStack {
            if isUser { Spacer(minLength: 60) }
            VStack(alignment: .leading, spacing: 7) {
                if !isUser {
                    NativeToolTimelineView(message: message)
                }
                if !message.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    NativeMarkdownView(content: message.content, isUser: isUser)
                }
                if let timestamp = message.timestamp {
                    let relative = relativeTimestamp(timestamp)
                    let absolute = absoluteTimestamp(timestamp)
                    if !relative.isEmpty {
                        Text(absolute.isEmpty ? relative : "\(relative) · \(absolute)")
                            .font(.system(size: 10.5, weight: .medium, design: .rounded))
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(isUser ? accentTint.opacity(0.28) : Color.white.opacity(0.06))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(isUser ? accentTint.opacity(0.18) : Color.white.opacity(0.08), lineWidth: 1)
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
            async let loadedSessions = client.sessions()
            async let loadedAgents = client.agents()
            async let loadedProviders = client.providers()
            sessions = try await loadedSessions
            agents = try await loadedAgents
            providers = try await loadedProviders
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func rename(_ session: GatewaySession, to title: String) async {
        renameTarget = nil
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        do {
            try await client.renameSession(session.id, title: trimmed)
            await loadSessions()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func togglePin(_ session: GatewaySession) async {
        do {
            try await client.pinSession(session.id, pinned: session.pinned != true)
            await loadSessions()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func remove(_ session: GatewaySession) async {
        deleteTarget = nil
        do {
            try await client.deleteSession(session.id)
            if selectedSessionID == session.id {
                selectedSessionID = nil
                messages = []
            }
            await loadSessions()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func startNewChat() {
        selectedSessionID = nil
        messages = []
        pendingWorkspaceDir = ""
        error = nil
    }

    @MainActor
    private func chooseWorkspace(for session: GatewaySession?) async {
        guard !workspaceSaving else { return }
        let defaultPath = firstNonEmptyGatewayString(
            session?.workspace_dir,
            activeWorkspaceDir,
            lastWorkspaceDir,
            FileManager.default.homeDirectoryForCurrentUser.path
        )
        guard let selectedPath = presentWorkspacePanel(defaultPath: defaultPath) else { return }
        await applyWorkspace(selectedPath, to: session)
    }

    @MainActor
    private func applyWorkspace(_ workspaceDir: String?, to session: GatewaySession?) async {
        let normalizedWorkspaceDir = firstNonEmptyGatewayString(workspaceDir)
        guard let session else {
            pendingWorkspaceDir = normalizedWorkspaceDir ?? ""
            if let normalizedWorkspaceDir {
                lastWorkspaceDir = normalizedWorkspaceDir
            }
            return
        }

        workspaceSaving = true
        do {
            let response = try await client.updateSessionWorkspace(
                session.id,
                workspaceDir: normalizedWorkspaceDir
            )
            if response.success == false {
                throw GatewayClientError.badStatus(200, response.error ?? "Failed to update session workspace")
            }
            if let workspaceDir = response.workspaceDir {
                lastWorkspaceDir = workspaceDir
            }
            await loadSessions()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        workspaceSaving = false
    }

    @MainActor
    private func presentWorkspacePanel(defaultPath: String?) -> String? {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Select"
        panel.message = "Choose a workspace folder for this Cybara session."
        panel.title = "Select Workspace"
        if let defaultPath = firstNonEmptyGatewayString(defaultPath) {
            panel.directoryURL = URL(fileURLWithPath: defaultPath)
        }
        return panel.runModal() == .OK ? panel.url?.path : nil
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
        messages.append(GatewaySessionMessage(role: "user", content: text, timestamp: gatewayTimestampNow()))
        do {
            let result = try await client.sendChat(
                message: text,
                sessionId: selectedSessionID,
                agentId: nil,
                workspaceDir: activeWorkspaceDir
            )
            if let workspaceDir = result.workspaceDir {
                lastWorkspaceDir = workspaceDir
                if selectedSessionID == nil {
                    pendingWorkspaceDir = workspaceDir
                }
            }
            if let reply = result.response, !reply.isEmpty {
                messages.append(GatewaySessionMessage(role: "assistant", content: reply, timestamp: gatewayTimestampNow()))
            }
            if selectedSessionID == nil, let newId = result.sessionId {
                selectedSessionID = newId
                await loadSessions()
            }
        } catch {
            self.error = error.localizedDescription
        }
        sending = false
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
