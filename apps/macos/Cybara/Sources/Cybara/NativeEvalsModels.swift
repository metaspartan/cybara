import Foundation

struct GatewayEvalTool: Decodable, Hashable {
    let name: String
    let status: String
}

struct GatewayEvalStructure: Decodable, Hashable {
    let tools: [GatewayEvalTool]
}

struct GatewayEvalUserMessage: Decodable, Hashable {
    let content: String
}

struct GatewayEvalRequestSummary: Decodable, Hashable {
    let userMessage: GatewayEvalUserMessage
    let workspaceDir: String?
}

struct GatewayEvalBaseline: Decodable, Hashable {
    let sessionId: String
    let turnIndex: Int
    let provider: String?
    let model: String?
    let request: GatewayEvalRequestSummary
    let structure: GatewayEvalStructure
}

struct GatewayEvalGolden: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let description: String?
    let tags: [String]
    let baseline: GatewayEvalBaseline
}

struct GatewayEvalRun: Decodable, Identifiable, Hashable {
    let id: String
    let goldenId: String
    let replaySessionId: String?
    let status: String
    let score: Double?
    let error: String?
}

struct GatewayEvalsResponse: Decodable, Hashable {
    let goldens: [GatewayEvalGolden]
    let runs: [GatewayEvalRun]
}

struct GatewayEvalReplayResponse: Decodable, Hashable {
    let success: Bool
    let run: GatewayEvalRun?
    let error: String?
}

struct GatewayEvalExportResponse: Decodable, Hashable {
    let filename: String
    let mimeType: String
    let content: String
    let count: Int
}

struct GatewayEvalImportResponse: Decodable, Hashable {
    let success: Bool
    let count: Int
    let error: String?
}

struct GatewayResearchStats: Decodable, Hashable {
    let total: Int
    let toolCalls: Int
    let failedToolCalls: Int
    let reasoningTraces: Int
    let cleanTraces: Int
    let train: Int
    let validation: Int
    let test: Int
}

struct GatewayResearchResponse: Decodable, Hashable {
    let stats: GatewayResearchStats
    let total: Int
}
