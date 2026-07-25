import AppKit
import SwiftUI
import UniformTypeIdentifiers

extension ChatScreen {
    var sortedPendingMessages: [GatewayPendingChatMessage] {
        pendingMessages
            .filter { !$0.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .sorted {
                if $0.sequence == $1.sequence { return $0.createdAt < $1.createdAt }
                return $0.sequence < $1.sequence
            }
    }

    var thinkingBubble: some View {
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

    var pendingQueueView: some View {
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

    @ViewBuilder
    func messageAuthorLabel(_ message: GatewaySessionMessage) -> some View {
        if transcriptHasMixedAgents, let label = nativeMessageAuthorLabel(message) {
            HStack(spacing: 3) {
                Image(systemName: "cpu")
                    .font(.system(size: 8.5))
                Text(label)
                    .font(.system(size: 10, design: .rounded))
            }
            .foregroundStyle(.secondary)
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .background(
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(Color.white.opacity(0.05))
            )
        }
    }

    func messageBubble(_ message: GatewaySessionMessage) -> some View {
        let isUser = message.role == "user"
        let visibleContent = NativeMarkdown.preprocess(message.content, stripAssistantMarkup: !isUser)
        return HStack {
            if isUser { Spacer(minLength: 60) }
            VStack(alignment: isUser ? .trailing : .leading, spacing: 4) {
                VStack(alignment: .leading, spacing: 7) {
                    if !isUser {
                        messageAuthorLabel(message)
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
    func agentTransferTimeline(_ transfers: [GatewayAgentTransfer]?) -> some View {
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

    func messageTimestampLabel(_ message: GatewaySessionMessage) -> String {
        guard let timestamp = message.timestamp else { return "" }
        let relative = relativeTimestamp(timestamp)
        let absolute = absoluteTimestamp(timestamp)
        if relative.isEmpty { return absolute }
        return absolute.isEmpty ? relative : "\(relative) · \(absolute)"
    }

    func pendingMessageMeta(_ message: GatewayPendingChatMessage) -> String {
        let mode = message.mode == "steering" ? "Steering" : "Queued"
        let date = Date(timeIntervalSince1970: message.createdAt / 1000)
        let relative = RelativeDateTimeFormatter()
        relative.unitsStyle = .short
        return "\(mode) - \(relative.localizedString(for: date, relativeTo: Date()))"
    }

    func formatNativeTokenCount(_ value: Int) -> String {
        if abs(value) >= 1_000_000 {
            return String(format: "%.1fM", Double(value) / 1_000_000)
        }
        if abs(value) >= 1_000 {
            return "\(Int((Double(value) / 1_000).rounded()))k"
        }
        return "\(max(0, value))"
    }

    func formatNativePercent(_ value: Double) -> String {
        String(format: value.rounded() == value ? "%.0f%%" : "%.1f%%", value)
    }

    func formatNativeDecimal(_ value: Double) -> String {
        String(format: value.rounded() == value ? "%.0f" : "%.1f", value)
    }

    func steerPending(_ message: GatewayPendingChatMessage) async {
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

    func updatePending(_ message: GatewayPendingChatMessage, content: String) async {
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

    func deletePending(_ message: GatewayPendingChatMessage) async {
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

    func movePending(_ message: GatewayPendingChatMessage, direction: Int) async {
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

    func performRevert(_ message: GatewaySessionMessage) {
        guard let sessionID = selectedSessionID else { return }
        Task {
            do {
                let response = try await client.revertSession(
                    sessionID,
                    messageContent: message.content,
                    messageTimestamp: message.timestamp
                )
                draft = response.revertedMessage?.content ?? message.content
                await loadMessages(sessionID)
            } catch {
                self.error = "Failed to revert: \(error.localizedDescription)"
            }
        }
    }

    func messageIndex(_ message: GatewaySessionMessage) -> Int? {
        messages.firstIndex { $0.id == message.id }
    }

    func performFork(_ message: GatewaySessionMessage) {
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

    func performSaveGolden(_ message: GatewaySessionMessage) {
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

}
