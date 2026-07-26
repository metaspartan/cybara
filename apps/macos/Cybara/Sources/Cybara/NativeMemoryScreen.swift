import SwiftUI

struct MemoryScreen: View {
    let client: GatewayClient
    @Environment(\.cybaraAccent) private var accentTint

    @State private var files: [String] = []
    @State private var memories: [GatewayMemoryFile] = []
    @State private var searchText = ""
    @State private var searchResults: [GatewayMemorySearchResult] = []
    @State private var searchPerformed = false
    @State private var newFile = ""
    @State private var newContent = ""
    @State private var loaded = false
    @State private var saving = false
    @State private var error: String?
    @State private var editingEntry: MemoryEditDraft?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .top, spacing: 12) {
                    ScreenHeader(title: "Memory", subtitle: "Persistent memory files on the gateway")
                    Spacer()
                    Button {
                        Task { await load() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(.borderless)
                    .help("Refresh memory")
                }

                if !loaded {
                    ProgressView().frame(maxWidth: .infinity)
                } else if let error {
                    LoadFailedView(message: error) { Task { await load() } }
                } else {
                    createMemoryCard
                    searchCard
                    memoryList
                }

                if saving { ProgressView().controlSize(.small) }
            }
            .padding(24)
        }
        .task { await load() }
        .sheet(item: $editingEntry) { draft in
            MemoryEditSheet(draft: draft) { updatedContent in
                _ = try await client.updateMemory(file: draft.file, index: draft.index, content: updatedContent)
                editingEntry = nil
                await load()
            }
        }
    }

    private var createMemoryCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                Label("Add Memory", systemImage: "plus.circle")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                TextField("File name, e.g. project.md", text: $newFile)
                    .textFieldStyle(.roundedBorder)
                TextEditor(text: $newContent)
                    .font(.system(size: 12, design: .rounded))
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 72)
                    .padding(8)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(Color.white.opacity(0.06))
                    )
                HStack {
                    Spacer()
                    Button(saving ? "Saving..." : "Add Entry") {
                        Task { await createMemory() }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(saving || newFile.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        || newContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }

    private var searchCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    TextField("Search memory", text: $searchText)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit { Task { await search() } }
                    Button {
                        Task { await search() }
                    } label: {
                        Label("Search", systemImage: "magnifyingglass")
                    }
                    .buttonStyle(.bordered)
                    .disabled(searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    if searchPerformed {
                        Button("Clear") {
                            searchText = ""
                            searchResults = []
                            searchPerformed = false
                        }
                        .buttonStyle(.borderless)
                    }
                }

                if searchPerformed {
                    if searchResults.isEmpty {
                        Text("No memory matches.")
                            .font(.system(size: 12, design: .rounded))
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(searchResults) { result in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(result.file)
                                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                                Text(result.entry.content)
                                    .font(.system(size: 12, design: .rounded))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(3)
                            }
                            .padding(10)
                            .background(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .fill(Color.white.opacity(0.05))
                            )
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var memoryList: some View {
        if files.isEmpty {
            Text("No memory files yet. Agents write memory as they work, or you can add one above.")
                .font(.system(size: 13, design: .rounded))
                .foregroundStyle(.secondary)
        } else {
            LazyVStack(alignment: .leading, spacing: 12) {
                ForEach(files, id: \.self) { file in
                    memoryCard(file: file, memory: memories.first { $0.file == file })
                }
            }
        }
    }

    private func memoryCard(file: String, memory: GatewayMemoryFile?) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: "brain")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(accentTint)
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(Color.white.opacity(0.06)))
                VStack(alignment: .leading, spacing: 3) {
                    Text(file)
                        .font(.system(size: 13, weight: .medium, design: .monospaced))
                        .lineLimit(1)
                    Text(entryCountLabel(memory?.entries.count ?? 0))
                        .font(.system(size: 11.5, design: .rounded))
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button(role: .destructive) {
                    Task { await deleteMemory(file: file, index: nil) }
                } label: {
                    Image(systemName: "trash")
                }
                .buttonStyle(.borderless)
                .help("Delete memory file")
            }

            if let entries = memory?.entries, !entries.isEmpty {
                ForEach(Array(entries.enumerated()), id: \.offset) { index, entry in
                    HStack(alignment: .top, spacing: 10) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(entry.content)
                                .font(.system(size: 12, design: .rounded))
                                .lineLimit(3)
                            Text(memoryEntryMeta(entry))
                                .font(.system(size: 11, design: .rounded))
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button {
                            editingEntry = MemoryEditDraft(file: file, index: index, content: entry.content)
                        } label: {
                            Image(systemName: "pencil")
                        }
                        .buttonStyle(.borderless)
                        .help("Edit entry")
                        Button(role: .destructive) {
                            Task { await deleteMemory(file: file, index: index) }
                        } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(.borderless)
                        .help("Delete entry")
                    }
                    .padding(10)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(Color.white.opacity(0.04))
                    )
                }
            }
        }
        .padding(14)
        .cybaraGlass(cornerRadius: 14)
    }

    private func load() async {
        do {
            let list = try await client.memoryList()
            files = list.files
            memories = list.memories
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }

    private func createMemory() async {
        saving = true
        do {
            _ = try await client.createMemory(file: newFile, content: newContent)
            newContent = ""
            if !files.contains(newFile) {
                newFile = ""
            }
            await load()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }

    private func search() async {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return }
        do {
            searchResults = try await client.searchMemory(query)
            searchPerformed = true
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func deleteMemory(file: String, index: Int?) async {
        saving = true
        do {
            _ = try await client.deleteMemory(file: file, index: index)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }

    private func entryCountLabel(_ count: Int) -> String {
        count == 1 ? "1 entry" : "\(count) entries"
    }

    private func memoryEntryMeta(_ entry: GatewayMemoryEntry) -> String {
        [entry.type, relativeTimestamp(entry.timestamp)].compactMap { value in
            guard let value, !value.isEmpty else { return nil }
            return value
        }.joined(separator: " · ")
    }
}

private struct MemoryEditDraft: Identifiable {
    let file: String
    let index: Int
    let content: String

    var id: String { "\(file)-\(index)" }
}

private struct MemoryEditSheet: View {
    let draft: MemoryEditDraft
    let onSave: (String) async throws -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var content: String
    @State private var saving = false
    @State private var error: String?

    init(draft: MemoryEditDraft, onSave: @escaping (String) async throws -> Void) {
        self.draft = draft
        self.onSave = onSave
        _content = State(initialValue: draft.content)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ScreenHeader(title: "Edit Memory", subtitle: draft.file)
            TextEditor(text: $content)
                .font(.system(size: 12, design: .rounded))
                .scrollContentBackground(.hidden)
                .frame(minHeight: 160)
                .padding(10)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Color.white.opacity(0.06))
                )
            if let error {
                Text(error)
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(.red)
            }
            HStack {
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button(saving ? "Saving..." : "Save") {
                    Task { await save() }
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(saving || content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(24)
        .frame(width: 520)
    }

    private func save() async {
        saving = true
        do {
            try await onSave(content)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}

