import Foundation

// ─── Models ──────────────────────────────────────────────────────────────────

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
    let provider_id: String?

    var isRunning: Bool { status?.lowercased() == "running" }
}

struct GatewayProvider: Decodable, Identifiable, Hashable {
    let id: String
    let name: String?
    let provider: String?
    let enabled: Bool?

    var displayName: String { name ?? provider ?? id }
}

struct GatewaySessionMessage: Decodable, Identifiable, Hashable {
    let role: String
    let content: String
    let timestamp: String?
    // Stable local identity (excluded from decoding via CodingKeys).
    var id = UUID()

    private enum CodingKeys: String, CodingKey {
        case role, content, timestamp
    }
}

struct GatewaySession: Decodable, Identifiable, Hashable {
    let id: String
    let title: String?
    let agent_id: String?
    let message_count: Int?
    let updated_at: String?
    let pinned: Bool?

    var displayTitle: String { title?.isEmpty == false ? title! : String(id.prefix(8)) }
}

struct GatewayTask: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let schedule: String?
    let status: String?
    let agent_id: String?

    var isRunning: Bool {
        let s = status?.lowercased()
        return s == "running" || s == "pending"
    }
}

struct ChatSendResponse: Decodable {
    let sessionId: String?
    let response: String?
}

// ─── Client ──────────────────────────────────────────────────────────────────

enum GatewayClientError: LocalizedError {
    case badStatus(Int, String)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .badStatus(let code, let body):
            return "Gateway error \(code): \(body.prefix(200))"
        case .invalidResponse:
            return "The gateway returned an unexpected response."
        }
    }
}

/// Native async client for the local Cybara gateway. Authenticates with the
/// root API key at ~/.cybara/api_key (same user as the sidecar), so the native
/// UI has the same access the web UI gets via the localhost same-origin bypass.
struct GatewayClient: Sendable {
    let baseURL: URL

    static func loadAPIKey() -> String? {
        let path = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".cybara/api_key")
        guard let raw = try? String(contentsOf: path, encoding: .utf8) else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func request(_ path: String, method: String = "GET", body: Data? = nil) async throws -> Data {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = method
        req.timeoutInterval = 120
        if let key = Self.loadAPIKey() {
            req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw GatewayClientError.invalidResponse }
        guard (200 ..< 300).contains(http.statusCode) else {
            throw GatewayClientError.badStatus(http.statusCode, String(data: data, encoding: .utf8) ?? "")
        }
        return data
    }

    private func get<T: Decodable>(_ path: String, as type: T.Type) async throws -> T {
        try JSONDecoder().decode(T.self, from: try await request(path))
    }

    /// Decode either a bare array or `{ "<key>": [...] }` wrappers, since some
    /// gateway routes wrap their list payloads.
    private func getList<T: Decodable>(_ path: String, keys: [String]) async throws -> [T] {
        let data = try await request(path)
        let decoder = JSONDecoder()
        if let direct = try? decoder.decode([T].self, from: data) { return direct }
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw GatewayClientError.invalidResponse
        }
        for key in keys {
            if let nested = object[key],
               let nestedData = try? JSONSerialization.data(withJSONObject: nested),
               let list = try? decoder.decode([T].self, from: nestedData) {
                return list
            }
        }
        return []
    }

    // ─── Endpoints ───────────────────────────────────────────────────────────

    func health() async throws -> GatewayHealth {
        try await get("api/health", as: GatewayHealth.self)
    }

    func agents() async throws -> [GatewayAgent] {
        try await getList("api/agents", keys: ["agents", "items"])
    }

    func providers() async throws -> [GatewayProvider] {
        try await getList("api/providers", keys: ["providers", "items"])
    }

    func sessions() async throws -> [GatewaySession] {
        try await getList("api/sessions", keys: ["sessions", "items"])
    }

    func sessionMessages(_ id: String) async throws -> [GatewaySessionMessage] {
        try await getList(
            "api/sessions/\(id)/messages",
            keys: ["messages", "items"]
        )
    }

    func tasks() async throws -> [GatewayTask] {
        try await getList("api/tasks", keys: ["tasks", "items"])
    }

    func sendChat(message: String, sessionId: String?, agentId: String?) async throws -> ChatSendResponse {
        var payload: [String: Any] = ["message": message]
        if let sessionId { payload["sessionId"] = sessionId }
        if let agentId { payload["agentId"] = agentId }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let data = try await request("api/chat", method: "POST", body: body)
        return try JSONDecoder().decode(ChatSendResponse.self, from: data)
    }

    @discardableResult
    func startAgent(_ id: String) async throws -> Data {
        try await request("api/agents/\(id)/start", method: "POST")
    }

    @discardableResult
    func stopAgent(_ id: String) async throws -> Data {
        try await request("api/agents/\(id)/stop", method: "POST")
    }

    @discardableResult
    func runTask(_ id: String) async throws -> Data {
        try await request("api/tasks/\(id)/run", method: "POST")
    }
}
