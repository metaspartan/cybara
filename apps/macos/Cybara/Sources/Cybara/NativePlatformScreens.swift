import Foundation
import AppKit
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
    let category: String?
    let permissions: [String]?
    let input_schema: [String: JSONValue]?
    let inputSchema: [String: JSONValue]?

    var id: String { name }
    var schema: [String: JSONValue] { input_schema ?? inputSchema ?? [:] }
}

struct NativeDangerousToolPolicy: Decodable, Hashable {
    let enabled: Bool?
    let mode: String?

    init(from decoder: Decoder) throws {
        if let string = try? decoder.singleValueContainer().decode(String.self) {
            enabled = nil
            mode = string
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        enabled = try container.decodeIfPresent(Bool.self, forKey: .enabled)
        mode = try container.decodeIfPresent(String.self, forKey: .mode)
    }

    private enum CodingKeys: String, CodingKey {
        case enabled, mode
    }

    var displayLabel: String {
        let modeText = firstNonEmptyGatewayString(mode)?.replacingOccurrences(of: "_", with: " ") ?? "ask"
        guard let enabled else { return modeText }
        return enabled ? modeText : "disabled"
    }
}

struct NativeDangerousTools: Decodable, Hashable {
    let policy: NativeDangerousToolPolicy?
    let tools: [String]
}

struct NativeSubagentSummary: Decodable, Identifiable, Hashable {
    let id: String
    let label: String
    let status: String
    let createdAt: String?
    let task: String?
    let sessionKey: String?
    let model: String?
    let workspaceDir: String?
    let runTimeoutSeconds: Int?
    let cleanup: String?
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
    let filesScanned: Int?
    let scanTruncated: Bool?
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

struct NativeIDEBlameLine: Decodable, Hashable {
    let line: Int
    let shortCommit: String?
    let author: String?
    let authorDate: String?
    let summary: String?
    let isUncommitted: Bool?
}

struct NativeIDEBlameResult: Decodable, Hashable {
    let success: Bool?
    let isRepo: Bool?
    let truncated: Bool?
    let lines: [NativeIDEBlameLine]?
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
    let filesScanned: Int?
    let scanTruncated: Bool?
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
    let filesScanned: Int?
    let scanTruncated: Bool?
    let error: String?
}

struct NativeIDEReplaceResult: Decodable, Hashable {
    let success: Bool?
    let path: String?
    let query: String?
    let replacement: String?
    let changedFiles: [NativeIDEChangedFile]
    let totalReplacements: Int?
    let truncated: Bool?
    let filesScanned: Int?
    let scanTruncated: Bool?
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

    func nativeSubagents() async throws -> [NativeSubagentSummary] {
        try await nativeList("api/subagents", keys: ["subagents", "items"])
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

    func blameIDEFile(path: String, maxLines: Int) async throws -> NativeIDEBlameResult {
        try await nativeGet(
            "api/ide/blame",
            as: NativeIDEBlameResult.self,
            queryItems: [
                URLQueryItem(name: "path", value: path),
                URLQueryItem(name: "maxLines", value: String(maxLines)),
            ]
        )
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
                        .frame(width: 318)
                }
                .frame(maxHeight: .infinity, alignment: .top)
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .task { await load() }
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
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            if inspectorSection == "index" {
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
        do {
            status = try await client.ideIndexStatus(workspacePath: firstNonEmptyGatewayString(workspacePath))
            if workspacePath.isEmpty {
                workspacePath = status?.workspacePath ?? status?.indexedWorkspacePath ?? ""
            }
            let initialPath = firstNonEmptyGatewayString(currentPath == "~" ? workspacePath : currentPath, workspacePath, "~") ?? "~"
            await browsePath(initialPath)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }

    private func browsePath(_ path: String) async {
        loadingBrowse = true
        do {
            let result = try await client.browseIDE(path: firstNonEmptyGatewayString(path) ?? "~")
            if result.success == false {
                error = result.error ?? "Unable to browse path."
            } else {
                browse = result
                currentPath = result.path
                if workspacePath.isEmpty {
                    workspacePath = result.path
                }
                error = nil
            }
        } catch {
            self.error = error.localizedDescription
        }
        loadingBrowse = false
    }

    private func openEntry(_ entry: NativeIDEEntry) async {
        selectedEntry = entry
        if entry.isDirectory {
            await browsePath(entry.path)
        } else {
            await openFile(path: entry.path)
        }
    }

    private func openFile(path: String) async {
        loadingFile = true
        do {
            let result = try await client.readIDEFile(path: path)
            if result.success == false {
                error = result.error ?? "Unable to read file."
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
            }
        } catch {
            self.error = error.localizedDescription
        }
        loadingFile = false
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
                            ("Dangerous policy", dangerous?.policy?.displayLabel ?? "ask"),
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
                                VStack(alignment: .leading, spacing: 10) {
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
                                    HStack(spacing: 6) {
                                        if let category = firstNonEmptyGatewayString(tool.category) {
                                            NativeToolChip(category, systemImage: "tag", tint: .cyan)
                                        }
                                        if dangerous?.tools.contains(tool.name) == true {
                                            NativeToolChip("dangerous", systemImage: "exclamationmark.shield", tint: .orange)
                                        }
                                        ForEach((tool.permissions ?? []).prefix(3), id: \.self) { permission in
                                            NativeToolChip(permission, systemImage: "checkmark.seal", tint: .secondary)
                                        }
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

private struct NativeToolChip: View {
    let label: String
    let systemImage: String
    let tint: Color

    init(_ label: String, systemImage: String, tint: Color) {
        self.label = label
        self.systemImage = systemImage
        self.tint = tint
    }

    var body: some View {
        Label(label, systemImage: systemImage)
            .font(.system(size: 10, weight: .semibold, design: .rounded))
            .foregroundStyle(tint)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(Capsule().fill(tint.opacity(0.12)))
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
