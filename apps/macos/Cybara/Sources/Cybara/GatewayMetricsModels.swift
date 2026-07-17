import Foundation

struct MetricsOverview: Decodable {
    struct TokenUsage: Decodable {
        let total: Int?
        let input: Int?
        let output: Int?
        let cache: Int?
    }

    struct FileOperations: Decodable {
        let filesRead: Int?
        let filesWritten: Int?
        let filesEdited: Int?
        let filesSearched: Int?
    }

    struct Sessions: Decodable {
        let totalSessions: Int?
        let memoryFlushes: Int?
        let memoryFlushFailures: Int?
        let compactions: Int?
    }

    struct ToolCalls: Decodable {
        let totalCalls: Int?
    }

    struct APICalls: Decodable {
        let totalCalls: Int?
        let successfulCalls: Int?
        let failedCalls: Int?

        var successRate: Double {
            guard let totalCalls, totalCalls > 0 else { return 0 }
            return Double(successfulCalls ?? 0) / Double(totalCalls) * 100
        }
    }

    struct AgentActivity: Decodable {
        let totalExecutions: Int?
        let totalMessages: Int?
    }

    struct ContextHealth: Decodable {
        let warnings: Int?
        let criticalWarnings: Int?
    }

    let tokenUsage: TokenUsage?
    let fileOperations: FileOperations?
    let sessions: Sessions?
    let toolCalls: ToolCalls?
    let apiCalls: APICalls?
    let agentActivity: AgentActivity?
    let contextHealth: ContextHealth?
}

struct MetricModelToken: Decodable, Identifiable, Hashable, Sendable {
    let model: String
    let tokens: Int

    var id: String { model }

    private enum CodingKeys: String, CodingKey {
        case model, tokens
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        model = try container.decodeFlexibleString(forKeys: [.model]) ?? "unknown"
        tokens = try container.decodeFlexibleInt(forKeys: [.tokens]) ?? 0
    }
}

struct MetricProviderToken: Decodable, Identifiable, Hashable, Sendable {
    let provider: String
    let tokens: Int

    var id: String { provider }

    private enum CodingKeys: String, CodingKey {
        case provider, tokens
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        provider = try container.decodeFlexibleString(forKeys: [.provider]) ?? "unknown"
        tokens = try container.decodeFlexibleInt(forKeys: [.tokens]) ?? 0
    }
}

struct MetricTimelinePoint: Decodable, Identifiable, Hashable, Sendable {
    let timestamp: String?
    let type: String?
    let tool: String?
    let hour: String?
    let value: Int?
    let tokens: Int?
    let calls: Int?
    let duration: Double?
    let metadata: JSONValue?

    var id: String { [timestamp, type, tool, hour].compactMap { $0 }.joined(separator: "-") }
}

struct TokenMetrics: Decodable, Hashable, Sendable {
    let topModels: [MetricModelToken]
    let topProviders: [MetricProviderToken]
    let recentUsage: [MetricTimelinePoint]
    let totalTokens: Int?
    let estimatedCost: Double?
}

struct MetricFilePath: Decodable, Identifiable, Hashable, Sendable {
    let path: String
    let count: Int

    var id: String { path }

    private enum CodingKeys: String, CodingKey {
        case path, count
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        path = try container.decodeFlexibleString(forKeys: [.path]) ?? "unknown"
        count = try container.decodeFlexibleInt(forKeys: [.count]) ?? 0
    }
}

struct FileMetrics: Decodable, Hashable, Sendable {
    let mostRead: [MetricFilePath]
    let mostWritten: [MetricFilePath]
    let mostEdited: [MetricFilePath]
    let recentOperations: [MetricTimelinePoint]
}

struct MetricToolUsage: Decodable, Identifiable, Hashable, Sendable {
    let tool: String
    let calls: Int

    var id: String { tool }

    private enum CodingKeys: String, CodingKey {
        case tool, calls
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        tool = try container.decodeFlexibleString(forKeys: [.tool]) ?? "tool"
        calls = try container.decodeFlexibleInt(forKeys: [.calls]) ?? 0
    }
}

struct MetricToolError: Decodable, Identifiable, Hashable, Sendable {
    let tool: String
    let errors: Int

    var id: String { tool }

    private enum CodingKeys: String, CodingKey {
        case tool, errors
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        tool = try container.decodeFlexibleString(forKeys: [.tool]) ?? "tool"
        errors = try container.decodeFlexibleInt(forKeys: [.errors]) ?? 0
    }
}

struct ToolMetrics: Decodable, Hashable, Sendable {
    let mostUsed: [MetricToolUsage]
    let mostErrors: [MetricToolError]
    let recentCalls: [MetricTimelinePoint]
}

struct MetricProviderSummary: Decodable, Identifiable, Hashable, Sendable {
    let provider: String
    let url: String?
    let hits: Int
    let tokens: Int

    var id: String { provider }

    private enum CodingKeys: String, CodingKey {
        case provider, url, hits, tokens
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        provider = try container.decodeFlexibleString(forKeys: [.provider]) ?? "unknown"
        url = try container.decodeFlexibleString(forKeys: [.url])
        hits = try container.decodeFlexibleInt(forKeys: [.hits]) ?? 0
        tokens = try container.decodeFlexibleInt(forKeys: [.tokens]) ?? 0
    }
}

struct ProviderMetrics: Decodable, Hashable, Sendable {
    let providers: [MetricProviderSummary]
}

struct TimeSeriesDay: Decodable, Identifiable, Hashable, Sendable {
    let date: String
    let values: [String: Double]

    var id: String { date }
    var total: Double { values.values.reduce(0, +) }

    init(from decoder: Decoder) throws {
        let object = try decoder.singleValueContainer().decode([String: JSONValue].self)
        date = {
            if case .string(let value)? = object["date"] { return value }
            return ""
        }()
        values = object.reduce(into: [String: Double]()) { result, entry in
            guard entry.key != "date" else { return }
            switch entry.value {
            case .number(let value):
                result[entry.key] = value
            case .string(let value):
                if let parsed = Double(value) { result[entry.key] = parsed }
            default:
                break
            }
        }
    }
}

struct TimeSeriesData: Decodable, Hashable, Sendable {
    let days: [TimeSeriesDay]
}

struct MetricStorageComponent: Decodable, Hashable, Sendable {
    let path: String?
    let bytes: Int

    private enum CodingKeys: String, CodingKey {
        case path, bytes
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        path = try container.decodeFlexibleString(forKeys: [.path])
        bytes = try container.decodeFlexibleInt(forKeys: [.bytes]) ?? 0
    }
}

struct MetricsStorage: Decodable, Hashable, Sendable {
    struct Directories: Decodable, Hashable, Sendable {
        let cybaraDir: String?
        let dataDir: String?
        let logsDir: String?
        let memoryDir: String?
        let secureDir: String?
        let artifactsDir: String?
        let userSkillsDir: String?
        let sessionsDir: String?
        let mediaDir: String?
        let channelsDir: String?
    }

    struct Components: Decodable, Hashable, Sendable {
        let database: MetricStorageComponent?
        let artifacts: MetricStorageComponent?
        let logs: MetricStorageComponent?
        let memory: MetricStorageComponent?
        let secure: MetricStorageComponent?
        let skills: MetricStorageComponent?
        let sessions: MetricStorageComponent?
        let media: MetricStorageComponent?
        let channels: MetricStorageComponent?
        let other: MetricStorageComponent?
        let data: MetricStorageComponent?
    }

    struct TopLevelEntry: Decodable, Identifiable, Hashable, Sendable {
        let name: String
        let path: String
        let bytes: Int
        let type: String?

        var id: String { path }

        private enum CodingKeys: String, CodingKey {
            case name, path, bytes, type
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            name = try container.decodeFlexibleString(forKeys: [.name]) ?? "unknown"
            path = try container.decodeFlexibleString(forKeys: [.path]) ?? name
            bytes = try container.decodeFlexibleInt(forKeys: [.bytes]) ?? 0
            type = try container.decodeFlexibleString(forKeys: [.type])
        }
    }

    let totalBytes: Int
    let accountedBytes: Int?
    let uncategorizedBytes: Int?
    let directories: Directories?
    let components: Components?
    let topLevel: [TopLevelEntry]?

    private enum CodingKeys: String, CodingKey {
        case totalBytes, accountedBytes, uncategorizedBytes, directories, components, topLevel
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        totalBytes = try container.decodeFlexibleInt(forKeys: [.totalBytes]) ?? 0
        accountedBytes = try container.decodeFlexibleInt(forKeys: [.accountedBytes])
        uncategorizedBytes = try container.decodeFlexibleInt(forKeys: [.uncategorizedBytes])
        directories = try container.decodeIfPresent(Directories.self, forKey: .directories)
        components = try container.decodeIfPresent(Components.self, forKey: .components)
        topLevel = try container.decodeIfPresent([TopLevelEntry].self, forKey: .topLevel)
    }
}

struct MetricModelPerformance: Decodable, Identifiable, Hashable, Sendable {
    let model: String
    let provider: String
    let avgTps: Double
    let maxTps: Double
    let minTps: Double
    let avgLatencyMs: Double
    let totalTokens: Int
    let callCount: Int

    var id: String { "\(provider)-\(model)" }
}

struct ModelMetrics: Decodable, Hashable, Sendable {
    let models: [MetricModelPerformance]
}

struct MetricsInsights: Decodable, Hashable, Sendable {
    struct TokenBreakdown: Decodable, Hashable, Sendable {
        let total: Int?
        let input: Int?
        let output: Int?
        let cache: Int?
        let inputPct: Double?
        let outputPct: Double?
        let cachePct: Double?
    }

    struct Trend: Decodable, Hashable, Sendable {
        let current: Int?
        let previous: Int?
        let changePct: Double?
        let direction: String?
    }

    struct CacheEfficiency: Decodable, Hashable, Sendable {
        let cacheTokens: Int?
        let cacheSharePct: Double?
    }

    struct TopModel: Decodable, Hashable, Sendable {
        let model: String
        let tokens: Int
        let sharePct: Double
    }

    struct ProviderEfficiency: Decodable, Identifiable, Hashable, Sendable {
        let provider: String
        let tokens: Int
        let calls: Int
        let tokensPerCall: Double
        let sharePct: Double

        var id: String { provider }
    }

    struct ModelInsight: Decodable, Identifiable, Hashable, Sendable {
        let model: String
        let provider: String
        let avgTps: Double
        let maxTps: Double
        let minTps: Double
        let avgLatencyMs: Double
        let totalTokens: Int
        let callCount: Int
        let tokenSharePct: Double

        var id: String { "\(provider)-\(model)" }
    }

    struct ToolReliability: Decodable, Hashable, Sendable {
        let totalCalls: Int?
        let totalErrors: Int?
        let successRatePct: Double?
    }

    struct ToolUsage24h: Decodable, Identifiable, Hashable, Sendable {
        let tool: String
        let calls: Int

        var id: String { tool }
    }

    struct ContextHealth24h: Decodable, Hashable, Sendable {
        let warnings: Int?
        let criticalWarnings: Int?
    }

    let tokenBreakdown: TokenBreakdown?
    let tokenTrend24h: Trend?
    let cacheEfficiency: CacheEfficiency?
    let topModel: TopModel?
    let providerEfficiency: [ProviderEfficiency]
    let modelInsights: [ModelInsight]
    let toolReliability: ToolReliability?
    let toolUsage24h: [ToolUsage24h]
    let contextHealth24h: ContextHealth24h?
}

struct TokenAnalysisMetrics: Decodable, Hashable, Sendable {
    struct Summary: Decodable, Hashable, Sendable {
        let callCount: Int?
        let totalTokens: Int?
        let totalInputTokens: Int?
        let totalOutputTokens: Int?
        let averageTokensPerCall: Double?
        let medianTokensPerCall: Double?
        let inputToOutputRatio: Double?
        let outputToInputRatio: Double?
    }

    struct PromptOutputDistribution: Decodable, Hashable, Sendable {
        struct Band: Decodable, Identifiable, Hashable, Sendable {
            let band: String
            let calls: Int
            let sharePct: Double

            var id: String { band }
        }

        let sampleCount: Int?
        let bands: [Band]
    }

    struct TokenHeatmap: Decodable, Hashable, Sendable {
        struct HottestHour: Decodable, Hashable, Sendable {
            let date: String?
            let dayLabel: String?
            let hour: Int?
            let tokens: Int?
            let calls: Int?
        }

        struct Day: Decodable, Identifiable, Hashable, Sendable {
            struct Hour: Decodable, Identifiable, Hashable, Sendable {
                let hour: Int
                let tokens: Int
                let calls: Int
                let intensity: Double

                var id: Int { hour }
            }

            let date: String
            let dayLabel: String
            let hours: [Hour]

            var id: String { date }
        }

        let timezone: String?
        let maxBucketTokens: Int?
        let hottestHour: HottestHour?
        let days: [Day]
    }

    struct TokenCloudEntry: Decodable, Identifiable, Hashable, Sendable {
        let token: String
        let category: String
        let weight: Int
        let sharePct: Double

        var id: String { "\(category)-\(token)" }
    }

    struct ModelThoughtProfile: Decodable, Identifiable, Hashable, Sendable {
        let model: String
        let provider: String
        let totalTokens: Int
        let calls: Int
        let promptSharePct: Double
        let responseSharePct: Double
        let avgTokensPerCall: Double
        let avgLatencyMs: Double
        let avgTps: Double
        let behavior: String

        var id: String { "\(provider)-\(model)" }
    }

    struct TokenBurst: Decodable, Identifiable, Hashable, Sendable {
        let timestamp: String
        let model: String
        let provider: String
        let inputTokens: Int
        let outputTokens: Int
        let totalTokens: Int
        let durationMs: Double?
        let tokensPerSecond: Double?

        var id: String { "\(timestamp)-\(provider)-\(model)" }
    }

    struct Windows: Decodable, Hashable, Sendable {
        let analyzedDays: Int?
        let velocityHours: Int?
        let newestCallAt: String?
        let oldestCallAt: String?
        let recent24hTokens: Int?
    }

    let summary: Summary?
    let promptOutputDistribution: PromptOutputDistribution?
    let tokenHeatmap: TokenHeatmap?
    let hourlyVelocity24h: [MetricTimelinePoint]
    let tokenCloud: [TokenCloudEntry]
    let modelThoughtProfiles: [ModelThoughtProfile]
    let topTokenBursts: [TokenBurst]
    let windows: Windows?
}
