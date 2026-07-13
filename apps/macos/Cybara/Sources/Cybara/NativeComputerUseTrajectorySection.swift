import AppKit
import SwiftUI

struct NativeComputerUseTrajectorySection: View {
    let client: GatewayClient
    @Binding var message: String?

    @Environment(\.cybaraAccent) private var accentTint
    @State private var response: GatewayComputerUseTrajectoriesResponse?
    @State private var busyID: String?
    @State private var replayCandidate: GatewayComputerUseTrajectorySummary?

    private var trajectories: [GatewayComputerUseTrajectorySummary] {
        response?.trajectories ?? []
    }

    private var actions: Int {
        trajectories.reduce(0) { $0 + $1.turnCount }
    }

    private var frames: Int {
        trajectories.reduce(0) { $0 + $1.screenshotCount }
    }

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: "cursorarrow.motionlines")
                        .foregroundStyle(accentTint)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Computer-use trajectories")
                            .font(.system(size: 14, weight: .semibold, design: .rounded))
                        Text("Capture desktop actions, UI state, screenshots, and optional video for replay and multimodal datasets.")
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 12)
                    if let settings = response?.settings {
                        Toggle("Capture", isOn: Binding(
                            get: { settings.trajectoryCaptureEnabled },
                            set: { value in Task { await configure(capture: value, video: nil) } }
                        ))
                        .toggleStyle(.switch)
                        Toggle("Video", isOn: Binding(
                            get: { settings.trajectoryVideoEnabled },
                            set: { value in Task { await configure(capture: nil, video: value) } }
                        ))
                        .toggleStyle(.switch)
                        .disabled(!settings.trajectoryCaptureEnabled)
                    }
                }
                HStack(spacing: 18) {
                    metric("Runs", trajectories.count)
                    metric("Actions", actions)
                    metric("Frames", frames)
                    Spacer()
                    Button { Task { await export() } } label: {
                        Label("Export", systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(.bordered)
                    .disabled(trajectories.isEmpty || busyID != nil)
                }
                Divider()
                if response == nil {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text("Loading desktop runs")
                            .foregroundStyle(.secondary)
                    }
                    .font(.system(size: 11, design: .rounded))
                } else if trajectories.isEmpty {
                    Text("No captured desktop runs. Enable capture, then let an agent use computer controls in a chat.")
                        .font(.system(size: 11, design: .rounded))
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(trajectories.prefix(12)) { trajectory in
                        trajectoryRow(trajectory)
                    }
                }
            }
        }
        .task { await load() }
        .confirmationDialog(
            "Replay desktop actions?",
            isPresented: Binding(
                get: { replayCandidate != nil },
                set: { if !$0 { replayCandidate = nil } }
            ),
            titleVisibility: .visible
        ) {
            if let candidate = replayCandidate {
                Button("Replay clicks and keystrokes", role: .destructive) {
                    Task { await replay(candidate) }
                }
            }
            Button("Cancel", role: .cancel) { replayCandidate = nil }
        } message: {
            Text("Replay operates the current desktop. Put the target apps in the same state as the recorded run first.")
        }
    }

    private func metric(_ title: String, _ value: Int) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value.formatted())
                .font(.system(size: 15, weight: .semibold, design: .rounded))
            Text(title)
                .font(.system(size: 9, design: .rounded))
                .foregroundStyle(.secondary)
        }
    }

    private func trajectoryRow(_ trajectory: GatewayComputerUseTrajectorySummary) -> some View {
        HStack(spacing: 10) {
            Image(systemName: trajectory.status == "recording" ? "record.circle" : "cursorarrow.click.2")
                .foregroundStyle(trajectory.status == "recording" ? Color.red : accentTint)
            VStack(alignment: .leading, spacing: 2) {
                Text(trajectory.replayOf == nil ? "Desktop run" : "Replay")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                Text("\(trajectory.turnCount) actions · \(trajectory.screenshotCount) frames · \(duration(trajectory.durationMs))")
                    .font(.system(size: 10, design: .rounded))
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text(trajectory.status.capitalized)
                .font(.system(size: 9, weight: .medium, design: .rounded))
                .foregroundStyle(.secondary)
            Button {
                replayCandidate = trajectory
            } label: {
                Image(systemName: busyID == trajectory.id ? "hourglass" : "play.fill")
            }
            .buttonStyle(.borderless)
            .help("Replay trajectory")
            .disabled(busyID != nil || trajectory.status == "recording" || trajectory.turnCount == 0)
            Button(role: .destructive) {
                Task { await delete(trajectory) }
            } label: {
                Image(systemName: "trash")
            }
            .buttonStyle(.borderless)
            .help("Delete trajectory")
            .disabled(busyID != nil)
        }
        .padding(.vertical, 2)
    }

    private func duration(_ milliseconds: Int) -> String {
        if milliseconds < 1_000 { return "\(milliseconds) ms" }
        if milliseconds < 60_000 { return "\(milliseconds / 1_000) sec" }
        return "\(milliseconds / 60_000) min"
    }

    @MainActor
    private func load() async {
        do {
            response = try await client.computerUseTrajectories()
        } catch {
            message = error.localizedDescription
        }
    }

    @MainActor
    private func configure(capture: Bool?, video: Bool?) async {
        busyID = "config"
        defer { busyID = nil }
        do {
            try await client.configureComputerUseTrajectories(capture: capture, video: video)
            await load()
        } catch {
            message = error.localizedDescription
        }
    }

    @MainActor
    private func replay(_ trajectory: GatewayComputerUseTrajectorySummary) async {
        replayCandidate = nil
        busyID = trajectory.id
        defer { busyID = nil }
        do {
            let replay = try await client.replayComputerUseTrajectory(trajectory.id)
            message = replay.result ?? "Replay completed"
            await load()
        } catch {
            message = error.localizedDescription
        }
    }

    @MainActor
    private func delete(_ trajectory: GatewayComputerUseTrajectorySummary) async {
        busyID = trajectory.id
        defer { busyID = nil }
        do {
            try await client.deleteComputerUseTrajectory(trajectory.id)
            await load()
        } catch {
            message = error.localizedDescription
        }
    }

    @MainActor
    private func export() async {
        busyID = "export"
        defer { busyID = nil }
        do {
            let exported = try await client.exportComputerUseTrajectories()
            let panel = NSSavePanel()
            panel.nameFieldStringValue = exported.filename
            if panel.runModal() == .OK, let url = panel.url {
                try exported.content.write(to: url, atomically: true, encoding: .utf8)
                message = "Exported \(exported.count) desktop runs"
            }
        } catch {
            message = error.localizedDescription
        }
    }
}
