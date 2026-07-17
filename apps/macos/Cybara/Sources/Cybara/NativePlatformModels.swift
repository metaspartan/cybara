import Foundation

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

struct NativePluginSummary: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let version: String
    let description: String
    let author: String?
    let homepage: String?
    let source: String
    let rootDir: String
    let skillDirs: [String]
    let skillCount: Int
    let skillNames: [String]
    let enabled: Bool
    let builtIn: Bool
}

struct NativePluginManifest: Decodable, Hashable {
    let id: String
    let name: String
    let version: String
    let description: String
    let author: String?
    let homepage: String?
}

struct NativePluginValidation: Decodable, Hashable {
    let valid: Bool
    let errors: [String]
    let warnings: [String]
    let manifest: NativePluginManifest?
}

struct NativePluginInstallResponse: Decodable {
    let success: Bool
    let plugin: NativePluginSummary?
}

struct NativeAccountConnector: Decodable, Identifiable, Hashable {
    let id: String
    let label: String
    let description: String
    let services: [String]
    let docsUrl: String
    let clientIdLabel: String
    let clientSecretLabel: String?
    let redirectUri: String
    let configured: Bool
    let connected: Bool
    let access: String
    let account: String?
    let needsReauthorization: Bool
}

struct NativeAccountConnectorOAuthStart: Decodable {
    let state: String
    let authUrl: String
    let expiresAt: Double
}

struct NativeAccountConnectorOAuthStatus: Decodable {
    let status: String
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
    let requesterSessionId: String?
    let result: String?
    let error: String?
    let thinking: String?
    let activityCount: Int?
    let toolCallCount: Int?
    let activities: [GatewayProcessActivity]?
    let toolCalls: [GatewayToolCall]?
}

struct NativeSubagentMutationResponse: Decodable, Hashable {
    let success: Bool?
    let subagentId: String?
    let sessionKey: String?
    let status: String?
    let warning: String?
    let error: String?
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
    let active: [NativeActiveLSPServer]?
    let diagnosticsCount: Int?
    let error: String?
}

struct NativeActiveLSPServer: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let command: String
    let initialized: Bool
}

struct NativeLSPInstallStatus: Decodable, Identifiable, Hashable {
    let language: String
    let installed: Bool?
    let available: Bool?
    let bundled: Bool?
    let preinstalled: Bool?
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

struct NativeArtifactContentEnvelope: Decodable {
    let content: String?
    let truncated: Bool?
    let totalChars: Int?
}

struct NativeLSPInstallResult: Decodable {
    let success: Bool?
    let error: String?
}
