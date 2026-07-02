import AppKit
import SwiftUI

struct NativeSettingsScreen: View {
    let client: GatewayClient
    var onAccentChanged: (String) -> Void = { _ in }

    @EnvironmentObject private var sidecar: SidecarManager
    @Environment(\.openURL) private var openURL

    @State private var selectedTab: SettingsTab = .general
    @State private var health: GatewayHealth?
    @State private var config: [String: Any] = [:]
    @State private var providers: [GatewayProvider] = []
    @State private var selectedAccent = "indigo"
    @State private var defaultModel = ""
    @State private var reasoningEffort = ""
    @State private var terminalEnabled = false
    @State private var selfImprovingSkills = true
    @State private var dangerousPolicyEnabled = false
    @State private var dangerousPolicyMode = "audit"
    @State private var toolApprovalMode = "always_allow"
    @State private var sandboxEnabled = false
    @State private var sandboxProvider = "auto"
    @State private var sandboxNetwork = "deny"
    @State private var savingKey: String?
    @State private var copiedURL = false
    @State private var error: String?

    private var availableModels: [String] {
        Array(Set(providers.flatMap { $0.models ?? [] })).sorted()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            ScreenHeader(title: "Settings", subtitle: "Native app preferences synced through the gateway")

            TabView(selection: $selectedTab) {
                generalTab.tabItem { Label("General", systemImage: "switch.2") }.tag(SettingsTab.general)
                appearanceTab.tabItem { Label("Appearance", systemImage: "paintpalette") }.tag(SettingsTab.appearance)
                modelTab.tabItem { Label("Model", systemImage: "brain") }.tag(SettingsTab.model)
                featuresTab.tabItem { Label("Features", systemImage: "slider.horizontal.3") }.tag(SettingsTab.features)
            }

            if let error {
                Text(error)
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(24)
        .task { await load() }
    }

    private var generalTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                GlassCard {
                    HStack(spacing: 14) {
                        CybaraLogo(size: 52)
                        VStack(alignment: .leading, spacing: 5) {
                            Text("Cybara")
                                .font(.system(size: 18, weight: .bold, design: .rounded))
                            Text(sidecar.isReady ? "Gateway online" : sidecar.statusMessage)
                                .font(.system(size: 12, design: .rounded))
                                .foregroundStyle(sidecar.isReady ? Color.green : Color.secondary)
                            Text(sidecar.serverURL.absoluteString)
                                .font(.system(size: 11, weight: .medium, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                        }
                        Spacer()
                        StatusPill(status: sidecar.status)
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Desktop")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        settingRow("Gateway version", health?.version.map { "v\($0)" } ?? "Unavailable")
                        settingRow("Gateway uptime", uptimeLabel)
                        settingRow("Launch mode", sidecar.managesGateway ? "Managed sidecar" : "Attached gateway")
                        HStack(spacing: 10) {
                            Button {
                                NotificationCenter.default.post(name: .cybaraCheckForUpdates, object: nil)
                            } label: {
                                Label("Check Updates", systemImage: "arrow.down.circle")
                            }
                            .buttonStyle(.borderedProminent)
                            Button {
                                openURL(sidecar.serverURL)
                            } label: {
                                Label("Open Web UI", systemImage: "globe")
                            }
                            .buttonStyle(.bordered)
                            Button {
                                copyServerURL()
                            } label: {
                                Label(copiedURL ? "Copied" : "Copy URL", systemImage: copiedURL ? "checkmark" : "doc.on.doc")
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                }
            }
            .padding(.vertical, 12)
        }
    }

    private var appearanceTab: some View {
        ScrollView {
            GlassCard {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("Accent")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        Spacer()
                        progressLabel(for: "themeAccent", fallback: CybaraAccent.label(for: selectedAccent))
                    }
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 48, maximum: 58), spacing: 12)], spacing: 12) {
                        ForEach(CybaraAccent.orderedKeys, id: \.self) { key in
                            accentSwatch(key)
                        }
                    }
                }
            }
            .padding(.vertical, 12)
        }
    }

    private var modelTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Default Model")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        if !availableModels.isEmpty {
                            Picker("Known model", selection: $defaultModel) {
                                Text("Auto").tag("")
                                ForEach(availableModels, id: \.self) { model in
                                    Text(model).tag(model)
                                }
                            }
                            .pickerStyle(.menu)
                            .onChange(of: defaultModel) { _, value in
                                saveConfigPatch(["default_model": value], key: "default_model")
                            }
                        }
                        TextField("Default model", text: $defaultModel)
                            .textFieldStyle(.roundedBorder)
                            .onSubmit {
                                saveConfigPatch(["default_model": defaultModel], key: "default_model")
                            }
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Reasoning")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        Picker("Default reasoning effort", selection: $reasoningEffort) {
                            ForEach(nativeReasoningEfforts, id: \.value) { option in
                                Text(option.label).tag(option.value)
                            }
                        }
                        .pickerStyle(.segmented)
                        .onChange(of: reasoningEffort) { _, value in
                            saveConfigPatch(["reasoning_effort": value], key: "reasoning_effort")
                        }
                    }
                }
            }
            .padding(.vertical, 12)
        }
    }

    private var featuresTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Platform Features")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        toggleRow("Web Terminal", detail: "Enable browser-based terminal access.", isOn: $terminalEnabled) {
                            saveConfigPatch(["terminal_enabled": terminalEnabled], key: "terminal_enabled")
                        }
                        toggleRow("Self-improving skills", detail: "Allow agents to save reusable skills.", isOn: $selfImprovingSkills) {
                            saveConfigPatch(["self_improving_skills_enabled": selfImprovingSkills], key: "self_improving_skills_enabled")
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
            }
            .padding(.vertical, 12)
        }
    }

    private var uptimeLabel: String {
        guard let uptime = health?.uptime, uptime > 0 else { return "Starting" }
        let minutes = Int(uptime) / 60
        if minutes < 60 { return "\(minutes)m" }
        return "\(minutes / 60)h \(minutes % 60)m"
    }

    private func settingRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(.system(size: 12, design: .rounded)).foregroundStyle(.secondary)
            Spacer(minLength: 20)
            Text(value)
                .font(.system(size: 12, weight: .semibold, design: value.count > 42 ? .monospaced : .rounded))
                .lineLimit(2)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
    }

    private func toggleRow(
        _ title: String,
        detail: String,
        isOn: Binding<Bool>,
        onChange: @escaping () -> Void
    ) -> some View {
        Toggle(isOn: isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 13, weight: .semibold, design: .rounded))
                Text(detail).font(.system(size: 11, design: .rounded)).foregroundStyle(.secondary)
            }
        }
        .onChange(of: isOn.wrappedValue) { _, _ in onChange() }
    }

    private func progressLabel(for key: String, fallback: String) -> some View {
        Group {
            if savingKey == key {
                ProgressView().controlSize(.small)
            } else {
                Text(fallback).font(.system(size: 12, weight: .semibold, design: .rounded)).foregroundStyle(.secondary)
            }
        }
    }

    private func accentSwatch(_ key: String) -> some View {
        let color = CybaraAccent.palette[key] ?? .accentColor
        return Button {
            selectedAccent = key
            onAccentChanged(key)
            saveConfigPatch(["themeAccent": key], key: "themeAccent") {
                NotificationCenter.default.post(name: .cybaraThemeAccentChanged, object: key)
            }
        } label: {
            ZStack {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(color)
                    .frame(width: 46, height: 46)
                if selectedAccent == key {
                    Image(systemName: "checkmark")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)
                        .shadow(radius: 2)
                }
            }
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(selectedAccent == key ? Color.white.opacity(0.85) : Color.white.opacity(0.16), lineWidth: 2)
            )
        }
        .buttonStyle(.plain)
        .disabled(savingKey == "themeAccent")
        .help(CybaraAccent.label(for: key))
    }

    private func saveDangerousPolicy() {
        saveConfigPatch(
            ["dangerous_tool_policy": ["enabled": dangerousPolicyEnabled, "mode": dangerousPolicyMode]],
            key: "dangerous_tool_policy"
        )
    }

    private func saveSandboxRuntime() {
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

    private func saveConfigPatch(
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

    private func copyServerURL() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(sidecar.serverURL.absoluteString, forType: .string)
        copiedURL = true
        Task {
            try? await Task.sleep(for: .seconds(1.4))
            copiedURL = false
        }
    }

    private func load() async {
        do {
            async let h = client.health()
            async let cfg = client.appConfig()
            async let p = client.providers()
            health = try await h
            config = try await cfg
            providers = try await p
            readConfig(config)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func readConfig(_ config: [String: Any]) {
        selectedAccent = readAccentKey(from: config) ?? "indigo"
        onAccentChanged(selectedAccent)
        defaultModel = config["default_model"] as? String ?? ""
        reasoningEffort = config["reasoning_effort"] as? String ?? ""
        terminalEnabled = config["terminal_enabled"] as? Bool ?? false
        selfImprovingSkills = (config["self_improving_skills_enabled"] as? Bool) ?? true
        let policy = config["dangerous_tool_policy"] as? [String: Any] ?? [:]
        dangerousPolicyEnabled = policy["enabled"] as? Bool ?? false
        dangerousPolicyMode = policy["mode"] as? String == "block" ? "block" : "audit"
        toolApprovalMode = config["tool_approval_mode"] as? String == "ask" ? "ask" : "always_allow"
        let sandbox = config["sandbox_runtime"] as? [String: Any] ?? [:]
        sandboxEnabled = sandbox["enabled"] as? Bool ?? false
        sandboxProvider = sandbox["provider"] as? String ?? "auto"
        sandboxNetwork = sandbox["network"] as? String == "allow" ? "allow" : "deny"
    }

    private func readAccentKey(from config: [String: Any]) -> String? {
        for key in ["themeAccent", "theme_accent", "theme", "accent", "ui_accent"] {
            if let value = config[key] as? String,
               CybaraAccent.palette[value.lowercased()] != nil {
                return value.lowercased()
            }
        }
        return nil
    }

    private enum SettingsTab {
        case general
        case appearance
        case model
        case features
    }
}

struct SettingsView: View {
    @EnvironmentObject private var sidecar: SidecarManager

    var body: some View {
        NativeSettingsScreen(client: GatewayClient(baseURL: sidecar.serverURL))
            .environmentObject(sidecar)
            .frame(width: 720, height: 620)
    }
}
