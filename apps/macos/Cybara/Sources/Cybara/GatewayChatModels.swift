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

struct GatewayBuildInfo: Decodable {
    let version: String
    let release_repository_url: String
    let commit: String?
    let executable_sha256: String?
    let executable_name: String
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
    let reasoning_mode: String?
    let reasoning_efforts: [String]?
    let image_input_mode: String?
    let supports_images: Bool?
    let created_at: String?
    let config: [String: JSONValue]?

    private enum CodingKeys: String, CodingKey {
        case id, name, label, type, model, status, state, provider, provider_id, providerId
        case provider_type, providerType
        case system_prompt, systemPrompt, reasoning_effort, reasoningEffort
        case reasoning_mode, reasoningMode, reasoning_efforts, reasoningEfforts
        case image_input_mode, imageInputMode, supports_images, supportsImages
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
        reasoning_mode = try container.decodeFlexibleString(forKeys: [.reasoning_mode, .reasoningMode])
        reasoning_efforts = try container.decodeIfPresent([String].self, forKey: .reasoning_efforts)
            ?? container.decodeIfPresent([String].self, forKey: .reasoningEfforts)
        image_input_mode = try container.decodeFlexibleString(forKeys: [.image_input_mode, .imageInputMode])
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

    var imageInputMode: String {
        if image_input_mode == "enabled" || image_input_mode == "disabled" {
            return image_input_mode ?? "auto"
        }
        guard case .string(let value)? = config?["image_input"],
              value == "enabled" || value == "disabled"
        else { return "auto" }
        return value
    }

    var imageStatusLabel: String {
        if imageInputMode == "enabled" { return "Enabled" }
        if imageInputMode == "disabled" { return "Disabled" }
        return supportsImages ? "Auto · enabled" : "Auto · disabled"
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
    let apiConsoleUrl: String?
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
    let worked_duration_ms: Double?
    let thinking: String?
    let tool_calls: [GatewayToolCall]?
    let process_activities: [GatewayProcessActivity]?
    let agent_transfers: [GatewayAgentTransfer]?
    let agent_id: String?
    let agent_name: String?
    let model: String?
    let _tool_calls_total_count: Int?
    let _tool_calls_hidden_count: Int?
    var attachedImages: [NativeAttachedImage] = []
    var id = UUID()

    private enum CodingKeys: String, CodingKey {
        case role, content, timestamp, worked_duration_ms, thinking, tool_calls, process_activities, agent_transfers
        case agent_id, agentId, agent_name, agentName, model
        case _tool_calls_total_count, _tool_calls_hidden_count
    }

    init(
        role: String,
        content: String,
        timestamp: String?,
        worked_duration_ms: Double? = nil,
        thinking: String? = nil,
        tool_calls: [GatewayToolCall]? = nil,
        process_activities: [GatewayProcessActivity]? = nil,
        agent_transfers: [GatewayAgentTransfer]? = nil,
        agent_id: String? = nil,
        agent_name: String? = nil,
        model: String? = nil,
        _tool_calls_total_count: Int? = nil,
        _tool_calls_hidden_count: Int? = nil,
        attachedImages: [NativeAttachedImage] = []
    ) {
        let normalized = Self.normalizedContentAndThinking(role: role, content: content, thinking: thinking)
        self.role = role
        self.content = normalized.content
        self.timestamp = timestamp
        self.worked_duration_ms = worked_duration_ms
        self.thinking = normalized.thinking
        self.tool_calls = tool_calls
        self.process_activities = process_activities
        self.agent_transfers = agent_transfers
        self.agent_id = agent_id
        self.agent_name = agent_name
        self.model = model
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
        worked_duration_ms = try container.decodeIfPresent(Double.self, forKey: .worked_duration_ms)
        self.thinking = normalized.thinking
        tool_calls = try container.decodeIfPresent([GatewayToolCall].self, forKey: .tool_calls)
        process_activities = try container.decodeIfPresent([GatewayProcessActivity].self, forKey: .process_activities)
        agent_transfers = try container.decodeIfPresent([GatewayAgentTransfer].self, forKey: .agent_transfers)
        agent_id = try container.decodeFlexibleString(forKeys: [.agent_id, .agentId])
        agent_name = try container.decodeFlexibleString(forKeys: [.agent_name, .agentName])
        model = try container.decodeFlexibleString(forKeys: [.model])
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

extension KeyedDecodingContainer {
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

struct GatewayRevertResponse: Decodable {
    let success: Bool
    let revertedMessage: GatewaySessionMessage?
}

struct GatewaySession: Decodable, Identifiable, Hashable {
    let id: String
    let title: String?
    let agent_id: String?
    let use_model_router: Bool?
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
        case id, title, agent_id, agentId, use_model_router, useModelRouter
        case agent_name, agentName, agent_type, agentType
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
        use_model_router = try container.decodeFlexibleBool(forKeys: [.use_model_router, .useModelRouter])
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
    let useModelRouter: Bool?
    let provider: String?
    let providerId: String?
    let providerName: String?
    let model: String?
    let contextUsage: GatewaySessionContextUsage?
    let tokenUsage: GatewaySessionTokenUsage?
    let error: String?

    private enum CodingKeys: String, CodingKey {
        case success, sessionId, session_id, agentId, agent_id, agentName, agent_name
        case useModelRouter, use_model_router
        case provider, providerId, provider_id, providerName, provider_name, model
        case contextUsage, context_usage, tokenUsage, token_usage, error
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        success = try container.decodeFlexibleBool(forKeys: [.success])
        sessionId = try container.decodeFlexibleString(forKeys: [.sessionId, .session_id])
        agentId = try container.decodeFlexibleString(forKeys: [.agentId, .agent_id])
        agentName = try container.decodeFlexibleString(forKeys: [.agentName, .agent_name])
        useModelRouter = try container.decodeFlexibleBool(forKeys: [.useModelRouter, .use_model_router])
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
    let session_id: String?
    let action: String?
    let description: String?
    let enabled: Bool?
    let last_run: String?
    let next_run: String?
    let config: [String: JSONValue]?

    private enum CodingKeys: String, CodingKey {
        case id, name, type, schedule, status, agent_id, agentId, session_id, sessionId, action, description
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
        session_id = try container.decodeFlexibleString(forKeys: [.session_id, .sessionId])
            ?? GatewayTask.stringValue(config?["session_id"])
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
    let pollToken: String
    let callbackPort: Int?

    private enum CodingKeys: String, CodingKey {
        case auth_url, authUrl, state, poll_token, pollToken, callback_port, callbackPort
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        authUrl = try container.decodeFlexibleString(forKeys: [.auth_url, .authUrl]) ?? ""
        state = try container.decodeFlexibleString(forKeys: [.state]) ?? ""
        pollToken = try container.decodeFlexibleString(forKeys: [.poll_token, .pollToken]) ?? ""
        callbackPort = try container.decodeFlexibleInt(forKeys: [.callback_port, .callbackPort])
    }
}
