import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct NativeEvalsScreen: View {
    let client: GatewayClient

    @Environment(\.cybaraAccent) private var accentTint
    @State private var goldens: [GatewayEvalGolden] = []
    @State private var runs: [GatewayEvalRun] = []
    @State private var researchStats: GatewayResearchStats?
    @State private var loading = true
    @State private var busyID: String?
    @State private var message: String?

    private var latestRuns: [String: GatewayEvalRun] {
        var output: [String: GatewayEvalRun] = [:]
        for run in runs where output[run.goldenId] == nil {
            output[run.goldenId] = run
        }
        return output
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ScreenHeader(title: "Lab", subtitle: "Curate agent data and replay known-good behavior")
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                metric("Captured Traces", value: researchStats?.total ?? 0, icon: "cylinder.split.1x2")
                metric("Tool Calls", value: researchStats?.toolCalls ?? 0, icon: "wrench.and.screwdriver")
                metric("Reasoning", value: researchStats?.reasoningTraces ?? 0, icon: "brain")
                metric("Clean Traces", value: researchStats?.cleanTraces ?? 0, icon: "checkmark.seal")
            }
            HStack(spacing: 8) {
                Button { Task { await runSuite() } } label: {
                    Label("Run Suite", systemImage: "play.fill")
                }
                .buttonStyle(.borderedProminent)
                .tint(accentTint)
                .disabled(goldens.isEmpty || busyID != nil)
                Menu {
                    Button("Conversational SFT JSONL") { Task { await exportResearch(format: "trl_sft") } }
                    Button("Long-Context JSONL") { Task { await exportResearch(format: "long_context") } }
                    Button("Suite Backup") { Task { await export(format: "bundle", sanitize: false) } }
                    Button("Redacted Trajectory JSONL") { Task { await export(format: "jsonl", sanitize: true) } }
                    Button("Full Trajectory JSONL") { Task { await export(format: "jsonl", sanitize: false) } }
                } label: {
                    Label("Export", systemImage: "square.and.arrow.up")
                }
                .disabled(goldens.isEmpty || busyID != nil)
                Button { Task { await importSuite() } } label: {
                    Label("Import", systemImage: "square.and.arrow.down")
                }
                .disabled(busyID != nil)
                Spacer()
                if let message {
                    Text(message)
                        .font(.system(size: 11, design: .rounded))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            if loading {
                VStack(spacing: 10) {
                    ProgressView()
                    Text("Loading evals")
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        NativeComputerUseTrajectorySection(client: client, message: $message)
                        if goldens.isEmpty {
                            ContentUnavailableView(
                                "No golden tests",
                                systemImage: "flask",
                                description: Text("Save a completed assistant turn from Chat to create one.")
                            )
                            .frame(maxWidth: .infinity, minHeight: 180)
                        } else {
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 320), spacing: 12)], spacing: 12) {
                                ForEach(goldens) { golden in
                                    goldenCard(golden)
                                }
                            }
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        }
        .padding(24)
        .task { await load() }
    }

    private func goldenCard(_ golden: GatewayEvalGolden) -> some View {
        let run = latestRuns[golden.id]
        return GlassCard {
            VStack(alignment: .leading, spacing: 11) {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "flask")
                        .foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(golden.name)
                            .font(.system(size: 14, weight: .semibold, design: .rounded))
                            .lineLimit(1)
                        Text(golden.baseline.request.userMessage.content)
                            .font(.system(size: 12, design: .rounded))
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                    Spacer(minLength: 8)
                    if let run {
                        Image(systemName: run.status == "passed" ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                            .foregroundStyle(run.status == "passed" ? Color.green : Color.orange)
                    }
                }
                HStack(spacing: 6) {
                    Text(golden.baseline.model ?? "Current model")
                    Text("·")
                    Text("\(golden.baseline.structure.tools.count) tools")
                    if let score = run?.score {
                        Text("·")
                        Text("\(Int(score.rounded()))% match")
                    }
                    Spacer()
                    Button { Task { await replay(golden) } } label: {
                        if busyID == golden.id {
                            ProgressView().controlSize(.small)
                        } else {
                            Image(systemName: "play.fill")
                        }
                    }
                    .buttonStyle(.borderless)
                    .help("Replay golden test")
                    .disabled(busyID != nil)
                    Button(role: .destructive) { Task { await delete(golden) } } label: {
                        Image(systemName: "trash")
                    }
                    .buttonStyle(.borderless)
                    .help("Delete golden test")
                    .disabled(busyID != nil)
                }
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(.secondary)
                if let error = run?.error, !error.isEmpty {
                    Text(error)
                        .font(.system(size: 11, design: .rounded))
                        .foregroundStyle(.orange)
                        .lineLimit(2)
                }
            }
        }
    }

    private func metric(_ title: String, value: Int, icon: String) -> some View {
        GlassCard {
            HStack(spacing: 9) {
                Image(systemName: icon)
                    .foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 1) {
                    Text(value.formatted())
                        .font(.system(size: 18, weight: .semibold, design: .rounded))
                    Text(title)
                        .font(.system(size: 10, design: .rounded))
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity)
    }

    @MainActor
    private func load() async {
        do {
            async let evals = client.evals()
            async let research = client.researchTraces()
            let (response, researchResponse) = try await (evals, research)
            goldens = response.goldens
            runs = response.runs
            researchStats = researchResponse.stats
        } catch {
            message = error.localizedDescription
        }
        loading = false
    }

    @MainActor
    private func replay(_ golden: GatewayEvalGolden) async {
        busyID = golden.id
        defer { busyID = nil }
        do {
            let response = try await client.replayEval(golden.id)
            if !response.success { throw evalError(response.error ?? "Replay failed") }
            message = "Replay completed"
            await load()
        } catch {
            message = error.localizedDescription
        }
    }

    @MainActor
    private func runSuite() async {
        busyID = "suite"
        defer { busyID = nil }
        do {
            try await client.runEvalSuite()
            message = "Suite completed"
            await load()
        } catch {
            message = error.localizedDescription
        }
    }

    @MainActor
    private func delete(_ golden: GatewayEvalGolden) async {
        busyID = golden.id
        defer { busyID = nil }
        do {
            try await client.deleteEval(golden.id)
            message = "Golden test deleted"
            await load()
        } catch {
            message = error.localizedDescription
        }
    }

    @MainActor
    private func export(format: String, sanitize: Bool) async {
        busyID = "export"
        defer { busyID = nil }
        do {
            let response = try await client.exportEvals(format: format, sanitize: sanitize)
            let panel = NSSavePanel()
            panel.nameFieldStringValue = response.filename
            if panel.runModal() == .OK, let url = panel.url {
                try response.content.write(to: url, atomically: true, encoding: .utf8)
                message = "Exported \(response.count) golden tests"
            }
        } catch {
            message = error.localizedDescription
        }
    }

    @MainActor
    private func exportResearch(format: String) async {
        busyID = "research-export"
        defer { busyID = nil }
        do {
            let response = try await client.exportResearch(format: format)
            let panel = NSSavePanel()
            panel.nameFieldStringValue = response.filename
            if panel.runModal() == .OK, let url = panel.url {
                try response.content.write(to: url, atomically: true, encoding: .utf8)
                message = "Exported \(response.count) traces"
            }
        } catch {
            message = error.localizedDescription
        }
    }

    @MainActor
    private func importSuite() async {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.json]
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        busyID = "import"
        defer { busyID = nil }
        do {
            let response = try await client.importEvals(Data(contentsOf: url))
            if !response.success { throw evalError(response.error ?? "Import failed") }
            message = "Imported \(response.count) golden tests"
            await load()
        } catch {
            message = error.localizedDescription
        }
    }

    private func evalError(_ message: String) -> NSError {
        NSError(domain: "Cybara.Evals", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
