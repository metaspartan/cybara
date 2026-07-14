import Foundation

struct GatewayComputerUseStatus: Decodable {
    let available: Bool
    let command: String
    let configuredCommand: String?
    let driverSource: String?
    let platform: String
    let version: String?
    let accessibility: Bool?
    let screenRecording: Bool?
    let ready: Bool
    let message: String
    let installHint: String?
}

struct GatewayHealth: Decodable {
    let status: String?
    let version: String?
    let uptime: Double?
}

struct GatewayAgent: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let type: String?
    let model: String?
    let status: String?
    let provider: String?
    let provider_id: String?
    let provider_type: String?
    let system_prompt: String?
    let reasoning_effort: String?
    let supports_images: Bool?
    let created_at: String?
    let config: [String: JSONValue]?

    private enum CodingKeys: String, CodingKey {
        case id, name, label, type, model, status, state, provider, provider_id, providerId
        case provider_type, providerType
        case system_prompt, systemPrompt, reasoning_effort, reasoningEffort, supports_images, supportsImages
        case created_at, createdAt, config
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedID = try container.decodeFlexibleString(forKeys: [.id, .name])
        id = decodedID ?? UUID().uuidString
        name = try container.decodeFlexibleString(forKeys: [.name, .label, .id]) ?? id
        type = try container.decodeFlexibleString(forKeys: [.type])
        model = try container.decodeFlexibleString(forKeys: [.model])
        status = try container.decodeFlexibleString(forKeys: [.status, .state])
        provider = try container.decodeFlexibleString(forKeys: [.provider, .provider_id, .providerId])
        provider_id = try container.decodeFlexibleString(forKeys: [.provider_id, .providerId, .provider])
        provider_type = try container.decodeFlexibleString(forKeys: [.provider_type, .providerType])
        system_prompt = try container.decodeFlexibleString(forKeys: [.system_prompt, .systemPrompt])
        reasoning_effort = try container.decodeFlexibleString(forKeys: [.reasoning_effort, .reasoningEffort])
        supports_images = try container.decodeIfPresent(Bool.self, forKey: .supports_images)
            ?? container.decodeIfPresent(Bool.self, forKey: .supportsImages)
        created_at = try container.decodeFlexibleString(forKeys: [.created_at, .createdAt])
        config = try container.decodeJSONDictionary(forKey: .config)
    }

    var isRunning: Bool { status?.lowercased() == "running" }
    var providerID: String? { firstNonEmptyGatewayString(provider_id, provider) }
    var providerType: String? { firstNonEmptyGatewayString(provider_type) }
    var supportsImages: Bool { supports_images == true }

    var reasoningEffort: String {
        if let reasoning_effort, !reasoning_effort.isEmpty { return reasoning_effort }
        guard case .object(let modelParams)? = config?["model_params"],
              case .string(let effort)? = modelParams["reasoning_effort"]
        else { return "" }
        return effort
    }

    var toolProfile: String {
        guard case .string(let value)? = config?["tool_profile"], !value.isEmpty else {
            return "full"
        }
        return value
    }

    var autostart: Bool {
        guard case .bool(let value)? = config?["autostart"] else { return false }
        return value
    }
}

struct GatewayProvider: Decodable, Identifiable, Hashable {
    let id: String
    let name: String?
    let provider: String?
    let base_url: String?
    let enabled: Bool?
    let is_default: Bool?
    let created_at: String?
    let models: [String]?
    let authType: String?
    let oauthFlow: String?
    let hasOAuthConfig: Bool?
    let oauthLoginUrl: String?

    private enum CodingKeys: String, CodingKey {
        case id, name, label, provider, type, base_url, baseUrl, enabled, is_default, isDefault
        case created_at, createdAt, models, info, authType, auth_type, oauthFlow, oauth_flow
        case hasOAuthConfig, has_oauth_config, oauthLoginUrl, oauth_login_url
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let info = try? container.decodeIfPresent(JSONValue.self, forKey: .info)
        let infoObject: [String: JSONValue]? = {
            if case .object(let object)? = info { return object }
            return nil
        }()
        id = try container.decodeFlexibleString(forKeys: [.id, .provider, .name]) ?? UUID().uuidString
        name = try container.decodeFlexibleString(forKeys: [.name, .label, .provider])
        provider = try container.decodeFlexibleString(forKeys: [.provider, .type])
        base_url = try container.decodeFlexibleString(forKeys: [.base_url, .baseUrl])
        enabled = try container.decodeFlexibleBool(forKeys: [.enabled])
        is_default = try container.decodeFlexibleBool(forKeys: [.is_default, .isDefault])
        created_at = try container.decodeFlexibleString(forKeys: [.created_at, .createdAt])
        authType = try container.decodeFlexibleString(forKeys: [.authType, .auth_type])
            ?? GatewayProvider.stringValue(infoObject?["authType"])
        oauthFlow = try container.decodeFlexibleString(forKeys: [.oauthFlow, .oauth_flow])
            ?? GatewayProvider.stringValue(infoObject?["oauthFlow"])
        hasOAuthConfig = try container.decodeFlexibleBool(forKeys: [.hasOAuthConfig, .has_oauth_config])
            ?? GatewayProvider.boolValue(infoObject?["oauthConfig"])
        oauthLoginUrl = try container.decodeFlexibleString(forKeys: [.oauthLoginUrl, .oauth_login_url])
            ?? GatewayProvider.stringValue(infoObject?["oauthLoginUrl"])

        if let modelIDs = try container.decodeFlexibleStringArray(forKey: .models) {
            models = modelIDs
        } else if let infoObject {
            models = GatewayProvider.modelIDs(from: infoObject["models"])
        } else {
            models = nil
        }
    }

    private static func modelIDs(from value: JSONValue?) -> [String]? {
        guard case .array(let entries)? = value else { return nil }
        let ids = entries.compactMap { entry -> String? in
            switch entry {
            case .string(let value):
                return firstNonEmptyGatewayString(value)
            case .object(let object):
                if case .string(let id)? = object["id"] { return firstNonEmptyGatewayString(id) }
                if case .string(let modelID)? = object["model_id"] { return firstNonEmptyGatewayString(modelID) }
                return nil
            default:
                return nil
            }
        }
        return ids.isEmpty ? nil : ids
    }

    private static func stringValue(_ value: JSONValue?) -> String? {
        if case .string(let text)? = value { return firstNonEmptyGatewayString(text) }
        return nil
    }

    private static func boolValue(_ value: JSONValue?) -> Bool? {
        guard let value else { return nil }
        switch value {
        case .bool(let bool):
            return bool
        case .object:
            return true
        default:
            return nil
        }
    }

    var displayName: String { firstNonEmptyGatewayString(name, provider, id) ?? id }
    var providerType: String { firstNonEmptyGatewayString(provider) ?? id }
}

struct GatewayAvailableProvider: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let description: String?
    let baseUrl: String?
    let authType: String?
    let oauthFlow: String?
    let hasOAuthConfig: Bool?
    let oauthLoginUrl: String?
    let models: [GatewayAvailableProviderModel]
}

struct GatewayAvailableProviderModel: Decodable, Identifiable, Hashable {
    let id: String
    let name: String?
    let context: Int?
    let maxTokens: Int?
    let reasoning: Bool?
}

struct GatewayProviderModel: Decodable, Identifiable, Hashable {
    let model_id: String
    let model_name: String?
    let context_window: Int?
    let reasoning: Bool?

    var id: String { model_id }
    var displayName: String { firstNonEmptyGatewayString(model_name, model_id) ?? model_id }

    private enum CodingKeys: String, CodingKey {
        case id, model_id, modelId, model_name, modelName, context_window, contextWindow, reasoning
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        model_id = try container.decodeFlexibleString(forKeys: [.model_id, .modelId, .id]) ?? "model"
        model_name = try container.decodeFlexibleString(forKeys: [.model_name, .modelName])
        context_window = try container.decodeFlexibleInt(forKeys: [.context_window, .contextWindow])
        reasoning = try container.decodeFlexibleBool(forKeys: [.reasoning])
    }
}

enum JSONValue: Decodable, Hashable, Sendable {
    case string(String)
    case bool(Bool)
    case number(Double)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    var anyValue: Any {
        switch self {
        case .string(let value): return value
        case .bool(let value): return value
        case .number(let value): return value
        case .object(let value): return value.mapValues(\.anyValue)
        case .array(let value): return value.map(\.anyValue)
        case .null: return NSNull()
        }
    }

    var displayString: String {
        switch self {
        case .string(let value): return value
        case .bool(let value): return value ? "true" : "false"
        case .number(let value):
            return value.rounded() == value ? String(Int(value)) : String(value)
        case .object, .array:
            return jsonString(pretty: true) ?? String(describing: anyValue)
        case .null: return "null"
        }
    }

    func jsonString(pretty: Bool = false) -> String? {
        switch self {
        case .object, .array:
            break
        default:
            return displayString
        }
        let options: JSONSerialization.WritingOptions = pretty ? [.prettyPrinted, .sortedKeys] : [.sortedKeys]
        guard let data = try? JSONSerialization.data(withJSONObject: anyValue, options: options) else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }
}

struct GatewayToolCall: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let args: [String: JSONValue]?
    let status: String?
    let result: JSONValue?
    let error: String?
    let duration: Double?
    let started_at: Double?
    let timeline_index: Int?
    let command: String?
    let detail: String?
    let sandboxProvider: String?
    let _truncated: String?
    let _source_index: Int?

    private enum CodingKeys: String, CodingKey {
        case id, name, args, arguments, status, result, error, duration, started_at, timeline_index, command, detail
        case sandboxProvider, sandbox_provider, _truncated, _source_index
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        name = (try container.decodeIfPresent(String.self, forKey: .name)) ?? "tool"
        args = try container.decodeIfPresent([String: JSONValue].self, forKey: .args)
            ?? container.decodeIfPresent([String: JSONValue].self, forKey: .arguments)
        status = try container.decodeIfPresent(String.self, forKey: .status)
        result = try container.decodeIfPresent(JSONValue.self, forKey: .result)
        error = try container.decodeIfPresent(String.self, forKey: .error)
        duration = try container.decodeFlexibleDouble(forKey: .duration)
        started_at = try container.decodeFlexibleDouble(forKey: .started_at)
        timeline_index = try container.decodeIfPresent(Int.self, forKey: .timeline_index)
        command = try container.decodeIfPresent(String.self, forKey: .command)
        detail = try container.decodeIfPresent(String.self, forKey: .detail)
        sandboxProvider = try container.decodeIfPresent(String.self, forKey: .sandboxProvider)
            ?? container.decodeIfPresent(String.self, forKey: .sandbox_provider)
        _truncated = try container.decodeIfPresent(String.self, forKey: ._truncated)
        _source_index = try container.decodeIfPresent(Int.self, forKey: ._source_index)
        let rawID = try container.decodeIfPresent(String.self, forKey: .id)
        id = firstNonEmptyGatewayString(rawID)
            ?? "\(name)-\(timeline_index.map(String.init) ?? String(_source_index ?? 0))"
    }
}

struct GatewayProcessActivity: Decodable, Identifiable, Hashable {
    let id: String
    let phase: String?
    let text: String?
    let timestamp: Double?
    let toolName: String?
    let toolCallId: String?
    let sandboxProvider: String?

    private enum CodingKeys: String, CodingKey {
        case id, phase, text, timestamp, toolName, tool_name, toolCallId, tool_call_id
        case sandboxProvider, sandbox_provider
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = (try container.decodeIfPresent(String.self, forKey: .id)) ?? UUID().uuidString
        phase = try container.decodeIfPresent(String.self, forKey: .phase)
        text = try container.decodeIfPresent(String.self, forKey: .text)
        timestamp = try container.decodeFlexibleDouble(forKey: .timestamp)
        toolName = try container.decodeIfPresent(String.self, forKey: .toolName)
            ?? container.decodeIfPresent(String.self, forKey: .tool_name)
        toolCallId = try container.decodeIfPresent(String.self, forKey: .toolCallId)
            ?? container.decodeIfPresent(String.self, forKey: .tool_call_id)
        sandboxProvider = try container.decodeIfPresent(String.self, forKey: .sandboxProvider)
            ?? container.decodeIfPresent(String.self, forKey: .sandbox_provider)
    }
}

struct GatewayProcessActivityPayload: Encodable, Hashable {
    let id: String
    let phase: String
    let text: String
    let timestamp: Double?
    let toolName: String?
    let toolCallId: String?
    let sandboxProvider: String?
}

struct NativeAttachedImage: Identifiable, Hashable, Sendable {
    let id: UUID
    let base64: String
    let mimeType: String
    let size: Int

    init(id: UUID = UUID(), base64: String, mimeType: String, size: Int? = nil) {
        self.id = id
        self.base64 = base64
        self.mimeType = mimeType
        self.size = size ?? (base64.count * 3) / 4
    }
}

struct GatewayAgentTransfer: Decodable, Identifiable, Hashable {
    let fromAgentId: String
    let fromAgentName: String
    let toAgentId: String
    let toAgentName: String
    let reason: String
    let contextMode: String
    let contextSummary: String?
    let requestedAt: String?

    var id: String {
        [fromAgentId, toAgentId, requestedAt ?? "transfer"].joined(separator: ":")
    }
}

struct GatewaySessionMessage: Decodable, Identifiable, Hashable {
    let role: String
    let content: String
    let timestamp: String?
    let thinking: String?
    let tool_calls: [GatewayToolCall]?
    let process_activities: [GatewayProcessActivity]?
    let agent_transfers: [GatewayAgentTransfer]?
    let _tool_calls_total_count: Int?
    let _tool_calls_hidden_count: Int?
    var attachedImages: [NativeAttachedImage] = []
    var id = UUID()

    private enum CodingKeys: String, CodingKey {
        case role, content, timestamp, thinking, tool_calls, process_activities, agent_transfers
        case _tool_calls_total_count, _tool_calls_hidden_count
    }

    init(
        role: String,
        content: String,
        timestamp: String?,
        thinking: String? = nil,
        tool_calls: [GatewayToolCall]? = nil,
        process_activities: [GatewayProcessActivity]? = nil,
        agent_transfers: [GatewayAgentTransfer]? = nil,
        _tool_calls_total_count: Int? = nil,
        _tool_calls_hidden_count: Int? = nil,
        attachedImages: [NativeAttachedImage] = []
    ) {
        let normalized = Self.normalizedContentAndThinking(role: role, content: content, thinking: thinking)
        self.role = role
        self.content = normalized.content
        self.timestamp = timestamp
        self.thinking = normalized.thinking
        self.tool_calls = tool_calls
        self.process_activities = process_activities
        self.agent_transfers = agent_transfers
        self._tool_calls_total_count = _tool_calls_total_count
        self._tool_calls_hidden_count = _tool_calls_hidden_count
        self.attachedImages = attachedImages
    }

    func withAttachedImages(_ images: [NativeAttachedImage]) -> GatewaySessionMessage {
        var copy = self
        copy.attachedImages = images
        return copy
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let role = try container.decodeIfPresent(String.self, forKey: .role) ?? "message"
        let content = try container.decodeIfPresent(String.self, forKey: .content) ?? ""
        let thinking = try container.decodeIfPresent(String.self, forKey: .thinking)
        let normalized = Self.normalizedContentAndThinking(role: role, content: content, thinking: thinking)
        self.role = role
        self.content = normalized.content
        timestamp = try container.decodeIfPresent(String.self, forKey: .timestamp)
        self.thinking = normalized.thinking
        tool_calls = try container.decodeIfPresent([GatewayToolCall].self, forKey: .tool_calls)
        process_activities = try container.decodeIfPresent([GatewayProcessActivity].self, forKey: .process_activities)
        agent_transfers = try container.decodeIfPresent([GatewayAgentTransfer].self, forKey: .agent_transfers)
        _tool_calls_total_count = try container.decodeIfPresent(Int.self, forKey: ._tool_calls_total_count)
        _tool_calls_hidden_count = try container.decodeIfPresent(Int.self, forKey: ._tool_calls_hidden_count)
    }

    private static func normalizedContentAndThinking(
        role: String,
        content: String,
        thinking: String?
    ) -> (content: String, thinking: String?) {
        guard role.lowercased() == "assistant" else {
            return (content, firstNonEmptyGatewayString(thinking))
        }
        let stripped = NativeMarkdown.stripAssistantMarkupTags(content)
        return (
            stripped.content,
            firstNonEmptyGatewayString(thinking, stripped.thinking)
        )
    }
}

private extension KeyedDecodingContainer {
    func decodeFlexibleString(forKeys keys: [Key]) throws -> String? {
        for key in keys {
            if let value = try? decodeIfPresent(String.self, forKey: key),
               let trimmed = firstNonEmptyGatewayString(value) {
                return trimmed
            }
            if let value = try? decodeIfPresent(Int.self, forKey: key) {
                return String(value)
            }
            if let value = try? decodeIfPresent(Double.self, forKey: key) {
                return value.rounded() == value ? String(Int(value)) : String(value)
            }
            if let value = try? decodeIfPresent(Bool.self, forKey: key) {
                return value ? "true" : "false"
            }
        }
        return nil
    }

    func decodeFlexibleInt(forKeys keys: [Key]) throws -> Int? {
        for key in keys {
            if let value = try? decodeIfPresent(Int.self, forKey: key) {
                return value
            }
            if let value = try? decodeIfPresent(Double.self, forKey: key), value.isFinite {
                return Int(value.rounded())
            }
            if let value = try? decodeIfPresent(String.self, forKey: key),
               let parsed = Int(value.trimmingCharacters(in: .whitespacesAndNewlines)) {
                return parsed
            }
        }
        return nil
    }

    func decodeFlexibleBool(forKeys keys: [Key]) throws -> Bool? {
        for key in keys {
            if let value = try? decodeIfPresent(Bool.self, forKey: key) {
                return value
            }
            if let value = try? decodeIfPresent(Int.self, forKey: key) {
                return value != 0
            }
            if let value = try? decodeIfPresent(Double.self, forKey: key) {
                return value != 0
            }
            if let value = try? decodeIfPresent(String.self, forKey: key) {
                switch value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
                case "true", "1", "yes", "enabled": return true
                case "false", "0", "no", "disabled": return false
                default: continue
                }
            }
        }
        return nil
    }

    func decodeFlexibleStringArray(forKey key: Key) throws -> [String]? {
        if let values = try? decodeIfPresent([String].self, forKey: key) {
            let normalized = values.compactMap { firstNonEmptyGatewayString($0) }
            return normalized.isEmpty ? nil : normalized
        }
        if let values = try? decodeIfPresent([JSONValue].self, forKey: key) {
            let normalized = values.compactMap { value -> String? in
                switch value {
                case .string(let text):
                    return firstNonEmptyGatewayString(text)
                case .object(let object):
                    if case .string(let id)? = object["id"] { return firstNonEmptyGatewayString(id) }
                    if case .string(let modelID)? = object["model_id"] { return firstNonEmptyGatewayString(modelID) }
                    return nil
                default:
                    return nil
                }
            }
            return normalized.isEmpty ? nil : normalized
        }
        if let value = try? decodeIfPresent(String.self, forKey: key),
           let data = value.data(using: .utf8),
           let decoded = try? JSONDecoder().decode([String].self, from: data) {
            let normalized = decoded.compactMap { firstNonEmptyGatewayString($0) }
            return normalized.isEmpty ? nil : normalized
        }
        return nil
    }

    func decodeJSONDictionary(forKey key: Key) throws -> [String: JSONValue]? {
        if let value = try? decodeIfPresent([String: JSONValue].self, forKey: key) {
            return value
        }
        if let value = try? decodeIfPresent(String.self, forKey: key),
           let data = value.data(using: .utf8),
           let decoded = try? JSONDecoder().decode([String: JSONValue].self, from: data) {
            return decoded
        }
        return nil
    }

    func decodeFlexibleDouble(forKey key: Key) throws -> Double? {
        if let value = try? decodeIfPresent(Double.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return Double(value) }
        if let value = try? decodeIfPresent(String.self, forKey: key) {
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            if let parsed = Double(trimmed) {
                return parsed
            }
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = fractional.date(from: trimmed) ?? ISO8601DateFormatter().date(from: trimmed) {
                return date.timeIntervalSince1970 * 1000
            }
        }
        return nil
    }

    func decodeFlexibleDouble(forKeys keys: [Key]) throws -> Double? {
        for key in keys {
            if let value = try decodeFlexibleDouble(forKey: key) {
                return value
            }
        }
        return nil
    }
}

struct GatewaySessionLastMessage: Decodable, Hashable {
    let role: String?
    let content: String?

    var preview: String? {
        firstNonEmptyGatewayString(content)
    }
}

struct GatewaySessionContextUsage: Decodable, Hashable {
    let usedTokens: Int
    let limitTokens: Int
    let remainingTokens: Int
    let usedPercent: Double
    let messageCount: Int
    let transcriptTokens: Int?
    let metadataTokens: Int?
    let compacted: Bool?
    let compactionCount: Int?
    let compactedTokens: Int?
    let source: String?

    private enum CodingKeys: String, CodingKey {
        case usedTokens, used_tokens, limitTokens, limit_tokens, remainingTokens, remaining_tokens
        case usedPercent, used_percent, messageCount, message_count
        case transcriptTokens, transcript_tokens, metadataTokens, metadata_tokens
        case compacted, compactionCount, compaction_count, compactedTokens, compacted_tokens, source
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        usedTokens = try container.decodeFlexibleInt(forKeys: [.usedTokens, .used_tokens]) ?? 0
        limitTokens = max(1, try container.decodeFlexibleInt(forKeys: [.limitTokens, .limit_tokens]) ?? 1)
        remainingTokens = max(0, try container.decodeFlexibleInt(forKeys: [.remainingTokens, .remaining_tokens]) ?? limitTokens - usedTokens)
        usedPercent = try container.decodeFlexibleDouble(forKeys: [.usedPercent, .used_percent]) ?? min(100, (Double(usedTokens) / Double(limitTokens)) * 100)
        messageCount = max(0, try container.decodeFlexibleInt(forKeys: [.messageCount, .message_count]) ?? 0)
        transcriptTokens = try container.decodeFlexibleInt(forKeys: [.transcriptTokens, .transcript_tokens])
        metadataTokens = try container.decodeFlexibleInt(forKeys: [.metadataTokens, .metadata_tokens])
        compacted = try container.decodeIfPresent(Bool.self, forKey: .compacted)
        compactionCount = try container.decodeFlexibleInt(forKeys: [.compactionCount, .compaction_count])
        compactedTokens = try container.decodeFlexibleInt(forKeys: [.compactedTokens, .compacted_tokens])
        source = try container.decodeIfPresent(String.self, forKey: .source)
    }
}

struct GatewaySessionTokenUsage: Decodable, Hashable {
    let inputTokens: Int
    let outputTokens: Int
    let cachedInputTokens: Int
    let cacheWriteTokens: Int
    let cacheHitRate: Double?
    let totalTokens: Int
    let callCount: Int
    let durationMs: Int
    let tokensPerSecond: Double?
    let firstTokenMs: Double?
    let source: String?

    private enum CodingKeys: String, CodingKey {
        case inputTokens, input_tokens, outputTokens, output_tokens, totalTokens, total_tokens
        case callCount, call_count, durationMs, duration_ms, tokensPerSecond, tokens_per_second, source
        case cachedInputTokens, cached_input_tokens, cacheWriteTokens, cache_write_tokens
        case cacheHitRate, cache_hit_rate, firstTokenMs, first_token_ms
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        inputTokens = max(0, try container.decodeFlexibleInt(forKeys: [.inputTokens, .input_tokens]) ?? 0)
        outputTokens = max(0, try container.decodeFlexibleInt(forKeys: [.outputTokens, .output_tokens]) ?? 0)
        cachedInputTokens = max(0, try container.decodeFlexibleInt(forKeys: [.cachedInputTokens, .cached_input_tokens]) ?? 0)
        cacheWriteTokens = max(0, try container.decodeFlexibleInt(forKeys: [.cacheWriteTokens, .cache_write_tokens]) ?? 0)
        cacheHitRate = try container.decodeFlexibleDouble(forKeys: [.cacheHitRate, .cache_hit_rate])
        let decodedTotal = try container.decodeFlexibleInt(forKeys: [.totalTokens, .total_tokens]) ?? 0
        totalTokens = max(decodedTotal, inputTokens + outputTokens)
        callCount = max(0, try container.decodeFlexibleInt(forKeys: [.callCount, .call_count]) ?? 0)
        durationMs = max(0, try container.decodeFlexibleInt(forKeys: [.durationMs, .duration_ms]) ?? 0)
        tokensPerSecond = try container.decodeFlexibleDouble(forKeys: [.tokensPerSecond, .tokens_per_second])
        firstTokenMs = try container.decodeFlexibleDouble(forKeys: [.firstTokenMs, .first_token_ms])
        source = try container.decodeFlexibleString(forKeys: [.source])
    }
}

struct GatewaySession: Decodable, Identifiable, Hashable {
    let id: String
    let title: String?
    let agent_id: String?
    let agent_name: String?
    let agent_type: String?
    let provider: String?
    let provider_id: String?
    let provider_name: String?
    let model: String?
    let message_count: Int?
    let created_at: String?
    let updated_at: String?
    let workspace_dir: String?
    let pinned: Bool?
    let last_message: GatewaySessionLastMessage?
    let contextUsage: GatewaySessionContextUsage?
    let tokenUsage: GatewaySessionTokenUsage?
    let messagesList: [GatewaySessionMessage]?

    private enum CodingKeys: String, CodingKey {
        case id, title, agent_id, agentId, agent_name, agentName, agent_type, agentType
        case provider, provider_id, providerId, provider_name, providerName, model
        case message_count, messageCount, created_at, createdAt, updated_at, updatedAt
        case workspace_dir, workspaceDir, pinned, last_message, lastMessage
        case contextUsage, context_usage, tokenUsage, token_usage, messagesList, messages
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeFlexibleString(forKeys: [.id]) ?? UUID().uuidString
        title = try container.decodeFlexibleString(forKeys: [.title])
        agent_id = try container.decodeFlexibleString(forKeys: [.agent_id, .agentId])
        agent_name = try container.decodeFlexibleString(forKeys: [.agent_name, .agentName])
        agent_type = try container.decodeFlexibleString(forKeys: [.agent_type, .agentType])
        provider = try container.decodeFlexibleString(forKeys: [.provider])
        provider_id = try container.decodeFlexibleString(forKeys: [.provider_id, .providerId])
        provider_name = try container.decodeFlexibleString(forKeys: [.provider_name, .providerName])
        model = try container.decodeFlexibleString(forKeys: [.model])
        message_count = try container.decodeFlexibleInt(forKeys: [.message_count, .messageCount])
        created_at = try container.decodeFlexibleString(forKeys: [.created_at, .createdAt])
        updated_at = try container.decodeFlexibleString(forKeys: [.updated_at, .updatedAt])
        workspace_dir = try container.decodeFlexibleString(forKeys: [.workspace_dir, .workspaceDir])
        pinned = try container.decodeFlexibleBool(forKeys: [.pinned])
        last_message = (try? container.decodeIfPresent(GatewaySessionLastMessage.self, forKey: .last_message))
            ?? (try? container.decodeIfPresent(GatewaySessionLastMessage.self, forKey: .lastMessage))
        contextUsage = (try? container.decodeIfPresent(GatewaySessionContextUsage.self, forKey: .contextUsage))
            ?? (try? container.decodeIfPresent(GatewaySessionContextUsage.self, forKey: .context_usage))
        tokenUsage = (try? container.decodeIfPresent(GatewaySessionTokenUsage.self, forKey: .tokenUsage))
            ?? (try? container.decodeIfPresent(GatewaySessionTokenUsage.self, forKey: .token_usage))
        messagesList = (try? container.decodeIfPresent([GatewaySessionMessage].self, forKey: .messagesList))
            ?? (try? container.decodeIfPresent([GatewaySessionMessage].self, forKey: .messages))
    }

    var displayTitle: String {
        gatewaySessionDisplayTitle(
            title,
            prefixes: [agent_name, agent_id],
            fallback: String(id.prefix(8))
        )
    }
    var workspaceLabel: String? { gatewayWorkspaceLabel(workspace_dir) }

    var providerModelSummary: String {
        providerModelLabel() ?? agentContextSummary ?? agentIDSummary ?? "Local gateway routing"
    }

    var agentContextSummary: String? {
        firstNonEmptyGatewayString(agent_name, gatewayProviderDisplayName(agent_type))
    }

    var providerModelAndAgentSummary: String {
        routeSummary()
    }

    func routeSummary(agent: GatewayAgent? = nil, provider resolvedProvider: GatewayProvider? = nil) -> String {
        let providerModel = providerModelLabel(agent: agent, provider: resolvedProvider)
        let agentLabel = firstNonEmptyGatewayString(
            agent_name,
            agent?.name,
            gatewayProviderDisplayName(agent_type),
            gatewayProviderDisplayName(agent?.type),
            agentIDSummary
        )

        if let providerModel, let agentLabel {
            return "\(providerModel) · via \(agentLabel)"
        }
        if let providerModel { return providerModel }
        if let agentLabel { return agentLabel }
        return "Local gateway routing"
    }

    private func providerModelLabel(
        agent: GatewayAgent? = nil,
        provider resolvedProvider: GatewayProvider? = nil
    ) -> String? {
        let providerLabel = firstNonEmptyGatewayString(
            provider_name,
            resolvedProvider?.displayName,
            gatewayProviderDisplayNameForProviderType(provider),
            gatewayProviderDisplayNameForProviderType(agent?.provider)
        )
        let modelLabel = firstNonEmptyGatewayString(model, agent?.model)
        if let providerLabel, let modelLabel {
            return "\(providerLabel) · \(modelLabel)"
        }
        if let modelLabel { return modelLabel }
        if let providerLabel { return providerLabel }
        return nil
    }

    private var agentIDSummary: String? {
        guard let agentID = firstNonEmptyGatewayString(agent_id) else { return nil }
        let display = agentID.count <= 12 ? agentID : String(agentID.prefix(8))
        return "Agent \(display)"
    }
}

func gatewaySessionRouteSummary(
    _ session: GatewaySession,
    agents: [GatewayAgent],
    providers: [GatewayProvider]
) -> String {
    let agent = gatewayAgent(for: session, agents: agents)
    let provider = gatewayProvider(for: session, agent: agent, providers: providers)
    return session.routeSummary(agent: agent, provider: provider)
}

func gatewayAgent(for session: GatewaySession, agents: [GatewayAgent]) -> GatewayAgent? {
    guard let agentID = firstNonEmptyGatewayString(session.agent_id) else { return nil }
    return agents.first { $0.id == agentID }
}

func gatewayProvider(
    for session: GatewaySession,
    agent: GatewayAgent?,
    providers: [GatewayProvider]
) -> GatewayProvider? {
    let providerID = firstNonEmptyGatewayString(session.provider_id, session.provider, agent?.providerID)
    guard let providerID else { return nil }
    return providers.first { $0.id == providerID || $0.providerType == providerID }
}

func firstNonEmptyGatewayString(_ values: String?...) -> String? {
    for value in values {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !trimmed.isEmpty { return trimmed }
    }
    return nil
}

func gatewaySessionDisplayTitle(
    _ title: String?,
    prefixes: [String?],
    fallback: String
) -> String {
    guard let rawTitle = firstNonEmptyGatewayString(title) else { return fallback }
    let knownPrefixes: [String?] = [
        "Anthropic",
        "Claude",
        "Codex",
        "DeepSeek",
        "Gemini",
        "GLM",
        "GPT",
        "Grok",
        "Kimi",
        "Mini",
        "MiniMax",
        "Ollama",
        "OpenAI",
        "OpenRouter",
        "Qwen",
        "Zai",
    ]
    var resolvedTitle = rawTitle
    for prefix in prefixes + knownPrefixes {
        guard let prefix = firstNonEmptyGatewayString(prefix) else { continue }
        guard resolvedTitle.range(of: prefix, options: [.caseInsensitive, .anchored]) != nil else {
            continue
        }
        let remainder = resolvedTitle.dropFirst(prefix.count)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let first = remainder.first, [":", "-", "–", "—"].contains(String(first)) else {
            continue
        }
        let stripped = remainder.dropFirst()
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if !stripped.isEmpty {
            resolvedTitle = stripped
            break
        }
    }
    return firstNonEmptyGatewayString(resolvedTitle) ?? rawTitle
}

func gatewayProviderDisplayName(_ value: String?) -> String? {
    guard let trimmed = firstNonEmptyGatewayString(value) else { return nil }
    let normalized = trimmed.lowercased()
    let knownNames: [String: String] = [
        "anthropic": "Anthropic",
        "azure": "Azure",
        "google": "Google",
        "google_vertex": "Google Vertex",
        "groq": "Groq",
        "featherless": "Featherless AI",
        "kimi-code": "Kimi",
        "longcat": "LongCat",
        "minimax": "MiniMax",
        "ollama": "Ollama",
        "openai": "OpenAI",
        "openrouter": "OpenRouter",
        "xai": "xAI",
    ]
    if let known = knownNames[normalized] { return known }
    return trimmed
        .split { $0 == "_" || $0 == "-" }
        .map { $0.prefix(1).uppercased() + String($0.dropFirst()) }
        .joined(separator: " ")
}

func gatewayWorkspaceLabel(_ path: String?, maxLength: Int = 44) -> String? {
    guard let path = firstNonEmptyGatewayString(path) else { return nil }
    let normalized = path.replacingOccurrences(of: "\\", with: "/")
    guard normalized.count > maxLength, maxLength > 8 else { return normalized }
    let segments = normalized.split(separator: "/").map(String.init)
    let tail = segments.last ?? normalized
    if tail.count + 4 >= maxLength {
        return ".../" + String(tail.suffix(max(0, maxLength - 4)))
    }
    let prefixLength = max(0, maxLength - tail.count - 4)
    return String(normalized.prefix(prefixLength)) + ".../" + tail
}

func gatewayWorkspaceFolderName(_ path: String?) -> String? {
    guard let path = firstNonEmptyGatewayString(path) else { return nil }
    let normalized = path
        .replacingOccurrences(of: "\\", with: "/")
        .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    let segments = normalized.split(separator: "/").map(String.init)
    return firstNonEmptyGatewayString(segments.last, normalized)
}

private func gatewayProviderDisplayNameForProviderType(_ value: String?) -> String? {
    guard let value = firstNonEmptyGatewayString(value) else { return nil }
    // Provider IDs are UUIDs in normal gateway rows. Do not turn those into
    // noisy labels when the provider list has not been loaded yet.
    if value.range(
        of: #"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"#,
        options: .regularExpression
    ) != nil {
        return nil
    }
    return gatewayProviderDisplayName(value)
}

struct GatewaySessionWorkspaceUpdateResponse: Decodable, Hashable {
    let success: Bool?
    let sessionId: String?
    let workspaceDir: String?
    let error: String?

    private enum CodingKeys: String, CodingKey {
        case success, sessionId, session_id, workspaceDir, workspace_dir, error
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        success = try container.decodeFlexibleBool(forKeys: [.success])
        sessionId = try container.decodeFlexibleString(forKeys: [.sessionId, .session_id])
        workspaceDir = try container.decodeFlexibleString(forKeys: [.workspaceDir, .workspace_dir])
        error = try container.decodeFlexibleString(forKeys: [.error])
    }
}

struct GatewaySessionAgentUpdateResponse: Decodable, Hashable {
    let success: Bool?
    let sessionId: String?
    let agentId: String?
    let agentName: String?
    let provider: String?
    let providerId: String?
    let providerName: String?
    let model: String?
    let contextUsage: GatewaySessionContextUsage?
    let tokenUsage: GatewaySessionTokenUsage?
    let error: String?

    private enum CodingKeys: String, CodingKey {
        case success, sessionId, session_id, agentId, agent_id, agentName, agent_name
        case provider, providerId, provider_id, providerName, provider_name, model
        case contextUsage, context_usage, tokenUsage, token_usage, error
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        success = try container.decodeFlexibleBool(forKeys: [.success])
        sessionId = try container.decodeFlexibleString(forKeys: [.sessionId, .session_id])
        agentId = try container.decodeFlexibleString(forKeys: [.agentId, .agent_id])
        agentName = try container.decodeFlexibleString(forKeys: [.agentName, .agent_name])
        provider = try container.decodeFlexibleString(forKeys: [.provider])
        providerId = try container.decodeFlexibleString(forKeys: [.providerId, .provider_id])
        providerName = try container.decodeFlexibleString(forKeys: [.providerName, .provider_name])
        model = try container.decodeFlexibleString(forKeys: [.model])
        contextUsage = (try? container.decodeIfPresent(GatewaySessionContextUsage.self, forKey: .contextUsage))
            ?? (try? container.decodeIfPresent(GatewaySessionContextUsage.self, forKey: .context_usage))
        tokenUsage = (try? container.decodeIfPresent(GatewaySessionTokenUsage.self, forKey: .tokenUsage))
            ?? (try? container.decodeIfPresent(GatewaySessionTokenUsage.self, forKey: .token_usage))
        error = try container.decodeFlexibleString(forKeys: [.error])
    }
}

struct GatewaySessionForkResponse: Decodable, Hashable {
    struct Fork: Decodable, Hashable {
        let sessionId: String
        let sourceSessionId: String
        let agentId: String
        let messageCount: Int
        let workspaceDir: String?
        let title: String?
    }

    let success: Bool
    let fork: Fork?
    let error: String?
}

struct GatewayGoldenSaveResponse: Decodable, Hashable {
    let success: Bool
    let error: String?
}

struct GatewaySuccessResponse: Decodable, Hashable {
    let success: Bool
    let error: String?

    private enum CodingKeys: String, CodingKey {
        case success, error
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        success = try container.decodeFlexibleBool(forKeys: [.success]) ?? false
        error = try container.decodeFlexibleString(forKeys: [.error])
    }
}

struct GatewayGitBranchResponse: Decodable, Hashable {
    let branch: String?
}

struct GatewayGitBranchSummary: Decodable, Identifiable, Hashable {
    let name: String
    let current: Bool

    var id: String { name }

    private enum CodingKeys: String, CodingKey {
        case name, current
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        name = try container.decodeFlexibleString(forKeys: [.name]) ?? ""
        current = try container.decodeFlexibleBool(forKeys: [.current]) ?? false
    }
}

struct GatewayGitBranchesResponse: Decodable, Hashable {
    let success: Bool
    let current: String?
    let branches: [GatewayGitBranchSummary]
    let error: String?

    private enum CodingKeys: String, CodingKey {
        case success, current, branches, error
    }

    init(success: Bool, current: String?, branches: [GatewayGitBranchSummary], error: String?) {
        self.success = success
        self.current = current
        self.branches = branches
        self.error = error
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        success = try container.decodeFlexibleBool(forKeys: [.success]) ?? true
        current = try container.decodeFlexibleString(forKeys: [.current])
        branches = (try? container.decodeIfPresent([GatewayGitBranchSummary].self, forKey: .branches)) ?? []
        error = try container.decodeFlexibleString(forKeys: [.error])
    }
}

struct GatewayGitBranchCheckoutResponse: Decodable, Hashable {
    let success: Bool
    let branch: String?
    let error: String?

    private enum CodingKeys: String, CodingKey {
        case success, branch, error
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        success = try container.decodeFlexibleBool(forKeys: [.success]) ?? false
        branch = try container.decodeFlexibleString(forKeys: [.branch])
        error = try container.decodeFlexibleString(forKeys: [.error])
    }
}

struct GatewayMemoryEntry: Decodable, Identifiable, Hashable {
    let id: String
    let timestamp: String?
    let type: String?
    let content: String

    private enum CodingKeys: String, CodingKey {
        case id, timestamp, created_at, createdAt, time, type, kind, content, text, body, message
    }

    init(from decoder: Decoder) throws {
        if let value = try? decoder.singleValueContainer().decode(String.self) {
            id = "entry-\(String(value.prefix(32)))"
            timestamp = nil
            type = nil
            content = value
            return
        }

        let container = try decoder.container(keyedBy: CodingKeys.self)
        timestamp = try container.decodeFlexibleString(forKeys: [.timestamp, .created_at, .createdAt, .time])
        type = try container.decodeFlexibleString(forKeys: [.type, .kind])
        content = try container.decodeFlexibleString(forKeys: [.content, .text, .body, .message]) ?? ""
        id = try container.decodeFlexibleString(forKeys: [.id])
            ?? "\(timestamp ?? type ?? "entry")-\(String(content.prefix(32)))"
    }
}

struct GatewayMemoryFile: Decodable, Identifiable, Hashable {
    let file: String
    let entries: [GatewayMemoryEntry]

    var id: String { file }

    private enum CodingKeys: String, CodingKey {
        case file, name, entries
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        file = try container.decodeFlexibleString(forKeys: [.file, .name]) ?? "memory"
        entries = (try? container.decodeIfPresent([GatewayMemoryEntry].self, forKey: .entries)) ?? []
    }
}

struct GatewayMemoryList: Decodable, Hashable {
    let files: [String]
    let memories: [GatewayMemoryFile]

    private enum CodingKeys: String, CodingKey {
        case files, memories
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        memories = (try? container.decodeIfPresent([GatewayMemoryFile].self, forKey: .memories)) ?? []
        let decodedFiles = try container.decodeFlexibleStringArray(forKey: .files) ?? []
        files = Array(Set(decodedFiles + memories.map(\.file))).sorted()
    }
}

struct GatewayMemorySearchResult: Decodable, Identifiable, Hashable {
    let file: String
    let entry: GatewayMemoryEntry

    var id: String { "\(file)-\(entry.id)" }
}

struct GatewayMemorySearchResponse: Decodable, Hashable {
    let results: [GatewayMemorySearchResult]
}

struct GatewayMemoryCreateResponse: Decodable, Hashable {
    let success: Bool
    let file: String
    let appended: Bool?
    let error: String?

    private enum CodingKeys: String, CodingKey {
        case success, file, appended, error
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        success = try container.decodeFlexibleBool(forKeys: [.success]) ?? false
        file = try container.decodeFlexibleString(forKeys: [.file]) ?? ""
        appended = try container.decodeFlexibleBool(forKeys: [.appended])
        error = try container.decodeFlexibleString(forKeys: [.error])
    }
}

struct GatewayTask: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let type: String?
    let schedule: String?
    let status: String?
    let agent_id: String?
    let action: String?
    let description: String?
    let enabled: Bool?
    let last_run: String?
    let next_run: String?
    let config: [String: JSONValue]?

    private enum CodingKeys: String, CodingKey {
        case id, name, type, schedule, status, agent_id, agentId, action, description
        case enabled, last_run, lastRun, next_run, nextRun, config
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeFlexibleString(forKeys: [.id]) ?? UUID().uuidString
        name = try container.decodeFlexibleString(forKeys: [.name]) ?? "Untitled Task"
        type = try container.decodeFlexibleString(forKeys: [.type])
        schedule = try container.decodeFlexibleString(forKeys: [.schedule])
        status = try container.decodeFlexibleString(forKeys: [.status])
        agent_id = try container.decodeFlexibleString(forKeys: [.agent_id, .agentId])
        config = try container.decodeJSONDictionary(forKey: .config)
        action = try container.decodeFlexibleString(forKeys: [.action]) ?? GatewayTask.stringValue(config?["action"])
        description = try container.decodeFlexibleString(forKeys: [.description]) ?? GatewayTask.stringValue(config?["description"])
        enabled = try container.decodeFlexibleBool(forKeys: [.enabled])
        last_run = try container.decodeFlexibleString(forKeys: [.last_run, .lastRun])
        next_run = try container.decodeFlexibleString(forKeys: [.next_run, .nextRun])
    }

    var isRunning: Bool {
        if let enabled { return enabled }
        let normalizedStatus = status?.lowercased()
        return normalizedStatus == "running" || normalizedStatus == "pending"
    }

    var statusLabel: String {
        switch status?.lowercased() {
        case "pending": return "Active"
        case "running": return "Running"
        case "paused": return "Paused"
        case "completed": return "Completed"
        case "failed": return "Failed"
        default: return status?.capitalized ?? "Unknown"
        }
    }

    private static func stringValue(_ value: JSONValue?) -> String? {
        guard case .string(let text)? = value else { return nil }
        return firstNonEmptyGatewayString(text)
    }
}

struct GatewayTaskRun: Decodable, Identifiable, Hashable {
    let id: String
    let task_id: String?
    let status: String
    let started_at: String?
    let completed_at: String?
    let session_id: String?
    let result_preview: String?
    let error: String?

    private enum CodingKeys: String, CodingKey {
        case id, task_id, taskId, status, started_at, startedAt, completed_at, completedAt
        case session_id, sessionId, result_preview, resultPreview, error
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeFlexibleString(forKeys: [.id]) ?? UUID().uuidString
        task_id = try container.decodeFlexibleString(forKeys: [.task_id, .taskId])
        status = try container.decodeFlexibleString(forKeys: [.status]) ?? "unknown"
        started_at = try container.decodeFlexibleString(forKeys: [.started_at, .startedAt])
        completed_at = try container.decodeFlexibleString(forKeys: [.completed_at, .completedAt])
        session_id = try container.decodeFlexibleString(forKeys: [.session_id, .sessionId])
        result_preview = try container.decodeFlexibleString(forKeys: [.result_preview, .resultPreview])
        error = try container.decodeFlexibleString(forKeys: [.error])
    }
}

struct GatewayMobileDevice: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let baseUrl: String
    let status: String
    let scopes: [String]
    let createdAt: String
    let lastSeenAt: String?
    let revokedAt: String?
    let userAgent: String?
    let push: GatewayMobilePushSummary?

    var isActive: Bool { status.lowercased() == "active" }
    var scopeSummary: String {
        scopes.isEmpty ? "No scopes" : scopes.joined(separator: ", ")
    }
    var pushSummary: String {
        guard let push, push.configured else { return "Push: off" }
        let chat = push.preferences?.chatCompletions == false ? "chat off" : "chat on"
        let tasks = push.preferences?.taskCompletions == false ? "tasks off" : "tasks on"
        return "Push: \(push.provider ?? "expo") · \(push.platform ?? "unknown") · \(chat) · \(tasks)"
    }
}

struct GatewayMobilePushPreferences: Decodable, Hashable {
    let chatCompletions: Bool
    let taskCompletions: Bool
}

struct GatewayMobilePushSummary: Decodable, Hashable {
    let configured: Bool
    let enabled: Bool
    let provider: String?
    let platform: String?
    let preferences: GatewayMobilePushPreferences?
    let updatedAt: String?
    let lastSentAt: String?
    let lastError: String?
}

struct GatewayMobileDevicesResponse: Decodable {
    let devices: [GatewayMobileDevice]
}

struct GatewayMobileRemoteAccessInfo: Decodable, Hashable {
    let enabled: Bool
    let ready: Bool
    let mode: String?
    let provider: String?
    let baseUrl: String?
    let message: String?
}

struct GatewayMobileConnectInfo: Decodable, Hashable {
    let baseUrl: String?
    let lanAccessEnabled: Bool
    let candidates: [String]
    let warnings: [String]
    let remoteAccess: GatewayMobileRemoteAccessInfo?
}

struct GatewayMobilePairingPayload: Decodable, Hashable {
    let `protocol`: String
    let name: String
    let baseUrl: String
    let code: String
    let role: String?
    let expiresAt: Double?
}

struct GatewayMobilePairingCode: Decodable, Hashable {
    let success: Bool
    let code: String
    let expiresAt: Double?
    let payload: GatewayMobilePairingPayload
    let encoded: String
    let qrDataUrl: String

    var expiresAtDate: Date? {
        guard let expiresAt else { return nil }
        return Date(timeIntervalSince1970: expiresAt / 1000)
    }
}

struct GatewayOAuthDeviceCodeResponse: Decodable, Hashable {
    let deviceCode: String
    let userCode: String
    let verificationUri: String
    let verificationUriComplete: String?
    let expiresIn: Int
    let interval: Int

    private enum CodingKeys: String, CodingKey {
        case device_code, deviceCode, user_code, userCode, verification_uri, verificationUri
        case verification_uri_complete, verificationUriComplete
        case expires_in, expiresIn, interval
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        deviceCode = try container.decodeFlexibleString(forKeys: [.device_code, .deviceCode]) ?? ""
        userCode = try container.decodeFlexibleString(forKeys: [.user_code, .userCode]) ?? ""
        verificationUri = try container.decodeFlexibleString(forKeys: [.verification_uri, .verificationUri]) ?? ""
        verificationUriComplete = try container.decodeFlexibleString(
            forKeys: [.verification_uri_complete, .verificationUriComplete]
        )
        expiresIn = try container.decodeFlexibleInt(forKeys: [.expires_in, .expiresIn]) ?? 900
        interval = try container.decodeFlexibleInt(forKeys: [.interval]) ?? 5
    }
}

struct GatewayOAuthPollResponse: Decodable, Hashable {
    let status: String?
    let accessToken: String?
    let refreshToken: String?
    let expiresAt: Double?
    let error: String?

    private enum CodingKeys: String, CodingKey {
        case status, access_token, accessToken, refresh_token, refreshToken, expires_at, expiresAt, error
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        status = try container.decodeFlexibleString(forKeys: [.status])
        accessToken = try container.decodeFlexibleString(forKeys: [.access_token, .accessToken])
        refreshToken = try container.decodeFlexibleString(forKeys: [.refresh_token, .refreshToken])
        expiresAt = try container.decodeFlexibleDouble(forKeys: [.expires_at, .expiresAt])
        error = try container.decodeFlexibleString(forKeys: [.error])
    }
}

struct GatewayOAuthStartResponse: Decodable, Hashable {
    let authUrl: String
    let state: String
    let callbackPort: Int?

    private enum CodingKeys: String, CodingKey {
        case auth_url, authUrl, state, callback_port, callbackPort
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        authUrl = try container.decodeFlexibleString(forKeys: [.auth_url, .authUrl]) ?? ""
        state = try container.decodeFlexibleString(forKeys: [.state]) ?? ""
        callbackPort = try container.decodeFlexibleInt(forKeys: [.callback_port, .callbackPort])
    }
}

struct ChatSendResponse: Decodable {
    let sessionId: String?
    let workspaceDir: String?
    let contextUsage: GatewaySessionContextUsage?
    let tokenUsage: GatewaySessionTokenUsage?
    let message: GatewaySessionMessage?
    let queued: Bool?
    let pendingMessage: GatewayPendingChatMessage?
    let pendingMessages: [GatewayPendingChatMessage]

    private enum CodingKeys: String, CodingKey {
        case sessionId, session_id, workspaceDir, workspace_dir, message
        case contextUsage, context_usage, tokenUsage, token_usage, queued, pendingMessage, pending_message, pendingMessages, pending_messages
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        sessionId = try container.decodeFlexibleString(forKeys: [.sessionId, .session_id])
        workspaceDir = try container.decodeFlexibleString(forKeys: [.workspaceDir, .workspace_dir])
        contextUsage = (try? container.decodeIfPresent(GatewaySessionContextUsage.self, forKey: .contextUsage))
            ?? (try? container.decodeIfPresent(GatewaySessionContextUsage.self, forKey: .context_usage))
        tokenUsage = (try? container.decodeIfPresent(GatewaySessionTokenUsage.self, forKey: .tokenUsage))
            ?? (try? container.decodeIfPresent(GatewaySessionTokenUsage.self, forKey: .token_usage))
        message = try container.decodeIfPresent(GatewaySessionMessage.self, forKey: .message)
        queued = try container.decodeFlexibleBool(forKeys: [.queued])
        pendingMessage = (try? container.decodeIfPresent(GatewayPendingChatMessage.self, forKey: .pendingMessage))
            ?? (try? container.decodeIfPresent(GatewayPendingChatMessage.self, forKey: .pending_message))
        pendingMessages = (try? container.decodeIfPresent([GatewayPendingChatMessage].self, forKey: .pendingMessages))
            ?? ((try? container.decodeIfPresent([GatewayPendingChatMessage].self, forKey: .pending_messages)) ?? [])
    }

    var response: String? { message?.content }
}

struct GatewayPendingChatMessage: Decodable, Identifiable, Hashable {
    let id: String
    let sessionId: String
    let clientPendingId: String?
    let content: String
    let createdAt: Double
    let updatedAt: Double
    let mode: String
    let sequence: Double

    private enum CodingKeys: String, CodingKey {
        case id, sessionId, session_id, clientPendingId, client_pending_id, content, message, text, createdAt, created_at, updatedAt, updated_at, mode, sequence
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeFlexibleString(forKeys: [.id]) ?? UUID().uuidString
        sessionId = try container.decodeFlexibleString(forKeys: [.sessionId, .session_id]) ?? ""
        clientPendingId = try container.decodeFlexibleString(forKeys: [.clientPendingId, .client_pending_id])
        content = try container.decodeFlexibleString(forKeys: [.content, .message, .text]) ?? ""
        createdAt = try container.decodeFlexibleDouble(forKeys: [.createdAt, .created_at]) ?? Date().timeIntervalSince1970 * 1000
        updatedAt = try container.decodeFlexibleDouble(forKeys: [.updatedAt, .updated_at]) ?? createdAt
        mode = try container.decodeFlexibleString(forKeys: [.mode]) ?? "queued"
        sequence = try container.decodeFlexibleDouble(forKeys: [.sequence]) ?? 0
    }
}

struct GatewayPendingChatResponse: Decodable, Hashable {
    let success: Bool?
    let error: String?
    let pendingMessage: GatewayPendingChatMessage?
    let pendingMessages: [GatewayPendingChatMessage]
    let interruptedMessage: GatewaySessionMessage?

    private enum CodingKeys: String, CodingKey {
        case success, error, pendingMessage, pending_message, pendingMessages, pending_messages
        case interruptedMessage, interrupted_message
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        success = try container.decodeFlexibleBool(forKeys: [.success])
        error = try container.decodeFlexibleString(forKeys: [.error])
        pendingMessage = (try? container.decodeIfPresent(GatewayPendingChatMessage.self, forKey: .pendingMessage))
            ?? (try? container.decodeIfPresent(GatewayPendingChatMessage.self, forKey: .pending_message))
        pendingMessages = (try? container.decodeIfPresent([GatewayPendingChatMessage].self, forKey: .pendingMessages))
            ?? ((try? container.decodeIfPresent([GatewayPendingChatMessage].self, forKey: .pending_messages)) ?? [])
        interruptedMessage = (try? container.decodeIfPresent(GatewaySessionMessage.self, forKey: .interruptedMessage))
            ?? (try? container.decodeIfPresent(GatewaySessionMessage.self, forKey: .interrupted_message))
    }
}

struct GatewayChannel: Decodable, Identifiable, Hashable {
    let id: String
    let type: String?
    let name: String?
    let enabled: Int?
    let config: [String: JSONValue]?

    var displayName: String { firstNonEmptyGatewayString(name, type, id) ?? id }
    var isEnabled: Bool { enabled == 1 }
    var agentID: String? {
        guard case .string(let value)? = config?["agent_id"], !value.isEmpty else { return nil }
        return value
    }
    var usesModelRouter: Bool {
        guard case .bool(let value)? = config?["use_model_router"] else { return false }
        return value
    }
}

struct GatewayLogEntry: Decodable, Identifiable, Hashable {
    let id: String
    let level: String?
    let source: String?
    let message: String?
    let metadata: String?
    let created_at: String?
    let logType: String?
}

struct GatewayLogPage: Decodable, Hashable {
    let logs: [GatewayLogEntry]
    let total: Int?
    let limit: Int?
    let offset: Int?
    let hasMore: Bool?
}

struct GatewayMigrationSourcesResponse: Decodable, Hashable {
    let sources: [GatewayMigrationSource]
}

struct GatewayMigrationSource: Decodable, Identifiable, Hashable {
    let kind: String
    let path: String
    let exists: Bool
    let label: String
    let confidence: String?
    let detected: GatewayMigrationDetected

    var id: String { "\(kind):\(path)" }
}

struct GatewayMigrationDetected: Decodable, Hashable {
    let persona: Bool
    let memoryFiles: Int
    let skillCount: Int
    let configFiles: Int
    let envFiles: Int
}

struct GatewayMigrationReport: Decodable, Hashable {
    let success: Bool
    let dryRun: Bool
    let sourceKind: String
    let sourceRoot: String
    let targetRoot: String
    let preset: String
    let migrateSecrets: Bool
    let overwrite: Bool
    let skillConflict: String
    let reportPath: String?
    let createdAt: String
    let summary: [String: Int]
    let warnings: [String]
    let items: [GatewayMigrationItem]
    let nextSteps: [String]
}

struct GatewayMigrationItem: Decodable, Identifiable, Hashable {
    let id: String
    let category: String
    let name: String
    let source: String?
    let target: String?
    let status: String
    let detail: String?
}

struct GatewaySkill: Decodable, Identifiable, Hashable {
    let name: String
    let description: String?
    let category: String?
    let enabled: Bool?

    var id: String { name }
}

struct GatewaySkillRequirementSet: Decodable, Hashable {
    let bins: [String]
    let anyBins: [String]
    let env: [String]
    let anyEnv: [String]
    let config: [String]
    let os: [String]

    private enum CodingKeys: String, CodingKey {
        case bins, anyBins, any_bins, env, anyEnv, any_env, config, os
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        bins = try container.decodeFlexibleStringArray(forKey: .bins) ?? []
        anyBins = try container.decodeFlexibleStringArray(forKey: .anyBins)
            ?? container.decodeFlexibleStringArray(forKey: .any_bins)
            ?? []
        env = try container.decodeFlexibleStringArray(forKey: .env) ?? []
        anyEnv = try container.decodeFlexibleStringArray(forKey: .anyEnv)
            ?? container.decodeFlexibleStringArray(forKey: .any_env)
            ?? []
        config = try container.decodeFlexibleStringArray(forKey: .config) ?? []
        os = try container.decodeFlexibleStringArray(forKey: .os) ?? []
    }
}

struct GatewaySkillInstallSpec: Decodable, Identifiable, Hashable {
    let type: String?
    let command: String

    var id: String { "\(type ?? "install"):\(command)" }
}

struct GatewaySkillStatus: Decodable, Identifiable, Hashable {
    let name: String
    let description: String
    let location: String
    let source: String
    let eligible: Bool
    let disabled: Bool
    let blockedByAllowlist: Bool
    let requirements: GatewaySkillRequirementSet
    let missing: GatewaySkillRequirementSet
    let install: [GatewaySkillInstallSpec]
    let metadata: [String: JSONValue]?

    var id: String { "\(source):\(name):\(location)" }
}

struct GatewaySkillsStatusSummary: Decodable, Hashable {
    let total: Int
    let eligible: Int
    let disabled: Int
    let blocked: Int
}

struct GatewaySkillsStatusResponse: Decodable, Hashable {
    let skills: [GatewaySkillStatus]
    let summary: GatewaySkillsStatusSummary?
}

struct GatewayRegistrySkill: Decodable, Identifiable, Hashable {
    let slug: String
    let name: String
    let description: String
    let author: String?
    let downloads: Int?
    let installsCurrent: Int?
    let installsAllTime: Int?
    let stars: Int?
    let version: String?
    let tags: [String]
    let updatedAt: Double?
    let registry: String

    private enum CodingKeys: String, CodingKey {
        case slug, name, description, author, downloads, installsCurrent, installs_current
        case installsAllTime, installs_all_time, stars, version, tags, updatedAt, updated_at, registry
    }

    var id: String { "\(registry):\(slug)" }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        slug = try container.decodeFlexibleString(forKeys: [.slug]) ?? ""
        name = try container.decodeFlexibleString(forKeys: [.name]) ?? slug
        description = try container.decodeFlexibleString(forKeys: [.description]) ?? ""
        author = try container.decodeFlexibleString(forKeys: [.author])
        downloads = try container.decodeFlexibleInt(forKeys: [.downloads])
        installsCurrent = try container.decodeFlexibleInt(forKeys: [.installsCurrent, .installs_current])
        installsAllTime = try container.decodeFlexibleInt(forKeys: [.installsAllTime, .installs_all_time])
        stars = try container.decodeFlexibleInt(forKeys: [.stars])
        version = try container.decodeFlexibleString(forKeys: [.version])
        tags = try container.decodeFlexibleStringArray(forKey: .tags) ?? []
        updatedAt = try container.decodeFlexibleDouble(forKeys: [.updatedAt, .updated_at])
        registry = try container.decodeFlexibleString(forKeys: [.registry]) ?? "registry"
    }
}

struct GatewaySkillsRegistryResponse: Decodable, Hashable {
    let skills: [GatewayRegistrySkill]
    let registries: [String]
    let counts: [String: Int]
}

struct GatewaySkillInstallResult: Decodable, Hashable {
    let success: Bool
    let error: String?
    let blockedReason: String?
    let requiresConfirmation: Bool?
    let slug: String?

    private enum CodingKeys: String, CodingKey {
        case success, error, blockedReason, blocked_reason, requiresConfirmation, requires_confirmation, slug
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        success = try container.decodeFlexibleBool(forKeys: [.success]) ?? false
        error = try container.decodeFlexibleString(forKeys: [.error])
        blockedReason = try container.decodeFlexibleString(forKeys: [.blockedReason, .blocked_reason])
        requiresConfirmation = try container.decodeFlexibleBool(
            forKeys: [.requiresConfirmation, .requires_confirmation]
        )
        slug = try container.decodeFlexibleString(forKeys: [.slug])
    }
}

struct GatewaySessionStatusSnapshot: Decodable, Hashable {
    let sessionId: String
    let status: String?
    let timestamp: Double?
    let detail: String?
    let agentId: String?
    let activities: [GatewayProcessActivity]
    let pendingMessages: [GatewayPendingChatMessage]

    private enum CodingKeys: String, CodingKey {
        case sessionId, session_id, status, timestamp, detail, agentId, agent_id, activities
        case pendingMessages, pending_messages
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        sessionId = try container.decodeFlexibleString(forKeys: [.sessionId, .session_id]) ?? ""
        status = try container.decodeFlexibleString(forKeys: [.status])
        timestamp = try container.decodeFlexibleDouble(forKey: .timestamp)
        detail = try container.decodeFlexibleString(forKeys: [.detail])
        agentId = try container.decodeFlexibleString(forKeys: [.agentId, .agent_id])
        activities = (try? container.decodeIfPresent([GatewayProcessActivity].self, forKey: .activities)) ?? []
        pendingMessages = (try? container.decodeIfPresent([GatewayPendingChatMessage].self, forKey: .pendingMessages))
            ?? ((try? container.decodeIfPresent([GatewayPendingChatMessage].self, forKey: .pending_messages)) ?? [])
    }
}

struct GatewayStatusEvent: Decodable, Hashable {
    let type: String?
    let status: String?
    let detail: String?
    let timestamp: Double?
    let sessionId: String?
    let agentId: String?
    let toolName: String?
    let toolCallId: String?
    let sandboxProvider: String?
    let toolPhase: String?
    let durationMs: Double?
    let delta: String?
    let activeSessions: [GatewaySessionStatusSnapshot]
    let activeSessionIds: [String]
    let session: GatewaySessionStatusSnapshot?
    let active: Bool?

    private enum CodingKeys: String, CodingKey {
        case type, status, detail, timestamp, sessionId, session_id, agentId, agent_id
        case toolName, tool_name, toolCallId, tool_call_id, sandboxProvider, sandbox_provider
        case toolPhase, tool_phase, durationMs, duration_ms, delta
        case activeSessions, active_sessions, activeSessionIds, active_session_ids
        case session, active
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        type = try container.decodeFlexibleString(forKeys: [.type])
        status = try container.decodeFlexibleString(forKeys: [.status])
        detail = try container.decodeFlexibleString(forKeys: [.detail])
        timestamp = try container.decodeFlexibleDouble(forKey: .timestamp)
        sessionId = try container.decodeFlexibleString(forKeys: [.sessionId, .session_id])
        agentId = try container.decodeFlexibleString(forKeys: [.agentId, .agent_id])
        toolName = try container.decodeFlexibleString(forKeys: [.toolName, .tool_name])
        toolCallId = try container.decodeFlexibleString(forKeys: [.toolCallId, .tool_call_id])
        sandboxProvider = try container.decodeFlexibleString(forKeys: [.sandboxProvider, .sandbox_provider])
        toolPhase = try container.decodeFlexibleString(forKeys: [.toolPhase, .tool_phase])
        durationMs = try container.decodeFlexibleDouble(forKeys: [.durationMs, .duration_ms])
        delta = try container.decodeFlexibleString(forKeys: [.delta])
        activeSessions = (try? container.decodeIfPresent([GatewaySessionStatusSnapshot].self, forKey: .activeSessions))
            ?? ((try? container.decodeIfPresent([GatewaySessionStatusSnapshot].self, forKey: .active_sessions)) ?? [])
        activeSessionIds = (try? container.decodeIfPresent([String].self, forKey: .activeSessionIds))
            ?? ((try? container.decodeIfPresent([String].self, forKey: .active_session_ids)) ?? [])
        session = try? container.decodeIfPresent(GatewaySessionStatusSnapshot.self, forKey: .session)
        active = try? container.decodeIfPresent(Bool.self, forKey: .active)
    }
}

struct ProviderPlanRouteConstraint: Decodable, Hashable {
    let monitored: Bool
    let configured: Bool
    let enforced: Bool
    let status: String
    let reason: String?
    let primaryRemainingPercent: Double?

    private enum CodingKeys: String, CodingKey {
        case monitored, configured, enforced, status, reason, primaryRemainingPercent, primary_remaining_percent
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        monitored = try container.decodeFlexibleBool(forKeys: [.monitored]) ?? false
        configured = try container.decodeFlexibleBool(forKeys: [.configured]) ?? false
        enforced = try container.decodeFlexibleBool(forKeys: [.enforced]) ?? false
        status = try container.decodeFlexibleString(forKeys: [.status]) ?? "unconfigured"
        reason = try container.decodeFlexibleString(forKeys: [.reason])
        primaryRemainingPercent = try container.decodeFlexibleDouble(
            forKeys: [.primaryRemainingPercent, .primary_remaining_percent]
        )
    }
}

struct RouterAvailabilityStatus: Decodable, Identifiable, Hashable {
    let providerId: String
    let weight: Int
    let priority: Int
    let enabled: Bool
    let available: Bool
    let reason: String?
    let requestsIn5hWindow: Int
    let requestsInWeekWindow: Int
    let spendToday: Double
    let spendThisWeek: Double
    let plan: ProviderPlanRouteConstraint?

    var id: String { providerId }

    private enum CodingKeys: String, CodingKey {
        case providerId, provider_id, weight, priority, enabled, available, reason
        case requestsIn5hWindow, requests_in_5h_window, requestsInWeekWindow, requests_in_week_window
        case spendToday, spend_today, spendThisWeek, spend_this_week, plan
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        providerId = try container.decodeFlexibleString(forKeys: [.providerId, .provider_id]) ?? "provider"
        weight = try container.decodeFlexibleInt(forKeys: [.weight]) ?? 0
        priority = try container.decodeFlexibleInt(forKeys: [.priority]) ?? 0
        enabled = try container.decodeFlexibleBool(forKeys: [.enabled]) ?? true
        available = try container.decodeFlexibleBool(forKeys: [.available]) ?? false
        reason = try container.decodeFlexibleString(forKeys: [.reason])
        requestsIn5hWindow = try container.decodeFlexibleInt(
            forKeys: [.requestsIn5hWindow, .requests_in_5h_window]
        ) ?? 0
        requestsInWeekWindow = try container.decodeFlexibleInt(
            forKeys: [.requestsInWeekWindow, .requests_in_week_window]
        ) ?? 0
        spendToday = try container.decodeFlexibleDouble(forKeys: [.spendToday, .spend_today]) ?? 0
        spendThisWeek = try container.decodeFlexibleDouble(forKeys: [.spendThisWeek, .spend_this_week]) ?? 0
        plan = try? container.decodeIfPresent(ProviderPlanRouteConstraint.self, forKey: .plan)
    }
}

struct RouterStatusSummary: Decodable {
    let enabled: Bool?
    let strategy: String?
    let globalSpendToday: Double?
    let globalSpendLimitDaily: Double?
    let routes: [RouterAvailabilityStatus]
    let totalRequests: Int?

    private enum CodingKeys: String, CodingKey {
        case enabled, strategy, globalSpendToday, global_spend_today
        case globalSpendLimitDaily, global_spend_limit_daily, routes, totalRequests, total_requests
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        enabled = try container.decodeFlexibleBool(forKeys: [.enabled])
        strategy = try container.decodeFlexibleString(forKeys: [.strategy])
        globalSpendToday = try container.decodeFlexibleDouble(forKeys: [.globalSpendToday, .global_spend_today])
        globalSpendLimitDaily = try container.decodeFlexibleDouble(
            forKeys: [.globalSpendLimitDaily, .global_spend_limit_daily]
        )
        routes = (try? container.decodeIfPresent([RouterAvailabilityStatus].self, forKey: .routes)) ?? []
        totalRequests = try container.decodeFlexibleInt(forKeys: [.totalRequests, .total_requests])
    }
}

struct ProviderPlanUsageWindow: Decodable, Identifiable, Hashable {
    let id: String
    let title: String
    let kind: String
    let usedTokens: Int
    let tokenLimit: Double?
    let usedSpend: Double
    let spendLimit: Double?
    let usedPercent: Double?
    let remainingPercent: Double?
    let resetsAt: String?
    let resetDescription: String
    let usageKnown: Bool
    let unlimited: Bool

    private enum CodingKeys: String, CodingKey {
        case id, title, kind, usedTokens, used_tokens, tokenLimit, token_limit, usedSpend, used_spend
        case spendLimit, spend_limit, usedPercent, used_percent, remainingPercent, remaining_percent
        case resetsAt, resets_at, resetDescription, reset_description, usageKnown, usage_known
        case unlimited
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeFlexibleString(forKeys: [.id]) ?? UUID().uuidString
        title = try container.decodeFlexibleString(forKeys: [.title]) ?? "Plan window"
        kind = try container.decodeFlexibleString(forKeys: [.kind]) ?? "billing_month"
        usedTokens = try container.decodeFlexibleInt(forKeys: [.usedTokens, .used_tokens]) ?? 0
        tokenLimit = try container.decodeFlexibleDouble(forKeys: [.tokenLimit, .token_limit])
        usedSpend = try container.decodeFlexibleDouble(forKeys: [.usedSpend, .used_spend]) ?? 0
        spendLimit = try container.decodeFlexibleDouble(forKeys: [.spendLimit, .spend_limit])
        usedPercent = try container.decodeFlexibleDouble(forKeys: [.usedPercent, .used_percent])
        remainingPercent = try container.decodeFlexibleDouble(forKeys: [.remainingPercent, .remaining_percent])
        resetsAt = try container.decodeFlexibleString(forKeys: [.resetsAt, .resets_at])
        resetDescription = try container.decodeFlexibleString(
            forKeys: [.resetDescription, .reset_description]
        ) ?? ""
        usageKnown = try container.decodeFlexibleBool(forKeys: [.usageKnown, .usage_known]) ?? true
        unlimited = try container.decodeFlexibleBool(forKeys: [.unlimited]) ?? false
    }
}

struct ProviderPlanPresetSuggestion: Decodable, Identifiable, Hashable {
    let id: String
    let label: String
    let planName: String
    let description: String
    let confidence: String
    let sourceMode: String
    let sourceUrl: String?
    let limitDescription: String
    let monthlyTokenLimit: Double?
    let monthlySpendLimit: Double?
    let weeklyTokenLimit: Double?
    let fiveHourTokenLimit: Double?
    let routeLimit5h: Double?
    let routeLimitWeekly: Double?
    let externalSourceEnabled: Bool

    private enum CodingKeys: String, CodingKey {
        case id, label, planName, plan_name, description, confidence, sourceMode, source_mode
        case sourceUrl, source_url, limitDescription, limit_description
        case monthlyTokenLimit, monthly_token_limit, monthlySpendLimit, monthly_spend_limit
        case weeklyTokenLimit, weekly_token_limit, fiveHourTokenLimit, five_hour_token_limit
        case routeLimit5h, route_limit_5h, routeLimitWeekly, route_limit_weekly
        case externalSourceEnabled, external_source_enabled
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeFlexibleString(forKeys: [.id]) ?? UUID().uuidString
        label = try container.decodeFlexibleString(forKeys: [.label]) ?? "Provider plan"
        planName = try container.decodeFlexibleString(forKeys: [.planName, .plan_name]) ?? label
        description = try container.decodeFlexibleString(forKeys: [.description]) ?? ""
        confidence = try container.decodeFlexibleString(forKeys: [.confidence]) ?? "estimated"
        sourceMode = try container.decodeFlexibleString(forKeys: [.sourceMode, .source_mode]) ?? "local"
        sourceUrl = try container.decodeFlexibleString(forKeys: [.sourceUrl, .source_url])
        limitDescription = try container.decodeFlexibleString(
            forKeys: [.limitDescription, .limit_description]
        ) ?? ""
        monthlyTokenLimit = try container.decodeFlexibleDouble(forKeys: [.monthlyTokenLimit, .monthly_token_limit])
        monthlySpendLimit = try container.decodeFlexibleDouble(forKeys: [.monthlySpendLimit, .monthly_spend_limit])
        weeklyTokenLimit = try container.decodeFlexibleDouble(forKeys: [.weeklyTokenLimit, .weekly_token_limit])
        fiveHourTokenLimit = try container.decodeFlexibleDouble(forKeys: [.fiveHourTokenLimit, .five_hour_token_limit])
        routeLimit5h = try container.decodeFlexibleDouble(forKeys: [.routeLimit5h, .route_limit_5h])
        routeLimitWeekly = try container.decodeFlexibleDouble(forKeys: [.routeLimitWeekly, .route_limit_weekly])
        externalSourceEnabled = try container.decodeFlexibleBool(
            forKeys: [.externalSourceEnabled, .external_source_enabled]
        ) ?? false
    }
}

struct ProviderPlanSnapshot: Decodable, Identifiable, Hashable {
    let providerId: String
    let configuredProviderId: String?
    let providerType: String
    let providerName: String
    let authType: String
    let monitored: Bool
    let managedAutomatically: Bool
    let manualPlanEditable: Bool
    let automaticTrackingLabel: String?
    let appliedPresetId: String?
    let planName: String?
    let source: String?
    let sourceMode: String?
    let sourceLabel: String?
    let sourceDescription: String?
    let externalSourceAvailable: Bool
    let externalSourceMode: String?
    let externalSourceLabel: String?
    let externalSourceHint: String?
    let status: String
    let reason: String?
    let warningThresholdPct: Double?
    let hardStopPct: Double?
    let dataConfidence: String?
    let updatedAt: String?
    let localTokens30d: Int
    let localSpend30d: Double
    let windows: [ProviderPlanUsageWindow]
    let presetSuggestions: [ProviderPlanPresetSuggestion]

    var id: String { providerId }

    private enum CodingKeys: String, CodingKey {
        case providerId, provider_id, configuredProviderId, configured_provider_id
        case providerType, provider_type, providerName, provider_name, authType, auth_type
        case monitored, managedAutomatically, managed_automatically, manualPlanEditable, manual_plan_editable
        case automaticTrackingLabel, automatic_tracking_label, appliedPresetId, applied_preset_id
        case planName, plan_name, source, status, reason
        case sourceMode, source_mode, sourceLabel, source_label, sourceDescription, source_description
        case externalSourceAvailable, external_source_available, externalSourceMode, external_source_mode
        case externalSourceLabel, external_source_label, externalSourceHint, external_source_hint
        case warningThresholdPct, warning_threshold_pct, hardStopPct, hard_stop_pct
        case dataConfidence, data_confidence, updatedAt, updated_at
        case localTokens30d, local_tokens_30d, localSpend30d, local_spend_30d, windows
        case presetSuggestions, preset_suggestions
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        providerId = try container.decodeFlexibleString(forKeys: [.providerId, .provider_id]) ?? "provider"
        configuredProviderId = try container.decodeFlexibleString(
            forKeys: [.configuredProviderId, .configured_provider_id]
        )
        providerType = try container.decodeFlexibleString(forKeys: [.providerType, .provider_type]) ?? providerId
        providerName = try container.decodeFlexibleString(forKeys: [.providerName, .provider_name]) ?? providerId
        authType = try container.decodeFlexibleString(forKeys: [.authType, .auth_type]) ?? "unknown"
        monitored = try container.decodeFlexibleBool(forKeys: [.monitored]) ?? false
        managedAutomatically = try container.decodeFlexibleBool(
            forKeys: [.managedAutomatically, .managed_automatically]
        ) ?? false
        manualPlanEditable = try container.decodeFlexibleBool(
            forKeys: [.manualPlanEditable, .manual_plan_editable]
        ) ?? true
        automaticTrackingLabel = try container.decodeFlexibleString(
            forKeys: [.automaticTrackingLabel, .automatic_tracking_label]
        )
        appliedPresetId = try container.decodeFlexibleString(forKeys: [.appliedPresetId, .applied_preset_id])
        planName = try container.decodeFlexibleString(forKeys: [.planName, .plan_name])
        source = try container.decodeFlexibleString(forKeys: [.source])
        sourceMode = try container.decodeFlexibleString(forKeys: [.sourceMode, .source_mode])
        sourceLabel = try container.decodeFlexibleString(forKeys: [.sourceLabel, .source_label])
        sourceDescription = try container.decodeFlexibleString(forKeys: [.sourceDescription, .source_description])
        externalSourceAvailable = try container.decodeFlexibleBool(
            forKeys: [.externalSourceAvailable, .external_source_available]
        ) ?? false
        externalSourceMode = try container.decodeFlexibleString(forKeys: [.externalSourceMode, .external_source_mode])
        externalSourceLabel = try container.decodeFlexibleString(forKeys: [.externalSourceLabel, .external_source_label])
        externalSourceHint = try container.decodeFlexibleString(forKeys: [.externalSourceHint, .external_source_hint])
        status = try container.decodeFlexibleString(forKeys: [.status]) ?? "unconfigured"
        reason = try container.decodeFlexibleString(forKeys: [.reason])
        warningThresholdPct = try container.decodeFlexibleDouble(
            forKeys: [.warningThresholdPct, .warning_threshold_pct]
        )
        hardStopPct = try container.decodeFlexibleDouble(forKeys: [.hardStopPct, .hard_stop_pct])
        dataConfidence = try container.decodeFlexibleString(forKeys: [.dataConfidence, .data_confidence])
        updatedAt = try container.decodeFlexibleString(forKeys: [.updatedAt, .updated_at])
        localTokens30d = try container.decodeFlexibleInt(forKeys: [.localTokens30d, .local_tokens_30d]) ?? 0
        localSpend30d = try container.decodeFlexibleDouble(forKeys: [.localSpend30d, .local_spend_30d]) ?? 0
        windows = (try? container.decodeIfPresent([ProviderPlanUsageWindow].self, forKey: .windows)) ?? []
        presetSuggestions = (try? container.decodeIfPresent(
            [ProviderPlanPresetSuggestion].self,
            forKey: .presetSuggestions
        )) ?? (try? container.decodeIfPresent([ProviderPlanPresetSuggestion].self, forKey: .preset_suggestions)) ?? []
    }
}

struct ProviderPlanStatusResponse: Decodable, Hashable {
    struct Summary: Decodable, Hashable {
        let total: Int
        let monitored: Int
        let configured: Int
        let warnings: Int
        let exhausted: Int
    }

    let enabled: Bool
    let routerEnforcement: Bool
    let warningThresholdPct: Double
    let providers: [ProviderPlanSnapshot]
    let summary: Summary

    private enum CodingKeys: String, CodingKey {
        case enabled, routerEnforcement, router_enforcement, warningThresholdPct, warning_threshold_pct
        case providers, summary
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        enabled = try container.decodeFlexibleBool(forKeys: [.enabled]) ?? true
        routerEnforcement = try container.decodeFlexibleBool(
            forKeys: [.routerEnforcement, .router_enforcement]
        ) ?? true
        warningThresholdPct = try container.decodeFlexibleDouble(
            forKeys: [.warningThresholdPct, .warning_threshold_pct]
        ) ?? 80
        providers = (try? container.decodeIfPresent([ProviderPlanSnapshot].self, forKey: .providers)) ?? []
        summary = (try? container.decodeIfPresent(Summary.self, forKey: .summary))
            ?? Summary(total: 0, monitored: 0, configured: 0, warnings: 0, exhausted: 0)
    }
}

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
