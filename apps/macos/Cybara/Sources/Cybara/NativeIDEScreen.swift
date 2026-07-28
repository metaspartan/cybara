import AppKit
import SwiftUI

struct IDEScreen: View {
    let client: GatewayClient
    @AppStorage("cybara.ide.pendingWorkspacePath") private var pendingWorkspacePath = ""
    @AppStorage("cybara.ide.pendingFilePath") private var pendingFilePath = ""
    @State private var status: NativeIDEIndexStatus?
    @State private var browse: NativeIDEBrowseResult?
    @State private var workspacePath = ""
    @State private var currentPath = "~"
    @State private var selectedEntry: NativeIDEEntry?
    @State private var selectedFilePath: String?
    @State private var fileContent = ""
    @State private var originalFileContent = ""
    @State private var fileInfo: NativeIDEReadResult?
    @State private var query = ""
    @State private var searchQuery = ""
    @State private var replacement = ""
    @State private var caseSensitive = false
    @State private var wholeWord = false
    @State private var searchResult: NativeIDESearchResult?
    @State private var replacePreview: NativeIDEReplacePreviewResult?
    @State private var loaded = false
    @State private var loadingBrowse = false
    @State private var loadingFile = false
    @State private var busy = false
    @State private var error: String?
    @State private var notice: String?
    @State private var showingCreate = false
    @State private var createName = ""
    @State private var createType = "file"
    @State private var showingRename = false
    @State private var renameName = ""
    @State private var renamePath = ""
    @State private var inspectorSection = "search"
    @State private var ideChatSessionID: String?
    @State private var editorMode = "view"
    @State private var showBlame = false
    @State private var blameByLine: [Int: NativeIDEBlameLine] = [:]

    private var filteredEntries: [NativeIDEEntry] {
        let entries = browse?.entries ?? []
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let filtered = trimmed.isEmpty
            ? entries
            : entries.filter { $0.name.lowercased().contains(trimmed) || $0.path.lowercased().contains(trimmed) }
        return filtered.sorted {
            if $0.isDirectory != $1.isDirectory {
                return $0.isDirectory && !$1.isDirectory
            }
            return $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }
    }

    private var activePath: String {
        firstNonEmptyGatewayString(selectedFilePath, browse?.path, currentPath, workspacePath) ?? "~"
    }

    private var fileIsDirty: Bool {
        fileContent != originalFileContent
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 12) {
                ScreenHeader(title: "IDE", subtitle: "Native workspace browser, editor, search, and index")
                Spacer()
                if busy {
                    ProgressView().controlSize(.small)
                }
                Button {
                    Task { await load() }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                Button {
                    Task { await reindex() }
                } label: {
                    Label("Reindex", systemImage: "arrow.triangle.2.circlepath")
                }
                .buttonStyle(.borderedProminent)
                .disabled(busy)
                Button {
                    Task { await stop() }
                } label: {
                    Label("Stop", systemImage: "stop.circle")
                }
                .buttonStyle(.bordered)
                .disabled(busy || status?.isIndexing != true)
            }
            .controlSize(.small)

            if let notice {
                Text(notice)
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(.secondary)
            }

            if !loaded {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error {
                LoadFailedView(message: error) { Task { await load() } }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                HStack(alignment: .top, spacing: 10) {
                    fileBrowserPane
                        .frame(width: 286)
                    editorPane
                    searchReplacePane
                        .frame(width: inspectorSection == "chat" ? 460 : 318)
                }
                .frame(maxHeight: .infinity, alignment: .top)
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .task { await load() }
        .onChange(of: pendingFilePath) { _, path in
            guard !path.isEmpty, loaded else { return }
            Task { await openPendingFile(path) }
        }
        .sheet(isPresented: $showingCreate) {
            createSheet
        }
        .sheet(isPresented: $showingRename) {
            renameSheet
        }
    }

    private var fileBrowserPane: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Label("Workspace", systemImage: "folder")
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                    Spacer()
                    if loadingBrowse {
                        ProgressView().controlSize(.small)
                    }
                }

                TextField("Path", text: $currentPath)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 12, design: .monospaced))
                    .onSubmit { Task { await browsePath(currentPath) } }

                Label("Trusted local workspace", systemImage: "checkmark.shield")
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(.secondary)
                    .help("IDE reads and writes are confined to local paths accepted by the gateway.")

                HStack(spacing: 8) {
                    Button {
                        Task { await browsePath(currentPath) }
                    } label: {
                        Image(systemName: "arrow.right.circle")
                    }
                    .help("Open path")

                    Button {
                        if let parent = browse?.parent {
                            Task { await browsePath(parent) }
                        }
                    } label: {
                        Image(systemName: "arrow.up")
                    }
                    .disabled(firstNonEmptyGatewayString(browse?.parent) == nil)
                    .help("Open parent")

                    Button {
                        showingCreate = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .help("Create file or folder")

                    Spacer()

                    Button {
                        Task { await revealPath(activePath) }
                    } label: {
                        Image(systemName: "folder.badge.gearshape")
                    }
                    .help("Reveal in Finder")

                    Button {
                        Task { await openTerminal(activePath) }
                    } label: {
                        Image(systemName: "terminal")
                    }
                    .help("Open terminal here")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)

                TextField("Filter current folder", text: $query)
                    .textFieldStyle(.roundedBorder)

                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 4) {
                        ForEach(filteredEntries) { entry in
                            fileRow(entry)
                        }
                    }
                }
                .frame(maxHeight: .infinity)

                if filteredEntries.isEmpty {
                    Text("No files match this folder filter.")
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var editorPane: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .center) {
                    Label("Editor", systemImage: "doc.text")
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                    Spacer()
                    if loadingFile {
                        ProgressView().controlSize(.small)
                    }
                    if fileIsDirty {
                        StatusBadge(label: "Unsaved", color: .orange)
                    }
                    Button("Save") {
                        Task { await saveFile() }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .disabled(selectedFilePath == nil || fileInfo?.isBinary == true || !fileIsDirty || busy)
                    Button("Revert") {
                        fileContent = originalFileContent
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(!fileIsDirty)
                }

                if let selectedFilePath {
                    Text(selectedFilePath)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .help(selectedFilePath)
                }

                if selectedFilePath == nil {
                    VStack(spacing: 12) {
                        Image(systemName: "doc.badge.plus")
                            .font(.system(size: 42))
                            .foregroundStyle(.secondary)
                        Text("Select a file to edit.")
                            .font(.system(size: 14, weight: .semibold, design: .rounded))
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if fileInfo?.isBinary == true {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Binary file")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        Text(fileContent.isEmpty ? "This file cannot be edited as text." : fileContent)
                            .font(.system(size: 12, design: .rounded))
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                } else {
                    HStack(spacing: 10) {
                        Picker("Mode", selection: $editorMode) {
                            Text("View").tag("view")
                            Text("Edit").tag("edit")
                        }
                        .pickerStyle(.segmented)
                        .labelsHidden()
                        .frame(width: 150)
                        Toggle(isOn: $showBlame) {
                            Label("Blame", systemImage: "clock.arrow.circlepath")
                        }
                        .toggleStyle(.button)
                        .controlSize(.small)
                        .disabled(blameByLine.isEmpty)
                        .help(blameByLine.isEmpty ? "Git blame unavailable for this file" : "Toggle inline git blame")
                        Spacer()
                    }

                    if editorMode == "edit" {
                        TextEditor(text: $fileContent)
                            .font(.system(size: 12, design: .monospaced))
                            .scrollContentBackground(.hidden)
                            .background(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .fill(Color.primary.opacity(0.035))
                            )
                            .frame(minHeight: 360, maxHeight: .infinity)
                    } else {
                        codeViewer
                            .frame(minHeight: 360, maxHeight: .infinity)
                    }

                    HStack {
                        Text("\(lineCount(fileContent)) lines")
                        Text("\(fileContent.count) chars")
                        if let size = fileInfo?.size {
                            Text(formatByteCount(size))
                        }
                        Spacer()
                        Button {
                            Task { await copyPermalink() }
                        } label: {
                            Label("Copy Link", systemImage: "link")
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .disabled(selectedFilePath == nil)
                    }
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var codeViewer: some View {
        let lines = fileContent.components(separatedBy: "\n")
        let gutterWidth = max(44, CGFloat(String(lines.count).count) * 9 + 20)
        return ScrollView([.vertical, .horizontal]) {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(Array(lines.enumerated()), id: \.offset) { index, text in
                    let number = index + 1
                    HStack(alignment: .firstTextBaseline, spacing: 0) {
                        Text("\(number)")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(.tertiary)
                            .frame(width: gutterWidth, alignment: .trailing)
                            .padding(.trailing, 12)
                            .overlay(alignment: .trailing) {
                                Rectangle()
                                    .fill(Color.primary.opacity(0.08))
                                    .frame(width: 1)
                            }
                        Text(text.isEmpty ? " " : text)
                            .font(.system(size: 12, design: .monospaced))
                            .textSelection(.enabled)
                            .fixedSize(horizontal: true, vertical: false)
                            .padding(.leading, 14)
                        if showBlame, let blame = blameByLine[number] {
                            Text(blameLabel(blame))
                                .font(.system(size: 10, design: .rounded))
                                .foregroundStyle(.tertiary)
                                .lineLimit(1)
                                .padding(.leading, 16)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.vertical, 1.5)
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.primary.opacity(0.035))
        )
    }

    private var searchReplacePane: some View {
        VStack(alignment: .leading, spacing: 14) {
            Picker("IDE inspector", selection: $inspectorSection) {
                Text("Search").tag("search")
                Text("Results").tag("results")
                Text("Index").tag("index")
                Text("Chat").tag("chat")
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            if inspectorSection == "chat" {
                ChatScreen(
                    client: client,
                    selectedSessionID: $ideChatSessionID,
                    showsSessionList: false,
                    preferredWorkspaceDir: firstNonEmptyGatewayString(workspacePath, browse?.path, currentPath)
                )
                .frame(minWidth: 360, maxWidth: .infinity, maxHeight: .infinity)
            } else if inspectorSection == "index" {
                indexCard
            } else if inspectorSection == "results" {
                searchResultsPane
            } else {
                searchControlsCard
            }
        }
    }

    private var indexCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Label("Index", systemImage: "sparkle.magnifyingglass")
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                    Spacer()
                    StatusBadge(
                        label: status?.state ?? "unknown",
                        color: status?.isIndexing == true ? .orange : .secondary
                    )
                }
                NativeMetricGrid(rows: [
                    ("Files", "\(status?.filesIndexed ?? 0)/\(status?.filesScanned ?? 0)"),
                    ("Directories", "\(status?.directoriesScanned ?? 0)"),
                    ("Skipped", "\(status?.skippedFiles ?? 0)"),
                    ("Chunks", "\(status?.semanticIndexedChunks ?? 0)"),
                ])
                ProgressView(value: normalizedProgress)
                Text(indexSubtitle)
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var searchControlsCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                Label("Search and Replace", systemImage: "magnifyingglass")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                TextField("Search text", text: $searchQuery)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { Task { await runSearch() } }
                TextField("Replacement", text: $replacement)
                    .textFieldStyle(.roundedBorder)
                Toggle("Case sensitive", isOn: $caseSensitive)
                    .toggleStyle(.switch)
                Toggle("Whole word", isOn: $wholeWord)
                    .toggleStyle(.switch)
                HStack {
                    Button("Search") {
                        Task {
                            inspectorSection = "results"
                            await runSearch()
                        }
                    }
                    .buttonStyle(.bordered)
                    Button("Preview") {
                        Task {
                            inspectorSection = "results"
                            await previewReplace()
                        }
                    }
                    .buttonStyle(.bordered)
                    Button("Apply") {
                        Task {
                            inspectorSection = "results"
                            await applyReplace()
                        }
                    }
                    .buttonStyle(.borderedProminent)
                }
                .disabled(searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || busy)
            }
        }
    }

    @ViewBuilder
    private var searchResultsPane: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Results")
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                    Spacer()
                    Text(resultSummary)
                        .font(.system(size: 11, design: .rounded))
                        .foregroundStyle(.secondary)
                }

                if let resultLimitText {
                    Label(resultLimitText, systemImage: "exclamationmark.triangle")
                        .font(.system(size: 11, design: .rounded))
                        .foregroundStyle(.orange)
                }

                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        if let replacePreview, !replacePreview.files.isEmpty {
                            ForEach(replacePreview.files) { file in
                                replacePreviewRow(file)
                            }
                        } else if let searchResult, !searchResult.files.isEmpty {
                            ForEach(searchResult.files) { file in
                                searchFileRow(file)
                            }
                        } else {
                            Text("Run a search or preview a replacement.")
                                .font(.system(size: 12, design: .rounded))
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
                .frame(maxHeight: .infinity)
            }
        }
    }

    private var createSheet: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Create Item")
                .font(.system(size: 18, weight: .bold, design: .rounded))
            Picker("Type", selection: $createType) {
                Text("File").tag("file")
                Text("Folder").tag("directory")
            }
            .pickerStyle(.segmented)
            TextField("Name", text: $createName)
                .textFieldStyle(.roundedBorder)
                .onSubmit { Task { await createItem() } }
            HStack {
                Spacer()
                Button("Cancel") { showingCreate = false }
                Button("Create") {
                    Task { await createItem() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(createName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(24)
        .frame(width: 420)
    }

    private var renameSheet: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Rename Item")
                .font(.system(size: 18, weight: .bold, design: .rounded))
            Text(renamePath)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
                .lineLimit(2)
            TextField("Name", text: $renameName)
                .textFieldStyle(.roundedBorder)
                .onSubmit { Task { await renameItem() } }
            HStack {
                Spacer()
                Button("Cancel") { showingRename = false }
                Button("Rename") {
                    Task { await renameItem() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(renameName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(24)
        .frame(width: 460)
    }

    private var normalizedProgress: Double {
        let value = status?.progress ?? 0
        if value > 1 {
            return min(1, max(0, value / 100))
        }
        return min(1, max(0, value))
    }

    private var indexSubtitle: String {
        [
            status?.semanticReady == true ? "Semantic index ready" : "Semantic index not ready",
            status?.semanticProvider,
            status?.semanticModel,
            status?.semanticError,
        ]
        .compactMap { firstNonEmptyGatewayString($0) }
        .joined(separator: " · ")
    }

    private var resultSummary: String {
        if let replacePreview {
            return nativeIDEScanSummary(
                "\(replacePreview.totalReplacements ?? 0) replacements",
                filesScanned: replacePreview.filesScanned
            )
        }
        if let searchResult {
            return nativeIDEScanSummary(
                "\(searchResult.totalMatches ?? 0) matches",
                filesScanned: searchResult.filesScanned
            )
        }
        return "Idle"
    }

    private var resultLimitText: String? {
        if let replacePreview {
            if replacePreview.scanTruncated == true {
                return nativeIDEScanLimitText(filesScanned: replacePreview.filesScanned)
            }
            if replacePreview.truncated == true {
                return "Results limited to keep replacement preview responsive."
            }
        }
        if let searchResult {
            if searchResult.scanTruncated == true {
                return nativeIDEScanLimitText(filesScanned: searchResult.filesScanned)
            }
            if searchResult.truncated == true {
                return "Results limited to keep search responsive."
            }
        }
        return nil
    }

    private func nativeIDEScanSummary(_ prefix: String, filesScanned: Int?) -> String {
        guard let filesScanned else { return prefix }
        return "\(prefix) · \(filesScanned.formatted()) scanned"
    }

    private func nativeIDEScanLimitText(filesScanned: Int?) -> String {
        if let filesScanned {
            return "Filesystem scan limited after \(filesScanned.formatted()) files. Narrow the query or reindex."
        }
        return "Filesystem scan limited. Narrow the query or reindex."
    }

    private func fileRow(_ entry: NativeIDEEntry) -> some View {
        HStack(spacing: 8) {
            Image(systemName: entry.systemImage)
                .foregroundStyle(entry.isDirectory ? Color.accentColor : Color.secondary)
                .frame(width: 16)
            Text(entry.name)
                .font(.system(size: 12, design: entry.isDirectory ? .rounded : .monospaced))
                .lineLimit(1)
            Spacer()
            if let statusMark = entry.statusMark {
                Text(statusMark)
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 7)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(selectedEntry?.id == entry.id ? Color.accentColor.opacity(0.16) : Color.clear)
        )
        .contentShape(Rectangle())
        .onTapGesture {
            Task { await openEntry(entry) }
        }
        .help(entry.path)
        .contextMenu {
            Button("Rename") { beginRename(entry) }
            Button("Reveal in Finder") { Task { await revealPath(entry.path) } }
            Button("Open Terminal Here") { Task { await openTerminal(entry.path) } }
            if !entry.isDirectory {
                Button("Copy Permalink") {
                    Task { await copyPermalink(path: entry.path) }
                }
            }
        }
    }

    private func searchFileRow(_ file: NativeIDESearchFile) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                Task { await openFile(path: file.file) }
            } label: {
                HStack {
                    Image(systemName: "doc.text.magnifyingglass")
                    Text(file.file)
                        .lineLimit(1)
                    Spacer()
                    Text("\(file.count)")
                        .foregroundStyle(.secondary)
                }
                .font(.system(size: 11, design: .monospaced))
            }
            .buttonStyle(.plain)
            ForEach(file.matches.prefix(3)) { match in
                Text("\(match.line): \(match.text)")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.primary.opacity(0.04))
        )
    }

    private func replacePreviewRow(_ file: NativeIDEReplacePreviewFile) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                Task { await openFile(path: file.file) }
            } label: {
                HStack {
                    Image(systemName: "arrow.triangle.2.circlepath.doc.on.clipboard")
                    Text(file.file)
                        .lineLimit(1)
                    Spacer()
                    Text("\(file.replacements)")
                        .foregroundStyle(.secondary)
                }
                .font(.system(size: 11, design: .monospaced))
            }
            .buttonStyle(.plain)
            ForEach(file.preview.prefix(2)) { line in
                VStack(alignment: .leading, spacing: 2) {
                    Text("- \(line.before)")
                        .foregroundStyle(.secondary)
                    Text("+ \(line.after)")
                        .foregroundStyle(.primary)
                }
                .font(.system(size: 10, design: .monospaced))
                .lineLimit(2)
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.primary.opacity(0.04))
        )
    }

    private func load() async {
        defer { loaded = true }
        do {
            let pendingFile = firstNonEmptyGatewayString(pendingFilePath)
            if let pending = firstNonEmptyGatewayString(pendingWorkspacePath) {
                workspacePath = pending
                currentPath = pending
                pendingWorkspacePath = ""
            }
            if let pendingFile {
                let directory = URL(fileURLWithPath: pendingFile).deletingLastPathComponent().path
                workspacePath = directory
                currentPath = directory
            }
            status = try await client.ideIndexStatus(workspacePath: firstNonEmptyGatewayString(workspacePath))
            if workspacePath.isEmpty {
                workspacePath = status?.workspacePath ?? status?.indexedWorkspacePath ?? ""
            }
            let initialPath = firstNonEmptyGatewayString(currentPath == "~" ? workspacePath : currentPath, workspacePath, "~") ?? "~"
            guard await browsePath(initialPath) else { return }
            if let pendingFile {
                guard await openFile(path: pendingFile) else { return }
                if firstNonEmptyGatewayString(pendingFilePath) == pendingFile {
                    pendingFilePath = ""
                }
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func openPendingFile(_ path: String) async {
        guard let normalized = firstNonEmptyGatewayString(path) else { return }
        let directory = URL(fileURLWithPath: normalized).deletingLastPathComponent().path
        workspacePath = directory
        currentPath = directory
        guard await browsePath(directory), await openFile(path: normalized) else { return }
        if firstNonEmptyGatewayString(pendingFilePath) == normalized {
            pendingFilePath = ""
        }
    }

    @discardableResult
    private func browsePath(_ path: String) async -> Bool {
        loadingBrowse = true
        defer { loadingBrowse = false }
        do {
            let result = try await client.browseIDE(path: firstNonEmptyGatewayString(path) ?? "~")
            if result.success == false {
                error = result.error ?? "Unable to browse path."
                return false
            } else {
                browse = result
                currentPath = result.path
                if workspacePath.isEmpty {
                    workspacePath = result.path
                }
                error = nil
                return true
            }
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    private func openEntry(_ entry: NativeIDEEntry) async {
        selectedEntry = entry
        if entry.isDirectory {
            await browsePath(entry.path)
        } else {
            await openFile(path: entry.path)
        }
    }

    @discardableResult
    private func openFile(path: String) async -> Bool {
        loadingFile = true
        defer { loadingFile = false }
        do {
            let result = try await client.readIDEFile(path: path)
            if result.success == false {
                error = result.error ?? "Unable to read file."
                return false
            } else {
                selectedFilePath = result.path
                fileInfo = result
                fileContent = result.content ?? ""
                originalFileContent = fileContent
                error = nil
                blameByLine = [:]
                if result.isBinary != true {
                    await loadBlame(path: result.path, content: fileContent)
                }
                return true
            }
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    private func loadBlame(path: String, content: String) async {
        let lineTotal = max(1, content.components(separatedBy: "\n").count)
        let maxLines = max(3000, min(lineTotal + 64, 50000))
        do {
            let result = try await client.blameIDEFile(path: path, maxLines: maxLines)
            guard result.success == true, result.isRepo == true, let lines = result.lines else {
                blameByLine = [:]
                return
            }
            var map: [Int: NativeIDEBlameLine] = [:]
            for entry in lines {
                map[entry.line] = entry
            }
            blameByLine = map
        } catch {
            blameByLine = [:]
        }
    }

    private func blameLabel(_ blame: NativeIDEBlameLine) -> String {
        if blame.isUncommitted == true {
            return "Uncommitted"
        }
        let author = blame.author ?? "Unknown"
        let commit = blame.shortCommit ?? ""
        return commit.isEmpty ? author : "\(author) · \(commit)"
    }

    private func saveFile() async {
        guard let selectedFilePath else { return }
        busy = true
        do {
            let result = try await client.writeIDEFile(path: selectedFilePath, content: fileContent)
            if result.success == false {
                error = result.error ?? "Unable to save file."
            } else {
                originalFileContent = fileContent
                notice = "Saved \(selectedFilePath)"
                await openFile(path: selectedFilePath)
                await browsePath(currentPath)
            }
        } catch {
            self.error = error.localizedDescription
        }
        busy = false
    }

    private func createItem() async {
        let trimmed = createName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        busy = true
        do {
            let parent = browse?.path ?? currentPath
            let result = try await client.createIDEItem(parentPath: parent, name: trimmed, type: createType)
            if result.success == false {
                error = result.error ?? "Unable to create item."
            } else {
                showingCreate = false
                createName = ""
                notice = "Created \(trimmed)"
                await browsePath(parent)
                if createType == "file", let path = result.path {
                    await openFile(path: path)
                }
            }
        } catch {
            self.error = error.localizedDescription
        }
        busy = false
    }

    private func beginRename(_ entry: NativeIDEEntry) {
        renamePath = entry.path
        renameName = entry.name
        showingRename = true
    }

    private func renameItem() async {
        let trimmed = renameName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !renamePath.isEmpty else { return }
        busy = true
        do {
            let result = try await client.renameIDEItem(path: renamePath, newName: trimmed)
            if result.success == false {
                error = result.error ?? "Unable to rename item."
            } else {
                showingRename = false
                notice = "Renamed to \(trimmed)"
                await browsePath(currentPath)
                if let path = result.path, selectedFilePath == renamePath {
                    await openFile(path: path)
                }
            }
        } catch {
            self.error = error.localizedDescription
        }
        busy = false
    }

    private func revealPath(_ path: String) async {
        do {
            let result = try await client.revealIDEPath(path)
            if result.success == false {
                error = result.error ?? "Unable to reveal path."
            } else {
                notice = "Opened in Finder"
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func openTerminal(_ path: String) async {
        do {
            let result = try await client.openIDETerminal(path: path)
            if result.success == false {
                error = result.error ?? "Unable to open terminal."
            } else {
                notice = "Opened terminal"
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func copyPermalink(path: String? = nil) async {
        guard let path = firstNonEmptyGatewayString(path, selectedFilePath) else { return }
        do {
            let result = try await client.idePermalink(path: path)
            if let url = firstNonEmptyGatewayString(result.url) {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(url, forType: .string)
                notice = "Copied permalink"
            } else if result.success == false {
                error = result.error ?? "Unable to create permalink."
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func runSearch() async {
        let trimmed = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        busy = true
        do {
            searchResult = try await client.searchIDE(
                path: firstNonEmptyGatewayString(workspacePath, browse?.path, currentPath) ?? "~",
                query: trimmed,
                caseSensitive: caseSensitive,
                wholeWord: wholeWord
            )
            replacePreview = nil
            error = searchResult?.success == false ? searchResult?.error : nil
        } catch {
            self.error = error.localizedDescription
        }
        busy = false
    }

    private func previewReplace() async {
        let trimmed = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        busy = true
        do {
            replacePreview = try await client.previewIDEReplace(
                path: firstNonEmptyGatewayString(workspacePath, browse?.path, currentPath) ?? "~",
                query: trimmed,
                replacement: replacement,
                caseSensitive: caseSensitive,
                wholeWord: wholeWord
            )
            searchResult = nil
            error = replacePreview?.success == false ? replacePreview?.error : nil
        } catch {
            self.error = error.localizedDescription
        }
        busy = false
    }

    private func applyReplace() async {
        let trimmed = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        busy = true
        do {
            let result = try await client.applyIDEReplace(
                path: firstNonEmptyGatewayString(workspacePath, browse?.path, currentPath) ?? "~",
                query: trimmed,
                replacement: replacement,
                caseSensitive: caseSensitive,
                wholeWord: wholeWord
            )
            if result.success == false {
                error = result.error ?? "Replace failed."
            } else {
                notice = "Replaced \(result.totalReplacements ?? 0) matches in \(result.changedFiles.count) files"
                await previewReplace()
                if let selectedFilePath {
                    await openFile(path: selectedFilePath)
                }
            }
        } catch {
            self.error = error.localizedDescription
        }
        busy = false
    }

    private func reindex() async {
        busy = true
        do {
            try await client.reindexIDEWorkspace(firstNonEmptyGatewayString(workspacePath, browse?.path, currentPath))
            await load()
        } catch {
            self.error = error.localizedDescription
        }
        busy = false
    }

    private func stop() async {
        busy = true
        do {
            try await client.stopIDEIndexing()
            await load()
        } catch {
            self.error = error.localizedDescription
        }
        busy = false
    }

    private func lineCount(_ content: String) -> Int {
        guard !content.isEmpty else { return 0 }
        return content.split(separator: "\n", omittingEmptySubsequences: false).count
    }

    private func formatByteCount(_ bytes: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }
}
