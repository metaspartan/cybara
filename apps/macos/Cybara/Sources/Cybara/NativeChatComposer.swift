import AppKit
import SwiftUI
import UniformTypeIdentifiers

extension ChatScreen {
    var composer: some View {
        composerContent
            .padding(14)
            .cybaraGlass(cornerRadius: 0)
    }

    var composerContent: some View {
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

    var composerControls: some View {
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

    func composerAgentPicker(compact: Bool) -> some View {
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

    var reasoningEffortPopover: some View {
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

    var composerSecurityControls: some View {
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
    var toolApprovalStatusIcon: some View {
        if approvalSaving {
            ProgressView().controlSize(.small)
        } else {
            Image(systemName: toolApprovalIconName)
                .font(.system(size: 11, weight: .semibold))
        }
    }

    var contextUsagePopover: some View {
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

    var chatWorkspacePanel: some View {
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

    var fileDiffsPopover: some View {
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

}
