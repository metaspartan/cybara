import AppKit
import SwiftUI
import UniformTypeIdentifiers

extension ChatScreen {
    var environmentPopover: some View {
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

    var subagentsPopover: some View {
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

    var contextColor: Color {
        let percent = activeContextUsage?.usedPercent ?? 0
        if percent >= 90 { return .red }
        if percent >= 70 { return .orange }
        return .green
    }

    var contextUsageProgress: Double {
        min(1, max(0, (activeContextUsage?.usedPercent ?? 0) / 100))
    }

    var environmentUsageColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: 10, alignment: .leading), count: 3)
    }

    var environmentInputTokens: String {
        guard let usage = activeTokenUsage, usage.totalTokens > 0 else { return "—" }
        return formatNativeTokenCount(usage.inputTokens)
    }

    var environmentOutputTokens: String {
        guard let usage = activeTokenUsage, usage.totalTokens > 0 else { return "—" }
        return formatNativeTokenCount(usage.outputTokens)
    }

    var environmentModelCalls: String {
        guard let usage = activeTokenUsage, usage.totalTokens > 0 else { return "—" }
        return formatNativeTokenCount(usage.callCount)
    }

    var environmentOutputSpeed: String {
        guard let speed = activeTokenUsage?.tokensPerSecond else { return "—" }
        return "\(formatNativeDecimal(speed)) tok/s"
    }

    var environmentFirstToken: String {
        guard let milliseconds = activeTokenUsage?.firstTokenMs, milliseconds >= 0 else { return "—" }
        if milliseconds < 1_000 { return "\(Int(milliseconds.rounded()))ms" }
        return String(format: milliseconds < 10_000 ? "%.2fs" : "%.1fs", milliseconds / 1_000)
    }

    var environmentCacheRead: String {
        guard let usage = activeTokenUsage, usage.totalTokens > 0 else { return "—" }
        let tokens = formatNativeTokenCount(usage.cachedInputTokens)
        guard let hitRate = usage.cacheHitRate else { return tokens }
        return "\(tokens) · \(formatNativePercent(hitRate))"
    }

    var environmentCacheWrite: String {
        guard let usage = activeTokenUsage, usage.totalTokens > 0 else { return "—" }
        return formatNativeTokenCount(usage.cacheWriteTokens)
    }

    var environmentCompaction: String {
        guard activeContextUsage?.compacted == true else { return "Never" }
        let count = activeContextUsage?.compactionCount ?? 0
        let tokens = activeContextUsage?.compactedTokens ?? 0
        return tokens > 0 ? "\(count)x · \(formatNativeTokenCount(tokens))" : "\(count)x"
    }

    var toolApprovalLabel: String {
        toolApprovalMode == "ask" ? "Ask Me" : "Always Allow"
    }

    var toolApprovalIconName: String {
        toolApprovalMode == "ask" ? "questionmark.circle" : "exclamationmark.shield"
    }

    var toolApprovalColor: Color {
        toolApprovalMode == "ask" ? .blue : .orange
    }

}
