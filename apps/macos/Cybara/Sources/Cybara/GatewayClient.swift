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

    var displayName: String { firstNonEmptyGatewayString(name, provider, id) ?? id }
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

    var displayTitle: String { firstNonEmptyGatewayString(title) ?? String(id.prefix(8)) }
}

func firstNonEmptyGatewayString(_ values: String?...) -> String? {
    for value in values {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !trimmed.isEmpty { return trimmed }
    }
    return nil
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

    var isActive: Bool { status.lowercased() == "active" }
    var scopeSummary: String {
        scopes.isEmpty ? "No scopes" : scopes.joined(separator: ", ")
    }
}

struct GatewayMobileDevicesResponse: Decodable {
    let devices: [GatewayMobileDevice]
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

struct ChatSendResponse: Decodable {
    struct Message: Decodable {
        let role: String?
        let content: String?
    }

    let sessionId: String?
    let message: Message?

    var response: String? { message?.content }
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
        // Session detail carries its transcript under `messagesList`.
        try await getList("api/sessions/\(id)", keys: ["messagesList", "messages"])
    }

    func tasks() async throws -> [GatewayTask] {
        try await getList("api/tasks", keys: ["tasks", "items"])
    }

    func mobileDevices() async throws -> [GatewayMobileDevice] {
        try await get("api/mobile/devices", as: GatewayMobileDevicesResponse.self).devices
    }

    func createMobilePairingCode(
        baseUrl: String,
        gatewayName: String,
        deviceName: String,
        role: String
    ) async throws -> GatewayMobilePairingCode {
        let body = try JSONSerialization.data(
            withJSONObject: [
                "baseUrl": baseUrl,
                "gatewayName": gatewayName,
                "deviceName": deviceName,
                "role": role,
            ]
        )
        let data = try await request("api/mobile/devices/pair-code", method: "POST", body: body)
        return try JSONDecoder().decode(GatewayMobilePairingCode.self, from: data)
    }

    @discardableResult
    func revokeMobileDevice(_ id: String) async throws -> Data {
        try await request("api/mobile/devices/\(id)/revoke", method: "POST")
    }

    @discardableResult
    func deleteMobileDevice(_ id: String) async throws -> Data {
        try await request("api/mobile/devices/\(id)", method: "DELETE")
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

    // ─── Raw-object config round-trips ───────────────────────────────────────
    // Config PUT routes store the body verbatim, so screens read the full JSON
    // object, mutate only the keys they own, and PUT the whole object back —
    // preserving fields the native UI doesn't model yet (e.g. router routes).

    func rawObject(_ path: String) async throws -> [String: Any] {
        let data = try await request(path)
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw GatewayClientError.invalidResponse
        }
        return object
    }

    // Callers serialize on their own actor first ([String: Any] is not
    // Sendable under Swift 6 strict concurrency; Data is).
    @discardableResult
    func putJSON(_ path: String, body: Data) async throws -> Data {
        try await request(path, method: "PUT", body: body)
    }

    // ─── Router ──────────────────────────────────────────────────────────────

    func routerConfig() async throws -> [String: Any] {
        try await rawObject("api/router/config")
    }

    func updateRouterConfig(_ body: Data) async throws {
        try await putJSON("api/router/config", body: body)
    }

    func routerStatus() async throws -> RouterStatusSummary {
        try await get("api/router/status", as: RouterStatusSummary.self)
    }

    // ─── Gateway config ──────────────────────────────────────────────────────

    func appConfig() async throws -> [String: Any] {
        try await rawObject("api/config")
    }

    func updateAppConfig(_ body: Data) async throws {
        try await putJSON("api/config", body: body)
    }

    // ─── System prompt ───────────────────────────────────────────────────────

    func systemPrompt() async throws -> [String: Any] {
        try await rawObject("api/system-prompt")
    }

    func updateSystemPrompt(_ body: Data) async throws {
        try await putJSON("api/system-prompt", body: body)
    }

    // ─── Memory ──────────────────────────────────────────────────────────────

    func memoryFiles() async throws -> [String] {
        let object = try await rawObject("api/memory")
        return (object["files"] as? [String]) ?? []
    }

    // ─── Metrics ─────────────────────────────────────────────────────────────

    func metricsOverview() async throws -> MetricsOverview {
        try await get("api/metrics/overview", as: MetricsOverview.self)
    }

    // ─── Channels / Logs ─────────────────────────────────────────────────────

    func channels() async throws -> [GatewayChannel] {
        try await getList("api/channels", keys: ["channels", "items"])
    }

    func systemLogs(limit: Int = 200) async throws -> [GatewayLogEntry] {
        let logs: [GatewayLogEntry] = try await getList("api/logs/system", keys: ["logs", "items"])
        return Array(logs.prefix(limit))
    }

    // ─── Theme ───────────────────────────────────────────────────────────────

    /// The accent key shared with the web/Tauri and mobile UIs (gateway config).
    func themeAccent() async throws -> String? {
        let config = try await rawObject("api/config")
        for key in ["themeAccent", "theme_accent", "theme", "accent", "ui_accent"] {
            if let value = config[key] as? String, !value.isEmpty { return value }
        }
        return nil
    }

    // ─── Wallet / Skills ─────────────────────────────────────────────────────

    func walletStatus() async throws -> [String: Any] {
        try await rawObject("api/wallet/status")
    }

    func walletPolicy() async throws -> [String: Any] {
        try await rawObject("api/wallet/agent-policy")
    }

    func updateWalletPolicy(_ body: Data) async throws {
        try await putJSON("api/wallet/agent-policy", body: body)
    }

    func setWalletAgentAccess(_ enabled: Bool) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["enabled": enabled])
        try await putJSON("api/wallet/agent-access", body: body)
    }

    func skills() async throws -> [GatewaySkill] {
        try await getList("api/skills", keys: ["skills", "items"])
    }

    // ─── Session mutations ───────────────────────────────────────────────────

    @discardableResult
    func deleteSession(_ id: String) async throws -> Data {
        try await request("api/sessions/\(id)", method: "DELETE")
    }

    @discardableResult
    func renameSession(_ id: String, title: String) async throws -> Data {
        let body = try JSONSerialization.data(withJSONObject: ["title": title])
        return try await request("api/sessions/\(id)/title", method: "PUT", body: body)
    }

    @discardableResult
    func pinSession(_ id: String, pinned: Bool) async throws -> Data {
        let body = try JSONSerialization.data(withJSONObject: ["pinned": pinned])
        return try await request("api/sessions/\(id)/pin", method: "PUT", body: body)
    }
}

struct GatewayChannel: Decodable, Identifiable, Hashable {
    let id: String
    let type: String?
    let name: String?
    let enabled: Int?

    var displayName: String { firstNonEmptyGatewayString(name, type, id) ?? id }
    var isEnabled: Bool { enabled == 1 }
}

struct GatewayLogEntry: Decodable, Identifiable, Hashable {
    let id: String
    let level: String?
    let source: String?
    let message: String?
    let created_at: String?
}

struct GatewaySkill: Decodable, Identifiable, Hashable {
    let name: String
    let description: String?
    let category: String?
    let enabled: Bool?

    var id: String { name }
}

// ─── Live status (SSE) ───────────────────────────────────────────────────────

struct GatewayStatusEvent: Decodable {
    let status: String?
    let detail: String?
    let sessionId: String?
}

/// Subscribes to the gateway's status event stream (`/api/sse/status`) and
/// publishes the latest event, so the chat transcript can show live
/// "Thinking…" / tool activity while a reply is generating.
@MainActor
final class GatewayStatusStream: ObservableObject {
    @Published private(set) var latest: GatewayStatusEvent?

    private var task: Task<Void, Never>?

    func start(baseURL: URL) {
        stop()
        task = Task { [weak self] in
            var request = URLRequest(url: baseURL.appendingPathComponent("api/sse/status"))
            request.timeoutInterval = 3600
            if let key = GatewayClient.loadAPIKey() {
                request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
            }
            while !Task.isCancelled {
                do {
                    let (bytes, _) = try await URLSession.shared.bytes(for: request)
                    for try await line in bytes.lines {
                        if Task.isCancelled { return }
                        guard line.hasPrefix("data: "), let data = line.dropFirst(6).data(using: .utf8),
                              let event = try? JSONDecoder().decode(GatewayStatusEvent.self, from: data)
                        else { continue }
                        self?.latest = event
                    }
                } catch {
                    // Connection dropped (gateway restart etc.) — retry shortly.
                }
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }

    func stop() {
        task?.cancel()
        task = nil
    }

    deinit {
        task?.cancel()
    }
}

struct RouterStatusSummary: Decodable {
    let enabled: Bool?
    let strategy: String?
    let globalSpendToday: Double?
    let totalRequests: Int?
}

struct MetricsOverview: Decodable {
    struct TokenUsage: Decodable {
        let total: Int?
        let input: Int?
        let output: Int?
        let cache: Int?
    }

    struct Sessions: Decodable {
        let totalSessions: Int?
        let memoryFlushes: Int?
        let compactions: Int?
    }

    struct ToolCalls: Decodable {
        let totalCalls: Int?
    }

    let tokenUsage: TokenUsage?
    let sessions: Sessions?
    let toolCalls: ToolCalls?
}
