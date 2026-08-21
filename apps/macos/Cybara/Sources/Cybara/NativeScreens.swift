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

func parseGatewayDate(_ iso: String?) -> Date? {
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
    @State var copied = false

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
                .help("Revert to before this message")
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
    @EnvironmentObject var sidecar: SidecarManager

    @State var health: GatewayHealth?
    @State var agents: [GatewayAgent] = []
    @State var providers: [GatewayProvider] = []
    @State var sessions: [GatewaySession] = []
    @State var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ScreenHeader(title: "Dashboard", subtitle: "Local gateway status and activity")

                CybaraGlassGroup(spacing: 14) {
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

    var uptimeLabel: String {
        guard let uptime = health?.uptime, uptime > 0 else { return "starting" }
        let minutes = Int(uptime) / 60
        if minutes < 60 { return "up \(minutes)m" }
        return "up \(minutes / 60)h \(minutes % 60)m"
    }

    func statTile(label: String, value: String, detail: String, systemImage: String) -> some View {
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

    func dashboardSessionDetail(for session: GatewaySession) -> String {
        let timestamp = relativeTimestamp(session.updated_at ?? session.created_at)
        var parts = [
            gatewaySessionRouteSummary(session, agents: agents, providers: providers),
            session.workspaceLabel.map { "Workspace \($0)" },
            "\(session.message_count ?? 0) messages",
        ].compactMap { $0 }
        if !timestamp.isEmpty { parts.append(timestamp) }
        return parts.joined(separator: " · ")
    }

    func load() async {
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

func nativeSessionUpdatedDate(_ session: GatewaySession) -> Date {
    parseGatewayDate(session.updated_at) ?? parseGatewayDate(session.created_at) ?? .distantPast
}

func nativeWorkspaceSectionLabel(_ path: String?) -> String {
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

let nativeModelRouterSelectorValue = "__model_router__"

func nativeMergeReloadedSessionMessages(
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
    @Environment(\.cybaraAccent) var accentTint
    @Environment(\.accessibilityReduceMotion) var systemReduceMotion

    @State var sessions: [GatewaySession] = []
    @State var activeTasks: [GatewayTask] = []
    @State var agents: [GatewayAgent] = []
    @State var providers: [GatewayProvider] = []
    @State var providerPlanStatus: ProviderPlanStatusResponse?
    @State var messages: [GatewaySessionMessage] = []
    @State var followsChatBottom = true
    @State var messagesBySessionID: [String: [GatewaySessionMessage]] = [:]
    @State var searchText = ""
    @State var draft = ""
    @State var sending = false
    @State var error: String?
    @State var pendingAttachments: [NativeAttachedImage] = []
    @State var pendingFiles: [NativeAttachedFile] = []
    @State var attachmentsByContent: [String: [NativeAttachedImage]] = [:]
    @State var renameTarget: GatewaySession?
    @State var renameDraft = ""
    @State var deleteTarget: GatewaySession?
    @State var pendingAgentID = ""
    @State var pendingAgentSessionID: String?
    @State var modelRouterEnabled = false
    @State var useModelRouter = false
    @State var pendingWorkspaceDir = ""
    @State var workspaceSaving = false
    @State var activeGitBranch: String?
    @State var activeGitBranches: [GatewayGitBranchSummary] = []
    @State var workspaceOpenTargets: [NativeWorkspaceOpenTarget] = []
    @State var workspaceOpenTargetsLoading = false
    @State var workspaceOpeningTargetID: String?
    @State var gitBranchSearch = ""
    @State var newGitBranchName = ""
    @State var gitBranchLoading = false
    @State var gitBranchError: String?
    @State var showGitBranchPicker = false
    @State var agentSaving = false
    @State var approvalSaving = false
    @State var toolApprovalMode = "always_allow"
    @State var followUpBehaviorEnabled = true
    @State var goldenTurnsEnabled = true
    @State var chatAppearance = NativeChatAppearanceSettings()
    @State var pendingApprovals: [GatewayPendingApproval] = []
    @State var sessionGoal: GatewaySessionGoal?
    @State var goalActionBusy = false
    @State var expandedApprovalID: String?
    @State var showContextPopover = false
    @State var showReasoningPopover = false
    @State var reasoningDraftIndex = 0.0
    @State var reasoningSaving = false
    @State var showEnvironmentPopover = false
    @State var environmentLSPStatus: NativeLSPStatus?
    @State var showNearbyShare = false
    @State var nearbyStatus: NativeNearbyStatus?
    @State var nearbyShareBusy = false
    @State var showWorkspacePanel = false
    @State var activeWorkspaceTab = NativeChatWorkspaceTab.review
    @State var subagents: [NativeSubagentSummary] = []
    @State var subagentsLoading = false
    @State var subagentsLoadingSessionID: String?
    @State var selectedSubagent: NativeSubagentSummary?
    @State var showSpawnSubagent = false
    @State var subagentTaskDraft = ""
    @State var subagentMutating = false
    @State var showClearSubagentHistoryConfirm = false
    @State var liveStatus = "idle"
    @State var revertCandidate: GatewaySessionMessage?
    @State var showRevertConfirm = false
    @State var liveActivities: [NativeToolActivity] = []
    @State var liveCurrentStep: String?
    @State var liveStartedAt: Date?
    @State var streamingContent: String?
    @State var liveEventCursor = NativeSessionEventCursor()
    @State var pendingMessages: [GatewayPendingChatMessage] = []
    @State var steeringPendingID: String?
    @State var pendingMutationID: String?
    @State var editingPendingMessage: GatewayPendingChatMessage?
    @State var editingPendingDraft = ""
    @State var collapsedSessionGroupIDs: Set<String> = []
    @State var hoveredSessionGroupID: String?
    @State var activeSessionIDs: Set<String> = []
    @AppStorage("cybara.chat.lastWorkspaceDir") var lastWorkspaceDir = ""
    @AppStorage("cybara.chat.pinnedWorkspaceGroupIds") var pinnedWorkspaceGroupIdsRaw = ""
    @StateObject var statusStream = GatewayStatusStream()

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
            async let goalLoad: Void = loadSessionGoal()
            _ = await (messagesLoad, statusLoad, goalLoad)
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
            if chatAppearance.reduceMotion || systemReduceMotion {
                transaction.animation = nil
            }
        }
        .alert("Revert to before this message?", isPresented: $showRevertConfirm) {
            Button("Revert", role: .destructive) {
                if let candidate = revertCandidate {
                    performRevert(candidate)
                }
                revertCandidate = nil
            }
            Button("Cancel", role: .cancel) { revertCandidate = nil }
        } message: {
            Text("This message and every message after it will be removed from the session.")
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

}
