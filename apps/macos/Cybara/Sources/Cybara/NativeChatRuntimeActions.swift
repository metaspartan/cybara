import AppKit
import SwiftUI
import UniformTypeIdentifiers

extension ChatScreen {
    func loadSessions() async {
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

    func loadProviderPlanStatus() async -> ProviderPlanStatusResponse? {
        try? await client.providerPlanStatus()
    }

    func loadSubagents() async {
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

    func loadSubagentDetail(_ id: String) async {
        do {
            selectedSubagent = try await client.nativeSubagent(id)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func spawnSubagent() async {
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

    func clearSubagent(_ id: String) async {
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

    func clearSubagentHistory() async {
        guard let selectedSessionID else { return }
        do {
            try await client.clearNativeSubagentHistory(sessionID: selectedSessionID)
            selectedSubagent = nil
            await loadSubagents()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func stopSubagent(_ id: String) async {
        do {
            try await client.stopNativeSubagent(id)
            await loadSubagentDetail(id)
            await loadSubagents()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func loadChatConfig() async {
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

    func changeToolApprovalMode(_ nextMode: String) async {
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

    func changeReasoningEffort(_ nextEffort: String) async {
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

    func updateSessionList(with session: GatewaySession) {
        if let index = sessions.firstIndex(where: { $0.id == session.id }) {
            sessions[index] = session
        } else {
            sessions.insert(session, at: 0)
        }
    }

    func rename(_ session: GatewaySession, to title: String) async {
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

    func togglePin(_ session: GatewaySession) async {
        do {
            try await client.pinSession(session.id, pinned: session.pinned != true)
            await loadSessions()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func remove(_ session: GatewaySession) async {
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

    func startNewChat() {
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
    func chooseWorkspace(for session: GatewaySession?) async {
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
    func applyWorkspace(_ workspaceDir: String?, to session: GatewaySession?) async {
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

    func changeChatAgent(_ agentID: String) async {
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
    func attachFiles() {
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
    func ingestAttachment(url: URL) {
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
    func handleDroppedProviders(_ providers: [NSItemProvider]) {
        for provider in providers {
            _ = provider.loadObject(ofClass: URL.self) { url, _ in
                guard let url else { return }
                Task { @MainActor in self.ingestAttachment(url: url) }
            }
        }
    }

    @MainActor
    func handlePaste() {
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

}
