import Foundation

struct GatewaySessionGoalLoop: Decodable, Hashable {
    let iterations: Int?
    let stoppedReason: String?
    let consecutiveFailures: Int?

    private enum CodingKeys: String, CodingKey {
        case iterations
        case stoppedReason = "stopped_reason"
        case consecutiveFailures = "consecutive_failures"
    }
}

struct GatewaySessionGoal: Decodable, Identifiable, Hashable {
    let sessionId: String
    let objective: String
    let status: String
    let createdAt: String?
    let updatedAt: String?
    let lastStatusNote: String?
    let activeMs: Int?
    let lastResumedAt: String?
    let loop: GatewaySessionGoalLoop?

    var id: String { sessionId }

    private enum CodingKeys: String, CodingKey {
        case sessionId, session_id
        case objective, status
        case createdAt, created_at
        case updatedAt, updated_at
        case lastStatusNote, last_status_note
        case activeMs, active_ms
        case lastResumedAt, last_resumed_at
        case loop
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedSessionID = try container.decodeFlexibleString(forKeys: [.sessionId, .session_id])
        sessionId = decodedSessionID ?? UUID().uuidString
        objective = (try? container.decode(String.self, forKey: .objective)) ?? ""
        status = (try? container.decode(String.self, forKey: .status)) ?? "active"
        createdAt = try? container.decodeFlexibleString(forKeys: [.createdAt, .created_at])
        updatedAt = try? container.decodeFlexibleString(forKeys: [.updatedAt, .updated_at])
        lastStatusNote = try? container.decodeFlexibleString(forKeys: [.lastStatusNote, .last_status_note])
        var activeMsValue = try? container.decode(Int.self, forKey: .activeMs)
        if activeMsValue == nil { activeMsValue = try? container.decode(Int.self, forKey: .active_ms) }
        activeMs = activeMsValue
        lastResumedAt = try? container.decodeFlexibleString(forKeys: [.lastResumedAt, .last_resumed_at])
        loop = try? container.decode(GatewaySessionGoalLoop.self, forKey: .loop)
    }
}

struct GatewaySessionGoalResponse: Decodable {
    let success: Bool
    let goal: GatewaySessionGoal?
    let error: String?
}

struct GatewayGoalMutationResponse: Decodable {
    let success: Bool
    let goal: GatewaySessionGoal?
    let error: String?
    let response: String?
}
