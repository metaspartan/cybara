import AppKit
import SwiftUI
import UniformTypeIdentifiers

extension ChatScreen {
    var renameAlertBinding: Binding<Bool> {
        Binding(
            get: { renameTarget != nil },
            set: { if !$0 { renameTarget = nil } }
        )
    }

    var deleteDialogBinding: Binding<Bool> {
        Binding(
            get: { deleteTarget != nil },
            set: { if !$0 { deleteTarget = nil } }
        )
    }

    var activeSession: GatewaySession? {
        guard let selectedSessionID else { return nil }
        return sessions.first { $0.id == selectedSessionID }
    }

    var filteredSessions: [GatewaySession] {
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

    var groupedSessions: [NativeSessionGroup] {
        nativeSessionGroups(filteredSessions, pinnedWorkspaceGroupIDs: pinnedWorkspaceGroupIDs)
    }

    var filteredActiveTasks: [GatewayTask] {
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

    var hasPinnedSessionGroup: Bool {
        groupedSessions.contains { $0.kind == .pinned }
    }

    var pinnedWorkspaceGroupIDs: Set<String> {
        Set(pinnedWorkspaceGroupIdsRaw.split(separator: "\n").map(String.init))
    }

    var sessionList: some View {
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
    var activeTaskSidebarSection: some View {
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

    func toggleSessionGroup(_ groupID: String) {
        if collapsedSessionGroupIDs.contains(groupID) {
            collapsedSessionGroupIDs.remove(groupID)
        } else {
            collapsedSessionGroupIDs.insert(groupID)
        }
    }

    func toggleWorkspaceProjectPin(_ groupID: String) {
        var next = pinnedWorkspaceGroupIDs
        if next.contains(groupID) {
            next.remove(groupID)
        } else {
            next.insert(groupID)
        }
        pinnedWorkspaceGroupIdsRaw = next.sorted().joined(separator: "\n")
    }

    func revealWorkspaceProject(_ workspaceDir: String) {
        NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: workspaceDir)
    }

    func sessionListRow(for session: GatewaySession) -> some View {
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

}
