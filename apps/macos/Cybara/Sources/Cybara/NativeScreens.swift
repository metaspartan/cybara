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

/// Icon actions under a chat message: copy always, revert (confirmed upstream).
struct NativeMessageActions: View {
    let content: String
    let timestampLabel: String
    let onRevert: (() -> Void)?
    @State private var copied = false

    var body: some View {
        HStack(spacing: 8) {
            if !timestampLabel.isEmpty {
                Text(timestampLabel)
                    .font(.system(size: 10.5, weight: .medium, design: .rounded))
                    .foregroundStyle(.secondary)
            }
            Button {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(content, forType: .string)
                copied = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copied = false }
            } label: {
                Image(systemName: copied ? "checkmark" : "doc.on.doc")
                    .font(.system(size: 10, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(copied ? Color.green : Color.secondary)
            .help("Copy message")
            if let onRevert {
                Button(action: onRevert) {
                    Image(systemName: "arrow.uturn.backward")
                        .font(.system(size: 10, weight: .semibold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help("Revert session to this message")
            }
        }
    }
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
            async let s = client.sessions(limit: 12)
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

private struct NativeSessionGroup: Identifiable {
    enum Kind: Equatable {
        case pinned
        case workspace
        case unassigned
    }

    let id: String
    let label: String
    let kind: Kind
    let sessions: [GatewaySession]
    let latestDate: Date
}

private func nativeSessionUpdatedDate(_ session: GatewaySession) -> Date {
    parseGatewayDate(session.updated_at) ?? parseGatewayDate(session.created_at) ?? .distantPast
}

private func nativeWorkspaceSectionLabel(_ path: String?) -> String {
    guard let path = firstNonEmptyGatewayString(path) else { return "No Workspace" }
    let normalized = path.replacingOccurrences(of: "\\", with: "/")
    return normalized.split(separator: "/").last.map(String.init) ?? normalized
}

private func nativeSessionGroups(_ sessions: [GatewaySession]) -> [NativeSessionGroup] {
    let sortedPinned = sessions
        .filter { $0.pinned == true }
        .sorted { nativeSessionUpdatedDate($0) > nativeSessionUpdatedDate($1) }
    let unpinned = sessions.filter { $0.pinned != true }
    var groups: [NativeSessionGroup] = []

    if let latestPinned = sortedPinned.first {
        groups.append(
            NativeSessionGroup(
                id: "pinned",
                label: "Pinned",
                kind: .pinned,
                sessions: sortedPinned,
                latestDate: nativeSessionUpdatedDate(latestPinned)
            )
        )
    }

    let grouped = Dictionary(grouping: unpinned) { session -> String in
        firstNonEmptyGatewayString(session.workspace_dir) ?? "__unassigned"
    }

    for (key, sessions) in grouped {
        let sorted = sessions.sorted { nativeSessionUpdatedDate($0) > nativeSessionUpdatedDate($1) }
        guard let latest = sorted.first else { continue }
        let isUnassigned = key == "__unassigned"
        groups.append(
            NativeSessionGroup(
                id: isUnassigned ? key : "workspace:\(key)",
                label: isUnassigned ? "No Workspace" : nativeWorkspaceSectionLabel(key),
                kind: isUnassigned ? .unassigned : .workspace,
                sessions: sorted,
                latestDate: nativeSessionUpdatedDate(latest)
            )
        )
    }

    return groups.sorted {
        if $0.kind == .pinned { return true }
        if $1.kind == .pinned { return false }
        if $0.kind == .workspace && $1.kind == .unassigned { return true }
        if $0.kind == .unassigned && $1.kind == .workspace { return false }
        if $0.latestDate != $1.latestDate { return $0.latestDate > $1.latestDate }
        return $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending
    }
}

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
    @State private var pendingAgentID = ""
    @State private var pendingAgentSessionID: String?
    @State private var pendingWorkspaceDir = ""
    @State private var workspaceSaving = false
    @State private var agentSaving = false
    @State private var approvalSaving = false
    @State private var toolApprovalMode = "always_allow"
    @State private var pendingApprovals: [GatewayPendingApproval] = []
    @State private var expandedApprovalID: String?
    @State private var showContextPopover = false
    @State private var liveStatus = "idle"
    @State private var revertCandidate: GatewaySessionMessage?
    @State private var showRevertConfirm = false
    @State private var liveActivities: [NativeToolActivity] = []
    @State private var liveCurrentStep: String?
    @State private var liveStartedAt: Date?
    @State private var streamingContent: String?
    @State private var pendingMessages: [GatewayPendingChatMessage] = []
    @State private var steeringPendingID: String?
    @State private var pendingMutationID: String?
    @State private var editingPendingMessage: GatewayPendingChatMessage?
    @State private var editingPendingDraft = ""
    @State private var collapsedSessionGroupIDs: Set<String> = []
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
            await loadChatConfig()
        }
        .task {
            // Poll pending tool approvals so the inline banner stays live.
            while !Task.isCancelled {
                await pollApprovals()
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
        }
        .task(id: selectedSessionID) {
            resetLiveTimeline(clearStartedAt: true)
            pendingMessages = []
            if pendingAgentSessionID != selectedSessionID {
                pendingAgentSessionID = nil
                if selectedSessionID != nil { pendingAgentID = "" }
            }
            guard let selectedSessionID else {
                messages = []
                return
            }
            await loadMessages(selectedSessionID)
            await hydrateStatus(selectedSessionID)
        }
        .onReceive(statusStream.$latest.compactMap { $0 }) { event in
            handleStatusEvent(event)
        }
        .onDisappear { statusStream.stop() }
        .alert("Revert to this message?", isPresented: $showRevertConfirm) {
            Button("Revert", role: .destructive) {
                if let candidate = revertCandidate {
                    performRevert(candidate)
                }
                revertCandidate = nil
            }
            Button("Cancel", role: .cancel) { revertCandidate = nil }
        } message: {
            Text("The conversation rolls back to this point. Messages after it are removed from the session.")
        }
        .sheet(item: $editingPendingMessage) { message in
            VStack(alignment: .leading, spacing: 14) {
                Text("Edit queued message")
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                TextEditor(text: $editingPendingDraft)
                    .font(.system(size: 13, design: .rounded))
                    .frame(width: 420, height: 120)
                    .scrollContentBackground(.hidden)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(Color.white.opacity(0.05))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(Color.white.opacity(0.1), lineWidth: 1)
                    )
                HStack {
                    Spacer()
                    Button("Cancel") {
                        editingPendingMessage = nil
                        editingPendingDraft = ""
                    }
                    Button("Save") {
                        Task { await updatePending(message, content: editingPendingDraft) }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(editingPendingDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || pendingMutationID != nil)
                }
            }
            .padding(18)
            .frame(width: 460)
        }
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

    private var groupedSessions: [NativeSessionGroup] {
        nativeSessionGroups(filteredSessions)
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
                ForEach(groupedSessions) { group in
                    Section {
                        if group.kind == .pinned || !collapsedSessionGroupIDs.contains(group.id) {
                            ForEach(group.sessions) { session in
                                sessionListRow(for: session)
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
                    } header: {
                        Button {
                            if group.kind != .pinned {
                                toggleSessionGroup(group.id)
                            }
                        } label: {
                            HStack(spacing: 5) {
                                if group.kind != .pinned {
                                    Image(systemName: collapsedSessionGroupIDs.contains(group.id) ? "chevron.right" : "chevron.down")
                                        .font(.system(size: 9, weight: .semibold))
                                }
                                if group.kind == .workspace {
                                    Image(systemName: "folder")
                                        .font(.system(size: 10, weight: .medium))
                                }
                                Text(group.label)
                                    .lineLimit(1)
                                Spacer(minLength: 4)
                                Text("\(group.sessions.count)")
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(.secondary)
                        .help(group.kind == .pinned ? "Pinned chats" : "\(group.label) workspace")
                    }
                }
            }
            .listStyle(.sidebar)
        }
    }

    private func toggleSessionGroup(_ groupID: String) {
        if collapsedSessionGroupIDs.contains(groupID) {
            collapsedSessionGroupIDs.remove(groupID)
        } else {
            collapsedSessionGroupIDs.insert(groupID)
        }
    }

    private func sessionListRow(for session: GatewaySession) -> some View {
        HStack(spacing: 6) {
            if session.pinned == true {
                Image(systemName: "pin.fill")
                    .font(.system(size: 9))
                    .foregroundStyle(.orange)
            }
            Text(session.displayTitle)
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .lineLimit(1)
            Spacer(minLength: 4)
        }
        .padding(.vertical, 1)
        .help(sessionListTooltip(for: session))
    }

    private var transcript: some View {
        VStack(spacing: 0) {
            transcriptHeader
            Divider().opacity(0.35)
            approvalBanner

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
                        if showWorkingTimeline {
                            thinkingBubble
                                .id("thinking")
                        }
                        if !sortedPendingMessages.isEmpty {
                            pendingQueueView
                                .id("pendingQueue")
                        }
                    }
                    .padding(20)
                }
                .onChange(of: messages) { _, newValue in
                    if let last = newValue.last {
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
                // Keep the live run in view as activities/tokens stream in.
                .onChange(of: liveActivities.count) { _, _ in
                    if showWorkingTimeline {
                        proxy.scrollTo("thinking", anchor: .bottom)
                    }
                }
                .onChange(of: streamingContent) { _, _ in
                    if showWorkingTimeline {
                        proxy.scrollTo("thinking", anchor: .bottom)
                    }
                }
            }

            composer
        }
    }

    @ViewBuilder
    private var approvalBanner: some View {
        if !pendingApprovals.isEmpty {
            VStack(spacing: 0) {
                ForEach(pendingApprovals) { req in
                    approvalRow(req)
                    Divider().opacity(0.2)
                }
            }
            .background(Color.orange.opacity(0.12))
        }
    }

    private func approvalRow(_ req: GatewayPendingApproval) -> some View {
        let expanded = expandedApprovalID == req.id
        let hasDetail = !req.argsSummary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.shield")
                    .foregroundStyle(.orange)
                Button {
                    if hasDetail { expandedApprovalID = expanded ? nil : req.id }
                } label: {
                    HStack(spacing: 6) {
                        Text(req.toolName)
                            .font(.system(size: 12, weight: .bold, design: .rounded))
                            .foregroundStyle(.orange)
                        if hasDetail {
                            Text(req.argsSummary)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                            Image(systemName: expanded ? "chevron.up" : "chevron.down")
                                .font(.system(size: 9))
                                .foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
                approvalButton("Allow once", .green) { resolveApproval(req.id, "approve_once") }
                approvalButton("Allow session", .blue) { resolveApproval(req.id, "approve_session") }
                approvalButton("Deny", .red) { resolveApproval(req.id, "deny") }
            }
            if expanded, hasDetail {
                Text(req.argsSummary)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.primary.opacity(0.85))
                    .textSelection(.enabled)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Color.black.opacity(0.25)))
                    .padding(.leading, 24)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
    }

    private func approvalButton(_ title: String, _ tint: Color, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundStyle(tint)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(RoundedRectangle(cornerRadius: 5).fill(tint.opacity(0.18)))
        }
        .buttonStyle(.plain)
        .fixedSize()
    }

    private func resolveApproval(_ requestId: String, _ decision: String) {
        pendingApprovals.removeAll { $0.id == requestId }
        Task {
            try? await client.resolveToolApproval(requestId, decision: decision)
        }
    }

    private func pollApprovals() async {
        if let pending = try? await client.pendingToolApprovals() {
            pendingApprovals = pending
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

    private func sessionListTooltip(for session: GatewaySession) -> String {
        var parts = [session.displayTitle, routeSummary(for: session), "\(session.message_count ?? 0) messages"]
        if let workspace = firstNonEmptyGatewayString(session.workspace_dir) {
            parts.append("Workspace: \(workspace)")
        }
        let updated = absoluteTimestamp(session.updated_at)
        if !updated.isEmpty {
            parts.append("Updated: \(updated)")
        }
        if let preview = firstNonEmptyGatewayString(session.last_message?.preview) {
            parts.append("Latest: \(preview)")
        }
        return parts.joined(separator: "\n")
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

    private var selectedChatAgentID: String {
        if let selectedSessionID,
           pendingAgentSessionID == selectedSessionID,
           let pending = firstNonEmptyGatewayString(pendingAgentID) {
            return pending
        }
        if selectedSessionID == nil {
            return firstNonEmptyGatewayString(pendingAgentID) ?? ""
        }
        return firstNonEmptyGatewayString(activeSession?.agent_id) ?? ""
    }

    private var selectedChatAgent: GatewayAgent? {
        agents.first { $0.id == selectedChatAgentID }
    }

    private var agentSelectionBinding: Binding<String> {
        Binding(
            get: { selectedChatAgentID },
            set: { nextValue in
                Task { await changeChatAgent(nextValue) }
            }
        )
    }

    private var activeContextUsage: GatewaySessionContextUsage? {
        activeSession?.contextUsage
    }

    private var contextUsageText: String {
        guard let usage = activeContextUsage else {
            return "Context usage is available after the session loads."
        }
        return "\(formatNativeTokenCount(usage.usedTokens)) of \(formatNativeTokenCount(usage.limitTokens)) tokens used (\(formatNativePercent(usage.usedPercent))). \(formatNativeTokenCount(usage.remainingTokens)) tokens remaining."
    }

    private var workspaceHelpText: String {
        if let activeWorkspaceDir {
            return "Switch workspace: \(activeWorkspaceDir)"
        }
        return "Select workspace folder for this chat"
    }

    private var showWorkingTimeline: Bool {
        sending ||
            !liveActivities.isEmpty ||
            streamingContent != nil ||
            ["thinking", "generating", "compacting", "tool_executing"].contains(liveStatus.lowercased())
    }

    private var sortedPendingMessages: [GatewayPendingChatMessage] {
        pendingMessages
            .filter { !$0.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .sorted {
                if $0.sequence == $1.sequence { return $0.createdAt < $1.createdAt }
                return $0.sequence < $1.sequence
            }
    }

    /// Live status while a reply generates, fed by the gateway's SSE stream
    /// (thoughts, tool activity), scoped to the active session. The streamed
    /// answer body is NOT shown during a run — only the timeline/status —
    /// matching web/Tauri and mobile; the full reply renders on completion.
    private var thinkingBubble: some View {
        HStack {
            VStack(alignment: .leading, spacing: 9) {
                NativeLiveToolTimelineView(
                    status: liveStatus,
                    activities: liveActivities,
                    currentStep: liveCurrentStep,
                    startedAt: liveStartedAt
                )
            }
            .padding(.vertical, 2)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var pendingQueueView: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(
                sortedPendingMessages.count == 1
                    ? "Pending message"
                    : "\(sortedPendingMessages.count) pending messages",
                systemImage: "text.bubble"
            )
            .font(.system(size: 11, weight: .semibold, design: .rounded))
            .foregroundStyle(.secondary)

            ForEach(Array(sortedPendingMessages.enumerated()), id: \.element.id) { index, message in
                let mutable = message.mode != "steering" && pendingMutationID == nil
                HStack(alignment: .top, spacing: 10) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(pendingMessageMeta(message))
                            .font(.system(size: 10, weight: .semibold, design: .rounded))
                            .foregroundStyle(message.mode == "steering" ? accentTint : .secondary)
                        Text(message.content)
                            .font(.system(size: 12, design: .rounded))
                            .lineLimit(3)
                            .textSelection(.enabled)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    if message.mode != "steering" {
                        VStack(spacing: 2) {
                            Button {
                                Task { await movePending(message, direction: -1) }
                            } label: {
                                Image(systemName: "chevron.up")
                            }
                            .buttonStyle(.borderless)
                            .controlSize(.small)
                            .help("Move queued message up")
                            .disabled(!mutable || index == sortedPendingMessages.startIndex)

                            Button {
                                Task { await movePending(message, direction: 1) }
                            } label: {
                                Image(systemName: "chevron.down")
                            }
                            .buttonStyle(.borderless)
                            .controlSize(.small)
                            .help("Move queued message down")
                            .disabled(!mutable || index == sortedPendingMessages.count - 1)
                        }

                        Button {
                            editingPendingMessage = message
                            editingPendingDraft = message.content
                        } label: {
                            Image(systemName: "pencil")
                        }
                        .buttonStyle(.borderless)
                        .controlSize(.small)
                        .help("Edit queued message")
                        .disabled(!mutable)

                        Button(role: .destructive) {
                            Task { await deletePending(message) }
                        } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(.borderless)
                        .controlSize(.small)
                        .help("Delete queued message")
                        .disabled(!mutable)

                        Button("Steer") {
                            Task { await steerPending(message) }
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .disabled(steeringPendingID == message.id || pendingMutationID == message.id)
                    }
                }
                .padding(10)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color.white.opacity(0.05))
                )
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cybaraGlass(cornerRadius: 14)
    }

    private func messageBubble(_ message: GatewaySessionMessage) -> some View {
        let isUser = message.role == "user"
        let visibleContent = NativeMarkdown.preprocess(message.content, stripAssistantMarkup: !isUser)
        return HStack {
            if isUser { Spacer(minLength: 60) }
            VStack(alignment: isUser ? .trailing : .leading, spacing: 4) {
                VStack(alignment: .leading, spacing: 7) {
                    if !isUser {
                        NativeToolTimelineView(message: message)
                    }
                    if !visibleContent.isEmpty {
                        NativeMarkdownView(content: visibleContent, isUser: isUser)
                    }
                }
                .padding(.horizontal, isUser ? 14 : 0)
                .padding(.vertical, isUser ? 10 : 2)
                .frame(maxWidth: isUser ? nil : .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(isUser ? accentTint.opacity(0.28) : Color.clear)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(isUser ? accentTint.opacity(0.18) : Color.clear, lineWidth: 1)
                )
                NativeMessageActions(
                    content: visibleContent.isEmpty ? message.content : visibleContent,
                    timestampLabel: messageTimestampLabel(message),
                    onRevert: isUser
                        ? {
                            revertCandidate = message
                            showRevertConfirm = true
                        }
                        : nil
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
    }

    private func messageTimestampLabel(_ message: GatewaySessionMessage) -> String {
        guard let timestamp = message.timestamp else { return "" }
        let relative = relativeTimestamp(timestamp)
        let absolute = absoluteTimestamp(timestamp)
        if relative.isEmpty { return absolute }
        return absolute.isEmpty ? relative : "\(relative) · \(absolute)"
    }

    private func pendingMessageMeta(_ message: GatewayPendingChatMessage) -> String {
        let mode = message.mode == "steering" ? "Steering" : "Queued"
        let date = Date(timeIntervalSince1970: message.createdAt / 1000)
        let relative = RelativeDateTimeFormatter()
        relative.unitsStyle = .short
        return "\(mode) - \(relative.localizedString(for: date, relativeTo: Date()))"
    }

    private func formatNativeTokenCount(_ value: Int) -> String {
        if abs(value) >= 1_000_000 {
            return String(format: "%.1fM", Double(value) / 1_000_000)
        }
        if abs(value) >= 1_000 {
            return "\(Int((Double(value) / 1_000).rounded()))k"
        }
        return "\(max(0, value))"
    }

    private func formatNativePercent(_ value: Double) -> String {
        String(format: value.rounded() == value ? "%.0f%%" : "%.1f%%", value)
    }

    private func steerPending(_ message: GatewayPendingChatMessage) async {
        guard let selectedSessionID else { return }
        steeringPendingID = message.id
        defer { steeringPendingID = nil }
        do {
            let response = try await client.steerPendingMessage(
                sessionId: selectedSessionID,
                pendingId: message.id,
                processActivities: nativeSteeringProcessActivityPayloads(from: liveActivities)
            )
            if response.success == false {
                error = response.error ?? "Failed to steer pending message"
            } else {
                pendingMessages = response.pendingMessages
                await loadMessages(selectedSessionID)
                await loadSessions()
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func updatePending(_ message: GatewayPendingChatMessage, content: String) async {
        guard let selectedSessionID else { return }
        let nextContent = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !nextContent.isEmpty else { return }
        if nextContent == message.content.trimmingCharacters(in: .whitespacesAndNewlines) {
            editingPendingMessage = nil
            editingPendingDraft = ""
            return
        }
        pendingMutationID = message.id
        do {
            let response = try await client.updatePendingMessage(
                sessionId: selectedSessionID,
                pendingId: message.id,
                content: nextContent
            )
            if response.success == false {
                error = response.error ?? "Failed to update pending message"
            } else {
                pendingMessages = response.pendingMessages
                editingPendingMessage = nil
                editingPendingDraft = ""
            }
        } catch {
            self.error = error.localizedDescription
        }
        pendingMutationID = nil
    }

    private func deletePending(_ message: GatewayPendingChatMessage) async {
        guard let selectedSessionID else { return }
        pendingMutationID = message.id
        do {
            let response = try await client.deletePendingMessage(
                sessionId: selectedSessionID,
                pendingId: message.id
            )
            if response.success == false {
                error = response.error ?? "Failed to delete pending message"
            } else {
                pendingMessages = response.pendingMessages
            }
        } catch {
            self.error = error.localizedDescription
        }
        pendingMutationID = nil
    }

    private func movePending(_ message: GatewayPendingChatMessage, direction: Int) async {
        guard let selectedSessionID else { return }
        guard message.mode != "steering", pendingMutationID == nil else { return }
        let previousMessages = sortedPendingMessages
        guard let currentIndex = previousMessages.firstIndex(where: { $0.id == message.id }) else { return }
        let nextIndex = currentIndex + direction
        guard previousMessages.indices.contains(nextIndex) else { return }
        var nextMessages = previousMessages
        nextMessages.swapAt(currentIndex, nextIndex)
        pendingMessages = nextMessages
        pendingMutationID = message.id
        do {
            let response = try await client.reorderPendingMessages(
                sessionId: selectedSessionID,
                pendingIds: nextMessages.map(\.id)
            )
            if response.success == false {
                pendingMessages = previousMessages
                error = response.error ?? "Failed to reorder pending messages"
            } else {
                pendingMessages = response.pendingMessages
            }
        } catch {
            pendingMessages = previousMessages
            self.error = error.localizedDescription
        }
        pendingMutationID = nil
    }

    private func performRevert(_ message: GatewaySessionMessage) {
        guard let sessionID = selectedSessionID else { return }
        Task {
            do {
                _ = try await client.revertSession(
                    sessionID,
                    messageContent: message.content,
                    messageTimestamp: message.timestamp
                )
                await loadMessages(sessionID)
            } catch {
                self.error = "Failed to revert: \(error.localizedDescription)"
            }
        }
    }

    private var composer: some View {
        VStack(spacing: 8) {
            if let error {
                Text(error)
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            VStack(spacing: 6) {
                TextField("Message Cybara…", text: $draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1 ... 6)
                    .font(.system(size: 13, design: .rounded))
                    .onSubmit { Task { await send() } }
                    .padding(.horizontal, 4)
                    .padding(.top, 2)
                HStack(spacing: 6) {
                    composerSecurityControls
                    Spacer(minLength: 6)
                    composerControls
                    Button {
                        Task { await send() }
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 24))
                    }
                    .buttonStyle(.borderless)
                    .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color.white.opacity(0.06))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(Color.white.opacity(0.1), lineWidth: 1)
            )
        }
        .padding(14)
        .cybaraGlass(cornerRadius: 0)
    }

    private var composerControls: some View {
        HStack(spacing: 4) {
            Button {
                showContextPopover.toggle()
            } label: {
                ZStack {
                    Circle()
                        .stroke(contextColor.opacity(0.85), lineWidth: 2)
                        .background(Circle().fill(contextColor.opacity(0.12)))
                    Text(activeContextUsage.map { "\(Int($0.usedPercent.rounded()))" } ?? "?")
                        .font(.system(size: 7.5, weight: .bold, design: .rounded))
                        .foregroundStyle(contextColor)
                }
                .frame(width: 20, height: 20)
            }
            .buttonStyle(.plain)
            .help(contextUsageText)
            .popover(isPresented: $showContextPopover) {
                contextUsagePopover
            }

            Picker("Agent", selection: agentSelectionBinding) {
                Text("Gateway default").tag("")
                ForEach(agents) { agent in
                    Text(agent.model.map { "\(agent.name) - \($0)" } ?? agent.name).tag(agent.id)
                }
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .controlSize(.small)
            .frame(width: 176)
            .disabled(agentSaving || agents.isEmpty)

            if agentSaving {
                ProgressView().controlSize(.small)
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    private var composerSecurityControls: some View {
        Menu {
            Button {
                Task { await changeToolApprovalMode("always_allow") }
            } label: {
                Label("Always Allow", systemImage: "exclamationmark.shield")
            }
            Button {
                Task { await changeToolApprovalMode("ask") }
            } label: {
                Label("Ask Me", systemImage: "questionmark.circle")
            }
        } label: {
            HStack(spacing: 5) {
                if approvalSaving {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: toolApprovalIconName)
                        .font(.system(size: 11, weight: .semibold))
                }
                Text(toolApprovalLabel)
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
            .foregroundStyle(toolApprovalColor)
            .padding(.horizontal, 8)
            .frame(height: 26)
            .background(Capsule().fill(toolApprovalColor.opacity(0.08)))
        }
        .buttonStyle(.plain)
        .disabled(approvalSaving)
        .help("Tool approvals: \(toolApprovalLabel)")
    }

    private var contextUsagePopover: some View {
        VStack(spacing: 3) {
            Text("Context window:")
                .foregroundStyle(.secondary)
            if let usage = activeContextUsage {
                Text("\(formatNativePercent(usage.usedPercent)) full")
                    .fontWeight(.medium)
                Text("\(formatNativeTokenCount(usage.usedTokens)) / \(formatNativeTokenCount(usage.limitTokens)) tokens used")
            } else {
                Text("Not loaded yet")
                    .fontWeight(.medium)
                Text("Open a session or send a message to estimate usage.")
                    .multilineTextAlignment(.center)
            }
        }
        .font(.system(size: 12, design: .rounded))
        .padding(14)
        .frame(width: 260, alignment: .center)
    }

    private var contextColor: Color {
        let percent = activeContextUsage?.usedPercent ?? 0
        if percent >= 90 { return .red }
        if percent >= 70 { return .orange }
        return .green
    }

    private var toolApprovalLabel: String {
        toolApprovalMode == "ask" ? "Ask Me" : "Always Allow"
    }

    private var toolApprovalIconName: String {
        toolApprovalMode == "ask" ? "questionmark.circle" : "exclamationmark.shield"
    }

    private var toolApprovalColor: Color {
        toolApprovalMode == "ask" ? .blue : .orange
    }

    private func loadSessions() async {
        do {
            async let loadedSessions = client.sessions(limit: 150)
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

    private func loadChatConfig() async {
        do {
            let config = try await client.appConfig()
            toolApprovalMode = config["tool_approval_mode"] as? String == "ask" ? "ask" : "always_allow"
        } catch {
            toolApprovalMode = "always_allow"
        }
    }

    private func changeToolApprovalMode(_ nextMode: String) async {
        let normalized = nextMode == "ask" ? "ask" : "always_allow"
        guard normalized != toolApprovalMode, !approvalSaving else { return }
        let previousMode = toolApprovalMode
        toolApprovalMode = normalized
        approvalSaving = true
        do {
            let body = try JSONSerialization.data(withJSONObject: ["tool_approval_mode": normalized])
            try await client.updateAppConfig(body)
            error = nil
        } catch {
            toolApprovalMode = previousMode
            self.error = error.localizedDescription
        }
        approvalSaving = false
    }

    private func updateSessionList(with session: GatewaySession) {
        if let index = sessions.firstIndex(where: { $0.id == session.id }) {
            sessions[index] = session
        } else {
            sessions.insert(session, at: 0)
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
        pendingMessages = []
        pendingAgentID = ""
        pendingAgentSessionID = nil
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

    private func changeChatAgent(_ agentID: String) async {
        guard !agentSaving else { return }
        guard !agentID.isEmpty else {
            if selectedSessionID == nil { pendingAgentID = "" }
            return
        }
        if selectedSessionID == nil {
            pendingAgentID = agentID
            return
        }
        guard let selectedSessionID else { return }
        pendingAgentID = agentID
        pendingAgentSessionID = selectedSessionID
        agentSaving = true
        do {
            let response = try await client.updateSessionAgent(selectedSessionID, agentId: agentID)
            if response.success == false {
                throw GatewayClientError.badStatus(200, response.error ?? "Failed to update session agent")
            }
            await loadSessions()
            await loadMessages(selectedSessionID)
            pendingAgentSessionID = nil
            pendingAgentID = ""
            error = nil
        } catch {
            pendingAgentSessionID = nil
            pendingAgentID = ""
            self.error = error.localizedDescription
        }
        agentSaving = false
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
            let detail = try await client.sessionDetail(id)
            updateSessionList(with: detail)
            messages = detail.messagesList ?? []
            liveActivities = nativePrunePersistedLiveActivities(
                liveActivities,
                persistedMessages: messages
            )
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func hydrateStatus(_ id: String) async {
        do {
            let status = try await client.sessionStatus(id)
            guard selectedSessionID == id else { return }
            let snapshot = status.session ?? status.activeSessions.first { $0.sessionId == id }
            if let snapshot {
                applyStatusSnapshot(snapshot)
            } else if status.active == false, !sending {
                pendingMessages = []
                resetLiveTimeline(clearStartedAt: true)
            }
        } catch {}
    }

    private func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let queuedSend = sending || showWorkingTimeline || !pendingMessages.isEmpty
        guard !text.isEmpty else { return }
        if !queuedSend {
            sending = true
        }
        error = nil
        draft = ""
        if !queuedSend {
            liveStatus = "thinking"
            liveCurrentStep = "Thinking..."
            liveStartedAt = Date()
            liveActivities = []
            streamingContent = nil
        }
        let optimisticTimestamp = gatewayTimestampNow()
        messages.append(GatewaySessionMessage(role: "user", content: text, timestamp: optimisticTimestamp))
        do {
            let result = try await client.sendChat(
                message: text,
                sessionId: selectedSessionID,
                agentId: selectedChatAgentID.isEmpty ? nil : selectedChatAgentID,
                workspaceDir: activeWorkspaceDir,
                queueMode: queuedSend ? "queue" : nil
            )
            if result.queued == true {
                pendingMessages = result.pendingMessages
                messages.removeAll {
                    $0.content == text && $0.role == "user" && $0.timestamp == optimisticTimestamp
                }
                return
            }
            if let workspaceDir = result.workspaceDir {
                lastWorkspaceDir = workspaceDir
                if selectedSessionID == nil {
                    pendingWorkspaceDir = workspaceDir
                }
            }
            let resolvedSessionID = result.sessionId ?? selectedSessionID
            if selectedSessionID == nil, let newId = result.sessionId {
                selectedSessionID = newId
            }
            await loadSessions()
            if let resolvedSessionID {
                await loadMessages(resolvedSessionID)
            } else if let reply = result.message {
                messages.append(reply)
            } else if let reply = result.response, !reply.isEmpty {
                messages.append(GatewaySessionMessage(role: "assistant", content: reply, timestamp: gatewayTimestampNow()))
            }
            resetLiveTimeline(clearStartedAt: true)
        } catch {
            self.error = error.localizedDescription
        }
        if !queuedSend {
            sending = false
        }
    }

    private func handleStatusEvent(_ event: GatewayStatusEvent) {
        switch event.type {
        case "snapshot":
            guard let snapshot = snapshotForVisibleSession(event) else { return }
            applyStatusSnapshot(snapshot)
        case "assistant_token":
            guard eventMatchesVisibleSession(event) else { return }
            guard let delta = event.delta, !delta.isEmpty else { return }
            streamingContent = (streamingContent ?? "") + delta
            if liveStartedAt == nil { liveStartedAt = Date() }
            liveStatus = "generating"
        case "status", nil:
            applyStatusEvent(event)
        default:
            return
        }
    }

    private func applyStatusEvent(_ event: GatewayStatusEvent) {
        guard eventMatchesVisibleSession(event) else { return }
        let status = event.status?.lowercased() ?? ""
        guard !status.isEmpty else { return }

        if status == "idle" {
            if !sending {
                // Fetch the persisted reply before dropping the live timeline
                // so the chat never goes blank right as a run finishes.
                Task {
                    if let id = selectedSessionID {
                        await loadMessages(id)
                    }
                    resetLiveTimeline(clearStartedAt: true)
                }
            }
            return
        }

        if status == "error" {
            liveStatus = "error"
            liveCurrentStep = firstNonEmptyGatewayString(event.detail) ?? "Run failed"
            if let activity = nativeLiveActivity(from: event) {
                liveActivities = nativeMergeLiveActivity(liveActivities, incoming: activity)
            }
            return
        }

        if liveStartedAt == nil { liveStartedAt = Date() }
        liveStatus = status

        if let activity = nativeLiveActivity(from: event) {
            liveActivities = nativeMergeLiveActivity(liveActivities, incoming: activity)
            liveCurrentStep = activity.phase == .start ? activity.text : nil
            return
        }

        if let detail = firstNonEmptyGatewayString(event.detail),
           !["thinking", "thinking...", "generating response", "generating response..."].contains(detail.lowercased()) {
            liveCurrentStep = detail
        } else if status == "generating" {
            liveCurrentStep = "Generating response..."
        } else if status == "thinking" {
            liveCurrentStep = "Thinking..."
        }
    }

    private func applyStatusSnapshot(_ snapshot: GatewaySessionStatusSnapshot) {
        guard !snapshot.sessionId.isEmpty else { return }
        if selectedSessionID != nil && snapshot.sessionId != selectedSessionID { return }
        pendingMessages = snapshot.pendingMessages
        liveStatus = snapshot.status ?? liveStatus
        if liveStartedAt == nil { liveStartedAt = Date() }
        let snapshotActivities = nativeLiveActivities(from: snapshot)
        let preservingLocalLiveActivities = snapshotActivities.isEmpty && !liveActivities.isEmpty
        if !snapshotActivities.isEmpty {
            liveActivities = nativeMergeLiveActivities([], incoming: snapshotActivities)
        }
        if let activeStep = liveActivities.reversed().first(where: { $0.phase == .start })?.text {
            liveCurrentStep = activeStep
        } else if let detail = firstNonEmptyGatewayString(snapshot.detail),
                  !preservingLocalLiveActivities,
                  !["thinking", "thinking...", "generating response", "generating response...", "queued follow-up"].contains(detail.lowercased()) {
            liveCurrentStep = detail
        }
    }

    private func eventMatchesVisibleSession(_ event: GatewayStatusEvent) -> Bool {
        guard let eventSessionID = firstNonEmptyGatewayString(event.sessionId) else {
            return selectedSessionID != nil || sending
        }
        if let selectedSessionID {
            return eventSessionID == selectedSessionID
        }
        return sending
    }

    private func snapshotForVisibleSession(_ event: GatewayStatusEvent) -> GatewaySessionStatusSnapshot? {
        if let selectedSessionID {
            return event.activeSessions.first { $0.sessionId == selectedSessionID }
        }
        return sending ? event.activeSessions.first : nil
    }

    private func resetLiveTimeline(clearStartedAt: Bool) {
        liveStatus = "idle"
        liveCurrentStep = nil
        liveActivities = []
        streamingContent = nil
        if clearStartedAt {
            liveStartedAt = nil
        }
    }
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

struct TasksScreen: View {
    let client: GatewayClient
    var openChat: (String) -> Void = { _ in }

    @State private var tasks: [GatewayTask] = []
    @State private var agents: [GatewayAgent] = []
    @State private var searchText = ""
    @State private var expandedTaskID: String?
    @State private var taskRuns: [String: [GatewayTaskRun]] = [:]
    @State private var runsLoadingTaskID: String?
    @State private var showingEditor = false
    @State private var editingTask: GatewayTask?
    @State private var deletingTask: GatewayTask?
    @State private var busyTask: String?
    @State private var error: String?

    private var filteredTasks: [GatewayTask] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return tasks }
        return tasks.filter { task in
            [
                task.name,
                task.description ?? "",
                task.action ?? "",
                task.schedule ?? "",
                task.statusLabel,
            ].joined(separator: " ").lowercased().contains(query)
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .firstTextBaseline) {
                    ScreenHeader(title: "Tasks", subtitle: "Scheduled agent automations")
                    Spacer()
                    Button {
                        editingTask = nil
                        showingEditor = true
                    } label: {
                        Label("New Task", systemImage: "plus")
                    }
                    .buttonStyle(.borderedProminent)
                    Button {
                        Task { await load() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(.bordered)
                    .help("Refresh tasks")
                }

                if let error {
                    LoadFailedView(message: error) { Task { await load() } }
                } else {
                    taskToolbar

                    if filteredTasks.isEmpty {
                        taskEmptyState
                    } else {
                        LazyVStack(spacing: 12) {
                            ForEach(filteredTasks) { task in
                                taskRow(task)
                            }
                        }
                    }
                }
            }
            .padding(24)
        }
        .task { await load() }
        .sheet(isPresented: $showingEditor) {
            TaskEditorSheet(task: editingTask, agents: agents) { draft in
                try await saveTask(draft)
            }
            .frame(minWidth: 520, idealWidth: 560, minHeight: 620)
        }
        .confirmationDialog(
            "Delete “\(deletingTask?.name ?? "task")”?",
            isPresented: deleteDialogBinding,
            titleVisibility: .visible
        ) {
            Button("Delete Task", role: .destructive) {
                if let deletingTask {
                    Task { await delete(deletingTask) }
                }
            }
            Button("Cancel", role: .cancel) { deletingTask = nil }
        } message: {
            Text("This removes the scheduled task and its run history.")
        }
    }

    private var deleteDialogBinding: Binding<Bool> {
        Binding(
            get: { deletingTask != nil },
            set: { if !$0 { deletingTask = nil } }
        )
    }

    private var taskToolbar: some View {
        HStack(spacing: 12) {
            TextField("Search tasks", text: $searchText)
                .textFieldStyle(.roundedBorder)
                .frame(maxWidth: 360)
            Spacer()
            taskSummary("Active", tasks.filter(\.isRunning).count, "checkmark.circle", .green)
            taskSummary("Paused", tasks.filter { $0.status?.lowercased() == "paused" }.count, "pause.circle", .orange)
            taskSummary("Total", tasks.count, "calendar.badge.clock", .secondary)
        }
    }

    private var taskEmptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "calendar.badge.clock")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(.secondary)
            Text(tasks.isEmpty ? "No scheduled tasks yet." : "No matching tasks.")
                .font(.system(size: 14, weight: .semibold, design: .rounded))
            Button {
                editingTask = nil
                showingEditor = true
            } label: {
                Label("Create Task", systemImage: "plus")
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .cybaraGlass(cornerRadius: 18)
    }

    private func taskSummary(_ label: String, _ value: Int, _ systemImage: String, _ tint: Color) -> some View {
        HStack(spacing: 6) {
            Image(systemName: systemImage)
                .foregroundStyle(tint)
            Text("\(value)")
                .font(.system(size: 13, weight: .bold, design: .rounded))
            Text(label)
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.white.opacity(0.055))
        )
    }

    private func taskRow(_ task: GatewayTask) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: task.isRunning ? "calendar.badge.checkmark" : "calendar.badge.clock")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(task.isRunning ? Color.green : Color.secondary)
                    .frame(width: 38, height: 38)
                    .background(Circle().fill(Color.white.opacity(0.065)))

                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 8) {
                        Text(task.name)
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                            .lineLimit(1)
                        taskStatusPill(task)
                    }
                    if let description = firstNonEmptyGatewayString(task.description) {
                        Text(description)
                            .font(.system(size: 12, design: .rounded))
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                    Text(taskDetailLine(task))
                        .font(.system(size: 11, design: .rounded))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    if let action = firstNonEmptyGatewayString(task.action) {
                        Text(action)
                            .font(.system(size: 12, design: .rounded))
                            .foregroundStyle(.primary.opacity(0.82))
                            .lineLimit(2)
                            .padding(.top, 1)
                    }
                }

                Spacer(minLength: 12)

                taskActions(task)
            }

            if expandedTaskID == task.id {
                taskHistory(task)
                    .padding(.leading, 52)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cybaraGlass(cornerRadius: 18)
    }

    @ViewBuilder
    private func taskActions(_ task: GatewayTask) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                taskActionButtons(task)
            }
            Menu {
                taskActionButtons(task)
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .menuStyle(.borderlessButton)
        }
    }

    @ViewBuilder
    private func taskActionButtons(_ task: GatewayTask) -> some View {
        Button {
            Task { await run(task) }
        } label: {
            Label("Run", systemImage: "play.fill")
        }
        .disabled(busyTask == task.id)

        Button {
            Task { await toggle(task) }
        } label: {
            Label(task.isRunning ? "Pause" : "Resume", systemImage: task.isRunning ? "pause.fill" : "play")
        }
        .disabled(busyTask == task.id)

        Button {
            editingTask = task
            showingEditor = true
        } label: {
            Label("Edit", systemImage: "pencil")
        }

        Button {
            Task { await toggleHistory(task) }
        } label: {
            Label(expandedTaskID == task.id ? "Hide History" : "History", systemImage: "clock.arrow.circlepath")
        }

        Button(role: .destructive) {
            deletingTask = task
        } label: {
            Label("Delete", systemImage: "trash")
        }
    }

    private func taskStatusPill(_ task: GatewayTask) -> some View {
        Text(task.statusLabel)
            .font(.system(size: 10, weight: .bold, design: .rounded))
            .foregroundStyle(task.isRunning ? Color.green : Color.secondary)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(
                Capsule()
                    .fill((task.isRunning ? Color.green : Color.secondary).opacity(0.13))
            )
    }

    private func taskHistory(_ task: GatewayTask) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if runsLoadingTaskID == task.id {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Loading history")
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.secondary)
                }
            } else if let runs = taskRuns[task.id], !runs.isEmpty {
                ForEach(runs) { run in
                    taskRunRow(run)
                }
            } else {
                Text("No runs yet.")
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.top, 2)
    }

    private func taskRunRow(_ run: GatewayTaskRun) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: taskRunIcon(run.status))
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(taskRunTint(run.status))
                .frame(width: 24, height: 24)
                .background(Circle().fill(taskRunTint(run.status).opacity(0.13)))
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(run.status.capitalized)
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                    if let started = firstNonEmptyGatewayString(absoluteTimestamp(run.started_at), relativeTimestamp(run.started_at)) {
                        Text(started)
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                    }
                }
                if let preview = firstNonEmptyGatewayString(run.result_preview) {
                    Text(preview)
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.primary.opacity(0.8))
                        .lineLimit(2)
                }
                if let error = firstNonEmptyGatewayString(run.error) {
                    Text(error)
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.red)
                        .lineLimit(2)
                }
                if let sessionID = firstNonEmptyGatewayString(run.session_id) {
                    Button {
                        openChat(sessionID)
                    } label: {
                        Label("Open Chat", systemImage: "bubble.left")
                    }
                    .buttonStyle(.borderless)
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                }
            }
            Spacer()
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.white.opacity(0.045))
        )
    }

    private func taskDetailLine(_ task: GatewayTask) -> String {
        var parts: [String] = []
        parts.append(task.schedule.map(formatTaskSchedule) ?? "Manual")
        if let agent = agents.first(where: { $0.id == task.agent_id }) {
            parts.append(agent.name)
        } else if let agentID = firstNonEmptyGatewayString(task.agent_id) {
            parts.append(agentID)
        } else {
            parts.append("Automatic agent")
        }
        let lastRun = relativeTimestamp(task.last_run)
        if !lastRun.isEmpty { parts.append("Last \(lastRun)") }
        let nextRun = relativeTimestamp(task.next_run)
        if !nextRun.isEmpty { parts.append("Next \(nextRun)") }
        return parts.joined(separator: " · ")
    }

    private func taskRunIcon(_ status: String) -> String {
        switch status.lowercased() {
        case "completed": return "checkmark.circle.fill"
        case "failed": return "xmark.circle.fill"
        case "running": return "arrow.triangle.2.circlepath"
        default: return "circle"
        }
    }

    private func taskRunTint(_ status: String) -> Color {
        switch status.lowercased() {
        case "completed": return .green
        case "failed": return .red
        case "running": return .orange
        default: return .secondary
        }
    }

    private func load() async {
        do {
            async let loadedTasks = client.tasks()
            async let loadedAgents = client.agents()
            tasks = try await loadedTasks
            agents = try await loadedAgents
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func saveTask(_ draft: NativeTaskDraft) async throws {
        if let editingTask {
            try await client.updateTask(
                editingTask.id,
                name: draft.name,
                description: draft.description,
                agentID: draft.agentID,
                action: draft.action,
                schedule: draft.schedule,
                enabled: draft.enabled
            )
        } else {
            try await client.createTask(
                name: draft.name,
                description: draft.description,
                agentID: draft.agentID,
                action: draft.action,
                schedule: draft.schedule,
                enabled: draft.enabled
            )
        }
        showingEditor = false
        editingTask = nil
        await load()
    }

    private func run(_ task: GatewayTask) async {
        busyTask = task.id
        do {
            try await client.triggerTask(task.id)
            await load()
            if expandedTaskID == task.id {
                await loadRuns(task.id)
            }
        } catch {
            self.error = error.localizedDescription
        }
        busyTask = nil
    }

    private func toggle(_ task: GatewayTask) async {
        busyTask = task.id
        do {
            if task.isRunning {
                try await client.stopTask(task.id)
            } else {
                try await client.startTask(task.id)
            }
            await load()
        } catch {
            self.error = error.localizedDescription
        }
        busyTask = nil
    }

    private func delete(_ task: GatewayTask) async {
        deletingTask = nil
        busyTask = task.id
        do {
            try await client.deleteTask(task.id)
            if expandedTaskID == task.id {
                expandedTaskID = nil
            }
            taskRuns.removeValue(forKey: task.id)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
        busyTask = nil
    }

    private func toggleHistory(_ task: GatewayTask) async {
        if expandedTaskID == task.id {
            expandedTaskID = nil
            return
        }
        expandedTaskID = task.id
        await loadRuns(task.id)
    }

    private func loadRuns(_ taskID: String) async {
        runsLoadingTaskID = taskID
        do {
            taskRuns[taskID] = try await client.taskRuns(taskID)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        runsLoadingTaskID = nil
    }
}

private struct NativeTaskDraft {
    let name: String
    let description: String
    let agentID: String?
    let action: String
    let schedule: String
    let enabled: Bool
}

private struct TaskSchedulePreset: Identifiable, Hashable {
    let id: String
    let label: String
}

private let nativeTaskSchedulePresets = [
    TaskSchedulePreset(id: "*/5 * * * *", label: "Every 5 minutes"),
    TaskSchedulePreset(id: "*/15 * * * *", label: "Every 15 minutes"),
    TaskSchedulePreset(id: "0 * * * *", label: "Every hour"),
    TaskSchedulePreset(id: "0 */6 * * *", label: "Every 6 hours"),
    TaskSchedulePreset(id: "0 0 * * *", label: "Daily at midnight"),
    TaskSchedulePreset(id: "0 9 * * 1", label: "Monday at 9 AM"),
]

private func formatTaskSchedule(_ schedule: String) -> String {
    nativeTaskSchedulePresets.first { $0.id == schedule }?.label ?? schedule
}

private struct TaskEditorSheet: View {
    let task: GatewayTask?
    let agents: [GatewayAgent]
    let onSave: (NativeTaskDraft) async throws -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var description: String
    @State private var agentID: String
    @State private var action: String
    @State private var schedulePreset: String
    @State private var customSchedule: String
    @State private var enabled: Bool
    @State private var saving = false
    @State private var error: String?

    init(
        task: GatewayTask?,
        agents: [GatewayAgent],
        onSave: @escaping (NativeTaskDraft) async throws -> Void
    ) {
        self.task = task
        self.agents = agents
        self.onSave = onSave
        let schedule = task?.schedule ?? "0 * * * *"
        let isPreset = nativeTaskSchedulePresets.contains { $0.id == schedule }
        _name = State(initialValue: task?.name ?? "")
        _description = State(initialValue: task?.description ?? "")
        _agentID = State(initialValue: task?.agent_id ?? "")
        _action = State(initialValue: task?.action ?? "")
        _schedulePreset = State(initialValue: isPreset ? schedule : "custom")
        _customSchedule = State(initialValue: isPreset ? "*/5 * * * *" : schedule)
        _enabled = State(initialValue: task?.isRunning ?? true)
    }

    private var selectedSchedule: String {
        schedulePreset == "custom" ? customSchedule : schedulePreset
    }

    private var canSave: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !action.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !selectedSchedule.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !saving
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                ScreenHeader(
                    title: task == nil ? "New Task" : "Edit Task",
                    subtitle: "Schedule an agent prompt through the local gateway"
                )
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                }
                .buttonStyle(.borderless)
                .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 14) {
                TextField("Task name", text: $name)
                    .textFieldStyle(.roundedBorder)

                TextField("Description", text: $description)
                    .textFieldStyle(.roundedBorder)

                Picker("Agent", selection: $agentID) {
                    Text("Automatic").tag("")
                    ForEach(agents) { agent in
                        Text(agent.name).tag(agent.id)
                    }
                }
                .pickerStyle(.menu)

                VStack(alignment: .leading, spacing: 7) {
                    Text("Action")
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .foregroundStyle(.secondary)
                    TextEditor(text: $action)
                        .font(.system(size: 13, design: .rounded))
                        .scrollContentBackground(.hidden)
                        .frame(minHeight: 110)
                        .padding(8)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(Color.white.opacity(0.055))
                        )
                }

                Picker("Schedule", selection: $schedulePreset) {
                    ForEach(nativeTaskSchedulePresets) { preset in
                        Text(preset.label).tag(preset.id)
                    }
                    Text("Custom").tag("custom")
                }
                .pickerStyle(.menu)

                if schedulePreset == "custom" {
                    TextField("Cron expression", text: $customSchedule)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 13, design: .monospaced))
                }

                Toggle("Enabled", isOn: $enabled)
            }
            .padding(16)
            .cybaraGlass(cornerRadius: 18)

            if let error {
                Text(error)
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(.red)
            }

            Spacer()

            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button {
                    Task { await save() }
                } label: {
                    if saving {
                        ProgressView().controlSize(.small)
                    } else {
                        Text(task == nil ? "Create" : "Save")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!canSave)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
    }

    private func save() async {
        let draft = NativeTaskDraft(
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            description: description.trimmingCharacters(in: .whitespacesAndNewlines),
            agentID: firstNonEmptyGatewayString(agentID),
            action: action.trimmingCharacters(in: .whitespacesAndNewlines),
            schedule: selectedSchedule.trimmingCharacters(in: .whitespacesAndNewlines),
            enabled: enabled
        )
        saving = true
        do {
            try await onSave(draft)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
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
