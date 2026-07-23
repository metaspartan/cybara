import AppKit
import SwiftUI
import UniformTypeIdentifiers

extension ChatScreen {
    func composerAttachmentChip(_ attachment: NativeAttachedImage) -> some View {
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

    func composerFileChip(_ file: NativeAttachedFile) -> some View {
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
    func presentWorkspacePanel(defaultPath: String?) -> String? {
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

    func loadMessages(_ id: String) async {
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
            useModelRouter = detail.use_model_router == true
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

    func loadActiveGitBranch() async {
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

    func loadWorkspaceOpenTargets() async {
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

    func openWorkspaceTarget(_ target: NativeWorkspaceOpenTarget, workspace: String) {
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

    func changeGitBranch(_ branch: String, create: Bool = false) async {
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

    func hydrateStatus(_ id: String) async {
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

    func send() async {
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

    func stopResponse() async {
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

    func handleStatusEvent(_ event: GatewayStatusEvent) {
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

    func updateActiveSessionIDs(from event: GatewayStatusEvent) {
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

    func applyStatusEvent(_ event: GatewayStatusEvent) {
        guard eventMatchesVisibleSession(event) else { return }
        let status = event.status?.lowercased() ?? ""
        guard !status.isEmpty else { return }

        let queuedTurnHandoff = event.pendingChatId != nil || firstNonEmptyGatewayString(event.detail)?.lowercased() == "starting queued follow-up"
        if queuedTurnHandoff, let id = selectedSessionID {
            Task { await loadMessages(id) }
        }

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

    func applyStatusSnapshot(_ snapshot: GatewaySessionStatusSnapshot) {
        guard !snapshot.sessionId.isEmpty else { return }
        if selectedSessionID != nil && snapshot.sessionId != selectedSessionID { return }
        pendingMessages = snapshot.pendingMessages
        liveStatus = snapshot.status ?? liveStatus
        if liveStartedAt == nil { liveStartedAt = Date() }
        let snapshotActivities = nativeLiveActivities(from: snapshot)
        let preservingLocalLiveActivities = snapshotActivities.isEmpty && !liveActivities.isEmpty
        if !snapshotActivities.isEmpty {
            liveActivities = nativeMergeLiveActivities(liveActivities, incoming: snapshotActivities)
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

    func eventMatchesVisibleSession(_ event: GatewayStatusEvent) -> Bool {
        guard let eventSessionID = firstNonEmptyGatewayString(event.sessionId) else {
            return selectedSessionID != nil || sending
        }
        if let selectedSessionID {
            return eventSessionID == selectedSessionID
        }
        return sending
    }

    func snapshotForVisibleSession(_ event: GatewayStatusEvent) -> GatewaySessionStatusSnapshot? {
        if let selectedSessionID {
            return event.activeSessions.first { $0.sessionId == selectedSessionID }
        }
        return sending ? event.activeSessions.first : nil
    }

    func resetLiveTimeline(clearStartedAt: Bool) {
        liveStatus = "idle"
        liveCurrentStep = nil
        liveActivities = []
        streamingContent = nil
        if clearStartedAt {
            liveStartedAt = nil
        }
    }

    func acceptLiveEvent(runId: String?, sequence: Double?, timestamp: Double?) -> Bool {
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
