import SwiftUI

struct ArtifactsScreen: View {
    let client: GatewayClient
    @State private var artifacts: [NativeArtifactSummary] = []
    @State private var selected: NativeArtifactSummary?
    @State private var content: NativeArtifactContent?
    @State private var query = ""
    @State private var loaded = false
    @State private var loadingContent = false
    @State private var error: String?

    private var filtered: [NativeArtifactSummary] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let sorted = artifacts.sorted { ($0.updatedAt ?? "") > ($1.updatedAt ?? "") }
        guard !trimmed.isEmpty else { return sorted }
        return sorted.filter {
            $0.displayTitle.lowercased().contains(trimmed)
                || $0.fileName.lowercased().contains(trimmed)
                || $0.sessionId.lowercased().contains(trimmed)
        }
    }

    var body: some View {
        NavigationSplitView {
            VStack(alignment: .leading, spacing: 12) {
                ScreenHeader(title: "Artifacts", subtitle: "\(artifacts.count) generated files")
                TextField("Search artifacts", text: $query)
                    .textFieldStyle(.roundedBorder)
                List(filtered, selection: $selected) { artifact in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(artifact.displayTitle)
                            .font(.system(size: 13, weight: .semibold, design: .rounded))
                            .lineLimit(1)
                        Text(artifact.fileName)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    .tag(artifact)
                }
            }
            .padding(18)
            .navigationSplitViewColumnWidth(min: 280, ideal: 320, max: 380)
        } detail: {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    ScreenHeader(
                        title: selected?.displayTitle ?? "Artifact Preview",
                        subtitle: selected?.path ?? "Select an artifact"
                    )
                    if let selected {
                        Button(role: .destructive) {
                            Task { await delete(selected) }
                        } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(.bordered)
                    }
                }

                if !loaded {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error {
                    LoadFailedView(message: error) { Task { await load() } }
                } else if loadingContent {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ScrollView {
                        Text(content?.content ?? "No artifact selected.")
                            .font(.system(size: 12, design: .monospaced))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(16)
                    }
                    .cybaraGlass(cornerRadius: 16)
                }
            }
            .padding(24)
        }
        .task { await load() }
        .onChange(of: selected) { _, artifact in
            Task { await loadContent(artifact) }
        }
    }

    private func load() async {
        do {
            artifacts = try await client.artifacts()
            if selected == nil {
                selected = filtered.first
            }
            error = nil
            await loadContent(selected)
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }

    private func loadContent(_ artifact: NativeArtifactSummary?) async {
        guard let artifact else {
            content = nil
            return
        }
        loadingContent = true
        do {
            content = try await client.readArtifact(artifact)
        } catch {
            self.error = error.localizedDescription
        }
        loadingContent = false
    }

    private func delete(_ artifact: NativeArtifactSummary) async {
        do {
            try await client.deleteArtifact(artifact)
            selected = nil
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
