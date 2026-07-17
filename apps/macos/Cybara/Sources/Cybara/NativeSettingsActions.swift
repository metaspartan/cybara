import AppKit
import SwiftUI

extension NativeSettingsScreen {
    func saveDangerousPolicy() {
        saveConfigPatch(
            ["dangerous_tool_policy": ["enabled": dangerousPolicyEnabled, "mode": dangerousPolicyMode]],
            key: "dangerous_tool_policy"
        )
    }

    func saveChatAppearance() {
        saveConfigPatch(["chat_appearance": chatAppearance.payload], key: "chat_appearance")
    }

    func saveLabSettings() {
        saveConfigPatch(
            [
                "lab": [
                    "enabled": labEnabled,
                    "goldenTurnsEnabled": labGoldenTurnsEnabled,
                    "trajectoryCaptureEnabled": labTrajectoryCaptureEnabled,
                    "sanitizeExportsByDefault": labSanitizeExportsByDefault,
                    "defaultExportFormat": labDefaultExportFormat,
                ],
            ],
            key: "lab"
        )
    }

    func saveSandboxRuntime() {
        saveConfigPatch(
            [
                "sandbox_runtime": [
                    "enabled": sandboxEnabled,
                    "provider": sandboxProvider,
                    "network": sandboxNetwork,
                ],
            ],
            key: "sandbox_runtime"
        )
    }

    func saveWebToolPolicy() {
        let fetchHosts = webFetchHosts
            .split(whereSeparator: { $0 == "," || $0.isNewline })
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { !$0.isEmpty }
        let searchHosts = webSearchHosts
            .split(whereSeparator: { $0 == "," || $0.isNewline })
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { !$0.isEmpty }
        saveConfigPatch(
            [
                "web_tool_url_policy": [
                    "enabled": webPolicyEnabled,
                    "fetch_allowlist": Array(Set(fetchHosts)).sorted(),
                    "search_result_allowlist": Array(Set(searchHosts)).sorted(),
                ],
            ],
            key: "web_tool_url_policy"
        )
    }

    func saveComputerUseDriverPath() {
        saveConfigPatch(
            ["computer_use": ["driverCommand": computerUseDriverPath.trimmingCharacters(in: .whitespacesAndNewlines)]],
            key: "computer_use",
            onSuccess: { Task { await loadComputerUseStatus() } }
        )
    }

    @MainActor
    func loadComputerUseStatus() async {
        computerUseBusy = true
        defer { computerUseBusy = false }
        do {
            let status = try await client.computerUseStatus()
            computerUseStatus = status
            computerUseDriverPath = status.configuredCommand ?? ""
        } catch {
            self.error = error.localizedDescription
        }
    }

    @MainActor
    func grantComputerUsePermissions() async {
        computerUseBusy = true
        defer { computerUseBusy = false }
        do {
            let result = try await client.grantComputerUsePermissions()
            if result["ok"] as? Bool != true {
                self.error = result["message"] as? String ?? "Permission request failed."
            }
            let status = try await client.computerUseStatus()
            computerUseStatus = status
            computerUseDriverPath = status.configuredCommand ?? ""
        } catch {
            self.error = error.localizedDescription
        }
    }

    func saveSpeechSettings() {
        saveConfigPatch(
            [
                "speech": [
                    "tts": [
                        "provider": speechTTSProvider,
                        "providerId": speechTTSProviderId,
                        "model": speechTTSModel,
                        "voice": speechTTSVoice,
                        "outputFormat": speechTTSFormat,
                        "fallbackToSystem": speechTTSFallback,
                    ],
                    "stt": [
                        "provider": speechSTTProvider,
                        "providerId": speechSTTProviderId,
                        "model": speechSTTModel,
                        "language": speechSTTLanguage,
                    ],
                    "realtime": [
                        "provider": speechRealtimeProvider,
                        "providerId": speechRealtimeProviderId,
                        "model": speechRealtimeModel,
                        "voice": speechRealtimeVoice,
                        "serverUrl": speechRealtimeServerURL,
                        "bargeIn": speechRealtimeBargeIn,
                        "silenceDurationMs": Int(speechRealtimeSilence) ?? 700,
                    ],
                ],
            ],
            key: "speech"
        )
    }

    func saveMemorySettings() {
        var memory = config["memory"] as? [String: Any] ?? [:]
        memory["backgroundReviewEnabled"] = memoryBackgroundReview
        memory["memoryFlushEnabled"] = memoryFlushEnabled
        memory["memoryFlushSoftThresholdTokens"] = max(500, Int(memoryFlushThreshold) ?? 4000)
        saveConfigPatch(["memory": memory], key: "memory")
    }

    func saveLlmTimeoutSettings() {
        let payload: [String: Any] = [
            "firstTokenSeconds": max(10, Int(llmFirstTokenSeconds) ?? 300),
            "stallSeconds": max(0, Int(llmStallSeconds) ?? 300),
            "totalSeconds": max(0, Int(llmTotalSeconds) ?? 0),
            "nonStreamingSeconds": max(60, Int(llmNonStreamingSeconds) ?? 1800),
        ]
        saveConfigPatch(["llm_timeouts": payload], key: "llm_timeouts")
    }

    func saveMemoryProviderSettings() {
        var payload: [String: Any] = [
            "provider": memoryProvider,
            "autoRecall": memoryAutoRecall,
            "autoCapture": memoryAutoCapture,
        ]
        for (provider, fields) in Self.memoryProviderFieldSpecs {
            var section: [String: Any] = [:]
            for field in fields {
                section[field.key] = memoryProviderFields["\(provider).\(field.key)"] ?? ""
            }
            payload[provider] = section
        }
        saveConfigPatch(["memory_provider": payload], key: "memory_provider")
    }

    func saveIndexingSettings() {
        var indexer = config["workspace_indexer"] as? [String: Any] ?? [:]
        indexer["enabled"] = indexEnabled
        indexer["semanticEnabled"] = indexSemantic
        indexer["includeHidden"] = indexHidden
        indexer["autoReindexOnWorkspaceSet"] = indexAutoReindex
        indexer["embeddingProvider"] = indexEmbeddingProvider
        indexer["embeddingModel"] = indexEmbeddingModel
        saveConfigPatch(["workspace_indexer": indexer], key: "workspace_indexer")
    }

    func testMemoryProviderConnection() {
        var settings: [String: Any] = [
            "provider": memoryProvider,
            "autoRecall": memoryAutoRecall,
            "autoCapture": memoryAutoCapture,
        ]
        for (provider, fields) in Self.memoryProviderFieldSpecs {
            var section: [String: Any] = [:]
            for field in fields {
                section[field.key] = memoryProviderFields["\(provider).\(field.key)"] ?? ""
            }
            settings[provider] = section
        }
        guard let body = try? JSONSerialization.data(
            withJSONObject: ["provider": memoryProvider, "settings": settings]
        ) else { return }
        memoryTesting = true
        memoryTestResult = nil
        Task {
            do {
                let result = try await client.testMemoryProvider(body)
                let ok = result["ok"] as? Bool ?? false
                let detail = result["detail"] as? String ?? (ok ? "Connected" : "Failed")
                memoryTestOK = ok
                memoryTestResult = "\(ok ? "Connected" : "Failed") — \(detail)"
            } catch {
                memoryTestOK = false
                memoryTestResult = "Failed — \(error.localizedDescription)"
            }
            memoryTesting = false
        }
    }

    func saveConfigPatch(
        _ patch: [String: Any],
        key: String,
        onSuccess: (() -> Void)? = nil
    ) {
        guard let body = try? JSONSerialization.data(withJSONObject: patch) else { return }
        savingKey = key
        Task {
            do {
                try await client.updateAppConfig(body)
                for (patchKey, value) in patch { config[patchKey] = value }
                onSuccess?()
                error = nil
            } catch {
                self.error = error.localizedDescription
            }
            savingKey = nil
        }
    }

    func saveCybaraDataDirectory() {
        let path = configuredCybaraDataDir.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !path.isEmpty,
              let body = try? JSONSerialization.data(withJSONObject: ["cybara_data_dir": path])
        else { return }
        savingKey = "cybara_data_dir"
        Task {
            do {
                try await client.updateAppConfig(body)
                let refreshed = try await client.appConfig()
                config = refreshed
                readConfig(refreshed)
                error = nil
            } catch {
                self.error = error.localizedDescription
            }
            savingKey = nil
        }
    }

    func copyServerURL() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(sidecar.serverURL.absoluteString, forType: .string)
        copiedURL = true
        Task {
            try? await Task.sleep(for: .seconds(1.4))
            copiedURL = false
        }
    }

    func restartGateway() async {
        gatewayRestarting = true
        defer { gatewayRestarting = false }

        if sidecar.managesGateway {
            await sidecar.restart()
            await load()
            return
        }

        do {
            let response = try await client.restartGateway()
            if response["success"] as? Bool == false {
                throw GatewayClientError.invalidResponse
            }
            await sidecar.waitForAttachedGatewayRestart()
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func refreshGatewayLogs() async {
        guard sidecar.isReady else {
            gatewayLogs = []
            return
        }
        if let page = try? await client.systemLogsPage(limit: 80) {
            gatewayLogs = page.logs
        }
    }

    func load() async {
        guard sidecar.isReady else {
            health = nil
            buildInfo = nil
            config = [:]
            providers = []
            gatewayLogs = []
            migrationSources = []
            error = nil
            return
        }

        do {
            async let h = client.health()
            async let build = client.buildInfo()
            async let cfg = client.appConfig()
            async let p = client.providers()
            health = try await h
            buildInfo = try await build
            config = try await cfg
            providers = try await p
            readConfig(config)
            error = nil
            if let loadedAgents = try? await client.agents() {
                agents = loadedAgents
            }
        } catch {
            self.error = error.localizedDescription
        }

        if let auth = try? await client.authSettings(), auth["success"] as? Bool == true {
            readAuthSettings(auth)
            authAvailable = true
        } else {
            authAvailable = false
        }

        await refreshGatewayLogs()
        await refreshMigrationSources()
    }

    func refreshMigrationSources() async {
        guard sidecar.isReady else {
            migrationSources = []
            return
        }
        if let sources = try? await client.migrationSources() {
            migrationSources = sources
            if migrationSourcePath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
               let detected = sources.first(where: { $0.exists }) {
                migrationSourceKind = detected.kind
                migrationSourcePath = detected.path
            }
        }
    }

    func migrationPayloadData() -> Data? {
        var payload: [String: Any] = [
            "sourceKind": migrationSourceKind,
            "preset": migrationPreset,
            "migrateSecrets": migrationImportSecrets,
            "overwrite": migrationOverwrite,
            "skillConflict": migrationSkillConflict,
        ]
        let source = migrationSourcePath.trimmingCharacters(in: .whitespacesAndNewlines)
        if !source.isEmpty { payload["sourcePath"] = source }
        let workspace = migrationWorkspaceTarget.trimmingCharacters(in: .whitespacesAndNewlines)
        if !workspace.isEmpty { payload["workspaceTarget"] = workspace }
        return try? JSONSerialization.data(withJSONObject: payload)
    }

    func previewMigration() async {
        guard let body = migrationPayloadData() else { return }
        migrationBusy = true
        defer { migrationBusy = false }
        do {
            migrationReport = try await client.previewMigration(body: body)
            migrationMessage = "Preview ready"
        } catch {
            migrationMessage = "Preview failed: \(error.localizedDescription)"
        }
    }

    func applyMigration() async {
        guard let body = migrationPayloadData() else { return }
        migrationBusy = true
        defer { migrationBusy = false }
        do {
            migrationReport = try await client.runMigration(body: body)
            migrationMessage = "Migration complete"
            await refreshMigrationSources()
        } catch {
            migrationMessage = "Migration failed: \(error.localizedDescription)"
        }
    }

    func chooseMigrationSourceDirectory() {
        chooseMigrationDirectory(title: "Choose Legacy Agent Directory") { path in
            migrationSourcePath = path
        }
    }

    func chooseMigrationWorkspaceDirectory() {
        chooseMigrationDirectory(title: "Choose Workspace Directory") { path in
            migrationWorkspaceTarget = path
        }
    }

    func chooseDefaultWorkspaceDirectory() {
        chooseMigrationDirectory(title: "Choose Default Workspace") { path in
            defaultWorkspaceDir = path
        }
    }

    func chooseCybaraDataDirectory() {
        chooseMigrationDirectory(title: "Choose Cybara Data Directory") { path in
            configuredCybaraDataDir = path
        }
    }

    func chooseMigrationDirectory(title: String, update: (String) -> Void) {
        let panel = NSOpenPanel()
        panel.title = title
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url {
            update(url.path)
        }
    }

    func migrationStatusColor(_ status: String) -> Color {
        switch status.lowercased() {
        case "migrated":
            return .green
        case "planned":
            return .blue
        case "conflict", "error":
            return .red
        case "archived":
            return .orange
        default:
            return .secondary
        }
    }

    func readAuthSettings(_ auth: [String: Any]) {
        authKeyPreview = auth["apiKeyPreview"] as? String ?? "No API key configured"
        authKeySource = auth["apiKeySource"] as? String ?? ""
        authRequireLocalhost = auth["requireAuthForLocalhost"] as? Bool ?? false
        authRequireForced = auth["requireAuthForLocalhostForced"] as? Bool ?? false
        authGatewayPasswordEnabled = auth["gatewayPasswordEnabled"] as? Bool ?? false
        if let remote = auth["remoteAccess"] as? [String: Any] {
            remoteAccessEnabled = remote["enabled"] as? Bool ?? false
            remoteAccessMode = remote["mode"] as? String ?? "private_overlay"
            remoteAccessProvider = remote["provider"] as? String ?? "tailscale"
            remoteAccessBaseURL = remote["baseUrl"] as? String ?? ""
            remoteAccessMessage = remote["message"] as? String ?? ""
            remoteAccessReady = remote["ready"] as? Bool ?? false
        }
    }

    func toggleRevealAuthKey() async {
        if authRevealedKey != nil {
            authRevealedKey = nil
            return
        }
        authBusy = true
        defer { authBusy = false }
        if let key = try? await client.revealAuthKey() {
            authRevealedKey = key
        }
    }

    func copyAuthKey() async {
        authBusy = true
        defer { authBusy = false }
        let key: String?
        if let revealed = authRevealedKey {
            key = revealed
        } else {
            key = try? await client.revealAuthKey()
        }
        guard let key, !key.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(key, forType: .string)
        authCopied = true
        Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            authCopied = false
        }
    }

    func rotateAuthKey() async {
        authBusy = true
        defer { authBusy = false }
        do {
            if let key = try await client.rotateAuthKey() {
                authRevealedKey = key
            }
            if let auth = try? await client.authSettings() {
                readAuthSettings(auth)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func updateRequireLocalhostAuth() async {
        authBusy = true
        defer { authBusy = false }
        do {
            let auth = try await client.updateAuthSettings(
                requireAuthForLocalhost: authRequireLocalhost
            )
            readAuthSettings(auth)
        } catch {
            self.error = error.localizedDescription
            if let auth = try? await client.authSettings() {
                readAuthSettings(auth)
            }
        }
    }

    func saveRemoteAccess() async {
        authBusy = true
        defer { authBusy = false }
        do {
            let auth = try await client.updateAuthSettings(
                remoteAccess: [
                    "enabled": remoteAccessEnabled,
                    "mode": remoteAccessMode,
                    "provider": remoteAccessProvider,
                    "baseUrl": remoteAccessBaseURL.trimmingCharacters(in: .whitespacesAndNewlines),
                ]
            )
            readAuthSettings(auth)
        } catch {
            self.error = error.localizedDescription
            if let auth = try? await client.authSettings() {
                readAuthSettings(auth)
            }
        }
    }

    func saveGatewayPassword() async {
        let password = gatewayPasswordDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard password.count >= 12 else {
            error = "Gateway password must be at least 12 characters"
            return
        }
        guard password == gatewayPasswordConfirm.trimmingCharacters(in: .whitespacesAndNewlines)
        else {
            error = "Gateway password confirmation does not match"
            return
        }
        authBusy = true
        defer { authBusy = false }
        do {
            try GatewayPasswordStore.validateWrite(password)
            let auth = try await client.updateAuthSettings(gatewayPassword: password)
            try GatewayPasswordStore.save(password)
            gatewayPasswordDraft = ""
            gatewayPasswordConfirm = ""
            readAuthSettings(auth)
        } catch {
            self.error = error.localizedDescription
            if let auth = try? await client.authSettings() {
                readAuthSettings(auth)
            }
        }
    }

    func clearGatewayPassword() async {
        authBusy = true
        defer { authBusy = false }
        do {
            let auth = try await client.updateAuthSettings(clearGatewayPassword: true)
            try GatewayPasswordStore.clear()
            readAuthSettings(auth)
        } catch {
            self.error = error.localizedDescription
            if let auth = try? await client.authSettings() {
                readAuthSettings(auth)
            }
        }
    }

    func readConfig(_ config: [String: Any]) {
        selectedAccent = readAccentKey(from: config) ?? "indigo"
        onAccentChanged(selectedAccent)
        defaultModel = config["default_model"] as? String ?? ""
        defaultWorkspaceDir = config["default_workspace_dir"] as? String ?? defaultWorkspaceDir
        cybaraDataDir = config["cybara_data_dir"] as? String ?? cybaraDataDir
        configuredCybaraDataDir =
            config["configured_cybara_data_dir"] as? String ?? cybaraDataDir
        cybaraDataDirSource = config["cybara_data_dir_source"] as? String ?? "default"
        cybaraDataDirForced = config["cybara_data_dir_forced"] as? Bool ?? false
        cybaraDataDirRestartRequired =
            config["cybara_data_dir_restart_required"] as? Bool
            ?? (cybaraDataDir != configuredCybaraDataDir)
        cybaraDataDirOverrideFile = config["cybara_data_dir_override_file"] as? String ?? ""
        defaultCybaraDataDir = config["default_cybara_data_dir"] as? String ?? ""
        reasoningEffort = config["reasoning_effort"] as? String ?? ""
        followUpBehaviorEnabled = config["follow_up_behavior_enabled"] as? Bool ?? true
        chatAppearance = NativeChatAppearanceSettings(config: config)
        defaultAgentId = config["default_agent_id"] as? String ?? ""
        backgroundAgentId = config["background_agent_id"] as? String ?? ""
        visionFallbackAgentId = config["vision_fallback_agent_id"] as? String ?? ""
        terminalEnabled = config["terminal_enabled"] as? Bool ?? false
        acpEnabled = config["acp_enabled"] as? Bool ?? true
        selfImprovingSkills = (config["self_improving_skills_enabled"] as? Bool) ?? true
        let webPolicy = config["web_tool_url_policy"] as? [String: Any] ?? [:]
        webPolicyEnabled = webPolicy["enabled"] as? Bool ?? false
        webFetchHosts = (webPolicy["fetch_allowlist"] as? [String] ?? []).joined(separator: ", ")
        webSearchHosts = (webPolicy["search_result_allowlist"] as? [String] ?? []).joined(separator: ", ")
        Task { await loadComputerUseStatus() }
        let policy = config["dangerous_tool_policy"] as? [String: Any] ?? [:]
        dangerousPolicyEnabled = policy["enabled"] as? Bool ?? false
        dangerousPolicyMode = policy["mode"] as? String == "block" ? "block" : "audit"
        toolApprovalMode = config["tool_approval_mode"] as? String == "ask" ? "ask" : "always_allow"
        let sandbox = config["sandbox_runtime"] as? [String: Any] ?? [:]
        sandboxEnabled = sandbox["enabled"] as? Bool ?? false
        sandboxProvider = sandbox["provider"] as? String ?? "auto"
        sandboxNetwork = sandbox["network"] as? String == "allow" ? "allow" : "deny"
        let speech = config["speech"] as? [String: Any] ?? [:]
        let tts = speech["tts"] as? [String: Any] ?? [:]
        let stt = speech["stt"] as? [String: Any] ?? [:]
        let realtime = speech["realtime"] as? [String: Any] ?? [:]
        let provider = tts["provider"] as? String ?? "auto"
        speechTTSProvider = ["auto", "local", "system", "elevenlabs", "openai"].contains(provider) ? provider : "auto"
        speechTTSProviderId = tts["providerId"] as? String ?? ""
        speechTTSModel = tts["model"] as? String ?? ""
        speechTTSVoice = tts["voice"] as? String ?? ""
        speechTTSFormat = tts["outputFormat"] as? String ?? "mp3"
        speechTTSFallback = tts["fallbackToSystem"] as? Bool ?? true
        let sttProvider = stt["provider"] as? String ?? "auto"
        speechSTTProvider = ["auto", "native", "local", "openai"].contains(sttProvider) ? sttProvider : "auto"
        speechSTTProviderId = stt["providerId"] as? String ?? ""
        speechSTTModel = stt["model"] as? String ?? ""
        speechSTTLanguage = stt["language"] as? String ?? ""
        let realtimeProvider = realtime["provider"] as? String ?? "managed"
        speechRealtimeProvider = ["managed", "openai", "gemini", "moshi"].contains(realtimeProvider) ? realtimeProvider : "managed"
        speechRealtimeProviderId = realtime["providerId"] as? String ?? ""
        speechRealtimeModel = realtime["model"] as? String ?? ""
        speechRealtimeVoice = realtime["voice"] as? String ?? ""
        speechRealtimeServerURL = realtime["serverUrl"] as? String ?? ""
        speechRealtimeBargeIn = realtime["bargeIn"] as? Bool ?? true
        speechRealtimeSilence = String(realtime["silenceDurationMs"] as? Int ?? 700)
        let memory = config["memory"] as? [String: Any] ?? [:]
        memoryBackgroundReview = memory["backgroundReviewEnabled"] as? Bool ?? true
        memoryFlushEnabled = memory["memoryFlushEnabled"] as? Bool ?? true
        memoryFlushThreshold = String(memory["memoryFlushSoftThresholdTokens"] as? Int ?? 4000)
        let lab = config["lab"] as? [String: Any] ?? [:]
        labEnabled = lab["enabled"] as? Bool ?? true
        labGoldenTurnsEnabled = lab["goldenTurnsEnabled"] as? Bool ?? true
        labTrajectoryCaptureEnabled = lab["trajectoryCaptureEnabled"] as? Bool ?? true
        labSanitizeExportsByDefault = lab["sanitizeExportsByDefault"] as? Bool ?? true
        let labFormat = lab["defaultExportFormat"] as? String ?? "distillation_sft"
        labDefaultExportFormat = [
            "distillation_sft",
            "trl_sft",
            "hf_session_trace",
            "cybara_trace",
            "long_context",
            "prompt_completion",
        ].contains(labFormat) ? labFormat : "distillation_sft"
        let timeouts = config["llm_timeouts"] as? [String: Any] ?? [:]
        llmFirstTokenSeconds = String(timeouts["firstTokenSeconds"] as? Int ?? 300)
        llmStallSeconds = String(timeouts["stallSeconds"] as? Int ?? 300)
        llmTotalSeconds = String(timeouts["totalSeconds"] as? Int ?? 0)
        llmNonStreamingSeconds = String(timeouts["nonStreamingSeconds"] as? Int ?? 1800)
        let memoryProviderConfig = config["memory_provider"] as? [String: Any] ?? [:]
        let providerId = memoryProviderConfig["provider"] as? String ?? "local"
        memoryProvider = Self.memoryProviderChoices.contains { $0.id == providerId } ? providerId : "local"
        memoryAutoRecall = memoryProviderConfig["autoRecall"] as? Bool ?? true
        memoryAutoCapture = memoryProviderConfig["autoCapture"] as? Bool ?? true
        var fieldValues: [String: String] = [:]
        for (provider, fields) in Self.memoryProviderFieldSpecs {
            let section = memoryProviderConfig[provider] as? [String: Any] ?? [:]
            for field in fields {
                let fallback = field.key == "apiKey" ? "" : field.placeholder
                fieldValues["\(provider).\(field.key)"] = section[field.key] as? String ?? fallback
            }
        }
        memoryProviderFields = fieldValues
        let indexer = config["workspace_indexer"] as? [String: Any] ?? [:]
        indexEnabled = indexer["enabled"] as? Bool ?? false
        indexSemantic = indexer["semanticEnabled"] as? Bool ?? false
        indexHidden = indexer["includeHidden"] as? Bool ?? false
        indexAutoReindex = indexer["autoReindexOnWorkspaceSet"] as? Bool ?? false
        let embedding = indexer["embeddingProvider"] as? String ?? "auto"
        indexEmbeddingProvider = ["auto", "local", "transformers_js", "openai", "voyage", "gemini", "ollama"].contains(embedding) ? embedding : "auto"
        indexEmbeddingModel = indexer["embeddingModel"] as? String ?? ""
    }

    func readAccentKey(from config: [String: Any]) -> String? {
        for key in ["themeAccent", "theme_accent", "theme", "accent", "ui_accent"] {
            if let value = config[key] as? String,
               CybaraAccent.palette[value.lowercased()] != nil {
                return value.lowercased()
            }
        }
        return nil
    }

    enum SettingsAdvancedSection: String, CaseIterable, Identifiable {
        case router
        case systemPrompt
        case memory
        case channels
        case skills
        case backups
        case logs
        case telemetry
        case permissions

        var id: String { rawValue }

        var title: String {
            switch self {
            case .router: return "Model Router"
            case .systemPrompt: return "System Prompt"
            case .memory: return "Memory"
            case .channels: return "Channels"
            case .skills: return "Skills"
            case .backups: return "Backups"
            case .logs: return "Logs"
            case .telemetry: return "Telemetry"
            case .permissions: return "Permissions"
            }
        }

        var systemImage: String {
            switch self {
            case .router: return "point.3.connected.trianglepath.dotted"
            case .systemPrompt: return "sparkles"
            case .memory: return "brain"
            case .channels: return "link"
            case .skills: return "wand.and.stars"
            case .backups: return "externaldrive.badge.timemachine"
            case .logs: return "list.bullet.rectangle"
            case .telemetry: return "waveform.path.ecg.rectangle"
            case .permissions: return "key.horizontal"
            }
        }
    }
}
