import AppKit
import SwiftUI
import UniformTypeIdentifiers

extension ChatScreen {
    var transcript: some View {
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
    var chatContent: some View {
        if selectedSessionID == nil && messages.isEmpty {
            newChatSurface
        } else {
            transcript
        }
    }

    var newChatSurface: some View {
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

    var newChatWorkspaceBar: some View {
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
    var approvalBanner: some View {
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

    func approvalRow(_ req: GatewayPendingApproval) -> some View {
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

    func approvalButton(_ title: String, _ tint: Color, _ action: @escaping () -> Void) -> some View {
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

    func resolveApproval(_ requestId: String, _ decision: String) {
        pendingApprovals.removeAll { $0.id == requestId }
        Task {
            try? await client.resolveToolApproval(requestId, decision: decision)
        }
    }

    func pollApprovals() async {
        if let pending = try? await client.pendingToolApprovals() {
            pendingApprovals = pending
        }
    }

    var transcriptHeader: some View {
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

    var nearbySharePopover: some View {
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

    func loadNearbyShare() async {
        nearbyShareBusy = true
        nearbyStatus = try? await client.nearbyStatus()
        nearbyShareBusy = false
    }

    func sendNearby(_ peerID: String) async {
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
    var workspaceOpenMenu: some View {
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

    func workspaceOpenTargetSort(_ left: NativeWorkspaceOpenTarget, _ right: NativeWorkspaceOpenTarget) -> Bool {
        if left.id == "cybara_ide" { return true }
        if right.id == "cybara_ide" { return false }
        return left.label.localizedCaseInsensitiveCompare(right.label) == .orderedAscending
    }

    @ViewBuilder
    func workspaceOpenTargetLabel(_ target: NativeWorkspaceOpenTarget) -> some View {
        Label {
            Text(target.label)
        } icon: {
            NativeWorkspaceOpenTargetIcon(target: target)
        }
    }

    var sessionDetailLine: String {
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

    func sessionListTooltip(for session: GatewaySession) -> String {
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

}
