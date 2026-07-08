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
        refreshToken: String?,
        expiresAt: Double?,
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
        if let refreshToken, !refreshToken.isEmpty { payload["refresh_token"] = refreshToken }
        if let expiresAt { payload["expires_at"] = expiresAt }
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
        refreshToken: String?,
        expiresAt: Double?,
        isDefault: Bool
    ) async throws -> Data {
        var payload: [String: Any] = [
            "name": name,
            "is_default": isDefault,
        ]
        if let baseURL, !baseURL.isEmpty { payload["base_url"] = baseURL }
        if let apiKey, !apiKey.isEmpty { payload["api_key"] = apiKey }
        if let accessToken, !accessToken.isEmpty { payload["access_token"] = accessToken }
        if let refreshToken, !refreshToken.isEmpty { payload["refresh_token"] = refreshToken }
        if let expiresAt { payload["expires_at"] = expiresAt }
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

    func startProviderOAuth(providerType: String) async throws -> GatewayOAuthStartResponse {
        let body = try JSONSerialization.data(withJSONObject: ["providerType": providerType])
        let data = try await request("api/providers/oauth/start", method: "POST", body: body)
        return try JSONDecoder().decode(GatewayOAuthStartResponse.self, from: data)
    }

    func providerOAuthCallbackStatus(state: String) async throws -> GatewayOAuthPollResponse {
        let body = try JSONSerialization.data(withJSONObject: ["state": state])
        let data = try await request("api/providers/oauth/callback-status", method: "POST", body: body)
        return try JSONDecoder().decode(GatewayOAuthPollResponse.self, from: data)
    }

    func startProviderDeviceCodeOAuth(providerType: String) async throws -> GatewayOAuthDeviceCodeResponse {
        let body = try JSONSerialization.data(withJSONObject: ["providerType": providerType])
        let data = try await request("api/providers/oauth/device-code", method: "POST", body: body)
        return try JSONDecoder().decode(GatewayOAuthDeviceCodeResponse.self, from: data)
    }

    func pollProviderDeviceCodeOAuth(
        providerType: String,
        deviceCode: String
    ) async throws -> GatewayOAuthPollResponse {
        let body = try JSONSerialization.data(
            withJSONObject: [
                "providerType": providerType,
                "deviceCode": deviceCode,
            ]
        )
        let data = try await request("api/providers/oauth/poll", method: "POST", body: body)
        return try JSONDecoder().decode(GatewayOAuthPollResponse.self, from: data)
    }

    // ─── Gateway auth ────────────────────────────────────────────────────────

    func authSettings() async throws -> [String: Any] {
        try await rawObject("api/auth/settings")
    }

    func updateAuthSettings(
        requireAuthForLocalhost: Bool? = nil,
        gatewayPassword: String? = nil,
        clearGatewayPassword: Bool? = nil,
        remoteAccess: [String: Any]? = nil
    ) async throws -> [String: Any] {
        var payload: [String: Any] = [:]
        if let requireAuthForLocalhost {
            payload["requireAuthForLocalhost"] = requireAuthForLocalhost
        }
        if let gatewayPassword {
            payload["gatewayPassword"] = gatewayPassword
        }
        if clearGatewayPassword == true {
            payload["clearGatewayPassword"] = true
        }
        if let remoteAccess {
            payload["remoteAccess"] = remoteAccess
        }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let data = try await request("api/auth/settings", method: "PUT", body: body)
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw GatewayClientError.invalidResponse
        }
        return object
    }

    func revealAuthKey() async throws -> String? {
        let object = try await rawObject("api/auth/key")
        return object["apiKey"] as? String
    }

    func rotateAuthKey() async throws -> String? {
        let data = try await request("api/auth/rotate-key", method: "POST")
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw GatewayClientError.invalidResponse
        }
        return object["apiKey"] as? String
    }

    func migrationSources() async throws -> [GatewayMigrationSource] {
        let data = try await request("api/migrations/sources")
        return try JSONDecoder().decode(GatewayMigrationSourcesResponse.self, from: data).sources
    }

    func previewMigration(body: Data) async throws -> GatewayMigrationReport {
        let data = try await request("api/migrations/preview", method: "POST", body: body)
        return try JSONDecoder().decode(GatewayMigrationReport.self, from: data)
    }

    func runMigration(body: Data) async throws -> GatewayMigrationReport {
        let data = try await request("api/migrations/run", method: "POST", body: body)
        return try JSONDecoder().decode(GatewayMigrationReport.self, from: data)
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
