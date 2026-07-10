import AppKit
import SwiftUI
import UniformTypeIdentifiers

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

func compactRelativeTimestamp(_ iso: String?) -> String {
    guard let date = parseGatewayDate(iso) else { return "" }
    let seconds = max(0, Int(Date().timeIntervalSince(date)))
    if seconds < 60 { return "now" }
    let minutes = seconds / 60
    if minutes < 60 { return "\(minutes)m" }
    let hours = minutes / 60
    if hours < 24 { return "\(hours)h" }
    let days = hours / 24
    if days < 7 { return "\(days)d" }
    let weeks = days / 7
    if weeks < 8 { return "\(weeks)w" }
    let months = max(1, days / 30)
    if months < 12 { return "\(months)mo" }
    return "\(days / 365)y"
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

func nativeChatAgentLabel(name: String, model: String?, compact: Bool) -> String {
    guard let model, !model.isEmpty else { return name }
    return compact ? model : "\(name) - \(model)"
}

func nativeReasoningEffortIndex(_ effort: String) -> Double {
    Double(nativeReasoningEfforts.firstIndex { $0.value == effort } ?? 0)
}

func nativeReasoningEffortValue(_ index: Double) -> String {
    let bounded = min(max(Int(index.rounded()), 0), nativeReasoningEfforts.count - 1)
    return nativeReasoningEfforts[bounded].value
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

/// Horizontal strip of the images a user attached to a chat message.
struct NativeAttachedImagesStrip: View {
    let images: [NativeAttachedImage]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(images) { image in
                    if let data = Data(base64Encoded: image.base64),
                       let nsImage = NSImage(data: data) {
                        Image(nsImage: nsImage)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 120, height: 120)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .stroke(Color.white.opacity(0.12), lineWidth: 1)
                            )
                    }
                }
            }
        }
    }
}

func nativeImageMimeType(for url: URL) -> String {
    switch url.pathExtension.lowercased() {
    case "png": return "image/png"
    case "jpg", "jpeg": return "image/jpeg"
    case "gif": return "image/gif"
    case "webp": return "image/webp"
    default:
        return UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "image/png"
    }
}

struct NativeAttachedFile: Identifiable, Hashable, Sendable {
    let id: UUID
    let name: String
    let content: String
    let size: Int

    init(id: UUID = UUID(), name: String, content: String, size: Int? = nil) {
        self.id = id
        self.name = name
        self.content = content
        self.size = size ?? content.utf8.count
    }
}

func nativeFormatBytes(_ bytes: Int) -> String {
    guard bytes > 0 else { return "" }
    let units = ["B", "KB", "MB", "GB"]
    var value = Double(bytes)
    var unit = 0
    while value >= 1024 && unit < units.count - 1 {
        value /= 1024
        unit += 1
    }
    if value >= 10 || unit == 0 {
        return "\(Int(value.rounded())) \(units[unit])"
    }
    return String(format: "%.1f %@", value, units[unit])
}

func nativeMediaSummaryLabel(images: [NativeAttachedImage], files: [NativeAttachedFile]) -> String {
    var parts: [String] = []
    if !images.isEmpty {
        parts.append("\(images.count) image\(images.count == 1 ? "" : "s")")
    }
    if !files.isEmpty {
        parts.append("\(files.count) file\(files.count == 1 ? "" : "s")")
    }
    let totalBytes = images.reduce(0) { $0 + $1.size } + files.reduce(0) { $0 + $1.size }
    let size = nativeFormatBytes(totalBytes)
    let joined = parts.joined(separator: " · ")
    return size.isEmpty ? joined : "\(joined) · \(size)"
}

let nativeImageFileExtensions: Set<String> = ["png", "jpg", "jpeg", "gif", "webp"]

func nativeComposedMessage(text: String, files: [NativeAttachedFile]) -> String {
    var composed = text
    for file in files {
        composed += "\n\nAttached file `\(file.name)`:\n```\n\(file.content)\n```\n"
    }
    return composed
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
    let workspaceDir: String?
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

private func nativeSessionGroups(
    _ sessions: [GatewaySession],
    pinnedWorkspaceGroupIDs: Set<String> = []
) -> [NativeSessionGroup] {
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
                workspaceDir: nil,
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
                workspaceDir: isUnassigned ? nil : key,
                sessions: sorted,
                latestDate: nativeSessionUpdatedDate(latest)
            )
        )
    }

    return groups.sorted {
        if $0.kind == .pinned { return true }
        if $1.kind == .pinned { return false }
        let leftPinnedProject = $0.kind == .workspace && pinnedWorkspaceGroupIDs.contains($0.id)
        let rightPinnedProject = $1.kind == .workspace && pinnedWorkspaceGroupIDs.contains($1.id)
        if leftPinnedProject != rightPinnedProject { return leftPinnedProject }
        if $0.kind == .workspace && $1.kind == .unassigned { return true }
        if $0.kind == .unassigned && $1.kind == .workspace { return false }
        if $0.latestDate != $1.latestDate { return $0.latestDate > $1.latestDate }
        return $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending
    }
}

private let nativeModelRouterSelectorValue = "__model_router__"

struct ChatScreen: View {
    let client: GatewayClient
    @Binding var selectedSessionID: String?
    var openCybaraIDEWorkspace: (String) -> Void = { _ in }
    @Environment(\.cybaraAccent) private var accentTint

    @State private var sessions: [GatewaySession] = []
    @State private var agents: [GatewayAgent] = []
    @State private var providers: [GatewayProvider] = []
    @State private var providerPlanStatus: ProviderPlanStatusResponse?
    @State private var messages: [GatewaySessionMessage] = []
    @State private var searchText = ""
    @State private var draft = ""
    @State private var sending = false
    @State private var error: String?
    @State private var pendingAttachments: [NativeAttachedImage] = []
    @State private var pendingFiles: [NativeAttachedFile] = []
    @State private var attachmentsByContent: [String: [NativeAttachedImage]] = [:]
    @State private var renameTarget: GatewaySession?
    @State private var renameDraft = ""
    @State private var deleteTarget: GatewaySession?
    @State private var pendingAgentID = ""
    @State private var pendingAgentSessionID: String?
    @State private var modelRouterEnabled = false
    @State private var useModelRouter = false
    @State private var pendingWorkspaceDir = ""
    @State private var workspaceSaving = false
    @State private var activeGitBranch: String?
    @State private var activeGitBranches: [GatewayGitBranchSummary] = []
    @State private var workspaceOpenTargets: [NativeWorkspaceOpenTarget] = []
    @State private var workspaceOpenTargetsLoading = false
    @State private var workspaceOpeningTargetID: String?
    @State private var gitBranchSearch = ""
    @State private var newGitBranchName = ""
    @State private var gitBranchLoading = false
    @State private var gitBranchError: String?
    @State private var showGitBranchPicker = false
    @State private var agentSaving = false
    @State private var approvalSaving = false
    @State private var toolApprovalMode = "always_allow"
    @State private var pendingApprovals: [GatewayPendingApproval] = []
    @State private var expandedApprovalID: String?
    @State private var showContextPopover = false
    @State private var showReasoningPopover = false
    @State private var reasoningDraftIndex = 0.0
    @State private var reasoningSaving = false
    @State private var showEnvironmentPopover = false
    @State private var showSubagentsPopover = false
    @State private var showFileDiffsPopover = false
    @State private var subagents: [NativeSubagentSummary] = []
    @State private var subagentsLoading = false
    @State private var selectedSubagent: NativeSubagentSummary?
    @State private var showSpawnSubagent = false
    @State private var subagentTaskDraft = ""
    @State private var subagentMutating = false
    @State private var showClearSubagentHistoryConfirm = false
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
    @State private var hoveredSessionGroupID: String?
    @State private var activeSessionIDs: Set<String> = []
    @AppStorage("cybara.chat.lastWorkspaceDir") private var lastWorkspaceDir = ""
    @AppStorage("cybara.chat.pinnedWorkspaceGroupIds") private var pinnedWorkspaceGroupIdsRaw = ""
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
            await loadSubagents()
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
            useModelRouter = false
            guard let selectedSessionID else {
                messages = []
                subagents = []
                selectedSubagent = nil
                showSpawnSubagent = false
                subagentTaskDraft = ""
                return
            }
            await loadMessages(selectedSessionID)
            await hydrateStatus(selectedSessionID)
            await loadSubagents()
        }
        .task(id: activeWorkspaceDir) {
            await loadActiveGitBranch()
            await loadWorkspaceOpenTargets()
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
        nativeSessionGroups(filteredSessions, pinnedWorkspaceGroupIDs: pinnedWorkspaceGroupIDs)
    }

    private var pinnedWorkspaceGroupIDs: Set<String> {
        Set(pinnedWorkspaceGroupIdsRaw.split(separator: "\n").map(String.init))
    }

    private var sessionList: some View {
        VStack(alignment: .leading, spacing: 0) {
            TextField("Search chats", text: $searchText)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal, 14)
                .padding(.top, 14)
                .padding(.bottom, 10)

            Button {
                startNewChat()
            } label: {
                Label("New Chat", systemImage: "plus")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
            .padding(.horizontal, 14)
            .padding(.bottom, 10)
            .help("New chat")

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
                        HStack(spacing: 4) {
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
                            if group.kind == .workspace {
                                Menu {
                                    Button(pinnedWorkspaceGroupIDs.contains(group.id) ? "Unpin Project" : "Pin Project") {
                                        toggleWorkspaceProjectPin(group.id)
                                    }
                                    if let workspaceDir = group.workspaceDir {
                                        Button("Reveal in Finder") {
                                            revealWorkspaceProject(workspaceDir)
                                        }
                                    }
                                } label: {
                                    Image(systemName: "ellipsis")
                                        .font(.system(size: 12, weight: .semibold))
                                }
                                .menuStyle(.borderlessButton)
                                .help("Project actions")
                                .disabled(hoveredSessionGroupID != group.id)
                                .opacity(hoveredSessionGroupID == group.id ? 1 : 0)
                            }
                        }
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(.secondary)
                        .help(group.kind == .pinned ? "Pinned chats" : "\(group.label) workspace")
                        .onHover { hovering in
                            hoveredSessionGroupID = hovering ? group.id : nil
                        }
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

    private func toggleWorkspaceProjectPin(_ groupID: String) {
        var next = pinnedWorkspaceGroupIDs
        if next.contains(groupID) {
            next.remove(groupID)
        } else {
            next.insert(groupID)
        }
        pinnedWorkspaceGroupIdsRaw = next.sorted().joined(separator: "\n")
    }

    private func revealWorkspaceProject(_ workspaceDir: String) {
        NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: workspaceDir)
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
            if activeSessionIDs.contains(session.id) || (sending && selectedSessionID == session.id) {
                ProgressView()
                    .controlSize(.mini)
                    .frame(width: 28, alignment: .trailing)
            } else {
                Text(compactRelativeTimestamp(session.updated_at ?? session.created_at))
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(.tertiary)
                    .frame(width: 32, alignment: .trailing)
            }
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
            workspaceOpenMenu

            Button {
                showFileDiffsPopover.toggle()
            } label: {
                Image(systemName: "doc.text.magnifyingglass")
            }
            .buttonStyle(.borderless)
            .popover(isPresented: $showFileDiffsPopover, arrowEdge: .bottom) {
                fileDiffsPopover
            }
            .help("File changes")

            Button {
                showEnvironmentPopover.toggle()
                Task { await loadSubagents() }
            } label: {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: "list.bullet.rectangle")
                    if hasEnvironmentSignal {
                        Circle()
                            .fill(accentTint)
                            .frame(width: 6, height: 6)
                            .offset(x: 3, y: -3)
                    }
                }
            }
            .buttonStyle(.borderless)
            .popover(isPresented: $showEnvironmentPopover, arrowEdge: .bottom) {
                environmentPopover
            }
            .help("Environment overview")

            Button {
                showSubagentsPopover.toggle()
                Task { await loadSubagents() }
            } label: {
                Image(systemName: "person.2.wave.2")
            }
            .buttonStyle(.borderless)
            .popover(isPresented: $showSubagentsPopover, arrowEdge: .bottom) {
                subagentsPopover
            }
            .help("Subagents")
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 13)
    }

    @ViewBuilder
    private var workspaceOpenMenu: some View {
        if let workspace = activeWorkspaceDir {
            Menu {
                Section(gatewayWorkspaceFolderName(workspace) ?? "Workspace") {
                    if workspaceOpenTargetsLoading {
                        Label("Detecting apps…", systemImage: "progress.indicator")
                    }
                    ForEach(workspaceOpenTargets.sorted(by: workspaceOpenTargetSort)) { target in
                        Button {
                            openWorkspaceTarget(target, workspace: workspace)
                        } label: {
                            workspaceOpenTargetLabel(target)
                        }
                        .disabled(workspaceOpeningTargetID != nil)
                    }
                }
                Divider()
                Button {
                    Task { await chooseWorkspace(for: activeSession) }
                } label: {
                    Label("Change Workspace…", systemImage: "folder")
                }
            } label: {
                HStack(spacing: 5) {
                    if workspaceOpeningTargetID != nil || workspaceSaving {
                        ProgressView().controlSize(.mini)
                    } else {
                        Image(systemName: "rectangle.and.arrow.up.right.and.arrow.down.left")
                    }
                    Text("Open in")
                    Image(systemName: "chevron.down")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(.tertiary)
                }
            }
            .menuStyle(.borderlessButton)
            .help("Workspace: \(workspace)")
            .task(id: workspace) {
                await loadWorkspaceOpenTargets()
            }
        } else {
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
        }
    }

    private func workspaceOpenTargetSort(_ left: NativeWorkspaceOpenTarget, _ right: NativeWorkspaceOpenTarget) -> Bool {
        if left.id == "cybara_ide" { return true }
        if right.id == "cybara_ide" { return false }
        return left.label.localizedCaseInsensitiveCompare(right.label) == .orderedAscending
    }

    private func workspaceOpenTargetIcon(_ target: NativeWorkspaceOpenTarget) -> String {
        switch target.id {
        case "cybara_ide":
            return "macwindow"
        case "finder", "explorer", "files":
            return "folder"
        case "terminal", "ghostty":
            return "terminal"
        case "xcode":
            return "hammer"
        default:
            return "curlybraces.square"
        }
    }

    @ViewBuilder
    private func workspaceOpenTargetLabel(_ target: NativeWorkspaceOpenTarget) -> some View {
        Label {
            Text(target.label)
        } icon: {
            if let image = workspaceOpenTargetImage(target) {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 14, height: 14)
            } else {
                Image(systemName: workspaceOpenTargetIcon(target))
            }
        }
    }

    private func workspaceOpenTargetImage(_ target: NativeWorkspaceOpenTarget) -> NSImage? {
        if target.iconUrl == "/cybara.png" {
            return CybaraBrand.logoImage
        }
        guard let iconUrl = firstNonEmptyGatewayString(target.iconUrl),
              let commaIndex = iconUrl.firstIndex(of: ","),
              iconUrl[..<commaIndex].lowercased().hasPrefix("data:image/")
        else {
            return nil
        }
        let encoded = String(iconUrl[iconUrl.index(after: commaIndex)...])
        guard let data = Data(base64Encoded: encoded) else { return nil }
        return NSImage(data: data)
    }

    private var sessionDetailLine: String {
        guard let activeSession else {
            if let workspaceLabel = activeWorkspaceLabel {
                var parts = ["New chat", "Workspace \(workspaceLabel)"]
                if let branch = activeGitBranchLabel {
                    parts.append("Branch \(branch)")
                }
                return parts.joined(separator: " · ")
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
        if let branch = activeGitBranchLabel {
            parts.append("Branch \(branch)")
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

    private var activeGitBranchLabel: String? {
        firstNonEmptyGatewayString(activeGitBranch)
    }

    private var selectedConcreteChatAgentID: String {
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

    private var selectedChatAgentID: String {
        useModelRouter ? nativeModelRouterSelectorValue : selectedConcreteChatAgentID
    }

    private var selectedChatAgent: GatewayAgent? {
        agents.first { $0.id == selectedConcreteChatAgentID }
    }

    private var activeAgentRouteLabel: String {
        if useModelRouter { return "Model Router" }
        guard let selectedChatAgent else { return "Gateway default" }
        return nativeChatAgentLabel(
            name: selectedChatAgent.name,
            model: selectedChatAgent.model,
            compact: false
        )
    }

    private var activeReasoningEffort: String {
        selectedChatAgent?.reasoningEffort ?? ""
    }

    private var activeReasoningEffortLabel: String {
        nativeReasoningLabel(
            effort: activeReasoningEffort,
            provider: selectedChatAgent?.providerID,
            model: selectedChatAgent?.model
        )
    }

    private var composerReasoningEfforts: [(value: String, label: String)] {
        nativeSupportedReasoningEfforts(
            provider: selectedChatAgent?.providerID,
            model: selectedChatAgent?.model
        )
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

    private var activeTokenUsage: GatewaySessionTokenUsage? {
        activeSession?.tokenUsage
    }

    private var contextUsageText: String {
        guard let usage = activeContextUsage else {
            return "Context usage is available after the session loads."
        }
        var parts = [
            "Active context: \(formatNativeTokenCount(usage.usedTokens)) of \(formatNativeTokenCount(usage.limitTokens)) tokens used (\(formatNativePercent(usage.usedPercent))). \(formatNativeTokenCount(usage.remainingTokens)) tokens remaining."
        ]
        if usage.compacted == true, let count = usage.compactionCount, count > 0 {
            parts.append("Compacted \(count) time\(count == 1 ? "" : "s").")
        }
        if let metadataTokens = usage.metadataTokens, metadataTokens > 0 {
            parts.append("\(formatNativeTokenCount(metadataTokens)) tool timeline tokens are not replayed.")
        }
        if let tokenUsage = activeTokenUsage, tokenUsage.totalTokens > 0 {
            let speed = tokenUsage.tokensPerSecond.map { " at \(formatNativeDecimal($0)) tok/s" } ?? ""
            parts.append("Session tokens: \(formatNativeTokenCount(tokenUsage.inputTokens)) input / \(formatNativeTokenCount(tokenUsage.outputTokens)) output across \(tokenUsage.callCount) call\(tokenUsage.callCount == 1 ? "" : "s")\(speed).")
        }
        if let detail = providerPlanText {
            parts.append(detail)
        }
        return parts.joined(separator: " ")
    }

    private var activeProviderPlan: ProviderPlanSnapshot? {
        guard !useModelRouter else { return nil }
        guard let providerPlanStatus else { return nil }
        let keys = Set([
            selectedChatAgent?.provider_id,
            selectedChatAgent?.provider,
            activeSession?.provider_id,
            activeSession?.provider,
        ].compactMap { firstNonEmptyGatewayString($0) })
        guard !keys.isEmpty else { return nil }
        return providerPlanStatus.providers.first { plan in
            [plan.configuredProviderId, plan.providerId, plan.providerType].contains { key in
                guard let key else { return false }
                return keys.contains(key)
            }
        }
    }

    private var providerPlanText: String? {
        guard let plan = activeProviderPlan else { return nil }
        guard plan.managedAutomatically else { return nil }
        func percent(for kind: String) -> String {
            guard let window = plan.windows.first(where: {
                $0.kind == kind && $0.usageKnown && ($0.unlimited || $0.usedPercent != nil)
            }) else {
                return "--"
            }
            let value = window.unlimited ? "∞" : "\(Int(ceil(window.usedPercent ?? 0)))%"
            guard let reset = nativeProviderPlanResetText(window.resetsAt) else { return value }
            return "\(value) (\(reset))"
        }
        return "Plan usage: 5h \(percent(for: "rolling_5h")) · Weekly \(percent(for: "rolling_week"))"
    }

    private var providerPlanUsageRows: [NativeContextProviderPlanUsageRow] {
        guard let plan = activeProviderPlan else { return [] }
        guard plan.managedAutomatically else { return [] }
        return [
            ("5h", "rolling_5h"),
            ("Weekly", "rolling_week"),
        ].compactMap { label, kind in
            guard let window = plan.windows.first(where: {
                $0.kind == kind && $0.usageKnown && ($0.unlimited || $0.usedPercent != nil)
            }) else {
                return nil
            }
            if window.unlimited {
                return NativeContextProviderPlanUsageRow(
                    id: kind,
                    label: label,
                    value: "∞",
                    percent: nil,
                    unlimited: true,
                    resetText: nativeProviderPlanResetText(window.resetsAt)
                )
            }
            let percent = min(100, max(0, ceil(window.usedPercent ?? 0)))
            return NativeContextProviderPlanUsageRow(
                id: kind,
                label: label,
                value: "\(Int(percent))%",
                percent: percent,
                unlimited: false,
                resetText: nativeProviderPlanResetText(window.resetsAt)
            )
        }
    }

    private var activeFileChanges: NativeChatFileChangeSummary {
        summarizeNativeChatFileChanges(messages, liveActivities: liveActivities)
    }

    private var environmentToolNames: [String] {
        let names = messages
            .flatMap { $0.tool_calls ?? [] }
            .map(\.name)
            .compactMap { firstNonEmptyGatewayString($0) }
        return Array(Set(names)).sorted()
    }

    private var currentSessionPlan: NativeSessionPlanSnapshot? {
        extractNativeSessionPlan(from: messages, sessionID: selectedSessionID)
    }

    private var environmentSubagents: [NativeSubagentSummary] {
        subagents
    }

    private var hasEnvironmentSignal: Bool {
        activeFileChanges.files.isEmpty == false ||
            activeWorkspaceDir != nil ||
            activeGitBranchLabel != nil ||
            currentSessionPlan != nil ||
            providerPlanUsageRows.isEmpty == false ||
            environmentSubagents.isEmpty == false ||
            environmentToolNames.isEmpty == false
    }

    private func nativeProviderPlanResetText(_ resetsAt: String?) -> String? {
        guard let resetsAt else { return nil }
        let fractionalFormatter = ISO8601DateFormatter()
        fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = fractionalFormatter.date(from: resetsAt) ?? ISO8601DateFormatter().date(from: resetsAt)
        guard let date else { return nil }
        let seconds = date.timeIntervalSinceNow
        if seconds <= 0 { return "reset ready" }
        let minute = 60.0
        let hour = 60.0 * minute
        let day = 24.0 * hour
        if seconds < hour { return "\(max(1, Int(ceil(seconds / minute))))m reset" }
        if seconds < day {
            let hours = Int(seconds / hour)
            let minutes = Int(ceil(seconds.truncatingRemainder(dividingBy: hour) / minute))
            return minutes > 0 ? "\(hours)h \(minutes)m reset" : "\(hours)h reset"
        }
        return "\(Int(ceil(seconds / day)))d reset"
    }

    private var workspaceHelpText: String {
        if let activeWorkspaceDir {
            return "Switch workspace: \(activeWorkspaceDir)"
        }
        return "Select workspace folder for this chat"
    }

    private var filteredGitBranches: [GatewayGitBranchSummary] {
        let query = gitBranchSearch.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if query.isEmpty { return activeGitBranches }
        return activeGitBranches.filter { $0.name.lowercased().contains(query) }
    }

    private var gitBranchPicker: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Branches", systemImage: "arrow.triangle.branch")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                Spacer()
                if gitBranchLoading {
                    ProgressView().controlSize(.small)
                }
            }
            TextField("Search branches", text: $gitBranchSearch)
                .textFieldStyle(.roundedBorder)

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 4) {
                    ForEach(filteredGitBranches) { branch in
                        Button {
                            Task { await changeGitBranch(branch.name) }
                        } label: {
                            HStack(spacing: 8) {
                                Image(systemName: "arrow.triangle.branch")
                                    .foregroundStyle(.secondary)
                                Text(branch.name)
                                    .font(.system(size: 12, design: .monospaced))
                                    .lineLimit(1)
                                Spacer()
                                if branch.current || branch.name == activeGitBranchLabel {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .padding(.horizontal, 8)
                            .padding(.vertical, 6)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .background(
                            RoundedRectangle(cornerRadius: 7)
                                .fill(branch.name == activeGitBranchLabel ? Color.secondary.opacity(0.12) : .clear)
                        )
                    }
                    if filteredGitBranches.isEmpty {
                        Text("No matching branches")
                            .font(.system(size: 12, design: .rounded))
                            .foregroundStyle(.secondary)
                            .padding(.vertical, 8)
                    }
                }
            }
            .frame(maxHeight: 210)

            Divider()
            HStack(spacing: 8) {
                TextField("New branch name", text: $newGitBranchName)
                    .textFieldStyle(.roundedBorder)
                Button {
                    Task {
                        await changeGitBranch(newGitBranchName, create: true)
                    }
                } label: {
                    Image(systemName: "plus")
                }
                .disabled(firstNonEmptyGatewayString(newGitBranchName) == nil || gitBranchLoading)
                .buttonStyle(.bordered)
            }
            if let gitBranchError {
                Text(gitBranchError)
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(.red)
            }
        }
        .padding(14)
        .frame(width: 320)
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
                        NativeToolTimelineView(
                            message: message,
                            mediaBaseURL: client.baseURL,
                            mediaToken: GatewayClient.loadAPIKey()
                        )
                    }
                    if isUser, !message.attachedImages.isEmpty {
                        NativeAttachedImagesStrip(images: message.attachedImages)
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

    private func formatNativeDecimal(_ value: Double) -> String {
        String(format: value.rounded() == value ? "%.0f" : "%.1f", value)
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
                if !pendingAttachments.isEmpty || !pendingFiles.isEmpty {
                    HStack(spacing: 5) {
                        Image(systemName: "paperclip")
                            .font(.system(size: 10))
                        Text(nativeMediaSummaryLabel(images: pendingAttachments, files: pendingFiles))
                        if pendingAttachments.count >= 8 {
                            Text("· max 8 images")
                                .foregroundStyle(.orange.opacity(0.8))
                        }
                    }
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(pendingAttachments) { attachment in
                                composerAttachmentChip(attachment)
                            }
                            ForEach(pendingFiles) { file in
                                composerFileChip(file)
                            }
                        }
                        .padding(.horizontal, 4)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
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
                        attachFiles()
                    } label: {
                        Image(systemName: "paperclip")
                            .font(.system(size: 15, weight: .semibold))
                    }
                    .buttonStyle(.borderless)
                    .help("Attach images or text files")
                    .disabled(pendingAttachments.count >= 8 && pendingFiles.count >= 8)
                    Button {
                        Task { await send() }
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 24))
                    }
                    .buttonStyle(.borderless)
                    .disabled(
                        draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            && pendingAttachments.isEmpty
                            && pendingFiles.isEmpty
                    )
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
            .onDrop(of: [.fileURL], isTargeted: nil) { providers in
                handleDroppedProviders(providers)
                return true
            }
            .onPasteCommand(of: [.png, .tiff, .fileURL]) { _ in
                handlePaste()
            }
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

            ViewThatFits(in: .horizontal) {
                composerAgentPicker(compact: false)
                    .frame(width: 176)
                composerAgentPicker(compact: true)
                    .frame(width: 116)
            }


            Button {
                reasoningDraftIndex = composerReasoningEfforts.firstIndex { $0.value == activeReasoningEffort }.map(Double.init) ?? 0
                showReasoningPopover.toggle()
            } label: {
                if reasoningSaving {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: "brain.head.profile")
                        .font(.system(size: 13, weight: .medium))
                }
            }
            .buttonStyle(.plain)
            .frame(width: 26, height: 26)
            .background(Circle().fill(Color.white.opacity(0.05)))
            .disabled(reasoningSaving || useModelRouter || selectedChatAgent == nil)
            .help("Reasoning: \(activeReasoningEffortLabel)")
            .popover(isPresented: $showReasoningPopover) {
                reasoningEffortPopover
            }

            if agentSaving {
                ProgressView().controlSize(.small)
            }
        }
    }

    private func composerAgentPicker(compact: Bool) -> some View {
        Picker("Agent", selection: agentSelectionBinding) {
            if modelRouterEnabled {
                Text("Model Router").tag(nativeModelRouterSelectorValue)
            } else {
                Text("Gateway default").tag("")
            }
            ForEach(agents) { agent in
                Text(nativeChatAgentLabel(name: agent.name, model: agent.model, compact: compact))
                    .tag(agent.id)
            }
        }
        .labelsHidden()
        .pickerStyle(.menu)
        .controlSize(.small)
        .disabled(agentSaving || (!modelRouterEnabled && agents.isEmpty))
        .help(activeAgentRouteLabel)
    }

    private var reasoningEffortPopover: some View {
        let efforts = composerReasoningEfforts
        let clampedIndex = min(max(Int(reasoningDraftIndex.rounded()), 0), max(efforts.count - 1, 0))
        let draftLabel = efforts.indices.contains(clampedIndex) ? efforts[clampedIndex].label : "Default"
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Effort")
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                Text(draftLabel)
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(.tint)
                Spacer()
            }
            Slider(
                value: $reasoningDraftIndex,
                in: 0 ... Double(max(efforts.count - 1, 0)),
                step: 1,
                onEditingChanged: { editing in
                    if !editing {
                        let index = min(max(Int(reasoningDraftIndex.rounded()), 0), max(efforts.count - 1, 0))
                        let value = efforts.indices.contains(index) ? efforts[index].value : ""
                        Task { await changeReasoningEffort(value) }
                    }
                }
            )
            HStack {
                Text("Faster")
                Spacer()
                Text("Smarter")
            }
            .font(.system(size: 10, design: .rounded))
            .foregroundStyle(.secondary)
        }
        .padding(14)
        .frame(width: 250)
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
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 5) {
                    toolApprovalStatusIcon
                    Text(toolApprovalLabel)
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .lineLimit(1)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 8, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 8)
                HStack(spacing: 0) {
                    toolApprovalStatusIcon
                }
                .frame(width: 26)
            }
            .foregroundStyle(toolApprovalColor)
            .frame(height: 26)
            .background(Capsule().fill(toolApprovalColor.opacity(0.08)))
        }
        .buttonStyle(.plain)
        .disabled(approvalSaving)
        .help("Tool approvals: \(toolApprovalLabel)")
    }

    @ViewBuilder
    private var toolApprovalStatusIcon: some View {
        if approvalSaving {
            ProgressView().controlSize(.small)
        } else {
            Image(systemName: toolApprovalIconName)
                .font(.system(size: 11, weight: .semibold))
        }
    }

    private var contextUsagePopover: some View {
        let planRows = providerPlanUsageRows
        return VStack(spacing: 3) {
            Text("Context window:")
                .foregroundStyle(.secondary)
            if let usage = activeContextUsage {
                Text("\(formatNativePercent(usage.usedPercent)) full")
                    .fontWeight(.medium)
                Text("\(formatNativeTokenCount(usage.usedTokens)) / \(formatNativeTokenCount(usage.limitTokens)) active tokens")
                if usage.compacted == true, let count = usage.compactionCount, count > 0 {
                    Text("Compacted \(count) time\(count == 1 ? "" : "s")")
                        .foregroundStyle(.secondary)
                }
                if let compactedTokens = usage.compactedTokens, compactedTokens > 0 {
                    Text("\(formatNativeTokenCount(compactedTokens)) tokens summarized out")
                        .foregroundStyle(.secondary)
                }
                if let metadataTokens = usage.metadataTokens, metadataTokens > 0 {
                    Text("\(formatNativeTokenCount(metadataTokens)) timeline metadata not replayed")
                        .foregroundStyle(.secondary)
                }
            } else {
                Text("Not loaded yet")
                    .fontWeight(.medium)
                Text("Open a session or send a message to estimate usage.")
                    .multilineTextAlignment(.center)
            }
            if !planRows.isEmpty {
                Divider().padding(.vertical, 4)
                Text("Plan usage")
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
                VStack(spacing: 7) {
                    ForEach(planRows) { row in
                        NativeContextProviderPlanUsageBar(row: row)
                    }
                }
            }
        }
        .font(.system(size: 12, design: .rounded))
        .padding(14)
        .frame(width: 260, alignment: .center)
    }

    private var fileDiffsPopover: some View {
        let summary = activeFileChanges
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("File changes", systemImage: "doc.text.magnifyingglass")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                Spacer()
                Text("\(summary.files.count)")
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
            }
            if summary.files.isEmpty {
                NativeEmptyPopoverState(
                    icon: "doc.text",
                    title: "No file diffs",
                    detail: "Tool calls in this chat have not recorded edits yet."
                )
            } else {
                VStack(alignment: .leading, spacing: 7) {
                    HStack(spacing: 10) {
                        Text("\(summary.files.count) files")
                        Text("+\(summary.totalAdded)")
                            .foregroundStyle(.green)
                        Text("-\(summary.totalRemoved)")
                            .foregroundStyle(.red)
                    }
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    ForEach(summary.files.prefix(10)) { file in
                        let display = nativeChatFilePathDisplay(file.path, workspaceDir: activeWorkspaceDir)
                        HStack(spacing: 8) {
                            Image(systemName: file.systemImage)
                                .foregroundStyle(.secondary)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(display.fileName)
                                    .font(.system(size: 11, weight: .medium, design: .rounded))
                                    .lineLimit(1)
                                if let parent = display.parentPath {
                                    Text(parent)
                                        .font(.system(size: 10, design: .monospaced))
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                        .truncationMode(.middle)
                                }
                            }
                            .help(display.fullPath)
                            Spacer()
                            Text(file.kind)
                                .font(.system(size: 10, weight: .semibold, design: .rounded))
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .padding(14)
        .frame(width: 340, alignment: .leading)
    }

    private var environmentPopover: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Environment")
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                    Text("Current chat only")
                        .font(.system(size: 11, design: .rounded))
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if subagentsLoading {
                    ProgressView().controlSize(.small)
                }
            }

            NativeEnvironmentSection(title: "Session") {
                NativeEnvironmentRow(icon: "doc.text.magnifyingglass", label: "Changes") {
                    if activeFileChanges.files.isEmpty {
                        Text("No file diffs").foregroundStyle(.secondary)
                    } else {
                        HStack(spacing: 5) {
                            Text("\(activeFileChanges.files.count) files")
                            Text("+\(activeFileChanges.totalAdded)").foregroundStyle(.green)
                            Text("-\(activeFileChanges.totalRemoved)").foregroundStyle(.red)
                        }
                    }
                }
                NativeEnvironmentRow(icon: "folder", label: "Local") {
                    Text(activeWorkspaceLabel ?? "No workspace")
                        .font(.system(size: 11, design: .monospaced))
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                NativeEnvironmentRow(icon: "arrow.triangle.branch", label: "Branch") {
                    Button {
                        showGitBranchPicker = true
                        Task { await loadActiveGitBranch() }
                    } label: {
                        HStack(spacing: 5) {
                            Text(activeGitBranchLabel ?? "No branch")
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(activeGitBranchLabel == nil ? .secondary : .primary)
                                .lineLimit(1)
                            Image(systemName: "chevron.down")
                                .font(.system(size: 8, weight: .semibold))
                                .foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(activeWorkspaceDir == nil)
                    .popover(isPresented: $showGitBranchPicker, arrowEdge: .trailing) {
                        gitBranchPicker
                    }
                }
                NativeEnvironmentRow(icon: "gauge.with.dots.needle.bottom.50percent", label: "Tokens") {
                    if let tokenUsage = activeTokenUsage, tokenUsage.totalTokens > 0 {
                        Text("\(formatNativeTokenCount(tokenUsage.inputTokens)) in / \(formatNativeTokenCount(tokenUsage.outputTokens)) out")
                            .font(.system(size: 11, design: .rounded))
                    } else {
                        Text("No usage recorded").foregroundStyle(.secondary)
                    }
                }
                if let tokenUsage = activeTokenUsage, tokenUsage.totalTokens > 0 {
                    NativeEnvironmentRow(icon: "speedometer", label: "Speed") {
                        Text(tokenUsage.tokensPerSecond.map { "\(formatNativeDecimal($0)) tok/s · \(tokenUsage.callCount) calls" } ?? "\(tokenUsage.callCount) calls")
                            .font(.system(size: 11, design: .rounded))
                    }
                }
                if let usage = activeContextUsage, usage.compacted == true {
                    NativeEnvironmentRow(icon: "rectangle.compress.vertical", label: "Compact") {
                        let count = usage.compactionCount ?? 0
                        let summarized = usage.compactedTokens ?? 0
                        Text(summarized > 0 ? "\(count)x · \(formatNativeTokenCount(summarized)) summarized" : "\(count)x")
                            .font(.system(size: 11, design: .rounded))
                    }
                }
            }

            NativeEnvironmentSection(title: "Plan") {
                if let plan = currentSessionPlan {
                    NativeSessionPlanCard(plan: plan)
                } else {
                    NativeEmptyPopoverState(
                        icon: "checklist",
                        title: "No plan recorded",
                        detail: "Plans appear when the agent uses the todo tool."
                    )
                }
            }

            NativeEnvironmentSection(title: "Provider plan") {
                let rows = providerPlanUsageRows
                if rows.isEmpty {
                    Text("No automatic plan data for this provider.")
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.secondary)
                } else {
                    VStack(spacing: 8) {
                        ForEach(rows) { row in
                            NativeContextProviderPlanUsageBar(row: row)
                        }
                    }
                }
            }

            NativeEnvironmentSection(title: "Subagents") {
                if environmentSubagents.isEmpty {
                    Text("No active subagents")
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.secondary)
                } else {
                    VStack(spacing: 6) {
                        ForEach(environmentSubagents.prefix(6)) { subagent in
                            NativeSubagentCompactRow(subagent: subagent)
                        }
                    }
                }
            }

            NativeEnvironmentSection(title: "Sources") {
                if environmentToolNames.isEmpty {
                    Text("No tool sources yet")
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.secondary)
                } else {
                    NativeToolNameCloud(names: environmentToolNames)
                }
            }
        }
        .font(.system(size: 12, design: .rounded))
        .padding(14)
        .frame(width: 370, alignment: .leading)
    }

    private var subagentsPopover: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                if selectedSubagent != nil || showSpawnSubagent {
                    Button {
                        selectedSubagent = nil
                        showSpawnSubagent = false
                    } label: {
                        Image(systemName: "chevron.left")
                    }
                    .buttonStyle(.borderless)
                }
                Label(
                    selectedSubagent?.label ?? (showSpawnSubagent ? "New Subagent" : "Subagents"),
                    systemImage: "person.2.wave.2"
                )
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .lineLimit(1)
                Spacer()
                if selectedSubagent == nil && !showSpawnSubagent {
                    if subagents.contains(where: { $0.status != "running" && $0.status != "pending" }) {
                        Button(role: .destructive) {
                            showClearSubagentHistoryConfirm = true
                        } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(.borderless)
                    }
                    Button {
                        showSpawnSubagent = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .buttonStyle(.borderless)
                }
            }
            if showSpawnSubagent {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Delegate a focused task using this chat's agent and workspace.")
                        .font(.system(size: 11.5, design: .rounded))
                        .foregroundStyle(.secondary)
                    TextEditor(text: $subagentTaskDraft)
                        .font(.system(size: 12, design: .rounded))
                        .scrollContentBackground(.hidden)
                        .padding(7)
                        .frame(minHeight: 130)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(Color.white.opacity(0.05))
                        )
                    HStack {
                        Spacer()
                        Button {
                            Task { await spawnSubagent() }
                        } label: {
                            if subagentMutating {
                                ProgressView().controlSize(.small)
                            } else {
                                Label("Start Subagent", systemImage: "plus")
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                        .disabled(subagentTaskDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || subagentMutating)
                    }
                }
            } else if let selectedSubagent {
                ScrollView {
                    NativeSubagentRunDetail(
                        subagent: selectedSubagent,
                        onStop: ["running", "pending"].contains(selectedSubagent.status)
                            ? { Task { await stopSubagent(selectedSubagent.id) } }
                            : nil,
                        onClear: ["running", "pending"].contains(selectedSubagent.status)
                            ? nil
                            : { Task { await clearSubagent(selectedSubagent.id) } }
                    )
                }
                .frame(maxHeight: 430)
            } else if subagentsLoading && subagents.isEmpty {
                ProgressView().frame(maxWidth: .infinity)
            } else if subagents.isEmpty {
                NativeEmptyPopoverState(
                    icon: "person.2",
                    title: "No subagents",
                    detail: "Runs spawned from this chat appear here."
                )
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(subagents) { subagent in
                            Button {
                                selectedSubagent = subagent
                                Task { await loadSubagentDetail(subagent.id) }
                            } label: {
                                NativeSubagentDetailRow(subagent: subagent)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .frame(maxHeight: 320)
            }
        }
        .padding(14)
        .frame(width: 390, alignment: .leading)
        .confirmationDialog(
            "Clear completed subagent history for this chat?",
            isPresented: $showClearSubagentHistoryConfirm,
            titleVisibility: .visible
        ) {
            Button("Clear History", role: .destructive) {
                Task { await clearSubagentHistory() }
            }
            Button("Cancel", role: .cancel) {}
        }
        .task(id: selectedSubagent?.id) {
            while !Task.isCancelled {
                await loadSubagents()
                if let id = selectedSubagent?.id,
                   let status = selectedSubagent?.status,
                   ["running", "pending"].contains(status) {
                    await loadSubagentDetail(id)
                }
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
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
            async let loadedProviderPlans = loadProviderPlanStatus()
            sessions = try await loadedSessions
            agents = try await loadedAgents
            providers = try await loadedProviders
            providerPlanStatus = await loadedProviderPlans
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func loadProviderPlanStatus() async -> ProviderPlanStatusResponse? {
        try? await client.providerPlanStatus()
    }

    private func loadSubagents() async {
        guard !subagentsLoading else { return }
        subagentsLoading = true
        defer { subagentsLoading = false }
        do {
            guard let selectedSessionID else {
                subagents = []
                return
            }
            subagents = try await client.nativeSubagents(sessionID: selectedSessionID)
        } catch {
            if subagents.isEmpty {
                subagents = []
            }
        }
    }

    private func loadSubagentDetail(_ id: String) async {
        do {
            selectedSubagent = try await client.nativeSubagent(id)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func spawnSubagent() async {
        guard let selectedSessionID else { return }
        let task = subagentTaskDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !task.isEmpty, !subagentMutating else { return }
        subagentMutating = true
        defer { subagentMutating = false }
        do {
            let response = try await client.spawnNativeSubagent(
                task: task,
                agentID: selectedConcreteChatAgentID,
                workspaceDir: activeWorkspaceDir,
                requesterSessionID: selectedSessionID
            )
            guard response.success != false else {
                throw NSError(
                    domain: "Cybara.Subagent",
                    code: 1,
                    userInfo: [NSLocalizedDescriptionKey: response.warning ?? response.error ?? "Subagent could not be started"]
                )
            }
            subagentTaskDraft = ""
            showSpawnSubagent = false
            await loadSubagents()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func clearSubagent(_ id: String) async {
        guard !subagentMutating else { return }
        subagentMutating = true
        defer { subagentMutating = false }
        do {
            try await client.clearNativeSubagent(id)
            selectedSubagent = nil
            await loadSubagents()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func clearSubagentHistory() async {
        guard let selectedSessionID else { return }
        do {
            try await client.clearNativeSubagentHistory(sessionID: selectedSessionID)
            selectedSubagent = nil
            await loadSubagents()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func stopSubagent(_ id: String) async {
        do {
            try await client.stopNativeSubagent(id)
            await loadSubagentDetail(id)
            await loadSubagents()
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
        do {
            let router = try await client.routerConfig()
            modelRouterEnabled = router["enabled"] as? Bool == true
            if !modelRouterEnabled {
                useModelRouter = false
            }
        } catch {
            modelRouterEnabled = false
            useModelRouter = false
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

    private func changeReasoningEffort(_ nextEffort: String) async {
        guard let agent = selectedChatAgent, !reasoningSaving else { return }
        let efforts = composerReasoningEfforts
        guard efforts.contains(where: { $0.value == nextEffort }) else { return }
        guard nextEffort != activeReasoningEffort else { return }
        reasoningSaving = true
        do {
            try await client.updateAgentReasoning(agent.id, effort: nextEffort.isEmpty ? nil : nextEffort)
            await loadSessions()
            error = nil
        } catch {
            reasoningDraftIndex = efforts.firstIndex { $0.value == activeReasoningEffort }.map(Double.init) ?? 0
            self.error = error.localizedDescription
        }
        reasoningSaving = false
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
        useModelRouter = false
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
        guard agentID != nativeModelRouterSelectorValue else {
            guard modelRouterEnabled else { return }
            useModelRouter = true
            return
        }
        useModelRouter = false
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
    private func attachFiles() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = true
        panel.allowedContentTypes = [.png, .jpeg, .gif, .webP, .image, .text, .plainText, .sourceCode, .json, .xml, .yaml, .commaSeparatedText, .html, .data]
        panel.prompt = "Attach"
        panel.title = "Attach Images or Files"
        panel.message = "Attach images or text files to send with your message."
        guard panel.runModal() == .OK else { return }
        for url in panel.urls {
            ingestAttachment(url: url)
        }
    }

    @MainActor
    private func ingestAttachment(url: URL) {
        guard let data = try? Data(contentsOf: url) else { return }
        if nativeImageFileExtensions.contains(url.pathExtension.lowercased()) {
            guard pendingAttachments.count < 8 else { return }
            pendingAttachments.append(
                NativeAttachedImage(
                    base64: data.base64EncodedString(),
                    mimeType: nativeImageMimeType(for: url),
                    size: data.count
                )
            )
            return
        }
        guard pendingFiles.count < 8, data.count <= 256 * 1024 else { return }
        guard let content = String(data: data, encoding: .utf8) else { return }
        pendingFiles.append(NativeAttachedFile(name: url.lastPathComponent, content: content, size: data.count))
    }

    @MainActor
    private func handleDroppedProviders(_ providers: [NSItemProvider]) {
        for provider in providers {
            _ = provider.loadObject(ofClass: URL.self) { url, _ in
                guard let url else { return }
                Task { @MainActor in self.ingestAttachment(url: url) }
            }
        }
    }

    @MainActor
    private func handlePaste() {
        let pasteboard = NSPasteboard.general
        if let urls = pasteboard.readObjects(
            forClasses: [NSURL.self],
            options: [.urlReadingFileURLsOnly: true]
        ) as? [URL], !urls.isEmpty {
            for url in urls { ingestAttachment(url: url) }
            return
        }
        guard let images = pasteboard.readObjects(forClasses: [NSImage.self], options: nil) as? [NSImage] else {
            return
        }
        for image in images {
            guard pendingAttachments.count < 8 else { break }
            guard let tiff = image.tiffRepresentation,
                  let rep = NSBitmapImageRep(data: tiff),
                  let png = rep.representation(using: .png, properties: [:]) else { continue }
            pendingAttachments.append(
                NativeAttachedImage(base64: png.base64EncodedString(), mimeType: "image/png", size: png.count)
            )
        }
    }

    private func composerAttachmentChip(_ attachment: NativeAttachedImage) -> some View {
        ZStack(alignment: .topTrailing) {
            Group {
                if let data = Data(base64Encoded: attachment.base64),
                   let image = NSImage(data: data) {
                    Image(nsImage: image)
                        .resizable()
                        .scaledToFill()
                } else {
                    Image(systemName: "photo")
                        .foregroundStyle(.secondary)
                }
            }
            .frame(width: 56, height: 56)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(alignment: .bottom) {
                if attachment.size > 0 {
                    Text(nativeFormatBytes(attachment.size))
                        .font(.system(size: 9))
                        .foregroundStyle(.white.opacity(0.9))
                        .lineLimit(1)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 1)
                        .background(Color.black.opacity(0.55))
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(Color.white.opacity(0.12), lineWidth: 1)
            )

            Button {
                pendingAttachments.removeAll { $0.id == attachment.id }
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(.white, .black.opacity(0.55))
            }
            .buttonStyle(.plain)
            .padding(2)
        }
    }

    private func composerFileChip(_ file: NativeAttachedFile) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "doc.text")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text(file.name)
                    .font(.system(size: 11.5, weight: .medium, design: .rounded))
                    .lineLimit(1)
                    .truncationMode(.middle)
                if !nativeFormatBytes(file.size).isEmpty {
                    Text(nativeFormatBytes(file.size))
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: 140, alignment: .leading)
            Button {
                pendingFiles.removeAll { $0.id == file.id }
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 10)
        .frame(height: 56)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.white.opacity(0.06))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Color.white.opacity(0.12), lineWidth: 1)
        )
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
            messages = (detail.messagesList ?? []).map { message in
                guard message.role == "user",
                      let cached = attachmentsByContent[message.content.trimmingCharacters(in: .whitespacesAndNewlines)],
                      !cached.isEmpty else {
                    return message
                }
                return message.withAttachedImages(cached)
            }
            liveActivities = nativePrunePersistedLiveActivities(
                liveActivities,
                persistedMessages: messages
            )
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func loadActiveGitBranch() async {
        guard let workspace = firstNonEmptyGatewayString(activeWorkspaceDir) else {
            activeGitBranch = nil
            activeGitBranches = []
            gitBranchError = nil
            return
        }
        gitBranchLoading = true
        do {
            let response = try await client.gitBranches(path: workspace)
            if firstNonEmptyGatewayString(activeWorkspaceDir) == workspace {
                activeGitBranch = firstNonEmptyGatewayString(response.current)
                    ?? response.branches.first(where: { $0.current })?.name
                activeGitBranches = response.branches
                gitBranchError = response.success ? nil : response.error
            }
        } catch {
            if firstNonEmptyGatewayString(activeWorkspaceDir) == workspace {
                activeGitBranch = nil
                activeGitBranches = []
                gitBranchError = error.localizedDescription
            }
        }
        gitBranchLoading = false
    }

    private func loadWorkspaceOpenTargets() async {
        guard let workspace = firstNonEmptyGatewayString(activeWorkspaceDir) else {
            workspaceOpenTargets = []
            return
        }
        workspaceOpenTargetsLoading = true
        do {
            let targets = try await client.workspaceOpenTargets(path: workspace)
            if firstNonEmptyGatewayString(activeWorkspaceDir) == workspace {
                workspaceOpenTargets = targets.filter { $0.available != false }
            }
        } catch {
            if firstNonEmptyGatewayString(activeWorkspaceDir) == workspace {
                workspaceOpenTargets = [
                    NativeWorkspaceOpenTarget(
                        id: "cybara_ide",
                        label: "Cybara IDE",
                        kind: "internal",
                        icon: "cybara",
                        iconUrl: "/cybara.png",
                        available: true,
                        detail: nil
                    )
                ]
                self.error = error.localizedDescription
            }
        }
        workspaceOpenTargetsLoading = false
    }

    private func openWorkspaceTarget(_ target: NativeWorkspaceOpenTarget, workspace: String) {
        workspaceOpeningTargetID = target.id
        Task {
            do {
                let response = try await client.openWorkspaceTarget(path: workspace, targetID: target.id)
                if response.success == false {
                    throw GatewayClientError.badStatus(200, response.error ?? "Unable to open workspace")
                }
                if target.id == "cybara_ide" {
                    openCybaraIDEWorkspace(response.path ?? workspace)
                }
                error = nil
            } catch {
                self.error = error.localizedDescription
            }
            workspaceOpeningTargetID = nil
        }
    }

    private func changeGitBranch(_ branch: String, create: Bool = false) async {
        guard let workspace = firstNonEmptyGatewayString(activeWorkspaceDir),
              let nextBranch = firstNonEmptyGatewayString(branch) else { return }
        gitBranchLoading = true
        gitBranchError = nil
        do {
            let response = try await client.checkoutGitBranch(path: workspace, branch: nextBranch, create: create)
            if response.success {
                activeGitBranch = firstNonEmptyGatewayString(response.branch) ?? nextBranch
                newGitBranchName = ""
                showGitBranchPicker = false
                await loadActiveGitBranch()
            } else {
                gitBranchError = response.error ?? "Unable to switch branches."
            }
        } catch {
            gitBranchError = error.localizedDescription
        }
        gitBranchLoading = false
    }

    private func hydrateStatus(_ id: String) async {
        do {
            let status = try await client.sessionStatus(id)
            guard selectedSessionID == id else { return }
            activeSessionIDs = Set(status.activeSessionIds)
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
        let attachments = pendingAttachments
        let files = pendingFiles
        let queuedSend = sending || showWorkingTimeline || !pendingMessages.isEmpty
        guard !text.isEmpty || !attachments.isEmpty || !files.isEmpty else { return }
        let outgoing = nativeComposedMessage(text: text, files: files)
        if !queuedSend {
            sending = true
        }
        error = nil
        draft = ""
        pendingAttachments = []
        pendingFiles = []
        if !attachments.isEmpty {
            attachmentsByContent[outgoing] = attachments
        }
        if !queuedSend {
            liveStatus = "thinking"
            liveCurrentStep = "Thinking..."
            liveStartedAt = Date()
            liveActivities = []
            streamingContent = nil
        }
        let optimisticTimestamp = gatewayTimestampNow()
        messages.append(
            GatewaySessionMessage(
                role: "user",
                content: outgoing,
                timestamp: optimisticTimestamp,
                attachedImages: attachments
            )
        )
        do {
            let result = try await client.sendChat(
                message: outgoing,
                sessionId: selectedSessionID,
                agentId: selectedConcreteChatAgentID.isEmpty ? nil : selectedConcreteChatAgentID,
                workspaceDir: activeWorkspaceDir,
                queueMode: queuedSend ? "queue" : nil,
                useModelRouter: useModelRouter,
                images: attachments.map { ["data": $0.base64, "mimeType": $0.mimeType] }
            )
            if result.queued == true {
                pendingMessages = result.pendingMessages
                messages.removeAll {
                    $0.content == outgoing && $0.role == "user" && $0.timestamp == optimisticTimestamp
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
        updateActiveSessionIDs(from: event)
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

    private func updateActiveSessionIDs(from event: GatewayStatusEvent) {
        if event.type == "snapshot" || !event.activeSessionIds.isEmpty {
            activeSessionIDs = Set(event.activeSessionIds)
            return
        }
        guard let sessionID = firstNonEmptyGatewayString(event.sessionId),
              let status = firstNonEmptyGatewayString(event.status)?.lowercased()
        else { return }
        if status == "idle" || status == "error" {
            activeSessionIDs.remove(sessionID)
        } else if [
            "thinking",
            "generating",
            "compacting",
            "tool_executing",
            "tool_completed"
        ].contains(status) {
            activeSessionIDs.insert(sessionID)
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

private struct NativeChatFileChangeItem: Identifiable, Hashable {
    let path: String
    let kind: String
    let added: Int
    let removed: Int

    var id: String { path }
    var systemImage: String {
        switch kind {
        case "created": return "doc.badge.plus"
        case "deleted": return "doc.badge.minus"
        default: return "doc.text"
        }
    }
}

private struct NativeChatFileChangeSummary: Hashable {
    let files: [NativeChatFileChangeItem]
    let totalAdded: Int
    let totalRemoved: Int
}

private struct NativeChatFilePathDisplay: Hashable {
    let fileName: String
    let parentPath: String?
    let fullPath: String
}

private func nativeNormalizeDisplayPath(_ path: String) -> String {
    path.trimmingCharacters(in: .whitespacesAndNewlines)
        .replacingOccurrences(of: "\\", with: "/")
        .replacingOccurrences(of: #"/+"#, with: "/", options: .regularExpression)
}

private func nativeIsAbsoluteDisplayPath(_ path: String) -> Bool {
    path.hasPrefix("/") || path.hasPrefix("~/") || path.range(of: #"^[A-Za-z]:/"#, options: .regularExpression) != nil
}

private func nativeChatFilePathDisplay(_ path: String, workspaceDir: String?) -> NativeChatFilePathDisplay {
    let fullPath = nativeNormalizeDisplayPath(path)
    let workspace = nativeNormalizeDisplayPath(workspaceDir ?? "").replacingOccurrences(
        of: #"/+$"#,
        with: "",
        options: .regularExpression
    )
    var relativePath = fullPath.replacingOccurrences(of: #"^\./"#, with: "", options: .regularExpression)
    var outsideWorkspace = false
    if !workspace.isEmpty {
        if fullPath.caseInsensitiveCompare(workspace) == .orderedSame {
            relativePath = fullPath.split(separator: "/").last.map(String.init) ?? fullPath
        } else if fullPath.lowercased().hasPrefix("\(workspace.lowercased())/") {
            relativePath = String(fullPath.dropFirst(workspace.count + 1))
        } else if nativeIsAbsoluteDisplayPath(fullPath) {
            outsideWorkspace = true
        }
    }
    var segments = relativePath.split(separator: "/").map(String.init)
    let fileName = segments.popLast() ?? relativePath
    let parentPath = outsideWorkspace && !workspace.isEmpty
        ? "Outside workspace"
        : (segments.isEmpty ? nil : segments.joined(separator: "/"))
    return NativeChatFilePathDisplay(
        fileName: fileName.isEmpty ? "file" : fileName,
        parentPath: parentPath,
        fullPath: fullPath
    )
}

private struct NativeSessionPlanItem: Identifiable, Hashable {
    let id = UUID()
    let content: String
    let status: String
    let priority: String
}

private struct NativeSessionPlanSnapshot: Hashable {
    let items: [NativeSessionPlanItem]
    let completed: Int
    let total: Int
    let updatedAt: String?

    var progress: Double {
        guard total > 0 else { return 0 }
        return Double(completed) / Double(total)
    }
}

private struct NativeEnvironmentSection<Content: View>: View {
    let title: String
    let content: Content

    init(title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Divider().opacity(0.35)
            Text(title)
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundStyle(.secondary)
            content
        }
    }
}

private struct NativeEnvironmentRow<Content: View>: View {
    let icon: String
    let label: String
    let content: Content

    init(icon: String, label: String, @ViewBuilder content: () -> Content) {
        self.icon = icon
        self.label = label
        self.content = content()
    }

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: icon)
                .foregroundStyle(.secondary)
                .frame(width: 16)
            Text(label)
                .foregroundStyle(.secondary)
                .frame(width: 58, alignment: .leading)
            Spacer(minLength: 8)
            content
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .font(.system(size: 12, design: .rounded))
    }
}

private struct NativeEmptyPopoverState: View {
    let icon: String
    let title: String
    let detail: String

    var body: some View {
        VStack(spacing: 7) {
            Image(systemName: icon)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
            Text(detail)
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
    }
}

private struct NativeSessionPlanCard: View {
    let plan: NativeSessionPlanSnapshot
    @State private var expanded = true

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 7) {
                ForEach(plan.items) { item in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: nativePlanItemIcon(item.status))
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(nativePlanItemTint(item.status))
                            .frame(width: 14)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.content)
                                .font(.system(size: 11.5, design: .rounded))
                                .lineLimit(3)
                            Text(item.priority.capitalized)
                                .font(.system(size: 10, weight: .medium, design: .rounded))
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .padding(.top, 8)
        } label: {
            VStack(alignment: .leading, spacing: 7) {
                HStack {
                    Label("Latest plan", systemImage: "checklist")
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                    Spacer()
                    Text("\(plan.completed)/\(plan.total) complete")
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .foregroundStyle(.secondary)
                }
                ProgressView(value: plan.progress)
                    .tint(plan.completed >= plan.total ? .green : .blue)
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white.opacity(0.05)))
    }
}

private struct NativeSubagentCompactRow: View {
    let subagent: NativeSubagentSummary

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(nativeSubagentStatusColor(subagent.status))
                .frame(width: 7, height: 7)
            Text(subagent.label)
                .lineLimit(1)
            Spacer()
            Text(subagent.status.capitalized)
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .foregroundStyle(.secondary)
        }
        .font(.system(size: 12, design: .rounded))
    }
}

private struct NativeSubagentDetailRow: View {
    let subagent: NativeSubagentSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Circle()
                    .fill(nativeSubagentStatusColor(subagent.status))
                    .frame(width: 8, height: 8)
                Text(subagent.label)
                    .font(.system(size: 12.5, weight: .semibold, design: .rounded))
                    .lineLimit(1)
                Spacer()
                Text(subagent.status.capitalized)
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
            }
            if let task = firstNonEmptyGatewayString(subagent.task) {
                Text(task)
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }
            HStack(spacing: 8) {
                if let model = firstNonEmptyGatewayString(subagent.model) {
                    Label(model, systemImage: "cpu")
                }
                if let workspace = gatewayWorkspaceLabel(subagent.workspaceDir, maxLength: 28) {
                    Label(workspace, systemImage: "folder")
                }
            }
            .font(.system(size: 10, design: .rounded))
            .foregroundStyle(.tertiary)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white.opacity(0.05)))
    }
}

private struct NativeSubagentRunDetail: View {
    let subagent: NativeSubagentSummary
    let onStop: (() -> Void)?
    let onClear: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Circle()
                    .fill(nativeSubagentStatusColor(subagent.status))
                    .frame(width: 8, height: 8)
                Text(subagent.status.capitalized)
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                Spacer()
                Text("\(subagent.toolCallCount ?? 0) tool calls")
                    .font(.system(size: 10, design: .rounded))
                    .foregroundStyle(.secondary)
            }

            if let task = firstNonEmptyGatewayString(subagent.task) {
                Text(task)
                    .font(.system(size: 12, design: .rounded))
                    .textSelection(.enabled)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(Color.white.opacity(0.05))
                    )
            }

            if let onStop {
                Button(role: .destructive, action: onStop) {
                    Label("Stop Subagent", systemImage: "stop.fill")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            } else if let onClear {
                Button(role: .destructive, action: onClear) {
                    Label("Clear This Run", systemImage: "trash")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }

            if let activities = subagent.activities, !activities.isEmpty {
                nativeSubagentSection("Activity") {
                    VStack(alignment: .leading, spacing: 9) {
                        ForEach(activities) { activity in
                            HStack(alignment: .top, spacing: 8) {
                                Circle()
                                    .fill(.secondary)
                                    .frame(width: 5, height: 5)
                                    .padding(.top, 6)
                                VStack(alignment: .leading, spacing: 2) {
                                    if let text = firstNonEmptyGatewayString(activity.text) {
                                        Text(text)
                                            .font(.system(size: 11.5, design: .rounded))
                                            .textSelection(.enabled)
                                    }
                                    if let toolName = firstNonEmptyGatewayString(activity.toolName), toolName != "__thought" {
                                        Text("\(toolName) · \(activity.phase ?? "activity")")
                                            .font(.system(size: 9.5, design: .monospaced))
                                            .foregroundStyle(.tertiary)
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if let thinking = firstNonEmptyGatewayString(subagent.thinking),
               !(subagent.activities ?? []).contains(where: { $0.toolName == "__thought" }) {
                nativeSubagentSection("Thinking") {
                    Text(thinking)
                        .font(.system(size: 11.5, design: .rounded))
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            }

            if let toolCalls = subagent.toolCalls, !toolCalls.isEmpty {
                nativeSubagentSection("Tool Calls") {
                    VStack(alignment: .leading, spacing: 7) {
                        ForEach(toolCalls) { toolCall in
                            NativeSubagentToolCallRow(toolCall: toolCall)
                        }
                    }
                }
            }

            if let output = firstNonEmptyGatewayString(subagent.result)
                ?? firstNonEmptyGatewayString(subagent.error) {
                nativeSubagentSection("Final Output") {
                    NativeMarkdownView(content: output, isUser: false)
                        .textSelection(.enabled)
                }
            }
        }
    }

    private func nativeSubagentSection<Content: View>(
        _ title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title.uppercased())
                .font(.system(size: 9.5, weight: .semibold, design: .rounded))
                .foregroundStyle(.tertiary)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct NativeSubagentToolCallRow: View {
    let toolCall: GatewayToolCall
    @State private var expanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 8) {
                if let args = toolCall.args, !args.isEmpty {
                    nativeToolValue("Arguments", value: JSONValue.object(args).displayString)
                }
                nativeToolValue(
                    "Output",
                    value: nativeSubagentToolOutput(toolCall.result)
                        ?? firstNonEmptyGatewayString(toolCall.error)
                        ?? "No output recorded"
                )
            }
            .padding(.top, 7)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: toolCall.status == "failed" ? "xmark.circle" : "terminal")
                    .foregroundStyle(toolCall.status == "failed" ? .red : .secondary)
                Text(toolCall.name)
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .lineLimit(1)
                Spacer()
                Text((toolCall.status ?? "completed").capitalized)
                    .font(.system(size: 9.5, design: .rounded))
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(9)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.white.opacity(0.04))
        )
    }

    private func nativeToolValue(_ label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .semibold, design: .rounded))
                .foregroundStyle(.tertiary)
            Text(value)
                .font(.system(size: 10.5, design: .monospaced))
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func nativeSubagentToolOutput(_ result: JSONValue?) -> String? {
        guard let result else { return nil }
        if case .object(let values) = result {
            for key in ["content", "output", "stdout"] {
                if case .string(let value) = values[key], let normalized = firstNonEmptyGatewayString(value) {
                    return normalized
                }
            }
        }
        return result.displayString
    }
}

private struct NativeToolNameCloud: View {
    let names: [String]

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 76), spacing: 6)], alignment: .leading, spacing: 6) {
            ForEach(names.prefix(18), id: \.self) { name in
                Text(name)
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(Color.white.opacity(0.06)))
            }
        }
    }
}

private func summarizeNativeChatFileChanges(
    _ messages: [GatewaySessionMessage],
    liveActivities: [NativeToolActivity] = []
) -> NativeChatFileChangeSummary {
    var files: [String: NativeChatFileChangeItem] = [:]
    func merge(_ item: NativeChatFileChangeItem) {
        if let existing = files[item.path] {
            let kind = item.kind == "deleted" || existing.kind == "deleted"
                ? "deleted"
                : (item.kind == "updated" || existing.kind == "updated" ? "updated" : item.kind)
            files[item.path] = NativeChatFileChangeItem(
                path: item.path,
                kind: kind,
                added: existing.added + item.added,
                removed: existing.removed + item.removed
            )
        } else {
            files[item.path] = item
        }
    }

    for tool in messages.flatMap({ $0.tool_calls ?? [] }) {
        let lowerName = tool.name.lowercased()
        let relevant = lowerName.contains("write") || lowerName.contains("edit") || lowerName.contains("patch")
        guard relevant else { continue }
        let paths = nativeToolFilePaths(tool)
        for path in paths {
            let diff = nativeJSONString(nativeJSONObject(tool.result), key: "diff") ?? nativeJSONString(tool.args, key: "diff") ?? ""
            let counts = nativeUnifiedDiffCounts(diff)
            merge(NativeChatFileChangeItem(
                path: path,
                kind: nativeFileChangeKind(tool),
                added: counts.added,
                removed: counts.removed
            ))
        }
    }
    for activity in messages.flatMap({ $0.process_activities ?? [] }) {
        if let item = nativeActivityFileChange(text: activity.text, phase: activity.phase) {
            merge(item)
        }
    }
    for activity in liveActivities {
        if let item = nativeActivityFileChange(text: activity.text, phase: activity.phase.rawValue) {
            merge(item)
        }
    }
    let sorted = files.values.sorted { $0.path.localizedCaseInsensitiveCompare($1.path) == .orderedAscending }
    return NativeChatFileChangeSummary(
        files: sorted,
        totalAdded: sorted.reduce(0) { $0 + $1.added },
        totalRemoved: sorted.reduce(0) { $0 + $1.removed }
    )
}

private func nativeActivityFileChange(text: String?, phase: String?) -> NativeChatFileChangeItem? {
    guard (phase ?? "result").lowercased() == "result",
          let text = firstNonEmptyGatewayString(text)
    else { return nil }
    let parts = text.split(separator: " ").map(String.init)
    guard parts.count >= 4,
          parts.first?.lowercased() == "edited",
          let addedRaw = parts.dropLast().last,
          let removedRaw = parts.last,
          addedRaw.hasPrefix("+"),
          removedRaw.hasPrefix("-"),
          let added = Int(addedRaw.dropFirst()),
          let removed = Int(removedRaw.dropFirst())
    else { return nil }
    let path = parts.dropFirst().dropLast(2).joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    guard !path.isEmpty, path.lowercased() != "file" else { return nil }
    return NativeChatFileChangeItem(
        path: path,
        kind: removed > 0 ? "updated" : "created",
        added: max(0, added),
        removed: max(0, removed)
    )
}

private func nativeToolFilePaths(_ tool: GatewayToolCall) -> [String] {
    var paths: [String] = []
    for object in [tool.args, nativeJSONObject(tool.result)] {
        guard let object else { continue }
        for key in ["path", "file", "filePath", "targetPath", "oldPath", "newPath"] {
            if let path = nativeJSONString(object, key: key) {
                paths.append(path)
            }
        }
        for key in ["files", "changedFiles"] {
            if case .array(let values)? = object[key] {
                for value in values {
                    if case .string(let path) = value {
                        paths.append(path)
                    } else if case .object(let fileObject) = value,
                              let path = nativeJSONString(fileObject, key: "path") ?? nativeJSONString(fileObject, key: "file") {
                        paths.append(path)
                    }
                }
            }
        }
    }
    let unique = Array(NSOrderedSet(array: paths.compactMap { firstNonEmptyGatewayString($0) })) as? [String]
    return unique?.isEmpty == false ? unique! : ["\(tool.name) change"]
}

private func nativeFileChangeKind(_ tool: GatewayToolCall) -> String {
    let name = tool.name.lowercased()
    if name.contains("delete") || name.contains("remove") { return "deleted" }
    if name.contains("create") || name.contains("write") { return "created" }
    return "updated"
}

private func nativeUnifiedDiffCounts(_ diff: String) -> (added: Int, removed: Int) {
    guard !diff.isEmpty else { return (0, 0) }
    var added = 0
    var removed = 0
    for line in diff.split(separator: "\n", omittingEmptySubsequences: false) {
        if line.hasPrefix("+"), !line.hasPrefix("+++") { added += 1 }
        if line.hasPrefix("-"), !line.hasPrefix("---") { removed += 1 }
    }
    return (added, removed)
}

private func extractNativeSessionPlan(
    from messages: [GatewaySessionMessage],
    sessionID: String?
) -> NativeSessionPlanSnapshot? {
    for message in messages.reversed() {
        guard let tools = message.tool_calls else { continue }
        for tool in tools.reversed() where tool.name.lowercased() == "todo" {
            let items = nativePlanItems(from: tool.result)
            let fallbackItems = items.isEmpty ? nativePlanItems(from: tool.args.map(JSONValue.object)) : items
            guard !fallbackItems.isEmpty else { continue }
            let completed = fallbackItems.filter { $0.status == "completed" }.count
            return NativeSessionPlanSnapshot(
                items: fallbackItems,
                completed: completed,
                total: fallbackItems.count,
                updatedAt: message.timestamp
            )
        }
    }
    return nil
}

private func nativePlanItems(from value: JSONValue?) -> [NativeSessionPlanItem] {
    guard case .object(let object)? = value,
          case .array(let rawItems)? = object["items"] else { return [] }
    return rawItems.compactMap { item in
        guard case .object(let itemObject) = item else { return nil }
        guard let content = nativeJSONString(itemObject, key: "content") else { return nil }
        return NativeSessionPlanItem(
            content: String(content.prefix(500)),
            status: nativeJSONString(itemObject, key: "status") == "completed"
                ? "completed"
                : nativeJSONString(itemObject, key: "status") == "in_progress" ? "in_progress" : "pending",
            priority: nativeJSONString(itemObject, key: "priority") ?? "medium"
        )
    }
}

private func nativePlanItemIcon(_ status: String) -> String {
    switch status {
    case "completed": return "checkmark.circle.fill"
    case "in_progress": return "circle.dotted"
    default: return "circle"
    }
}

private func nativePlanItemTint(_ status: String) -> Color {
    switch status {
    case "completed": return .green
    case "in_progress": return .blue
    default: return .secondary
    }
}

private func nativeSubagentStatusColor(_ status: String) -> Color {
    switch status.lowercased() {
    case "completed": return .green
    case "failed", "timeout": return .red
    case "running": return .blue
    default: return .secondary
    }
}

private func nativeJSONObject(_ value: JSONValue?) -> [String: JSONValue]? {
    guard case .object(let object)? = value else { return nil }
    return object
}

private func nativeJSONString(_ object: [String: JSONValue]?, key: String) -> String? {
    guard let value = object?[key] else { return nil }
    return nativeJSONString(value)
}

private func nativeJSONString(_ value: JSONValue?) -> String? {
    guard let value else { return nil }
    switch value {
    case .string(let string):
        return firstNonEmptyGatewayString(string)
    case .number(let number):
        return number.rounded() == number ? String(Int(number)) : String(number)
    case .bool(let bool):
        return bool ? "true" : "false"
    default:
        return nil
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

private struct NativeContextProviderPlanUsageRow: Identifiable {
    let id: String
    let label: String
    let value: String
    let percent: Double?
    let unlimited: Bool
    let resetText: String?
}

private struct NativeContextProviderPlanUsageBar: View {
    let row: NativeContextProviderPlanUsageRow

    var body: some View {
        let tint = nativeContextProviderPlanUsageTint(row)
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 8) {
                Text(row.label)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 12)
                Text(row.value)
                    .fontWeight(.semibold)
                    .foregroundStyle(tint)
            }
            GeometryReader { proxy in
                Capsule()
                    .fill(Color.white.opacity(0.08))
                    .overlay(alignment: .leading) {
                        Capsule()
                            .fill(tint.opacity(0.82))
                            .frame(
                                width: max(
                                    3,
                                    proxy.size.width * nativeContextProviderPlanProgress(row)
                                )
                            )
                    }
            }
            .frame(height: 5)
            if let resetText = row.resetText {
                Text(resetText)
                    .font(.system(size: 10, design: .rounded))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }
}

private func nativeContextProviderPlanUsageTint(_ row: NativeContextProviderPlanUsageRow) -> Color {
    if row.unlimited { return .green }
    guard let percent = row.percent else { return .secondary }
    if percent < 40 { return .green }
    if percent < 65 { return .blue }
    if percent < 80 { return .yellow }
    if percent < 95 { return .orange }
    return .red
}

private func nativeContextProviderPlanProgress(_ row: NativeContextProviderPlanUsageRow) -> Double {
    if row.unlimited { return 1 }
    guard let percent = row.percent else { return 0 }
    return min(1, max(0, percent / 100))
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
