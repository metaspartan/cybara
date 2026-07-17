import AppKit
import SwiftUI

extension NativeSettingsScreen {
    var featuresTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NativeSettingsLayout.cardSpacing) {
                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Safety Controls")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        toggleRow("Web Terminal", detail: "Enable browser-based terminal access.", isOn: $terminalEnabled) {
                            saveConfigPatch(["terminal_enabled": terminalEnabled], key: "terminal_enabled")
                        }
                        toggleRow("ACP Server", detail: "Allow compatible editors to connect through the gateway.", isOn: $acpEnabled) {
                            saveConfigPatch(["acp_enabled": acpEnabled], key: "acp_enabled")
                        }
                        if !agents.isEmpty {
                            Picker("Background model", selection: $backgroundAgentId) {
                                Text("Same agent as the turn (default)").tag("")
                                ForEach(agents) { agent in
                                    Text(agent.model.map { "\(agent.name) — \($0)" } ?? agent.name).tag(agent.id)
                                }
                            }
                            .onChange(of: backgroundAgentId) { _, value in
                                saveConfigPatch(["background_agent_id": value], key: "background_agent_id")
                            }
                            Text("Memory and skill review run silently after most turns. Point them at a cheaper agent to cut cost over time.")
                                .font(.system(size: 11, design: .rounded))
                                .foregroundStyle(.secondary)
                            Picker("Image fallback agent", selection: $visionFallbackAgentId) {
                                Text("None").tag("")
                                ForEach(agents.filter(\.supportsImages)) { agent in
                                    Text(agent.model.map { "\(agent.name) — \($0)" } ?? agent.name).tag(agent.id)
                                }
                            }
                            .onChange(of: visionFallbackAgentId) { _, value in
                                saveConfigPatch(["vision_fallback_agent_id": value], key: "vision_fallback_agent_id")
                            }
                            Text("Text-only chat models can use this model to describe attached images.")
                                .font(.system(size: 11, design: .rounded))
                                .foregroundStyle(.secondary)
                        }
                        toggleRow("Dangerous tool policy", detail: "Audit or block high-risk tool requests.", isOn: $dangerousPolicyEnabled) {
                            saveDangerousPolicy()
                        }
                        Picker("Policy mode", selection: $dangerousPolicyMode) {
                            Text("Audit").tag("audit")
                            Text("Block").tag("block")
                        }
                        .pickerStyle(.segmented)
                        .disabled(!dangerousPolicyEnabled)
                        .onChange(of: dangerousPolicyMode) { _, _ in saveDangerousPolicy() }
                        Picker("Tool approvals", selection: $toolApprovalMode) {
                            Text("Always Allow").tag("always_allow")
                            Text("Ask Me").tag("ask")
                        }
                        .pickerStyle(.segmented)
                        .onChange(of: toolApprovalMode) { _, value in
                            saveConfigPatch(["tool_approval_mode": value], key: "tool_approval_mode")
                        }
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Sandbox Runtime")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        Toggle("Enable sandbox runtime", isOn: $sandboxEnabled)
                            .toggleStyle(.switch)
                            .onChange(of: sandboxEnabled) { _, _ in saveSandboxRuntime() }
                        Picker("Provider", selection: $sandboxProvider) {
                            Text("Auto").tag("auto")
                            Text("Apple Sandbox").tag("apple_sandbox")
                            Text("Podman").tag("podman")
                            Text("Docker").tag("docker")
                        }
                        .pickerStyle(.menu)
                        .disabled(!sandboxEnabled)
                        .onChange(of: sandboxProvider) { _, _ in saveSandboxRuntime() }
                        Picker("Network", selection: $sandboxNetwork) {
                            Text("Deny").tag("deny")
                            Text("Allow").tag("allow")
                        }
                        .pickerStyle(.segmented)
                        .disabled(!sandboxEnabled)
                        .onChange(of: sandboxNetwork) { _, _ in saveSandboxRuntime() }
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Web Access Policy")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        toggleRow(
                            "Enforce host allowlists",
                            detail: "Empty enabled lists block that category.",
                            isOn: $webPolicyEnabled
                        ) {
                            saveWebToolPolicy()
                        }
                        TextField("Direct fetch hosts, comma separated", text: $webFetchHosts)
                            .textFieldStyle(.roundedBorder)
                            .onSubmit { saveWebToolPolicy() }
                        TextField("Search result hosts, comma separated", text: $webSearchHosts)
                            .textFieldStyle(.roundedBorder)
                            .onSubmit { saveWebToolPolicy() }
                        HStack {
                            Spacer()
                            Button("Save Policy") { saveWebToolPolicy() }
                                .buttonStyle(.borderedProminent)
                                .disabled(savingKey == "web_tool_url_policy")
                        }
                    }
                }

                computerUseCard
            }
            .nativeSettingsContentLayout()
        }
    }

    var computerUseCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Computer Use")
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                    Spacer()
                    if computerUseBusy {
                        ProgressView().controlSize(.small)
                    } else if let status = computerUseStatus {
                        Text(status.ready ? "Ready" : status.available ? "Needs Attention" : "Unavailable")
                            .font(.system(size: 11, weight: .semibold, design: .rounded))
                            .foregroundStyle(status.ready ? .green : .secondary)
                    }
                }
                if let status = computerUseStatus {
                    Text(status.message)
                        .font(.system(size: 11, design: .rounded))
                        .foregroundStyle(.secondary)
                    if let version = status.version {
                        settingRow("Version", version)
                    }
                    if status.platform == "darwin" {
                        settingRow("Accessibility", status.accessibility == true ? "Granted" : "Required")
                        settingRow("Screen Recording", status.screenRecording == true ? "Granted" : "Required")
                    }
                }
                TextField("Custom driver path", text: $computerUseDriverPath)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { saveComputerUseDriverPath() }
                HStack {
                    Button("Check Status") {
                        Task { await loadComputerUseStatus() }
                    }
                    .disabled(computerUseBusy)
                    if computerUseStatus?.platform == "darwin" {
                        Button("Request Permissions") {
                            Task { await grantComputerUsePermissions() }
                        }
                        .disabled(computerUseBusy)
                    }
                    Spacer()
                    Button("Save Custom Path") { saveComputerUseDriverPath() }
                        .buttonStyle(.borderedProminent)
                        .disabled(computerUseBusy)
                }
            }
        }
    }

    @ViewBuilder
    var ttsTextFields: some View {
        if speechTTSProvider != "local" && speechTTSProvider != "system" {
            TextField("Model", text: $speechTTSModel)
                .textFieldStyle(.roundedBorder)
                .onSubmit { saveSpeechSettings() }
        }
        TextField("Voice ID or name", text: $speechTTSVoice)
            .textFieldStyle(.roundedBorder)
            .onSubmit { saveSpeechSettings() }
    }

    @ViewBuilder
    var sttTextFields: some View {
        TextField("Model", text: $speechSTTModel)
            .textFieldStyle(.roundedBorder)
            .onSubmit { saveSpeechSettings() }
        TextField("Language", text: $speechSTTLanguage)
            .textFieldStyle(.roundedBorder)
            .onSubmit { saveSpeechSettings() }
            .frame(maxWidth: 160)
    }

}
