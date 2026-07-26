import SwiftUI

struct SystemPromptScreen: View {
    let client: GatewayClient

    @State private var config: [String: Any] = [:]
    @State private var name = ""
    @State private var emoji = ""
    @State private var creature = ""
    @State private var vibe = ""
    @State private var customPrompt = ""
    @State private var loaded = false
    @State private var saving = false
    @State private var error: String?
    @State private var selfImprovingSkills = true
    @State private var toonStructuredDataEnabled = true

    private static let featureRows: [(key: String, label: String)] = [
        ("memoryEnabled", "Memory"),
        ("skillsEnabled", "Skills"),
        ("messagingEnabled", "Messaging"),
        ("replyTagsEnabled", "Reply tags"),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ScreenHeader(title: "System Prompt", subtitle: "Assistant identity and behavior")

                if !loaded {
                    ProgressView().frame(maxWidth: .infinity)
                } else {
                    GlassCard {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Identity")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            identityField("Name", text: $name, prompt: "Cybara")
                            identityField("Emoji", text: $emoji, prompt: "🧠")
                            identityField("Creature / role", text: $creature, prompt: "AI assistant")
                            identityField("Vibe", text: $vibe, prompt: "concise and friendly")

                            Text("Custom instructions")
                                .font(.system(size: 12, weight: .semibold, design: .rounded))
                                .foregroundStyle(.secondary)
                            TextEditor(text: $customPrompt)
                                .font(.system(size: 12, design: .rounded))
                                .scrollContentBackground(.hidden)
                                .frame(minHeight: 80)
                                .padding(8)
                                .background(
                                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                                        .fill(Color.white.opacity(0.06))
                                )

                            HStack {
                                Spacer()
                                Button(saving ? "Saving…" : "Save identity") {
                                    Task { await saveIdentity() }
                                }
                                .buttonStyle(.borderedProminent)
                                .disabled(saving)
                            }
                        }
                    }

                    GlassCard {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Behavior")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            ForEach(Self.featureRows, id: \.key) { row in
                                Toggle(row.label, isOn: featureBinding(row.key))
                                    .toggleStyle(.switch)
                                    .font(.system(size: 13, weight: .medium, design: .rounded))
                            }
                            Divider().opacity(0.3)
                            Toggle("Self-improving skills", isOn: selfImprovingBinding)
                                .toggleStyle(.switch)
                                .font(.system(size: 13, weight: .medium, design: .rounded))
                            Text("Let agents save reusable skills with skill_save after complex tasks. When off, the tool is withheld.")
                                .font(.system(size: 11, design: .rounded))
                                .foregroundStyle(.secondary)
                            Divider().opacity(0.3)
                            Toggle("Compact structured tool results", isOn: toonBinding)
                                .toggleStyle(.switch)
                                .font(.system(size: 13, weight: .medium, design: .rounded))
                            Text("Use TOON for model-visible tool data when it is smaller than compact JSON.")
                                .font(.system(size: 11, design: .rounded))
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                if let error {
                    Text(error)
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.red)
                }
            }
            .padding(24)
        }
        .task { await load() }
    }

    private func identityField(_ label: String, text: Binding<String>, prompt: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(.secondary)
            TextField(prompt, text: text)
                .textFieldStyle(.plain)
                .font(.system(size: 13, design: .rounded))
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color.white.opacity(0.06))
                )
        }
    }

    private func featureBinding(_ key: String) -> Binding<Bool> {
        Binding(
            get: { (config["features"] as? [String: Any])?[key] as? Bool ?? false },
            set: { newValue in
                var next = config
                var features = next["features"] as? [String: Any] ?? [:]
                features[key] = newValue
                next["features"] = features
                config = next
                guard let body = try? JSONSerialization.data(withJSONObject: next) else { return }
                Task {
                    do {
                        try await client.updateSystemPrompt(body)
                        error = nil
                    } catch {
                        self.error = error.localizedDescription
                    }
                }
            }
        )
    }

    private var selfImprovingBinding: Binding<Bool> {
        Binding(
            get: { selfImprovingSkills },
            set: { newValue in
                selfImprovingSkills = newValue
                guard let body = try? JSONSerialization.data(
                    withJSONObject: ["self_improving_skills_enabled": newValue]
                ) else { return }
                Task {
                    do {
                        try await client.updateAppConfig(body)
                        error = nil
                    } catch {
                        self.error = error.localizedDescription
                        selfImprovingSkills = !newValue
                    }
                }
            }
        )
    }

    private var toonBinding: Binding<Bool> {
        Binding(
            get: { toonStructuredDataEnabled },
            set: { newValue in
                toonStructuredDataEnabled = newValue
                let payload: [String: Any] = [
                    "token_optimization": [
                        "toonStructuredDataEnabled": newValue
                    ]
                ]
                guard let body = try? JSONSerialization.data(withJSONObject: payload) else { return }
                Task {
                    do {
                        try await client.updateAppConfig(body)
                        error = nil
                    } catch {
                        self.error = error.localizedDescription
                        self.toonStructuredDataEnabled = !newValue
                    }
                }
            }
        )
    }

    private func saveIdentity() async {
        saving = true
        var next = config
        var identity = next["identity"] as? [String: Any] ?? [:]
        identity["name"] = name
        identity["emoji"] = emoji
        identity["creature"] = creature
        identity["vibe"] = vibe
        next["identity"] = identity
        next["customPrompt"] = customPrompt
        config = next
        do {
            let body = try JSONSerialization.data(withJSONObject: next)
            try await client.updateSystemPrompt(body)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }

    private func load() async {
        do {
            config = try await client.systemPrompt()
            let identity = config["identity"] as? [String: Any] ?? [:]
            name = identity["name"] as? String ?? ""
            emoji = identity["emoji"] as? String ?? ""
            creature = identity["creature"] as? String ?? ""
            vibe = identity["vibe"] as? String ?? ""
            customPrompt = config["customPrompt"] as? String ?? ""
            if let appConfig = try? await client.appConfig() {
                selfImprovingSkills = (appConfig["self_improving_skills_enabled"] as? Bool) ?? true
                let tokenOptimization = appConfig["token_optimization"] as? [String: Any]
                toonStructuredDataEnabled =
                    (tokenOptimization?["toonStructuredDataEnabled"] as? Bool) ??
                    (tokenOptimization?["toon_structured_data_enabled"] as? Bool) ??
                    true
            }
            loaded = true
            error = nil
        } catch {
            self.error = error.localizedDescription
            loaded = true
        }
    }
}

