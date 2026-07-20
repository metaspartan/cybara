import AppKit
import SwiftUI
import UniformTypeIdentifiers

extension ChatScreen {
    func routeSummary(for session: GatewaySession) -> String {
        gatewaySessionRouteSummary(session, agents: agents, providers: providers)
    }

    var visibleMessages: [GatewaySessionMessage] {
        messages.filter { $0.role == "user" || $0.role == "assistant" }
    }

    var activeWorkspaceDir: String? {
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

    var activeWorkspaceLabel: String? {
        gatewayWorkspaceLabel(activeWorkspaceDir, maxLength: 42)
    }

    var activeGitBranchLabel: String? {
        firstNonEmptyGatewayString(activeGitBranch)
    }

    var selectedConcreteChatAgentID: String {
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

    var selectedChatAgentID: String {
        useModelRouter ? nativeModelRouterSelectorValue : selectedConcreteChatAgentID
    }

    var selectedChatAgent: GatewayAgent? {
        agents.first { $0.id == selectedConcreteChatAgentID }
    }

    var activeAgentRouteLabel: String {
        if useModelRouter { return "Model Router" }
        guard let selectedChatAgent else { return "Gateway default" }
        return nativeChatAgentLabel(
            name: selectedChatAgent.name,
            model: selectedChatAgent.model,
            compact: false
        )
    }

    var activeReasoningEffort: String {
        selectedChatAgent?.reasoningEffort ?? ""
    }

    var activeReasoningEffortLabel: String {
        guard let selectedChatAgent else { return "Default" }
        return nativeReasoningLabel(effort: activeReasoningEffort, agent: selectedChatAgent)
    }

    var composerReasoningEfforts: [(value: String, label: String)] {
        guard let selectedChatAgent else { return nativeReasoningEfforts }
        return nativeSupportedReasoningEfforts(agent: selectedChatAgent)
    }

    var agentSelectionBinding: Binding<String> {
        Binding(
            get: { selectedChatAgentID },
            set: { nextValue in
                Task { await changeChatAgent(nextValue) }
            }
        )
    }

    var activeContextUsage: GatewaySessionContextUsage? {
        activeSession?.contextUsage
    }

    var activeTokenUsage: GatewaySessionTokenUsage? {
        activeSession?.tokenUsage
    }

    var contextUsageText: String {
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

    var activeProviderPlan: ProviderPlanSnapshot? {
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

    var providerPlanText: String? {
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

    var providerPlanUsageRows: [NativeContextProviderPlanUsageRow] {
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

    var activeFileChanges: NativeChatFileChangeSummary {
        summarizeNativeChatFileChanges(messages, liveActivities: liveActivities)
    }

    var environmentToolNames: [String] {
        let names = messages
            .flatMap { $0.tool_calls ?? [] }
            .map(\.name)
            .compactMap { firstNonEmptyGatewayString($0) }
        return Array(Set(names)).sorted()
    }

    var currentSessionPlan: NativeSessionPlanSnapshot? {
        extractNativeSessionPlan(from: messages, sessionID: selectedSessionID)
    }

    var environmentSubagents: [NativeSubagentSummary] {
        subagents
    }

    var agentUsingBrowser: Bool {
        nativeAgentUsingBrowser(
            liveActivities,
            sessionActive: selectedSessionID.map(activeSessionIDs.contains) ?? false
        )
    }

    var hasEnvironmentSignal: Bool {
        activeFileChanges.files.isEmpty == false ||
            activeWorkspaceDir != nil ||
            activeGitBranchLabel != nil ||
            currentSessionPlan != nil ||
            providerPlanUsageRows.isEmpty == false ||
            environmentSubagents.isEmpty == false ||
            environmentToolNames.isEmpty == false
    }

    func nativeProviderPlanResetText(_ resetsAt: String?) -> String? {
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

    var workspaceHelpText: String {
        if let activeWorkspaceDir {
            return "Switch workspace: \(activeWorkspaceDir)"
        }
        return "Select workspace folder for this chat"
    }

    var filteredGitBranches: [GatewayGitBranchSummary] {
        let query = gitBranchSearch.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if query.isEmpty { return activeGitBranches }
        return activeGitBranches.filter { $0.name.lowercased().contains(query) }
    }

    var gitBranchPicker: some View {
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

    var showWorkingTimeline: Bool {
        sending || selectedSessionID.map { activeSessionIDs.contains($0) } == true
    }

}
