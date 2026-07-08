import Foundation

// ─── Client ──────────────────────────────────────────────────────────────────

enum GatewayClientError: LocalizedError {
    case badStatus(Int, String)
    case invalidResponse
    case decodingFailed(String, String)

    var errorDescription: String? {
        switch self {
        case .badStatus(let code, let body):
            return "Gateway error \(code): \(body.prefix(200))"
        case .invalidResponse:
            return "The gateway returned an unexpected response."
        case .decodingFailed(let path, let detail):
            return "The gateway response for /\(path) could not be decoded: \(detail.prefix(240))"
        }
    }
}

private struct GatewaySteerPendingBody: Encodable {
    let processActivities: [GatewayProcessActivityPayload]
}

/// Native async client for the local Cybara gateway. Authenticates with the
/// root API key at ~/.cybara/api_key (same user as the sidecar), so the native
/// UI has the same access the web UI gets via the localhost same-origin bypass.
struct GatewayClient: Sendable {
    let baseURL: URL

    init(baseURL: URL) {
        // Relative request paths ("api/…") resolve against the last path
        // segment, so a gateway served under a base path (e.g. …/cybara)
        // needs a trailing slash to keep the prefix.
        let path = baseURL.path
        if path.isEmpty || path == "/" || baseURL.absoluteString.hasSuffix("/") {
            self.baseURL = baseURL
        } else {
            self.baseURL = URL(string: baseURL.absoluteString + "/") ?? baseURL
        }
    }

    static func loadAPIKey() -> String? {
        let path = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".cybara/api_key")
        guard let raw = try? String(contentsOf: path, encoding: .utf8) else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    static func loadGatewayPassword() -> String? {
        let trimmed = UserDefaults.standard.string(forKey: "cybara_gateway_password")?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    func request(
        _ path: String,
        method: String = "GET",
        body: Data? = nil,
        queryItems: [URLQueryItem] = []
    ) async throws -> Data {
        var url = URL(string: path, relativeTo: baseURL)?.absoluteURL
            ?? baseURL.appendingPathComponent(path)
        if !queryItems.isEmpty,
           var components = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            components.queryItems = (components.queryItems ?? []) + queryItems
            url = components.url ?? url
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 120
        if let key = Self.loadAPIKey() {
            req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        }
        if let password = Self.loadGatewayPassword() {
            req.setValue(password, forHTTPHeaderField: "X-Cybara-Gateway-Password")
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

    private func pathSegment(_ value: String) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    private func get<T: Decodable>(
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

    /// Decode either a bare array or `{ "<key>": [...] }` wrappers, since some
    /// gateway routes wrap their list payloads.
    private func getList<T: Decodable>(
        _ path: String,
        keys: [String],
        queryItems: [URLQueryItem] = []
    ) async throws -> [T] {
        let data = try await request(path, queryItems: queryItems)
        let decoder = JSONDecoder()
        do {
            return try decoder.decode([T].self, from: data)
        } catch {
            if (try? JSONSerialization.jsonObject(with: data)) is [Any] {
                throw GatewayClientError.decodingFailed(path, String(describing: error))
            }
        }
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw GatewayClientError.invalidResponse
        }
        var nestedDecodeErrors: [String] = []
        for key in keys {
            if let nested = object[key],
               let nestedData = try? JSONSerialization.data(withJSONObject: nested) {
                do {
                    return try decoder.decode([T].self, from: nestedData)
                } catch {
                    nestedDecodeErrors.append("\(key): \(String(describing: error))")
                }
            }
        }
        if !nestedDecodeErrors.isEmpty {
            throw GatewayClientError.decodingFailed(path, nestedDecodeErrors.joined(separator: "; "))
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

    func journey() async throws -> GatewayJourney {
        try await get("api/journey", as: GatewayJourney.self)
    }

    func pendingToolApprovals() async throws -> [GatewayPendingApproval] {
        let data = try await request("api/tools/approvals")
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let pending = object["pending"] as? [[String: Any]] else {
            return []
        }
        return pending.compactMap { entry in
            guard let id = entry["id"] as? String else { return nil }
            return GatewayPendingApproval(
                id: id,
                toolName: (entry["toolName"] as? String) ?? "tool",
                argsSummary: (entry["argsSummary"] as? String) ?? ""
            )
        }
    }

    func resolveToolApproval(_ requestId: String, decision: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["requestId": requestId, "decision": decision])
        _ = try await request("api/tools/approvals/resolve", method: "POST", body: body)
    }

    func providers() async throws -> [GatewayProvider] {
        try await getList("api/providers", keys: ["providers", "items"])
    }

    func availableProviders() async throws -> [GatewayAvailableProvider] {
        try await getList("api/providers/available", keys: ["providers", "items"])
    }

    func providerModels(_ id: String) async throws -> [GatewayProviderModel] {
        try await getList("api/providers/\(id)/models", keys: ["models", "items"])
    }

    func sessions(limit: Int? = 150) async throws -> [GatewaySession] {
        let queryItems: [URLQueryItem]
        if let limit {
            queryItems = [URLQueryItem(name: "limit", value: "\(max(1, limit))")]
        } else {
            queryItems = []
        }
        return try await getList("api/sessions", keys: ["sessions", "items"], queryItems: queryItems)
    }

    func sessionDetail(_ id: String) async throws -> GatewaySession {
        try await get(
            "api/sessions/\(id)",
            as: GatewaySession.self,
            queryItems: [URLQueryItem(name: "includeFullToolCalls", value: "1")]
        )
    }

    func sessionMessages(_ id: String) async throws -> [GatewaySessionMessage] {
        try await sessionDetail(id).messagesList ?? []
    }

    func sessionStatus(_ id: String? = nil) async throws -> GatewayStatusEvent {
        let queryItems = firstNonEmptyGatewayString(id).map {
            [URLQueryItem(name: "sessionId", value: $0)]
        } ?? []
        return try await get("api/status/sessions", as: GatewayStatusEvent.self, queryItems: queryItems)
    }

    func gitBranch(path: String) async throws -> String? {
        guard let workspace = firstNonEmptyGatewayString(path) else { return nil }
        let response = try await get(
            "api/git/branch",
            as: GatewayGitBranchResponse.self,
            queryItems: [URLQueryItem(name: "path", value: workspace)]
        )
        return firstNonEmptyGatewayString(response.branch)
    }

    func tasks() async throws -> [GatewayTask] {
        try await getList("api/tasks", keys: ["tasks", "items"])
    }

    func taskRuns(_ id: String) async throws -> [GatewayTaskRun] {
        try await getList("api/tasks/\(id)/runs", keys: ["runs", "items"])
    }

    func mobileDevices() async throws -> [GatewayMobileDevice] {
        try await get("api/mobile/devices", as: GatewayMobileDevicesResponse.self).devices
    }

    func mobileConnectInfo() async throws -> GatewayMobileConnectInfo {
        try await get("api/mobile/connect-info", as: GatewayMobileConnectInfo.self)
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

    func sendChat(
        message: String,
        sessionId: String?,
        agentId: String?,
        workspaceDir: String? = nil,
        queueMode: String? = nil,
        useModelRouter: Bool = false,
        images: [[String: String]] = []
    ) async throws -> ChatSendResponse {
        var payload: [String: Any] = ["message": message]
        if let sessionId { payload["sessionId"] = sessionId }
        if let agentId { payload["agentId"] = agentId }
        if useModelRouter { payload["useModelRouter"] = true }
        if let workspaceDir = firstNonEmptyGatewayString(workspaceDir) {
            payload["workspaceDir"] = workspaceDir
        }
        if let queueMode = firstNonEmptyGatewayString(queueMode) {
            payload["queueMode"] = queueMode
        }
        if !images.isEmpty {
            payload["images"] = Array(images.prefix(8))
        }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let data = try await request("api/chat", method: "POST", body: body)
        return try JSONDecoder().decode(ChatSendResponse.self, from: data)
    }

    func steerPendingMessage(
        sessionId: String,
        pendingId: String,
        processActivities: [GatewayProcessActivityPayload] = []
    ) async throws -> GatewayPendingChatResponse {
        let body = processActivities.isEmpty
            ? nil
            : try JSONEncoder().encode(GatewaySteerPendingBody(processActivities: processActivities))
        let data = try await request(
            "api/chat/sessions/\(sessionId)/pending/\(pendingId)/steer",
            method: "POST",
            body: body
        )
        return try JSONDecoder().decode(GatewayPendingChatResponse.self, from: data)
    }

    func updatePendingMessage(
        sessionId: String,
        pendingId: String,
        content: String
    ) async throws -> GatewayPendingChatResponse {
        let body = try JSONSerialization.data(withJSONObject: ["content": content])
        let data = try await request(
            "api/chat/sessions/\(sessionId)/pending/\(pendingId)",
            method: "PATCH",
            body: body
        )
        return try JSONDecoder().decode(GatewayPendingChatResponse.self, from: data)
    }

    func deletePendingMessage(
        sessionId: String,
        pendingId: String
    ) async throws -> GatewayPendingChatResponse {
        let data = try await request(
            "api/chat/sessions/\(sessionId)/pending/\(pendingId)",
            method: "DELETE"
        )
        return try JSONDecoder().decode(GatewayPendingChatResponse.self, from: data)
    }

    func reorderPendingMessages(
        sessionId: String,
        pendingIds: [String]
    ) async throws -> GatewayPendingChatResponse {
        let body = try JSONSerialization.data(withJSONObject: ["pendingMessageIds": pendingIds])
        let data = try await request(
            "api/chat/sessions/\(sessionId)/pending/reorder",
            method: "POST",
            body: body
        )
        return try JSONDecoder().decode(GatewayPendingChatResponse.self, from: data)
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
    func createTask(
        name: String,
        description: String,
        agentID: String?,
        action: String,
        schedule: String,
        enabled: Bool
    ) async throws -> Data {
        let body = try JSONSerialization.data(
            withJSONObject: taskPayload(
                name: name,
                description: description,
                agentID: agentID,
                action: action,
                schedule: schedule,
                enabled: enabled
            )
        )
        return try await request("api/tasks", method: "POST", body: body)
    }

    @discardableResult
    func updateTask(
        _ id: String,
        name: String,
        description: String,
        agentID: String?,
        action: String,
        schedule: String,
        enabled: Bool
    ) async throws -> Data {
        let body = try JSONSerialization.data(
            withJSONObject: taskPayload(
                name: name,
                description: description,
                agentID: agentID,
                action: action,
                schedule: schedule,
                enabled: enabled
            )
        )
        return try await request("api/tasks/\(id)", method: "PUT", body: body)
    }

    @discardableResult
    func deleteTask(_ id: String) async throws -> Data {
        try await request("api/tasks/\(id)", method: "DELETE")
    }

    @discardableResult
    func startTask(_ id: String) async throws -> Data {
        try await request("api/tasks/\(id)/start", method: "POST")
    }

    @discardableResult
    func stopTask(_ id: String) async throws -> Data {
        try await request("api/tasks/\(id)/stop", method: "POST")
    }

    @discardableResult
    func triggerTask(_ id: String) async throws -> Data {
        try await request("api/tasks/\(id)/trigger", method: "POST")
    }

    @discardableResult
    func runTask(_ id: String) async throws -> Data {
        try await request("api/tasks/\(id)/run", method: "POST")
    }

    private func taskPayload(
        name: String,
        description: String,
        agentID: String?,
        action: String,
        schedule: String,
        enabled: Bool
    ) -> [String: Any] {
        var payload: [String: Any] = [
            "name": name.trimmingCharacters(in: .whitespacesAndNewlines),
            "description": description.trimmingCharacters(in: .whitespacesAndNewlines),
            "action": action.trimmingCharacters(in: .whitespacesAndNewlines),
            "schedule": schedule.trimmingCharacters(in: .whitespacesAndNewlines),
            "enabled": enabled,
        ]
        if let agentID = firstNonEmptyGatewayString(agentID) {
            payload["agent_id"] = agentID
        } else {
            payload["agent_id"] = NSNull()
        }
        return payload
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

    func providerPlanConfig() async throws -> [String: Any] {
        try await rawObject("api/provider-plans/config")
    }

    func updateProviderPlanConfig(_ body: Data) async throws -> [String: Any] {
        let data = try await putJSON("api/provider-plans/config", body: body)
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw GatewayClientError.invalidResponse
        }
        return object
    }

    func providerPlanStatus() async throws -> ProviderPlanStatusResponse {
        try await get("api/provider-plans/status", as: ProviderPlanStatusResponse.self)
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

    func memoryList() async throws -> GatewayMemoryList {
        try await get("api/memory", as: GatewayMemoryList.self)
    }

    // Callers serialize the {provider, settings} payload on their own actor
    // (same Sendable constraint as putJSON).
    func testMemoryProvider(_ body: Data) async throws -> [String: Any] {
        let data = try await request("api/memory/providers/test", method: "POST", body: body)
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw GatewayClientError.invalidResponse
        }
        return object
    }

    func memoryFiles() async throws -> [String] {
        (try await memoryList()).files
    }

    func searchMemory(_ query: String) async throws -> [GatewayMemorySearchResult] {
        try await get(
            "api/memory/search",
            as: GatewayMemorySearchResponse.self,
            queryItems: [URLQueryItem(name: "query", value: query)]
        ).results
    }

    func createMemory(file: String, content: String) async throws -> GatewayMemoryCreateResponse {
        let body = try JSONSerialization.data(
            withJSONObject: [
                "file": file.trimmingCharacters(in: .whitespacesAndNewlines),
                "content": content,
            ]
        )
        let data = try await request("api/memory", method: "POST", body: body)
        return try JSONDecoder().decode(GatewayMemoryCreateResponse.self, from: data)
    }

    func updateMemory(file: String, index: Int, content: String) async throws -> GatewaySuccessResponse {
        let body = try JSONSerialization.data(withJSONObject: ["index": index, "content": content])
        let data = try await request(
            "api/memory/\(pathSegment(file))",
            method: "PUT",
            body: body
        )
        return try JSONDecoder().decode(GatewaySuccessResponse.self, from: data)
    }

    func deleteMemory(file: String, index: Int? = nil) async throws -> GatewaySuccessResponse {
        let body: Data?
        if let index {
            body = try JSONSerialization.data(withJSONObject: ["index": index])
        } else {
            body = nil
        }
        let data = try await request(
            "api/memory/\(pathSegment(file))",
            method: "DELETE",
            body: body
        )
        return try JSONDecoder().decode(GatewaySuccessResponse.self, from: data)
    }

    // ─── Metrics ─────────────────────────────────────────────────────────────

    func metricsOverview() async throws -> MetricsOverview {
        try await get("api/metrics/overview", as: MetricsOverview.self)
    }

    func metricsTokens() async throws -> TokenMetrics {
        try await get("api/metrics/tokens", as: TokenMetrics.self)
    }

    func metricsTokenAnalysis() async throws -> TokenAnalysisMetrics {
        try await get("api/metrics/token-analysis", as: TokenAnalysisMetrics.self)
    }

    func metricsFiles() async throws -> FileMetrics {
        try await get("api/metrics/files", as: FileMetrics.self)
    }

    func metricsTools() async throws -> ToolMetrics {
        try await get("api/metrics/tools", as: ToolMetrics.self)
    }

    func metricsTimeSeries() async throws -> TimeSeriesData {
        try await get("api/metrics/time-series", as: TimeSeriesData.self)
    }

    func metricsStorage() async throws -> MetricsStorage {
        try await get("api/metrics/storage", as: MetricsStorage.self)
    }

    func metricsProviders() async throws -> ProviderMetrics {
        try await get("api/metrics/providers", as: ProviderMetrics.self)
    }

    func metricsModels() async throws -> ModelMetrics {
        try await get("api/metrics/models", as: ModelMetrics.self)
    }

    func metricsInsights() async throws -> MetricsInsights {
        try await get("api/metrics/insights", as: MetricsInsights.self)
    }

    // ─── Channels / Logs ─────────────────────────────────────────────────────

    func channels() async throws -> [GatewayChannel] {
        try await getList("api/channels", keys: ["channels", "items"])
    }

    func setChannelEnabled(_ id: String, enabled: Bool) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["enabled": enabled])
        _ = try await request("api/channels/\(id)/toggle", method: "POST", body: body)
    }

    @discardableResult
    func deleteChannel(_ id: String) async throws -> Data {
        try await request("api/channels/\(id)", method: "DELETE")
    }

    func systemLogsPage(limit: Int = 200, offset: Int = 0) async throws -> GatewayLogPage {
        let boundedLimit = min(max(1, limit), 1000)
        let boundedOffset = max(0, offset)
        let queryItems = [
            URLQueryItem(name: "limit", value: "\(boundedLimit)"),
            URLQueryItem(name: "offset", value: "\(boundedOffset)"),
            URLQueryItem(name: "includeTotal", value: "1"),
        ]

        do {
            return try await get("api/logs/system", as: GatewayLogPage.self, queryItems: queryItems)
        } catch GatewayClientError.decodingFailed {
            let logs: [GatewayLogEntry] = try await getList(
                "api/logs/system",
                keys: ["logs", "items"],
                queryItems: queryItems
            )
            return GatewayLogPage(
                logs: Array(logs.prefix(boundedLimit)),
                total: nil,
                limit: boundedLimit,
                offset: boundedOffset,
                hasMore: nil
            )
        }
    }

    func systemLogs(limit: Int = 200) async throws -> [GatewayLogEntry] {
        let page = try await systemLogsPage(limit: limit)
        return page.logs
    }

    func restartGateway() async throws -> [String: Any] {
        let data = try await request("api/system/restart", method: "POST")
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw GatewayClientError.invalidResponse
        }
        return object
    }

    // ─── Theme ───────────────────────────────────────────────────────────────

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

    func sendWallet(_ body: Data) async throws -> [String: Any] {
        let data = try await request("api/wallet/send", method: "POST", body: body)
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw GatewayClientError.invalidResponse
        }
        return object
    }

    func sendWalletToken(_ body: Data) async throws -> [String: Any] {
        let data = try await request("api/wallet/send-token", method: "POST", body: body)
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw GatewayClientError.invalidResponse
        }
        return object
    }

    func skills() async throws -> [GatewaySkill] {
        try await getList("api/skills", keys: ["skills", "items"])
    }

    func skillsStatus() async throws -> GatewaySkillsStatusResponse {
        try await get("api/skills/status", as: GatewaySkillsStatusResponse.self)
    }

    func createSkill(name: String, category: String, description: String, content: String) async throws -> GatewaySkill {
        let body = try JSONSerialization.data(
            withJSONObject: [
                "name": name.trimmingCharacters(in: .whitespacesAndNewlines),
                "category": category.trimmingCharacters(in: .whitespacesAndNewlines),
                "description": description.trimmingCharacters(in: .whitespacesAndNewlines),
                "content": content,
            ]
        )
        let data = try await request("api/skills", method: "POST", body: body)
        do {
            return try JSONDecoder().decode(GatewaySkill.self, from: data)
        } catch {
            throw GatewayClientError.decodingFailed("api/skills", String(describing: error))
        }
    }

    func skillsRegistryBrowse(
        registry: String?,
        sort: String = "downloads",
        maxPages: Int = 1,
        limit: Int = 100
    ) async throws -> GatewaySkillsRegistryResponse {
        try await get(
            "api/skills/registry/browse",
            as: GatewaySkillsRegistryResponse.self,
            queryItems: skillsRegistryQueryItems(
                registry: registry,
                sort: sort,
                maxPages: maxPages,
                limit: limit
            )
        )
    }

    func skillsRegistrySearch(
        query: String,
        registry: String?,
        sort: String = "downloads",
        maxPages: Int = 1,
        limit: Int = 100
    ) async throws -> GatewaySkillsRegistryResponse {
        try await get(
            "api/skills/registry/search",
            as: GatewaySkillsRegistryResponse.self,
            queryItems: skillsRegistryQueryItems(
                query: query,
                registry: registry,
                sort: sort,
                maxPages: maxPages,
                limit: limit
            )
        )
    }

    func installSkill(
        slug: String,
        registry: String?,
        allowSuspicious: Bool = false
    ) async throws -> GatewaySkillInstallResult {
        var payload: [String: Any] = [
            "slug": slug,
            "allowSuspicious": allowSuspicious,
        ]
        if let registry = firstNonEmptyGatewayString(registry) {
            payload["registry"] = registry
        }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let data = try await request("api/skills/install", method: "POST", body: body)
        do {
            return try JSONDecoder().decode(GatewaySkillInstallResult.self, from: data)
        } catch {
            throw GatewayClientError.decodingFailed("api/skills/install", String(describing: error))
        }
    }

    private func skillsRegistryQueryItems(
        query: String? = nil,
        registry: String?,
        sort: String,
        maxPages: Int,
        limit: Int
    ) -> [URLQueryItem] {
        var items = [
            URLQueryItem(name: "sort", value: sort),
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "maxPages", value: String(maxPages)),
        ]
        if let query = firstNonEmptyGatewayString(query) {
            items.append(URLQueryItem(name: "q", value: query))
        }
        if let registry = firstNonEmptyGatewayString(registry) {
            items.append(URLQueryItem(name: "registry", value: registry))
        }
        return items
    }

    @discardableResult
    func deleteSkill(_ name: String) async throws -> Data {
        let allowed = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))
        let encoded = name.addingPercentEncoding(withAllowedCharacters: allowed) ?? name
        return try await request("api/skills/\(encoded)", method: "DELETE")
    }

    func updateSkills() async throws {
        _ = try await request("api/skills/update", method: "POST")
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

    func revertSession(
        _ id: String,
        messageContent: String?,
        messageTimestamp: String?
    ) async throws -> Data {
        var payload: [String: Any] = ["messageRole": "user"]
        if let messageContent, !messageContent.isEmpty {
            payload["messageContent"] = messageContent
        }
        if let messageTimestamp, !messageTimestamp.isEmpty {
            payload["messageTimestamp"] = messageTimestamp
        }
        let body = try JSONSerialization.data(withJSONObject: payload)
        return try await request("api/sessions/\(id)/revert", method: "POST", body: body)
    }

    func updateSessionWorkspace(
        _ id: String,
        workspaceDir: String?
    ) async throws -> GatewaySessionWorkspaceUpdateResponse {
        let normalizedWorkspaceDir = firstNonEmptyGatewayString(workspaceDir)
        let payloadValue: Any = normalizedWorkspaceDir ?? NSNull()
        let body = try JSONSerialization.data(
            withJSONObject: ["workspaceDir": payloadValue]
        )
        let data = try await request("api/sessions/\(id)/workspace", method: "PUT", body: body)
        return try JSONDecoder().decode(GatewaySessionWorkspaceUpdateResponse.self, from: data)
    }

    func updateSessionAgent(
        _ id: String,
        agentId: String
    ) async throws -> GatewaySessionAgentUpdateResponse {
        let body = try JSONSerialization.data(withJSONObject: ["agentId": agentId])
        let data = try await request("api/sessions/\(id)/agent", method: "PUT", body: body)
        return try JSONDecoder().decode(GatewaySessionAgentUpdateResponse.self, from: data)
    }

}

// ─── Live status (SSE) ───────────────────────────────────────────────────────

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
            if let password = GatewayClient.loadGatewayPassword() {
                request.setValue(password, forHTTPHeaderField: "X-Cybara-Gateway-Password")
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
