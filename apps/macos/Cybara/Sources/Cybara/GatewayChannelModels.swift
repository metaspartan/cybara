import Foundation

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
    let runId: String?
    let sequence: Double?
    let status: String?
    let timestamp: Double?
    let detail: String?
    let agentId: String?
    let activities: [GatewayProcessActivity]
    let pendingMessages: [GatewayPendingChatMessage]

    private enum CodingKeys: String, CodingKey {
        case sessionId, session_id, runId, run_id, sequence, status, timestamp, detail, agentId, agent_id, activities
        case pendingMessages, pending_messages
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        sessionId = try container.decodeFlexibleString(forKeys: [.sessionId, .session_id]) ?? ""
        runId = try container.decodeFlexibleString(forKeys: [.runId, .run_id])
        sequence = try container.decodeFlexibleDouble(forKey: .sequence)
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
    let runId: String?
    let sequence: Double?
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
    let pendingChatId: String?
    let clientPendingId: String?
    let delta: String?
    let activeSessions: [GatewaySessionStatusSnapshot]
    let activeSessionIds: [String]
    let session: GatewaySessionStatusSnapshot?
    let active: Bool?

    private enum CodingKeys: String, CodingKey {
        case type, runId, run_id, sequence, status, detail, timestamp, sessionId, session_id, agentId, agent_id
        case toolName, tool_name, toolCallId, tool_call_id, sandboxProvider, sandbox_provider
        case toolPhase, tool_phase, durationMs, duration_ms, delta
        case pendingChatId, pending_chat_id, clientPendingId, client_pending_id
        case activeSessions, active_sessions, activeSessionIds, active_session_ids
        case session, active
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        type = try container.decodeFlexibleString(forKeys: [.type])
        runId = try container.decodeFlexibleString(forKeys: [.runId, .run_id])
        sequence = try container.decodeFlexibleDouble(forKey: .sequence)
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
        pendingChatId = try container.decodeFlexibleString(forKeys: [.pendingChatId, .pending_chat_id])
        clientPendingId = try container.decodeFlexibleString(forKeys: [.clientPendingId, .client_pending_id])
        delta = try container.decodeFlexibleString(forKeys: [.delta])
        activeSessions = (try? container.decodeIfPresent([GatewaySessionStatusSnapshot].self, forKey: .activeSessions))
            ?? ((try? container.decodeIfPresent([GatewaySessionStatusSnapshot].self, forKey: .active_sessions)) ?? [])
        activeSessionIds = (try? container.decodeIfPresent([String].self, forKey: .activeSessionIds))
            ?? ((try? container.decodeIfPresent([String].self, forKey: .active_session_ids)) ?? [])
        session = try? container.decodeIfPresent(GatewaySessionStatusSnapshot.self, forKey: .session)
        active = try? container.decodeIfPresent(Bool.self, forKey: .active)
    }
}
