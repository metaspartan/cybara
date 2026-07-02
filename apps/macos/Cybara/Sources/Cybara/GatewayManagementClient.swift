import Foundation

extension GatewayClient {
    @discardableResult
    func createAgent(
        name: String,
        type: String,
        model: String,
        providerID: String?,
        systemPrompt: String,
        reasoningEffort: String,
        autostart: Bool
    ) async throws -> Data {
        let body = try JSONSerialization.data(withJSONObject: agentPayload(
            name: name,
            type: type,
            model: model,
            providerID: providerID,
            systemPrompt: systemPrompt,
            reasoningEffort: reasoningEffort,
            autostart: autostart,
            existingConfig: nil
        ))
        return try await request("api/agents", method: "POST", body: body)
    }

    @discardableResult
    func createAgent(body: Data) async throws -> Data {
        try await request("api/agents", method: "POST", body: body)
    }

    @discardableResult
    func createDefaultAgent() async throws -> Data {
        try await request("api/agents/default", method: "POST")
    }

    @discardableResult
    func updateAgent(
        _ id: String,
        name: String,
        type: String,
        model: String,
        providerID: String?,
        systemPrompt: String,
        reasoningEffort: String,
        autostart: Bool,
        existingConfig: [String: JSONValue]?
    ) async throws -> Data {
        let body = try JSONSerialization.data(withJSONObject: agentPayload(
            name: name,
            type: type,
            model: model,
            providerID: providerID,
            systemPrompt: systemPrompt,
            reasoningEffort: reasoningEffort,
            autostart: autostart,
            existingConfig: existingConfig
        ))
        return try await request("api/agents/\(id)", method: "PUT", body: body)
    }

    @discardableResult
    func updateAgent(_ id: String, body: Data) async throws -> Data {
        try await request("api/agents/\(id)", method: "PUT", body: body)
    }

    @discardableResult
    func deleteAgent(_ id: String) async throws -> Data {
        try await request("api/agents/\(id)", method: "DELETE")
    }

    @discardableResult
    func createProvider(
        provider: String,
        name: String,
        baseURL: String?,
        apiKey: String?,
        accessToken: String?,
        isDefault: Bool
    ) async throws -> Data {
        var payload: [String: Any] = [
            "provider": provider,
            "name": name,
            "is_default": isDefault,
        ]
        if let baseURL, !baseURL.isEmpty { payload["base_url"] = baseURL }
        if let apiKey, !apiKey.isEmpty { payload["api_key"] = apiKey }
        if let accessToken, !accessToken.isEmpty { payload["access_token"] = accessToken }
        let body = try JSONSerialization.data(withJSONObject: payload)
        return try await request("api/providers", method: "POST", body: body)
    }

    @discardableResult
    func updateProvider(
        _ id: String,
        name: String,
        baseURL: String?,
        apiKey: String?,
        accessToken: String?,
        isDefault: Bool
    ) async throws -> Data {
        var payload: [String: Any] = [
            "name": name,
            "is_default": isDefault,
        ]
        if let baseURL, !baseURL.isEmpty { payload["base_url"] = baseURL }
        if let apiKey, !apiKey.isEmpty { payload["api_key"] = apiKey }
        if let accessToken, !accessToken.isEmpty { payload["access_token"] = accessToken }
        let body = try JSONSerialization.data(withJSONObject: payload)
        return try await request("api/providers/\(id)", method: "PUT", body: body)
    }

    @discardableResult
    func deleteProvider(_ id: String) async throws -> Data {
        try await request("api/providers/\(id)", method: "DELETE")
    }

    @discardableResult
    func testProvider(_ id: String) async throws -> Data {
        try await request("api/providers/\(id)/test", method: "POST")
    }

    @discardableResult
    func discoverOllamaProviders() async throws -> Data {
        try await request("api/providers/discover/ollama", method: "POST")
    }

    private func agentPayload(
        name: String,
        type: String,
        model: String,
        providerID: String?,
        systemPrompt: String,
        reasoningEffort: String,
        autostart: Bool,
        existingConfig: [String: JSONValue]?
    ) -> [String: Any] {
        var config = existingConfig?.mapValues(\.anyValue) ?? [:]
        config["autostart"] = autostart
        var modelParams = config["model_params"] as? [String: Any] ?? [:]
        if reasoningEffort.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            modelParams.removeValue(forKey: "reasoning_effort")
        } else {
            modelParams["reasoning_effort"] = reasoningEffort
        }
        if modelParams.isEmpty {
            config.removeValue(forKey: "model_params")
        } else {
            config["model_params"] = modelParams
        }

        var payload: [String: Any] = [
            "name": name,
            "type": type,
            "model": model,
            "system_prompt": systemPrompt,
            "config": config,
        ]
        if let providerID, !providerID.isEmpty {
            payload["provider_id"] = providerID
        }
        return payload
    }
}
