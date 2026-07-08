import Foundation
import SwiftUI

struct NativeMCPServer: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let command: String?
    let args: String?
    let env: String?
    let url: String?
    let enabled: Bool?
    let status: String?
    let toolCount: Int?
    let error: String?
}

struct NativeToolSummary: Decodable, Identifiable, Hashable {
    let name: String
    let description: String?
    let input_schema: [String: JSONValue]?
    let inputSchema: [String: JSONValue]?

    var id: String { name }
    var schema: [String: JSONValue] { input_schema ?? inputSchema ?? [:] }
}

struct NativeDangerousTools: Decodable, Hashable {
    let policy: String?
    let tools: [String]
}

struct NativeLSPLanguage: Decodable, Identifiable, Hashable {
    let name: String
    let available: Bool
    let bundled: Bool

    var id: String { name }
}

struct NativeLSPStatus: Decodable, Hashable {
    let status: String?
    let workspace: String?
    let supported: [String]?
    let diagnosticsCount: Int?
    let error: String?
}

struct NativeLSPInstallStatus: Decodable, Identifiable, Hashable {
    let language: String
    let installed: Bool?
    let available: Bool?
    let bundled: Bool?
    let path: String?
    let version: String?
    let error: String?

    var id: String { language }
}

struct NativeLSPInstallStatusResponse: Decodable, Hashable {
    let status: [NativeLSPInstallStatus]
    let error: String?
}

struct NativeIDEIndexStatus: Decodable, Hashable {
    let success: Bool?
    let state: String?
    let isIndexing: Bool?
    let workspacePath: String?
    let indexedWorkspacePath: String?
    let filesIndexed: Int?
    let filesScanned: Int?
    let directoriesScanned: Int?
    let skippedFiles: Int?
    let progress: Double?
    let semanticReady: Bool?
    let semanticProvider: String?
    let semanticModel: String?
    let semanticIndexedFiles: Int?
    let semanticIndexedChunks: Int?
    let semanticError: String?
    let error: String?
}

struct NativeIDEFile: Decodable, Identifiable, Hashable {
    let path: String
    let relativePath: String

    var id: String { path }
}

struct NativeIDEFileList: Decodable, Hashable {
    let success: Bool?
    let path: String?
    let query: String?
    let totalFiles: Int?
    let truncated: Bool?
    let files: [NativeIDEFile]
    let error: String?
}

struct NativeIDEEntry: Decodable, Identifiable, Hashable {
    let name: String
    let path: String
    let type: String
    let size: Int?
    let `extension`: String?
    let modifiedAt: String?
    let gitModified: Bool?
    let gitStaged: Bool?
    let gitUntracked: Bool?
    let gitIgnored: Bool?

    var id: String { path }
    var isDirectory: Bool { type == "directory" }
    var systemImage: String { isDirectory ? "folder" : "doc.text" }
    var statusMark: String? {
        if gitStaged == true { return "S" }
        if gitModified == true { return "M" }
        if gitUntracked == true { return "U" }
        if gitIgnored == true { return "I" }
        return nil
    }
}

struct NativeIDEBrowseResult: Decodable, Hashable {
    let success: Bool?
    let path: String
    let parent: String?
    let entries: [NativeIDEEntry]
    let error: String?
}

struct NativeIDEReadResult: Decodable, Hashable {
    let success: Bool?
    let path: String
    let content: String?
    let size: Int?
    let `extension`: String?
    let isBinary: Bool?
    let error: String?
}

struct NativeIDEPathResult: Decodable, Hashable {
    let success: Bool?
    let path: String?
    let oldPath: String?
    let type: String?
    let url: String?
    let error: String?
}

struct NativeIDESearchMatch: Decodable, Identifiable, Hashable {
    let line: Int
    let column: Int
    let text: String

    var id: String { "\(line):\(column):\(text)" }
}

struct NativeIDESearchFile: Decodable, Identifiable, Hashable {
    let file: String
    let matches: [NativeIDESearchMatch]
    let count: Int

    var id: String { file }
}

struct NativeIDESearchResult: Decodable, Hashable {
    let success: Bool?
    let path: String?
    let query: String?
    let totalMatches: Int?
    let truncated: Bool?
    let files: [NativeIDESearchFile]
    let error: String?
}

struct NativeIDEReplacePreviewLine: Decodable, Identifiable, Hashable {
    let line: Int
    let before: String
    let after: String

    var id: String { "\(line):\(before):\(after)" }
}

struct NativeIDEReplacePreviewFile: Decodable, Identifiable, Hashable {
    let file: String
    let replacements: Int
    let preview: [NativeIDEReplacePreviewLine]

    var id: String { file }
}

struct NativeIDEReplacePreviewResult: Decodable, Hashable {
    let success: Bool?
    let path: String?
    let query: String?
    let replacement: String?
    let totalReplacements: Int?
    let files: [NativeIDEReplacePreviewFile]
    let truncated: Bool?
    let error: String?
}

struct NativeIDEReplaceResult: Decodable, Hashable {
    let success: Bool?
    let path: String?
    let query: String?
    let replacement: String?
    let changedFiles: [NativeIDEChangedFile]
    let totalReplacements: Int?
    let error: String?
}

struct NativeIDEChangedFile: Decodable, Identifiable, Hashable {
    let file: String
    let replacements: Int

    var id: String { file }
}

struct NativeTerminalSession: Decodable, Identifiable, Hashable {
    let id: String
    let createdAt: String
}

struct NativeArtifactSummary: Decodable, Identifiable, Hashable {
    let sessionId: String
    let name: String?
    let fileName: String
    let path: String?
    let kind: String?
    let title: String?
    let size: Int?
    let createdAt: String?
    let updatedAt: String?

    var id: String { "\(sessionId):\(fileName)" }
    var displayTitle: String { firstNonEmptyGatewayString(title, name, fileName) ?? fileName }
}

struct NativeArtifactContent: Decodable, Hashable {
    let content: String?
    let truncated: Bool?
    let totalChars: Int?
}

private struct NativeArtifactContentEnvelope: Decodable {
    let content: String?
    let truncated: Bool?
    let totalChars: Int?
}

struct NativeLSPInstallResult: Decodable {
    let success: Bool?
    let error: String?
}

extension GatewayClient {
    func nativeMCPServers() async throws -> [NativeMCPServer] {
        try await nativeList("api/mcp", keys: ["servers", "items"])
    }

    func nativeMCPTools() async throws -> [NativeToolSummary] {
        try await nativeList("api/mcp/tools", keys: ["tools", "items"])
    }

    func createMCPServer(name: String, command: String, args: String, env: String, enabled: Bool) async throws {
        let payload: [String: Any] = [
            "name": name.trimmingCharacters(in: .whitespacesAndNewlines),
            "command": command.trimmingCharacters(in: .whitespacesAndNewlines),
            "args": args.trimmingCharacters(in: .whitespacesAndNewlines),
            "env": env.trimmingCharacters(in: .whitespacesAndNewlines),
            "enabled": enabled,
        ]
        let body = try JSONSerialization.data(withJSONObject: payload)
        _ = try await request("api/mcp", method: "POST", body: body)
    }

    func mcpAction(_ id: String, action: String) async throws {
        _ = try await request("api/mcp/\(nativePathSegment(id))/\(action)", method: "POST")
    }

    func deleteMCPServer(_ id: String) async throws {
        _ = try await request("api/mcp/\(nativePathSegment(id))", method: "DELETE")
    }

    func nativeTools() async throws -> [NativeToolSummary] {
        try await nativeList("api/tools", keys: ["tools", "items"])
    }

    func dangerousTools() async throws -> NativeDangerousTools {
        try await nativeGet("api/tools/dangerous", as: NativeDangerousTools.self)
    }

    func lspStatus() async throws -> NativeLSPStatus {
        try await nativeGet("api/lsp/status", as: NativeLSPStatus.self)
    }

    func lspLanguages() async throws -> [NativeLSPLanguage] {
        try await nativeList("api/lsp/languages", keys: ["languages"])
    }

    func lspInstallStatus() async throws -> NativeLSPInstallStatusResponse {
        try await nativeGet("api/lsp/install-status", as: NativeLSPInstallStatusResponse.self)
    }

    func installLSP(_ language: String) async throws -> NativeLSPInstallResult {
        try await nativePostJSON("api/lsp/install", payload: ["language": language])
    }

    func uninstallLSP(_ language: String) async throws -> NativeLSPInstallResult {
        try await nativePostJSON("api/lsp/uninstall", payload: ["language": language])
    }

    func ideIndexStatus(workspacePath: String? = nil) async throws -> NativeIDEIndexStatus {
        var queryItems: [URLQueryItem] = []
        if let workspacePath = firstNonEmptyGatewayString(workspacePath) {
            queryItems.append(URLQueryItem(name: "workspacePath", value: workspacePath))
        }
        return try await nativeGet("api/ide/index/status", as: NativeIDEIndexStatus.self, queryItems: queryItems)
    }

    func reindexIDEWorkspace(_ workspacePath: String?) async throws {
        let trimmed = firstNonEmptyGatewayString(workspacePath)
        let payload = trimmed.map { ["workspacePath": $0] } ?? [:]
        _ = try await nativePostJSON("api/ide/index/reindex", payload: payload) as NativeLSPInstallResult
    }

    func stopIDEIndexing() async throws {
        _ = try await request("api/ide/index/stop", method: "POST")
    }

    func ideFiles(path: String, query: String, limit: Int = 120) async throws -> NativeIDEFileList {
        try await nativeGet(
            "api/ide/files",
            as: NativeIDEFileList.self,
            queryItems: [
                URLQueryItem(name: "path", value: path),
                URLQueryItem(name: "query", value: query),
                URLQueryItem(name: "limit", value: "\(limit)"),
            ]
        )
    }

    func browseIDE(path: String) async throws -> NativeIDEBrowseResult {
        try await nativeGet(
            "api/ide/browse",
            as: NativeIDEBrowseResult.self,
            queryItems: [URLQueryItem(name: "path", value: path)]
        )
    }

    func readIDEFile(path: String) async throws -> NativeIDEReadResult {
        try await nativeGet(
            "api/ide/read",
            as: NativeIDEReadResult.self,
            queryItems: [URLQueryItem(name: "path", value: path)]
        )
    }

    func writeIDEFile(path: String, content: String) async throws -> NativeIDEPathResult {
        try await nativePostJSON("api/ide/write", payload: ["path": path, "content": content])
    }

    func createIDEItem(parentPath: String, name: String, type: String) async throws -> NativeIDEPathResult {
        try await nativePostJSON(
            "api/ide/create",
            payload: ["parentPath": parentPath, "name": name, "type": type]
        )
    }

    func renameIDEItem(path: String, newName: String) async throws -> NativeIDEPathResult {
        try await nativePostJSON("api/ide/rename", payload: ["path": path, "newName": newName])
    }

    func revealIDEPath(_ path: String) async throws -> NativeIDEPathResult {
        try await nativePostJSON("api/ide/reveal", payload: ["path": path])
    }

    func openIDETerminal(path: String) async throws -> NativeIDEPathResult {
        try await nativePostJSON("api/ide/open-terminal", payload: ["path": path])
    }

    func idePermalink(path: String, line: Int = 1) async throws -> NativeIDEPathResult {
        try await nativeGet(
            "api/ide/permalink",
            as: NativeIDEPathResult.self,
            queryItems: [
                URLQueryItem(name: "path", value: path),
                URLQueryItem(name: "line", value: "\(max(1, line))"),
            ]
        )
    }

    func searchIDE(path: String, query: String, caseSensitive: Bool, wholeWord: Bool) async throws -> NativeIDESearchResult {
        try await nativeGet(
            "api/ide/search",
            as: NativeIDESearchResult.self,
            queryItems: [
                URLQueryItem(name: "path", value: path),
                URLQueryItem(name: "query", value: query),
                URLQueryItem(name: "caseSensitive", value: caseSensitive ? "true" : "false"),
                URLQueryItem(name: "wholeWord", value: wholeWord ? "true" : "false"),
            ]
        )
    }

    func previewIDEReplace(
        path: String,
        query: String,
        replacement: String,
        caseSensitive: Bool,
        wholeWord: Bool
    ) async throws -> NativeIDEReplacePreviewResult {
        try await nativePostJSON(
            "api/ide/replace/preview",
            payload: [
                "path": path,
                "query": query,
                "replacement": replacement,
                "caseSensitive": caseSensitive,
                "wholeWord": wholeWord,
                "maxFiles": 120,
            ]
        )
    }

    func applyIDEReplace(
        path: String,
        query: String,
        replacement: String,
        caseSensitive: Bool,
        wholeWord: Bool
    ) async throws -> NativeIDEReplaceResult {
        try await nativePostJSON(
            "api/ide/replace",
            payload: [
                "path": path,
                "query": query,
                "replacement": replacement,
                "caseSensitive": caseSensitive,
                "wholeWord": wholeWord,
            ]
        )
    }

    func terminalSessions() async throws -> [NativeTerminalSession] {
        try await nativeList("api/terminal/sessions", keys: ["sessions", "items"])
    }

    func artifacts() async throws -> [NativeArtifactSummary] {
        try await nativeList("api/artifacts", keys: ["artifacts", "items"])
    }

    func readArtifact(_ artifact: NativeArtifactSummary) async throws -> NativeArtifactContent {
        let data = try await request(
            "api/sessions/\(nativePathSegment(artifact.sessionId))/artifacts/\(nativePathSegment(artifact.fileName))"
        )
        let envelope = try JSONDecoder().decode(NativeArtifactContentEnvelope.self, from: data)
        return NativeArtifactContent(
            content: envelope.content,
            truncated: envelope.truncated,
            totalChars: envelope.totalChars
        )
    }

    func deleteArtifact(_ artifact: NativeArtifactSummary) async throws {
        _ = try await request(
            "api/sessions/\(nativePathSegment(artifact.sessionId))/artifacts/\(nativePathSegment(artifact.fileName))",
            method: "DELETE"
        )
    }

    private func nativeGet<T: Decodable>(
        _ path: String,
        as type: T.Type,
        queryItems: [URLQueryItem] = []
    ) async throws -> T {
        let data = try await request(path, queryItems: queryItems)
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw GatewayClientError.decodingFailed(path, String(describing: error))
        }
    }

    private func nativePostJSON<T: Decodable>(_ path: String, payload: [String: Any]) async throws -> T {
        let body = try JSONSerialization.data(withJSONObject: payload)
        let data = try await request(path, method: "POST", body: body)
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw GatewayClientError.decodingFailed(path, String(describing: error))
        }
    }

    private func nativeList<T: Decodable>(
        _ path: String,
        keys: [String],
        queryItems: [URLQueryItem] = []
    ) async throws -> [T] {
        let data = try await request(path, queryItems: queryItems)
        let decoder = JSONDecoder()
        if let decoded = try? decoder.decode([T].self, from: data) {
            return decoded
        }
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw GatewayClientError.invalidResponse
        }
        for key in keys {
            if let nested = object[key],
               let nestedData = try? JSONSerialization.data(withJSONObject: nested),
               let decoded = try? decoder.decode([T].self, from: nestedData) {
                return decoded
            }
        }
        return []
    }

    private func nativePathSegment(_ value: String) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }
}

struct MCPScreen: View {
    let client: GatewayClient
    @Environment(\.cybaraAccent) private var accent

    @State private var servers: [NativeMCPServer] = []
    @State private var tools: [NativeToolSummary] = []
    @State private var loaded = false
    @State private var busyID: String?
    @State private var error: String?
    @State private var showingAdd = false
    @State private var newName = ""
    @State private var newCommand = ""
    @State private var newArgs = ""
    @State private var newEnv = ""
    @State private var newEnabled = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    ScreenHeader(title: "MCP Servers", subtitle: "\(servers.count) servers · \(tools.count) tools")
                    Button {
                        showingAdd = true
                    } label: {
                        Label("Add", systemImage: "plus")
                    }
                    .buttonStyle(.borderedProminent)
                    Button {
                        Task { await load() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(.bordered)
                }

                if !loaded {
                    ProgressView().frame(maxWidth: .infinity)
                } else if let error {
                    LoadFailedView(message: error) { Task { await load() } }
                } else {
                    VStack(spacing: 12) {
                        ForEach(servers) { server in
                            GlassCard {
                                VStack(alignment: .leading, spacing: 12) {
                                    HStack(alignment: .top) {
                                        VStack(alignment: .leading, spacing: 3) {
                                            Text(server.name)
                                                .font(.system(size: 15, weight: .bold, design: .rounded))
                                            Text(server.commandLine)
                                                .font(.system(size: 11, design: .monospaced))
                                                .foregroundStyle(.secondary)
                                                .textSelection(.enabled)
                                        }
                                        Spacer()
                                        StatusBadge(label: server.status ?? "stopped", color: mcpTint(server.status))
                                    }

                                    if let error = firstNonEmptyGatewayString(server.error) {
                                        Text(error)
                                            .font(.system(size: 11, design: .rounded))
                                            .foregroundStyle(.red)
                                    }

                                    HStack {
                                        Label("\(server.toolCount ?? 0) tools", systemImage: "wrench.and.screwdriver")
                                            .foregroundStyle(.secondary)
                                        Spacer()
                                        Button("Start") { Task { await run(server, "start") } }
                                            .disabled(busyID != nil || server.status == "running")
                                        Button("Stop") { Task { await run(server, "stop") } }
                                            .disabled(busyID != nil || server.status != "running")
                                        Button("Restart") { Task { await run(server, "restart") } }
                                            .disabled(busyID != nil)
                                        Button(role: .destructive) { Task { await delete(server) } } label: {
                                            Image(systemName: "trash")
                                        }
                                        .disabled(busyID != nil)
                                    }
                                    .buttonStyle(.bordered)
                                    .controlSize(.small)
                                }
                            }
                        }

                        if !tools.isEmpty {
                            GlassCard {
                                VStack(alignment: .leading, spacing: 10) {
                                    Text("Active tools")
                                        .font(.system(size: 15, weight: .bold, design: .rounded))
                                    ForEach(tools.prefix(24)) { tool in
                                        NativeInfoRow(title: tool.name, detail: tool.description ?? "MCP tool")
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .padding(24)
        }
        .task { await load() }
        .sheet(isPresented: $showingAdd) {
            VStack(alignment: .leading, spacing: 14) {
                ScreenHeader(title: "Add MCP Server", subtitle: "Add a trusted local MCP command")
                TextField("Name", text: $newName)
                TextField("Command", text: $newCommand)
                TextField("Arguments", text: $newArgs)
                TextField("Environment, KEY=value pairs", text: $newEnv)
                Toggle("Enabled", isOn: $newEnabled)
                    .toggleStyle(.switch)
                HStack {
                    Spacer()
                    Button("Cancel") { showingAdd = false }
                    Button("Add Server") {
                        Task { await create() }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(newName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || newCommand.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .textFieldStyle(.roundedBorder)
            .padding(24)
            .frame(width: 460)
        }
    }

    private func mcpTint(_ status: String?) -> Color {
        switch status?.lowercased() {
        case "running": return .green
        case "starting": return .orange
        case "error": return .red
        default: return .secondary
        }
    }

    private func load() async {
        do {
            async let serverResult = client.nativeMCPServers()
            async let toolResult = client.nativeMCPTools()
            servers = try await serverResult
            tools = try await toolResult
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }

    private func run(_ server: NativeMCPServer, _ action: String) async {
        busyID = server.id
        do {
            try await client.mcpAction(server.id, action: action)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
        busyID = nil
    }

    private func delete(_ server: NativeMCPServer) async {
        busyID = server.id
        do {
            try await client.deleteMCPServer(server.id)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
        busyID = nil
    }

    private func create() async {
        do {
            try await client.createMCPServer(
                name: newName,
                command: newCommand,
                args: newArgs,
                env: newEnv,
                enabled: newEnabled
            )
            newName = ""
            newCommand = ""
            newArgs = ""
            newEnv = ""
            showingAdd = false
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct LSPScreen: View {
    let client: GatewayClient
    @State private var status: NativeLSPStatus?
    @State private var languages: [NativeLSPLanguage] = []
    @State private var installStatus: [NativeLSPInstallStatus] = []
    @State private var loaded = false
    @State private var busyLanguage: String?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    ScreenHeader(title: "LSP", subtitle: status?.workspace ?? "Language server status")
                    Button {
                        Task { await load() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(.bordered)
                }

                if !loaded {
                    ProgressView().frame(maxWidth: .infinity)
                } else if let error {
                    LoadFailedView(message: error) { Task { await load() } }
                } else {
                    GlassCard {
                        VStack(alignment: .leading, spacing: 10) {
                            NativeMetricGrid(rows: [
                                ("Status", status?.status ?? "unknown"),
                                ("Diagnostics", "\(status?.diagnosticsCount ?? 0)"),
                                ("Languages", "\(languages.count)"),
                            ])
                        }
                    }

                    LazyVStack(spacing: 10) {
                        ForEach(languages) { language in
                            let installed = installStatus.first { $0.language == language.name }
                            GlassCard {
                                HStack(alignment: .center) {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(language.name)
                                            .font(.system(size: 14, weight: .bold, design: .rounded))
                                        Text(lspDetail(language, installed))
                                            .font(.system(size: 11, design: .rounded))
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    StatusBadge(
                                        label: language.available ? "Available" : "Missing",
                                        color: language.available ? .green : .orange
                                    )
                                    if busyLanguage == language.name {
                                        ProgressView().controlSize(.small)
                                    } else {
                                        Button(language.available ? "Uninstall" : "Install") {
                                            Task { await toggle(language) }
                                        }
                                        .buttonStyle(.bordered)
                                        .controlSize(.small)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .padding(24)
        }
        .task { await load() }
    }

    private func lspDetail(_ language: NativeLSPLanguage, _ installed: NativeLSPInstallStatus?) -> String {
        [
            language.bundled ? "bundled" : "external",
            installed?.version,
            installed?.path,
            installed?.error,
        ]
        .compactMap { firstNonEmptyGatewayString($0) }
        .joined(separator: " · ")
    }

    private func load() async {
        do {
            async let statusResult = client.lspStatus()
            async let languagesResult = client.lspLanguages()
            async let installResult = client.lspInstallStatus()
            status = try await statusResult
            languages = try await languagesResult
            installStatus = try await installResult.status
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }

    private func toggle(_ language: NativeLSPLanguage) async {
        busyLanguage = language.name
        do {
            let result = language.available
                ? try await client.uninstallLSP(language.name)
                : try await client.installLSP(language.name)
            if result.success == false {
                error = result.error ?? "LSP operation failed."
            }
            await load()
        } catch {
            self.error = error.localizedDescription
        }
        busyLanguage = nil
    }
}

struct IDEScreen: View {
    let client: GatewayClient
    @State private var status: NativeIDEIndexStatus?
    @State private var files: [NativeIDEFile] = []
    @State private var workspacePath = ""
    @State private var query = ""
    @State private var loaded = false
    @State private var loadingFiles = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    ScreenHeader(title: "IDE", subtitle: "Workspace index, files, and search")
                    Button {
                        Task { await load() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(.bordered)
                }

                if !loaded {
                    ProgressView().frame(maxWidth: .infinity)
                } else if let error {
                    LoadFailedView(message: error) { Task { await load() } }
                } else {
                    GlassCard {
                        VStack(alignment: .leading, spacing: 12) {
                            NativeMetricGrid(rows: [
                                ("State", status?.state ?? "unknown"),
                                ("Files", "\(status?.filesIndexed ?? 0)/\(status?.filesScanned ?? 0)"),
                                ("Semantic", status?.semanticReady == true ? "Ready" : "Not ready"),
                                ("Chunks", "\(status?.semanticIndexedChunks ?? 0)"),
                            ])
                            ProgressView(value: min(1, max(0, (status?.progress ?? 0) / 100)))
                            HStack {
                                TextField("Workspace path", text: $workspacePath)
                                    .textFieldStyle(.roundedBorder)
                                Button("Reindex") { Task { await reindex() } }
                                    .buttonStyle(.borderedProminent)
                                    .disabled(busy)
                                Button("Stop") { Task { await stop() } }
                                    .buttonStyle(.bordered)
                                    .disabled(busy || status?.isIndexing != true)
                            }
                        }
                    }

                    GlassCard {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                Text("Files")
                                    .font(.system(size: 15, weight: .bold, design: .rounded))
                                Spacer()
                                TextField("Search files", text: $query)
                                    .textFieldStyle(.roundedBorder)
                                    .frame(width: 240)
                                    .onSubmit { Task { await searchFiles() } }
                                Button("Search") { Task { await searchFiles() } }
                                    .buttonStyle(.bordered)
                            }
                            if loadingFiles {
                                ProgressView().controlSize(.small)
                            }
                            LazyVStack(alignment: .leading, spacing: 6) {
                                ForEach(files) { file in
                                    HStack(spacing: 8) {
                                        Image(systemName: "doc.text")
                                            .foregroundStyle(.secondary)
                                        Text(file.relativePath)
                                            .font(.system(size: 12, design: .monospaced))
                                            .lineLimit(1)
                                        Spacer()
                                    }
                                    .help(file.path)
                                }
                            }
                        }
                    }
                }
            }
            .padding(24)
        }
        .task { await load() }
    }

    private func load() async {
        do {
            status = try await client.ideIndexStatus(workspacePath: firstNonEmptyGatewayString(workspacePath))
            if workspacePath.isEmpty {
                workspacePath = status?.workspacePath ?? status?.indexedWorkspacePath ?? ""
            }
            error = nil
            await searchFiles()
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }

    private func reindex() async {
        busy = true
        do {
            try await client.reindexIDEWorkspace(firstNonEmptyGatewayString(workspacePath))
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

    private func searchFiles() async {
        loadingFiles = true
        do {
            let root = firstNonEmptyGatewayString(workspacePath) ?? "~"
            files = try await client.ideFiles(path: root, query: query).files
        } catch {
            self.error = error.localizedDescription
        }
        loadingFiles = false
    }
}

struct SessionsManagementScreen: View {
    let client: GatewayClient
    let openChat: (GatewaySession) -> Void

    @State private var sessions: [GatewaySession] = []
    @State private var query = ""
    @State private var loaded = false
    @State private var error: String?
    @State private var renaming: GatewaySession?
    @State private var renameDraft = ""

    private var filtered: [GatewaySession] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let sorted = sessions.sorted { ($0.pinned == true ? 0 : 1, $0.updated_at ?? "") < ($1.pinned == true ? 0 : 1, $1.updated_at ?? "") }
        guard !trimmed.isEmpty else { return sorted }
        return sorted.filter {
            $0.displayTitle.lowercased().contains(trimmed)
                || ($0.workspace_dir?.lowercased().contains(trimmed) ?? false)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                ScreenHeader(title: "Sessions", subtitle: "\(sessions.count) chats")
                TextField("Search sessions", text: $query)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 240)
                Button {
                    Task { await load() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
            }
            .padding(24)

            if !loaded {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error {
                LoadFailedView(message: error) { Task { await load() } }
            } else {
                List(filtered) { session in
                    HStack {
                        Button {
                            openChat(session)
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(session.displayTitle)
                                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                                    .lineLimit(1)
                                Text(session.routeSummary())
                                    .font(.system(size: 11, design: .rounded))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                        .buttonStyle(.plain)
                        Spacer()
                        Text(compactRelativeTimestamp(session.updated_at))
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                        Button {
                            Task { await pin(session) }
                        } label: {
                            Image(systemName: session.pinned == true ? "pin.fill" : "pin")
                        }
                        .buttonStyle(.borderless)
                        Button {
                            renaming = session
                            renameDraft = session.displayTitle
                        } label: {
                            Image(systemName: "pencil")
                        }
                        .buttonStyle(.borderless)
                        Button(role: .destructive) {
                            Task { await delete(session) }
                        } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(.borderless)
                    }
                    .padding(.vertical, 6)
                }
                .listStyle(.inset)
            }
        }
        .task { await load() }
        .sheet(item: $renaming) { session in
            VStack(alignment: .leading, spacing: 14) {
                ScreenHeader(title: "Rename Chat", subtitle: session.id)
                TextField("Title", text: $renameDraft)
                    .textFieldStyle(.roundedBorder)
                HStack {
                    Spacer()
                    Button("Cancel") { renaming = nil }
                    Button("Save") {
                        Task { await rename(session) }
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .padding(24)
            .frame(width: 440)
        }
    }

    private func load() async {
        do {
            sessions = try await client.sessions(limit: 500)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }

    private func pin(_ session: GatewaySession) async {
        do {
            try await client.pinSession(session.id, pinned: !(session.pinned == true))
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func rename(_ session: GatewaySession) async {
        do {
            try await client.renameSession(session.id, title: renameDraft)
            renaming = nil
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func delete(_ session: GatewaySession) async {
        do {
            try await client.deleteSession(session.id)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct ToolsScreen: View {
    let client: GatewayClient
    @State private var tools: [NativeToolSummary] = []
    @State private var dangerous: NativeDangerousTools?
    @State private var approvals: [GatewayPendingApproval] = []
    @State private var query = ""
    @State private var loaded = false
    @State private var error: String?

    private var filteredTools: [NativeToolSummary] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !trimmed.isEmpty else { return tools }
        return tools.filter {
            $0.name.lowercased().contains(trimmed) || ($0.description?.lowercased().contains(trimmed) ?? false)
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    ScreenHeader(title: "Tools", subtitle: "\(tools.count) built-in tools · \(approvals.count) approvals")
                    TextField("Search tools", text: $query)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 220)
                    Button {
                        Task { await load() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(.bordered)
                }

                if !loaded {
                    ProgressView().frame(maxWidth: .infinity)
                } else if let error {
                    LoadFailedView(message: error) { Task { await load() } }
                } else {
                    GlassCard {
                        NativeMetricGrid(rows: [
                            ("Dangerous policy", dangerous?.policy ?? "ask"),
                            ("Dangerous tools", "\(dangerous?.tools.count ?? 0)"),
                            ("Pending approvals", "\(approvals.count)"),
                        ])
                    }

                    if !approvals.isEmpty {
                        GlassCard {
                            VStack(alignment: .leading, spacing: 10) {
                                Text("Pending approvals")
                                    .font(.system(size: 15, weight: .bold, design: .rounded))
                                ForEach(approvals) { approval in
                                    HStack(alignment: .top) {
                                        NativeInfoRow(title: approval.toolName, detail: approval.argsSummary)
                                        Spacer()
                                        ForEach(["approve_once", "approve_session", "deny"], id: \.self) { decision in
                                            Button(decision.replacingOccurrences(of: "_", with: " ")) {
                                                Task { await resolve(approval, decision) }
                                            }
                                            .buttonStyle(.bordered)
                                            .controlSize(.small)
                                        }
                                    }
                                }
                            }
                        }
                    }

                    LazyVStack(spacing: 10) {
                        ForEach(filteredTools) { tool in
                            GlassCard {
                                HStack(alignment: .top) {
                                    NativeInfoRow(
                                        title: tool.name,
                                        detail: firstNonEmptyGatewayString(tool.description) ?? "Tool schema"
                                    )
                                    Spacer()
                                    Text("\(tool.schema.count) fields")
                                        .font(.system(size: 11, design: .rounded))
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
            .padding(24)
        }
        .task { await load() }
    }

    private func load() async {
        do {
            async let toolsResult = client.nativeTools()
            async let dangerousResult = client.dangerousTools()
            async let approvalsResult = client.pendingToolApprovals()
            tools = try await toolsResult
            dangerous = try await dangerousResult
            approvals = try await approvalsResult
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }

    private func resolve(_ approval: GatewayPendingApproval, _ decision: String) async {
        do {
            try await client.resolveToolApproval(approval.id, decision: decision)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

@MainActor
final class NativeTerminalConnection: ObservableObject {
    @Published var output = ""
    @Published var connected = false
    @Published var error: String?

    private var task: URLSessionWebSocketTask?

    func connect(client: GatewayClient, sessionID: String) {
        disconnect()
        guard var components = URLComponents(url: URL(string: "api/terminal/ws", relativeTo: client.baseURL)!.absoluteURL, resolvingAgainstBaseURL: false) else {
            error = "Invalid terminal URL."
            return
        }
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.queryItems = [URLQueryItem(name: "session", value: sessionID)]
        guard let url = components.url else {
            error = "Invalid terminal URL."
            return
        }
        var request = URLRequest(url: url)
        if let key = GatewayClient.loadAPIKey() {
            request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        }
        if let password = GatewayClient.loadGatewayPassword() {
            request.setValue(password, forHTTPHeaderField: "X-Cybara-Gateway-Password")
        }
        let next = URLSession.shared.webSocketTask(with: request)
        task = next
        output = ""
        error = nil
        connected = true
        next.resume()
        receive()
    }

    func send(_ text: String) {
        guard let task else { return }
        task.send(.string(text)) { [weak self] error in
            Task { @MainActor in
                if let error {
                    self?.error = error.localizedDescription
                }
            }
        }
    }

    func disconnect() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        connected = false
    }

    private func receive() {
        task?.receive { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                switch result {
                case .success(let message):
                    switch message {
                    case .string(let text):
                        self.output += text
                    case .data(let data):
                        self.output += String(data: data, encoding: .utf8) ?? ""
                    @unknown default:
                        break
                    }
                    self.receive()
                case .failure(let error):
                    if self.connected {
                        self.error = error.localizedDescription
                    }
                    self.connected = false
                }
            }
        }
    }
}

struct TerminalScreen: View {
    let client: GatewayClient
    @StateObject private var connection = NativeTerminalConnection()
    @State private var sessions: [NativeTerminalSession] = []
    @State private var activeSessionID = UUID().uuidString
    @State private var command = ""
    @State private var loaded = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                ScreenHeader(title: "Terminal", subtitle: connection.connected ? "Connected" : "Native shell session")
                Button("New") {
                    activeSessionID = UUID().uuidString
                    connection.connect(client: client, sessionID: activeSessionID)
                }
                .buttonStyle(.borderedProminent)
                Button(connection.connected ? "Disconnect" : "Connect") {
                    if connection.connected {
                        connection.disconnect()
                    } else {
                        connection.connect(client: client, sessionID: activeSessionID)
                    }
                }
                .buttonStyle(.bordered)
            }
            .padding(24)

            if let error = error ?? connection.error {
                Text(error)
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(.red)
                    .padding(.horizontal, 24)
            }

            VStack(alignment: .leading, spacing: 10) {
                ScrollView {
                    Text(connection.output.isEmpty ? "Connect to start a terminal session." : connection.output)
                        .font(.system(size: 12, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(14)
                }
                .cybaraGlass(cornerRadius: 16)

                HStack {
                    TextField("Command", text: $command)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit { sendCommand() }
                    Button("Send", action: sendCommand)
                        .buttonStyle(.borderedProminent)
                        .disabled(!connection.connected || command.isEmpty)
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
        .task { await loadSessions() }
        .onDisappear { connection.disconnect() }
    }

    private func sendCommand() {
        let trimmed = command
        guard !trimmed.isEmpty else { return }
        connection.send(trimmed + "\n")
        command = ""
    }

    private func loadSessions() async {
        do {
            sessions = try await client.terminalSessions()
            if let first = sessions.first {
                activeSessionID = first.id
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }
}

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

private struct NativeInfoRow: View {
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.system(size: 13, weight: .semibold, design: .rounded))
            Text(detail)
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct NativeMetricGrid: View {
    let rows: [(String, String)]

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 10)], spacing: 10) {
            ForEach(rows, id: \.0) { row in
                VStack(alignment: .leading, spacing: 4) {
                    Text(row.0)
                        .font(.system(size: 10, weight: .semibold, design: .rounded))
                        .foregroundStyle(.secondary)
                    Text(row.1)
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .lineLimit(1)
                }
                .padding(10)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Color.primary.opacity(0.04))
                )
            }
        }
    }
}

private struct StatusBadge: View {
    let label: String
    let color: Color

    var body: some View {
        Text(label.capitalized)
            .font(.system(size: 10, weight: .bold, design: .rounded))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Capsule().fill(color.opacity(0.16)))
            .foregroundStyle(color)
    }
}

private extension NativeMCPServer {
    var commandLine: String {
        firstNonEmptyGatewayString(url, [command, args].compactMap { firstNonEmptyGatewayString($0) }.joined(separator: " "))
            ?? "No command"
    }
}
