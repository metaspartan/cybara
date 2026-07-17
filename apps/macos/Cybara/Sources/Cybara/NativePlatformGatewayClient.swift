import Foundation

extension GatewayClient {
    func nativePlugins() async throws -> [NativePluginSummary] {
        try await nativeList("api/plugins", keys: ["plugins", "items"])
    }

    func validateNativePlugin(path: String) async throws -> NativePluginValidation {
        let body = try JSONSerialization.data(withJSONObject: ["path": path])
        let data = try await request("api/plugins/validate", method: "POST", body: body)
        return try JSONDecoder().decode(NativePluginValidation.self, from: data)
    }

    func installNativePlugin(path: String) async throws -> NativePluginSummary {
        let body = try JSONSerialization.data(withJSONObject: ["path": path])
        let data = try await request("api/plugins/install", method: "POST", body: body)
        let response = try JSONDecoder().decode(NativePluginInstallResponse.self, from: data)
        guard response.success, let plugin = response.plugin else {
            throw GatewayClientError.decodingFailed("api/plugins/install", "Plugin installation failed")
        }
        return plugin
    }

    func setNativePluginEnabled(_ id: String, enabled: Bool) async throws -> NativePluginSummary {
        let body = try JSONSerialization.data(withJSONObject: ["enabled": enabled])
        let data = try await request("api/plugins/\(id)", method: "PUT", body: body)
        let response = try JSONDecoder().decode(NativePluginInstallResponse.self, from: data)
        guard response.success, let plugin = response.plugin else {
            throw GatewayClientError.decodingFailed("api/plugins/\(id)", "Plugin update failed")
        }
        return plugin
    }

    func nativeAccountConnectors() async throws -> [NativeAccountConnector] {
        try await nativeList("api/connectors", keys: ["connectors", "items"])
    }

    func updateAccountConnector(
        _ id: String,
        clientID: String,
        clientSecret: String,
        writeAccess: Bool
    ) async throws {
        var payload: [String: Any] = ["access": writeAccess ? "read_write" : "read"]
        let normalizedID = clientID.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedSecret = clientSecret.trimmingCharacters(in: .whitespacesAndNewlines)
        if !normalizedID.isEmpty { payload["clientId"] = normalizedID }
        if !normalizedSecret.isEmpty { payload["clientSecret"] = normalizedSecret }
        let body = try JSONSerialization.data(withJSONObject: payload)
        _ = try await request("api/connectors/\(pathSegment(id))", method: "PUT", body: body)
    }

    func startAccountConnectorOAuth(_ id: String) async throws -> NativeAccountConnectorOAuthStart {
        let data = try await request("api/connectors/\(pathSegment(id))/oauth/start", method: "POST")
        return try JSONDecoder().decode(NativeAccountConnectorOAuthStart.self, from: data)
    }

    func accountConnectorOAuthStatus(_ state: String) async throws -> NativeAccountConnectorOAuthStatus {
        try await nativeGet(
            "api/connectors/oauth/status",
            as: NativeAccountConnectorOAuthStatus.self,
            queryItems: [URLQueryItem(name: "state", value: state)]
        )
    }

    func disconnectAccountConnector(_ id: String) async throws {
        _ = try await request("api/connectors/\(pathSegment(id))", method: "DELETE")
    }

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
        _ = try await request("api/mcp/\(pathSegment(id))/\(pathSegment(action))", method: "POST")
    }

    func deleteMCPServer(_ id: String) async throws {
        _ = try await request("api/mcp/\(pathSegment(id))", method: "DELETE")
    }

    func nativeTools() async throws -> [NativeToolSummary] {
        try await nativeList("api/tools", keys: ["tools", "items"])
    }

    func dangerousTools() async throws -> NativeDangerousTools {
        try await nativeGet("api/tools/dangerous", as: NativeDangerousTools.self)
    }

    func nativeSubagents(sessionID: String? = nil) async throws -> [NativeSubagentSummary] {
        try await nativeList(
            "api/subagents",
            keys: ["subagents", "items"],
            queryItems: sessionID.map { [URLQueryItem(name: "sessionId", value: $0)] } ?? []
        )
    }

    func nativeSubagent(_ id: String) async throws -> NativeSubagentSummary {
        try await nativeGet("api/subagents/\(pathSegment(id))", as: NativeSubagentSummary.self)
    }

    func spawnNativeSubagent(
        task: String,
        agentID: String?,
        workspaceDir: String?,
        requesterSessionID: String
    ) async throws -> NativeSubagentMutationResponse {
        var payload: [String: Any] = [
            "task": task,
            "label": task.count > 42 ? "\(task.prefix(39))..." : task,
            "requesterSessionId": requesterSessionID,
        ]
        if let agentID = firstNonEmptyGatewayString(agentID) {
            payload["agentId"] = agentID
        }
        if let workspaceDir = firstNonEmptyGatewayString(workspaceDir) {
            payload["workspaceDir"] = workspaceDir
        }
        return try await nativePostJSON("api/subagents/spawn", payload: payload)
    }

    func stopNativeSubagent(_ id: String) async throws {
        _ = try await request("api/subagents/\(pathSegment(id))/kill", method: "POST")
    }

    func clearNativeSubagent(_ id: String) async throws {
        _ = try await request("api/subagents/\(pathSegment(id))", method: "DELETE")
    }

    func clearNativeSubagentHistory(sessionID: String) async throws {
        _ = try await request(
            "api/subagents",
            method: "DELETE",
            queryItems: [URLQueryItem(name: "sessionId", value: sessionID)]
        )
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
            "api/sessions/\(pathSegment(artifact.sessionId))/artifacts/\(pathSegment(artifact.fileName))"
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
            "api/sessions/\(pathSegment(artifact.sessionId))/artifacts/\(pathSegment(artifact.fileName))",
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

}
