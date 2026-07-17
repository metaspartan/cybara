import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct ScreenHeader: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.title2.weight(.semibold))
            Text(subtitle)
                .font(.subheadline)
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

struct NativeMessageActions: View {
    let content: String
    let timestampLabel: String
    let onRevert: (() -> Void)?
    let onFork: (() -> Void)?
    let onSaveGolden: (() -> Void)?
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
            if let onFork {
                Button(action: onFork) {
                    Image(systemName: "arrow.triangle.branch")
                        .font(.system(size: 10, weight: .semibold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help("Fork chat from this message")
            }
            if let onSaveGolden {
                Button(action: onSaveGolden) {
                    Image(systemName: "flask")
                        .font(.system(size: 10, weight: .semibold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help("Save this turn as a golden run")
            }
        }
    }
}

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

                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 168), spacing: 14)],
                    alignment: .leading,
                    spacing: 14
                ) {
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
        .frame(minHeight: 96, alignment: .topLeading)
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
        var failures: [String] = []
        do {
            health = try await client.health()
        } catch {
            failures.append("Health: \(error.localizedDescription)")
        }
        do {
            sessions = try await client.sessions(limit: 12)
        } catch {
            failures.append("Chats: \(error.localizedDescription)")
        }
        do {
            agents = try await client.agents()
        } catch {
            failures.append("Agents: \(error.localizedDescription)")
        }
        do {
            providers = try await client.providers()
        } catch {
            failures.append("Providers: \(error.localizedDescription)")
        }
        error = failures.isEmpty ? nil : failures.joined(separator: "\n")
    }
}

struct NativeSessionGroup: Identifiable {
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

func nativeSessionGroups(
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

private func nativeMergeReloadedSessionMessages(
    reference: [GatewaySessionMessage],
    reloaded: [GatewaySessionMessage],
    preserveReferenceTail: Bool
) -> [GatewaySessionMessage] {
    guard preserveReferenceTail,
          reloaded.count < reference.count,
          reloaded.enumerated().allSatisfy({ index, message in
              let current = reference[index]
              return current.role == message.role && current.content == message.content
          })
    else { return reloaded }
    return reloaded + reference.dropFirst(reloaded.count)
}

struct ChatScreen: View {
    let client: GatewayClient
    @Binding var selectedSessionID: String?
    var showsSessionList = true
    var preferredWorkspaceDir: String? = nil
    var openCybaraIDEWorkspace: (String) -> Void = { _ in }
    @Environment(\.cybaraAccent) private var accentTint

    @State private var sessions: [GatewaySession] = []
    @State private var activeTasks: [GatewayTask] = []
    @State private var agents: [GatewayAgent] = []
    @State private var providers: [GatewayProvider] = []
    @State private var providerPlanStatus: ProviderPlanStatusResponse?
    @State private var messages: [GatewaySessionMessage] = []
    @State private var messagesBySessionID: [String: [GatewaySessionMessage]] = [:]
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
    @State private var followUpBehaviorEnabled = true
    @State private var goldenTurnsEnabled = true
    @State private var chatAppearance = NativeChatAppearanceSettings()
    @State private var pendingApprovals: [GatewayPendingApproval] = []
    @State private var expandedApprovalID: String?
    @State private var showContextPopover = false
    @State private var showReasoningPopover = false
    @State private var reasoningDraftIndex = 0.0
    @State private var reasoningSaving = false
    @State private var showEnvironmentPopover = false
    @State private var showNearbyShare = false
    @State private var nearbyStatus: NativeNearbyStatus?
    @State private var nearbyShareBusy = false
    @State private var showWorkspacePanel = false
    @State private var activeWorkspaceTab = NativeChatWorkspaceTab.review
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
    @State private var liveEventCursor = NativeSessionEventCursor()
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
            if showsSessionList {
                sessionList
                    .frame(minWidth: 220, idealWidth: 260, maxWidth: 340)
            }
            chatContent
                .frame(minWidth: 380, maxWidth: .infinity)
            if showWorkspacePanel {
                chatWorkspacePanel
                    .frame(minWidth: 320, idealWidth: 460, maxWidth: 760)
            }
        }
        .task {
            statusStream.start(baseURL: client.baseURL)
            await loadSessions()
            await loadChatConfig()
            await loadSubagents()
        }
        .task {
            while !Task.isCancelled {
                await pollApprovals()
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
        }
        .task(id: selectedSessionID) {
            resetLiveTimeline(clearStartedAt: true)
            liveEventCursor = NativeSessionEventCursor()
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
            async let messagesLoad: Void = loadMessages(selectedSessionID)
            async let statusLoad: Void = hydrateStatus(selectedSessionID)
            _ = await (messagesLoad, statusLoad)
            await loadSubagents()
            await loadNearbyShare()
        }
        .task(id: activeWorkspaceDir) {
            await loadActiveGitBranch()
            await loadWorkspaceOpenTargets()
        }
        .onReceive(statusStream.$latest.compactMap { $0 }) { event in
            handleStatusEvent(event)
        }
        .onChange(of: selectedSessionID) { previous, current in
            if let previous {
                messagesBySessionID[previous] = messages
            }
            messages = current.flatMap { messagesBySessionID[$0] } ?? []
        }
        .onChange(of: messages) { _, current in
            if let selectedSessionID {
                messagesBySessionID[selectedSessionID] = current
            }
        }
        .onDisappear { statusStream.stop() }
        .nativeChatAppearance(chatAppearance)
        .transaction { transaction in
            if chatAppearance.reduceMotion {
                transaction.animation = nil
            }
        }
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

    private var filteredActiveTasks: [GatewayTask] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return activeTasks
            .filter(\.isRunning)
            .filter { task in
                query.isEmpty
                    || task.name.lowercased().contains(query)
                    || (task.action ?? "").lowercased().contains(query)
            }
            .sorted { left, right in
                if left.status?.lowercased() == "running" && right.status?.lowercased() != "running" {
                    return true
                }
                if right.status?.lowercased() == "running" && left.status?.lowercased() != "running" {
                    return false
                }
                return (parseGatewayDate(left.next_run) ?? .distantFuture)
                    < (parseGatewayDate(right.next_run) ?? .distantFuture)
            }
    }

    private var hasPinnedSessionGroup: Bool {
        groupedSessions.contains { $0.kind == .pinned }
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
                if filteredSessions.isEmpty && filteredActiveTasks.isEmpty {
                    Text("No matching chats")
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.secondary)
                        .padding(.vertical, 8)
                }
                if !hasPinnedSessionGroup {
                    activeTaskSidebarSection
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
                    if group.kind == .pinned {
                        activeTaskSidebarSection
                    }
                }
            }
            .listStyle(.sidebar)
        }
    }

    @ViewBuilder
    private var activeTaskSidebarSection: some View {
        if !filteredActiveTasks.isEmpty {
            Section {
                ForEach(filteredActiveTasks) { task in
                    Button {
                        if let sessionID = firstNonEmptyGatewayString(task.session_id) {
                            selectedSessionID = sessionID
                        }
                    } label: {
                        HStack(spacing: 8) {
                            if task.status?.lowercased() == "running" {
                                ProgressView()
                                    .controlSize(.mini)
                            } else {
                                Image(systemName: "calendar.badge.clock")
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundStyle(.secondary)
                            }
                            Text(task.name)
                                .lineLimit(1)
                            Spacer(minLength: 4)
                            if firstNonEmptyGatewayString(task.session_id) == nil {
                                Text("New chat")
                                    .font(.system(size: 9, design: .rounded))
                                    .foregroundStyle(.tertiary)
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(firstNonEmptyGatewayString(task.session_id) == nil)
                    .help(firstNonEmptyGatewayString(task.session_id) == nil ? "Runs in a new chat" : "Open assigned chat")
                }
            } header: {
                HStack(spacing: 5) {
                    Image(systemName: "calendar.badge.clock")
                        .font(.system(size: 10, weight: .medium))
                    Text("Tasks")
                    Spacer(minLength: 4)
                    Text("\(filteredActiveTasks.count)")
                }
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(.secondary)
            }
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
    private var chatContent: some View {
        if selectedSessionID == nil && messages.isEmpty {
            newChatSurface
        } else {
            transcript
        }
    }

    private var newChatSurface: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 28)
            VStack(spacing: 0) {
                VStack(spacing: 7) {
                    CybaraLogo(size: 64)
                        .saturation(0)
                        .brightness(0.22)
                        .opacity(0.58)
                        .padding(.bottom, 7)
                    Text("Start a conversation")
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                    Text("Ask questions, get help with code, or chat with your agents")
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.secondary)
                }
                .multilineTextAlignment(.center)
                .padding(.bottom, 18)

                VStack(spacing: -1) {
                    newChatWorkspaceBar
                        .padding(.horizontal, 14)
                        .zIndex(0)
                    composerContent
                        .zIndex(1)
                }
            }
            .frame(maxWidth: 672)
            Spacer(minLength: 28)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 18)
    }

    private var newChatWorkspaceBar: some View {
        HStack(spacing: 8) {
            Button {
                Task { await chooseWorkspace(for: nil) }
            } label: {
                HStack(spacing: 6) {
                    if workspaceSaving {
                        ProgressView().controlSize(.mini)
                    } else {
                        Image(systemName: "folder")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(.secondary)
                    }
                    Text(gatewayWorkspaceFolderName(activeWorkspaceDir) ?? "Select workspace")
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .lineLimit(1)
                }
                .padding(.horizontal, 7)
                .padding(.vertical, 5)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(workspaceSaving)
            .help(workspaceHelpText)

            if activeWorkspaceDir != nil {
                Button {
                    showGitBranchPicker = true
                    Task { await loadActiveGitBranch() }
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "arrow.triangle.branch")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(.secondary)
                        Text(activeGitBranchLabel ?? "No branch")
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .lineLimit(1)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 8, weight: .semibold))
                            .foregroundStyle(.tertiary)
                    }
                    .padding(.horizontal, 7)
                    .padding(.vertical, 5)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .popover(isPresented: $showGitBranchPicker, arrowEdge: .top) {
                    gitBranchPicker
                }
                .help("Change branch")
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 8)
        .padding(.top, 5)
        .padding(.bottom, 7)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.white.opacity(0.045))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
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
        HStack(spacing: 8) {
            Text(activeSession?.displayTitle ?? "Untitled chat")
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .lineLimit(1)
                .help(sessionDetailLine)
            if let activeSession {
                Menu {
                    Button("Rename…") {
                        renameDraft = activeSession.title ?? ""
                        renameTarget = activeSession
                    }
                    Button(activeSession.pinned == true ? "Unpin" : "Pin") {
                        Task { await togglePin(activeSession) }
                    }
                    Button("Set Workspace…") {
                        Task { await chooseWorkspace(for: activeSession) }
                    }
                    Divider()
                    Button("Delete…", role: .destructive) {
                        deleteTarget = activeSession
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
                .menuStyle(.borderlessButton)
                .help("Chat options")
            }
            Spacer()
            workspaceOpenMenu

            if selectedSessionID != nil, nearbyStatus?.settings.enabled == true {
                Button {
                    showNearbyShare.toggle()
                    if showNearbyShare { Task { await loadNearbyShare() } }
                } label: {
                    Image(systemName: "square.and.arrow.up")
                }
                .buttonStyle(.borderless)
                .popover(isPresented: $showNearbyShare, arrowEdge: .bottom) {
                    nearbySharePopover
                }
                .help("Send to nearby Cybara")
            }

            Button {
                activeWorkspaceTab = .review
                showWorkspacePanel = true
            } label: {
                Image(systemName: "doc.text.magnifyingglass")
            }
            .buttonStyle(.borderless)
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
                activeWorkspaceTab = .subagents
                showWorkspacePanel = true
                Task { await loadSubagents() }
            } label: {
                Image(systemName: "person.2.wave.2")
            }
            .buttonStyle(.borderless)
            .help("Subagents")

            Menu {
                ForEach(NativeChatWorkspaceTab.allCases) { tab in
                    Button {
                        activeWorkspaceTab = tab
                        showWorkspacePanel = true
                        if tab == .subagents { Task { await loadSubagents() } }
                    } label: {
                        Label(tab.label, systemImage: tab.systemImage)
                    }
                }
            } label: {
                Image(systemName: "sidebar.right")
            }
            .menuStyle(.borderlessButton)
            .help("Workspace panel")
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 13)
    }

    private var nearbySharePopover: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Send to Nearby Cybara")
                .font(.system(size: 13, weight: .bold, design: .rounded))
            if nearbyShareBusy {
                ProgressView().controlSize(.small)
            } else if let peers = nearbyStatus?.pairedPeers, !peers.isEmpty {
                ForEach(peers) { peer in
                    Button {
                        Task { await sendNearby(peer.id) }
                    } label: {
                        Label(peer.name, systemImage: "desktopcomputer")
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                    .padding(.vertical, 4)
                }
            } else {
                Text("Pair another Cybara in Gateway settings first.")
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(14)
        .frame(width: 260)
    }

    private func loadNearbyShare() async {
        nearbyShareBusy = true
        nearbyStatus = try? await client.nearbyStatus()
        nearbyShareBusy = false
    }

    private func sendNearby(_ peerID: String) async {
        guard let selectedSessionID else { return }
        nearbyShareBusy = true
        do {
            try await client.sendNearbySession(peerID: peerID, sessionID: selectedSessionID)
            showNearbyShare = false
        } catch {
            self.error = error.localizedDescription
        }
        nearbyShareBusy = false
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

    @ViewBuilder
    private func workspaceOpenTargetLabel(_ target: NativeWorkspaceOpenTarget) -> some View {
        Label {
            Text(target.label)
        } icon: {
            NativeWorkspaceOpenTargetIcon(target: target)
        }
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
            preferredWorkspaceDir,
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
            provider: selectedChatAgent?.providerType ?? selectedChatAgent?.providerID,
            model: selectedChatAgent?.model
        )
    }

    private var composerReasoningEfforts: [(value: String, label: String)] {
        nativeSupportedReasoningEfforts(
            provider: selectedChatAgent?.providerType ?? selectedChatAgent?.providerID,
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
            if let firstTokenMs = tokenUsage.firstTokenMs {
                let firstToken = firstTokenMs < 1000
                    ? "\(Int(firstTokenMs.rounded())) ms"
                    : String(format: "%.1f s", firstTokenMs / 1000)
                parts.append("First token: \(firstToken).")
            }
            if tokenUsage.cachedInputTokens > 0 || tokenUsage.cacheWriteTokens > 0 {
                parts.append("Cache: \(formatNativeTokenCount(tokenUsage.cachedInputTokens)) read / \(formatNativeTokenCount(tokenUsage.cacheWriteTokens)) write.")
            }
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

    private var agentUsingBrowser: Bool {
        nativeAgentUsingBrowser(
            liveActivities,
            sessionActive: selectedSessionID.map(activeSessionIDs.contains) ?? false
        )
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
        sending || selectedSessionID.map { activeSessionIDs.contains($0) } == true
    }

    private var sortedPendingMessages: [GatewayPendingChatMessage] {
        pendingMessages
            .filter { !$0.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .sorted {
                if $0.sequence == $1.sequence { return $0.createdAt < $1.createdAt }
                return $0.sequence < $1.sequence
            }
    }

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
                        .disabled(
                            !followUpBehaviorEnabled ||
                                steeringPendingID == message.id ||
                                pendingMutationID == message.id
                        )
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
                        agentTransferTimeline(message.agent_transfers)
                    }
                    if isUser, !message.attachedImages.isEmpty {
                        NativeAttachedImagesStrip(images: message.attachedImages)
                    }
                    if !visibleContent.isEmpty {
                        NativeMarkdownView(
                            content: visibleContent,
                            isUser: isUser,
                            mediaBaseURL: client.baseURL,
                            mediaToken: GatewayClient.loadAPIKey()
                        )
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
                        : nil,
                    onFork: {
                        performFork(message)
                    },
                    onSaveGolden: isUser || !goldenTurnsEnabled
                        ? nil
                        : {
                            performSaveGolden(message)
                        }
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
    }

    @ViewBuilder
    private func agentTransferTimeline(_ transfers: [GatewayAgentTransfer]?) -> some View {
        if let transfers, !transfers.isEmpty {
            VStack(alignment: .leading, spacing: 5) {
                ForEach(transfers) { transfer in
                    HStack(spacing: 7) {
                        Image(systemName: "arrow.left.arrow.right")
                            .font(.system(size: 11, weight: .medium))
                        Text("Transferred from \(transfer.fromAgentName) to \(transfer.toAgentName)")
                            .font(.system(size: 12))
                            .lineLimit(1)
                    }
                    .foregroundStyle(.secondary)
                    .help([transfer.reason, transfer.contextSummary].compactMap { $0 }.joined(separator: "\n"))
                }
            }
            .padding(.vertical, 3)
        }
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

    private func messageIndex(_ message: GatewaySessionMessage) -> Int? {
        messages.firstIndex { $0.id == message.id }
    }

    private func performFork(_ message: GatewaySessionMessage) {
        guard let sessionID = selectedSessionID else { return }
        Task {
            do {
                let response = try await client.forkSession(
                    sessionID,
                    throughMessageIndex: messageIndex(message)
                )
                guard response.success, let fork = response.fork else {
                    throw GatewayClientError.badStatus(400, response.error ?? "Failed to fork chat")
                }
                await loadSessions()
                selectedSessionID = fork.sessionId
            } catch {
                self.error = "Failed to fork: \(error.localizedDescription)"
            }
        }
    }

    private func performSaveGolden(_ message: GatewaySessionMessage) {
        guard let sessionID = selectedSessionID else { return }
        Task {
            do {
                let response = try await client.saveSessionGolden(
                    sessionID,
                    messageIndex: messageIndex(message)
                )
                if !response.success {
                    throw GatewayClientError.badStatus(400, response.error ?? "Failed to save golden run")
                }
            } catch {
                self.error = "Failed to save golden run: \(error.localizedDescription)"
            }
        }
    }

    private var composer: some View {
        composerContent
            .padding(14)
            .cybaraGlass(cornerRadius: 0)
    }

    private var composerContent: some View {
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
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Attachments")
                    .help("Attach images or text files")
                    .disabled(pendingAttachments.count >= 8 && pendingFiles.count >= 8)
                    Button {
                        Task {
                            if showWorkingTimeline && draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && pendingAttachments.isEmpty && pendingFiles.isEmpty {
                                await stopResponse()
                            } else {
                                await send()
                            }
                        }
                    } label: {
                        Image(systemName: showWorkingTimeline && draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && pendingAttachments.isEmpty && pendingFiles.isEmpty ? "stop.circle.fill" : "arrow.up.circle.fill")
                            .font(.system(size: 24))
                    }
                    .buttonStyle(.borderless)
                    .disabled(
                        (!showWorkingTimeline && draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            && pendingAttachments.isEmpty
                            && pendingFiles.isEmpty) ||
                            ((showWorkingTimeline || !pendingMessages.isEmpty) && !followUpBehaviorEnabled && (!draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !pendingAttachments.isEmpty || !pendingFiles.isEmpty))
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
    }

    private var composerControls: some View {
        HStack(spacing: 4) {
            Button {
                showContextPopover.toggle()
            } label: {
                ZStack {
                    Circle()
                        .stroke(Color.primary.opacity(0.14), lineWidth: 2)
                    Circle()
                        .trim(from: 0, to: contextUsageProgress)
                        .stroke(contextColor, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                        .rotationEffect(.degrees(-90))
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
                    Image(systemName: "brain")
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

    private var chatWorkspacePanel: some View {
        VStack(spacing: 0) {
            NativeChatWorkspaceHeader(
                selection: $activeWorkspaceTab,
                onClose: { showWorkspacePanel = false }
            )
            Divider()
            ZStack {
                ScrollView { fileDiffsPopover }
                    .nativeWorkspacePanelVisibility(activeWorkspaceTab == .review)
                TerminalScreen(client: client, isActive: activeWorkspaceTab == .terminal, compact: true)
                    .nativeWorkspacePanelVisibility(activeWorkspaceTab == .terminal)
                NativeChatBrowserPanel(
                    client: client,
                    sessionID: selectedSessionID,
                    isActive: activeWorkspaceTab == .browser
                )
                    .nativeWorkspacePanelVisibility(activeWorkspaceTab == .browser)
                NativeChatComputerPanel(
                    client: client,
                    sessionID: selectedSessionID,
                    isActive: activeWorkspaceTab == .computer
                )
                    .nativeWorkspacePanelVisibility(activeWorkspaceTab == .computer)
                NativeChatFilesPanel(client: client, workspacePath: activeWorkspaceDir)
                    .nativeWorkspacePanelVisibility(activeWorkspaceTab == .files)
                subagentsPopover
                    .nativeWorkspacePanelVisibility(activeWorkspaceTab == .subagents)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(.regularMaterial)
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
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Environment")
                            .font(.system(size: 14, weight: .semibold, design: .rounded))
                        Text("Session overview")
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
                }

                NativeEnvironmentSection(title: "Context and usage") {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text("Active context")
                                .foregroundStyle(.secondary)
                            Spacer()
                            if let usage = activeContextUsage {
                                Text("\(formatNativeTokenCount(usage.usedTokens)) / \(formatNativeTokenCount(usage.limitTokens))")
                                    .font(.system(size: 11, design: .monospaced))
                            } else {
                                Text("Not available")
                                    .foregroundStyle(.secondary)
                            }
                        }
                        ProgressView(value: activeContextUsage?.usedPercent ?? 0, total: 100)
                            .tint(contextColor)
                        HStack {
                            Text(activeContextUsage.map { "\(formatNativePercent($0.usedPercent)) used" } ?? "Waiting for context data")
                            Spacer()
                            if let usage = activeContextUsage {
                                Text("\(formatNativeTokenCount(usage.remainingTokens)) remaining")
                            }
                        }
                        .font(.system(size: 10, design: .rounded))
                        .foregroundStyle(.tertiary)
                        LazyVGrid(columns: environmentUsageColumns, alignment: .leading, spacing: 10) {
                            NativeEnvironmentUsageStat(label: "Input", value: environmentInputTokens)
                            NativeEnvironmentUsageStat(label: "Output", value: environmentOutputTokens)
                            NativeEnvironmentUsageStat(label: "Model calls", value: environmentModelCalls)
                            NativeEnvironmentUsageStat(label: "Output speed", value: environmentOutputSpeed)
                            NativeEnvironmentUsageStat(label: "First token", value: environmentFirstToken)
                            NativeEnvironmentUsageStat(label: "Cache read", value: environmentCacheRead)
                            NativeEnvironmentUsageStat(label: "Cache write", value: environmentCacheWrite)
                            NativeEnvironmentUsageStat(label: "Compaction", value: environmentCompaction)
                        }
                        .padding(.top, 2)
                    }
                }

                NativeEnvironmentSection(title: "Plans") {
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

                if showWorkspacePanel || agentUsingBrowser {
                    NativeEnvironmentSection(title: "Preview") {
                        VStack(alignment: .leading, spacing: 8) {
                            if agentUsingBrowser {
                                Button {
                                    activeWorkspaceTab = .browser
                                    showWorkspacePanel = true
                                    showEnvironmentPopover = false
                                } label: {
                                    Label("Agent is browsing", systemImage: "globe")
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .buttonStyle(.plain)
                            }
                            if showWorkspacePanel && (!agentUsingBrowser || activeWorkspaceTab != .browser) {
                                Button {
                                    showEnvironmentPopover = false
                                } label: {
                                    Label(activeWorkspaceTab.label, systemImage: activeWorkspaceTab.systemImage)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .buttonStyle(.plain)
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
        }
        .frame(width: 370, alignment: .leading)
        .frame(maxHeight: 620)
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
                        mediaBaseURL: client.baseURL,
                        mediaToken: GatewayClient.loadAPIKey(),
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

    private var contextUsageProgress: Double {
        min(1, max(0, (activeContextUsage?.usedPercent ?? 0) / 100))
    }

    private var environmentUsageColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: 10, alignment: .leading), count: 3)
    }

    private var environmentInputTokens: String {
        guard let usage = activeTokenUsage, usage.totalTokens > 0 else { return "—" }
        return formatNativeTokenCount(usage.inputTokens)
    }

    private var environmentOutputTokens: String {
        guard let usage = activeTokenUsage, usage.totalTokens > 0 else { return "—" }
        return formatNativeTokenCount(usage.outputTokens)
    }

    private var environmentModelCalls: String {
        guard let usage = activeTokenUsage, usage.totalTokens > 0 else { return "—" }
        return formatNativeTokenCount(usage.callCount)
    }

    private var environmentOutputSpeed: String {
        guard let speed = activeTokenUsage?.tokensPerSecond else { return "—" }
        return "\(formatNativeDecimal(speed)) tok/s"
    }

    private var environmentFirstToken: String {
        guard let milliseconds = activeTokenUsage?.firstTokenMs, milliseconds >= 0 else { return "—" }
        if milliseconds < 1_000 { return "\(Int(milliseconds.rounded()))ms" }
        return String(format: milliseconds < 10_000 ? "%.2fs" : "%.1fs", milliseconds / 1_000)
    }

    private var environmentCacheRead: String {
        guard let usage = activeTokenUsage, usage.totalTokens > 0 else { return "—" }
        let tokens = formatNativeTokenCount(usage.cachedInputTokens)
        guard let hitRate = usage.cacheHitRate else { return tokens }
        return "\(tokens) · \(formatNativePercent(hitRate))"
    }

    private var environmentCacheWrite: String {
        guard let usage = activeTokenUsage, usage.totalTokens > 0 else { return "—" }
        return formatNativeTokenCount(usage.cacheWriteTokens)
    }

    private var environmentCompaction: String {
        guard activeContextUsage?.compacted == true else { return "Never" }
        let count = activeContextUsage?.compactionCount ?? 0
        let tokens = activeContextUsage?.compactedTokens ?? 0
        return tokens > 0 ? "\(count)x · \(formatNativeTokenCount(tokens))" : "\(count)x"
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
            async let loadedTasks = client.tasks()
            async let loadedAgents = client.agents()
            async let loadedProviders = client.providers()
            async let loadedProviderPlans = loadProviderPlanStatus()
            sessions = try await loadedSessions
            activeTasks = try await loadedTasks
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
            followUpBehaviorEnabled = config["follow_up_behavior_enabled"] as? Bool ?? true
            let lab = config["lab"] as? [String: Any] ?? [:]
            goldenTurnsEnabled = (lab["enabled"] as? Bool ?? true) &&
                (lab["goldenTurnsEnabled"] as? Bool ?? true)
            chatAppearance = NativeChatAppearanceSettings(config: config)
        } catch {
            toolApprovalMode = "always_allow"
            followUpBehaviorEnabled = true
            goldenTurnsEnabled = true
            chatAppearance = NativeChatAppearanceSettings()
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
            let reloaded = (detail.messagesList ?? []).map { message in
                guard message.role == "user",
                      let cached = attachmentsByContent[message.content.trimmingCharacters(in: .whitespacesAndNewlines)],
                      !cached.isEmpty else {
                    return message
                }
                return message.withAttachedImages(cached)
            }
            guard selectedSessionID == id else { return }
            let reference = messagesBySessionID[id] ?? messages
            let nextMessages = nativeMergeReloadedSessionMessages(
                reference: reference,
                reloaded: reloaded,
                preserveReferenceTail: activeSessionIDs.contains(id) || sending
            )
            messages = nextMessages
            messagesBySessionID[id] = nextMessages
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
        let chatBusy = sending || showWorkingTimeline || !pendingMessages.isEmpty
        let queuedSend = followUpBehaviorEnabled && chatBusy
        guard !text.isEmpty || !attachments.isEmpty || !files.isEmpty else { return }
        guard !chatBusy || followUpBehaviorEnabled else { return }
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

    private func stopResponse() async {
        guard let sessionID = selectedSessionID else { return }
        do {
            _ = try await client.stopChatSession(sessionID)
            sending = false
            activeSessionIDs.remove(sessionID)
            await loadMessages(sessionID)
            resetLiveTimeline(clearStartedAt: true)
            await hydrateStatus(sessionID)
        } catch {
            self.error = "Failed to stop response: \(error.localizedDescription)"
        }
    }

    private func handleStatusEvent(_ event: GatewayStatusEvent) {
        switch event.type {
        case "snapshot":
            guard let snapshot = snapshotForVisibleSession(event) else {
                updateActiveSessionIDs(from: event)
                return
            }
            guard acceptLiveEvent(runId: snapshot.runId, sequence: snapshot.sequence, timestamp: snapshot.timestamp) else { return }
            updateActiveSessionIDs(from: event)
            applyStatusSnapshot(snapshot)
        case "assistant_token":
            guard eventMatchesVisibleSession(event) else { return }
            guard let delta = event.delta, !delta.isEmpty else { return }
            guard acceptLiveEvent(runId: event.runId, sequence: event.sequence, timestamp: event.timestamp) else { return }
            updateActiveSessionIDs(from: event)
            streamingContent = (streamingContent ?? "") + delta
            if liveStartedAt == nil { liveStartedAt = Date() }
            liveStatus = "generating"
        case "status", nil:
            if eventMatchesVisibleSession(event) {
                guard acceptLiveEvent(runId: event.runId, sequence: event.sequence, timestamp: event.timestamp) else { return }
            }
            updateActiveSessionIDs(from: event)
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
            if firstNonEmptyGatewayString(event.detail)?.lowercased() == "steering to follow-up..." {
                liveStatus = "thinking"
                liveCurrentStep = "Steering to follow-up..."
                if let id = selectedSessionID {
                    Task { await loadMessages(id) }
                }
                return
            }
            if !sending {
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
           !nativeIsGenericStatusLabel(detail) {
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
                  !nativeIsGenericStatusLabel(detail),
                  detail.lowercased() != "queued follow-up" {
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

    private func acceptLiveEvent(runId: String?, sequence: Double?, timestamp: Double?) -> Bool {
        let decision = liveEventCursor.accept(runId: runId, sequence: sequence, timestamp: timestamp)
        if decision.runChanged {
            resetLiveTimeline(clearStartedAt: true)
            liveStartedAt = timestamp.map { Date(timeIntervalSince1970: $0 / 1000) } ?? Date()
            if let id = selectedSessionID {
                Task { await loadMessages(id) }
            }
        }
        return decision.accepted
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

private struct NativeEnvironmentUsageStat: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .medium, design: .rounded))
                .foregroundStyle(.tertiary)
                .lineLimit(1)
            Text(value)
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
    let mediaBaseURL: URL
    let mediaToken: String?
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

            let visibleActivities = (subagent.activities ?? []).filter {
                guard let text = firstNonEmptyGatewayString($0.text) else { return true }
                return !nativeIsGenericStatusLabel(text)
            }
            if !visibleActivities.isEmpty {
                nativeSubagentSection("Activity") {
                    VStack(alignment: .leading, spacing: 9) {
                        ForEach(visibleActivities) { activity in
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
                    NativeMarkdownView(
                        content: output,
                        isUser: false,
                        mediaBaseURL: mediaBaseURL,
                        mediaToken: mediaToken
                    )
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
    func pathKey(_ path: String) -> String {
        path.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\\", with: "/")
            .replacingOccurrences(of: "/+", with: "/", options: .regularExpression)
            .lowercased()
    }
    func matchingKey(_ path: String) -> String? {
        let candidate = pathKey(path)
        return files.keys.first { key in
            key == candidate || key.hasSuffix("/\(candidate)") || candidate.hasSuffix("/\(key)")
        }
    }
    func merge(_ item: NativeChatFileChangeItem) {
        let key = matchingKey(item.path) ?? pathKey(item.path)
        if let existing = files[key] {
            let kind = item.kind == "deleted" || existing.kind == "deleted"
                ? "deleted"
                : (item.kind == "updated" || existing.kind == "updated" ? "updated" : item.kind)
            let preferredPath = item.path.count >= existing.path.count ? item.path : existing.path
            let preferredKey = pathKey(preferredPath)
            files.removeValue(forKey: key)
            files[preferredKey] = NativeChatFileChangeItem(
                path: preferredPath,
                kind: kind,
                added: existing.added + item.added,
                removed: existing.removed + item.removed
            )
        } else {
            files[key] = item
        }
    }

    for tool in messages.flatMap({ $0.tool_calls ?? [] }) {
        let lowerName = tool.name.lowercased()
        let relevant = lowerName.contains("write") || lowerName.contains("edit") || lowerName.contains("patch")
        guard relevant else { continue }
        let paths = nativeToolFilePaths(tool)
        for path in paths {
            let resultObject = nativeJSONObject(tool.result)
            let changeObject = resultObject?["change"].flatMap { nativeJSONObject($0) }
            let diff = nativeJSONString(changeObject, key: "diff")
                ?? nativeJSONString(resultObject, key: "diff")
                ?? nativeJSONString(tool.args, key: "diff")
                ?? ""
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
            if let key = matchingKey(item.path), let existing = files[key], existing.added + existing.removed > 0 {
                continue
            }
            merge(item)
        }
    }
    for activity in liveActivities {
        if let item = nativeActivityFileChange(text: activity.text, phase: activity.phase.rawValue) {
            if let key = matchingKey(item.path), let existing = files[key], existing.added + existing.removed > 0 {
                continue
            }
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
    var seen: Set<String> = []
    let unique = paths.compactMap { rawPath -> String? in
        guard let path = firstNonEmptyGatewayString(rawPath) else { return nil }
        let key = path.replacingOccurrences(of: "\\", with: "/").lowercased()
        guard seen.insert(key).inserted else { return nil }
        return path
    }
    return unique.isEmpty ? ["\(tool.name) change"] : unique
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

extension View {
    @ViewBuilder
    func refreshableIfAvailable(_ action: @escaping @Sendable () async -> Void) -> some View {
        self.refreshable { await action() }
    }
}
