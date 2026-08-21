import AppKit
import SwiftUI

extension ChatScreen {
    @ViewBuilder
    var goalPanel: some View {
        if let goal = sessionGoal {
            HStack(spacing: 10) {
                Image(systemName: "target")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(goalStatusColor(goal.status))

                Text(goal.objective)
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .help(goal.objective)

                goalStatusChip(goal)

                if let iterations = goal.loop?.iterations, iterations > 0 {
                    Text("It \(iterations)")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .help("Autonomous iterations started in the current loop run")
                }

                if goalLoopAtCheckpoint(goal) {
                    Text("Checkpoint")
                        .font(.system(size: 10, weight: .semibold, design: .rounded))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(Color.orange.opacity(0.16)))
                        .foregroundStyle(.orange)
                        .help("The loop paused for a checkpoint; press Resume to keep working")
                }

                if let note = goal.lastStatusNote, !note.isEmpty {
                    Text(note)
                        .font(.system(size: 11, design: .rounded))
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .foregroundStyle(.secondary)
                        .help(note)
                }

                Spacer(minLength: 0)

                HStack(spacing: 6) {
                    if goal.status == "active" {
                        goalActionButton(
                            title: "Pause",
                            systemImage: "pause.fill",
                            tint: .secondary,
                            help: "Pause the goal loop"
                        ) {
                            await mutateGoal("pause", note: nil)
                        }
                    } else if goal.status != "complete" {
                        goalActionButton(
                            title: "Resume",
                            systemImage: "play.fill",
                            tint: .green,
                            help: "Resume the goal loop"
                        ) {
                            await mutateGoal("resume", note: nil)
                        }
                    }
                    if goal.status != "complete" {
                        goalActionButton(
                            title: "Complete",
                            systemImage: "checkmark",
                            tint: .secondary,
                            help: "Mark the goal complete"
                        ) {
                            await mutateGoal("complete", note: nil)
                        }
                    }
                    goalActionButton(
                        title: "Clear",
                        systemImage: "xmark",
                        tint: .red,
                        help: "Clear the goal"
                    ) {
                        await mutateGoal("clear", note: nil)
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color.white.opacity(0.045))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Color.white.opacity(0.08), lineWidth: 1)
            )
            .padding(.horizontal, 14)
            .padding(.top, 6)
            .padding(.bottom, 4)
        }
    }

    @ViewBuilder
    private func goalStatusChip(_ goal: GatewaySessionGoal) -> some View {
        let label = goalStatusLabel(goal.status)
        let color = goalStatusColor(goal.status)
        HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)
                .opacity(goal.status == "active" ? 0.9 : 0.7)
            Text(label)
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .foregroundStyle(color)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 2)
        .background(Capsule().fill(color.opacity(0.12)))
    }

    private func goalStatusLabel(_ status: String) -> String {
        switch status {
        case "active": return "Working"
        case "paused": return "Paused"
        case "blocked": return "Blocked"
        case "complete": return "Complete"
        default: return status.capitalized
        }
    }

    private func goalStatusColor(_ status: String) -> Color {
        switch status {
        case "active": return .green
        case "paused": return .orange
        case "blocked": return .red
        case "complete": return .blue
        default: return .secondary
        }
    }

    private func goalLoopAtCheckpoint(_ goal: GatewaySessionGoal) -> Bool {
        guard let reason = goal.loop?.stoppedReason else { return false }
        return ["max_iterations", "max_duration", "error"].contains(reason)
    }

    private func goalActionButton(
        title: String,
        systemImage: String,
        tint: Color,
        help: String,
        action: @escaping () async -> Void
    ) -> some View {
        Button {
            Task { await action() }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: systemImage)
                    .font(.system(size: 9, weight: .semibold))
                Text(title)
                    .font(.system(size: 11, weight: .medium, design: .rounded))
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
        }
        .buttonStyle(.plain)
        .disabled(goalActionBusy)
        .opacity(goalActionBusy ? 0.5 : 1)
        .foregroundStyle(tint)
        .background(
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .fill(tint.opacity(0.1))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .stroke(tint.opacity(0.22), lineWidth: 1)
        )
        .help(help)
    }

    func loadSessionGoal() async {
        guard let sessionID = selectedSessionID else {
            sessionGoal = nil
            return
        }
        do {
            let response = try await client.getSessionGoal(sessionID)
            sessionGoal = response.success ? response.goal : nil
        } catch {
            sessionGoal = nil
        }
    }

    func mutateGoal(_ action: String, note: String?) async {
        guard let sessionID = selectedSessionID, !goalActionBusy else { return }
        goalActionBusy = true
        defer { goalActionBusy = false }
        do {
            let response = try await client.updateSessionGoalStatus(sessionID, action: action, note: note)
            if response.success {
                sessionGoal = response.goal
            } else {
                self.error = response.error ?? "Failed to update goal"
            }
        } catch {
            self.error = "Failed to update goal: \(error.localizedDescription)"
        }
    }

    func startGoal(_ objective: String) async {
        guard let sessionID = selectedSessionID, !goalActionBusy else { return }
        let trimmed = objective.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        goalActionBusy = true
        defer { goalActionBusy = false }
        do {
            let response = try await client.setSessionGoal(sessionID, objective: trimmed)
            if response.success {
                sessionGoal = response.goal
            } else {
                self.error = response.error ?? "Failed to set goal"
            }
        } catch {
            self.error = "Failed to set goal: \(error.localizedDescription)"
        }
    }
}
