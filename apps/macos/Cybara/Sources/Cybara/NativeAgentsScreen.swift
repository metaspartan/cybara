import SwiftUI

private let nativeAgentTypes: [(value: String, label: String)] = [
    ("main", "Main Assistant"),
    ("research", "Research"),
    ("coder", "Coder"),
    ("planner", "Planner"),
    ("ops", "Operations"),
    ("worker", "Worker"),
]

let nativeReasoningEfforts: [(value: String, label: String)] = [
    ("", "Default"),
    ("minimal", "Minimal"),
    ("low", "Low"),
    ("medium", "Medium"),
    ("high", "High"),
    ("xhigh", "Extra High"),
    ("max", "Max"),
]

private let nativeBinaryThinkingProviders: Set<String> = [
    "z.ai", "z.ai-coding", "zai", "z-ai", "qwen-portal", "alibaba", "alibaba-coding-plan",
    "qwen-token-plan", "qwen-token-plan-cn",
]
private let nativeAdaptiveThinkingProviders: Set<String> = [
    "minimax", "minimax-cn", "minimax-portal", "minimax-portal-cn",
]
private let nativeKimiCodeProviders: Set<String> = [
    "kimi-code", "kimi-code-oauth", "kimi-coding", "kimi-oauth", "kimi-code-subscription",
]
private let nativeAnthropicProviders: Set<String> = [
    "anthropic", "anthropic-oauth", "anthropic_vertex", "claude-oauth",
]
private let nativeGoogleProviders: Set<String> = [
    "antigravity", "gemini-cli", "google", "google-antigravity", "google-gemini-cli", "google_vertex",
]

private let nativeEffortLabels: [String: String] = [
    "minimal": "Minimal",
    "low": "Low",
    "medium": "Medium",
    "high": "High",
    "xhigh": "Extra High",
    "max": "Max",
]

private let nativeGPT5Efforts = ["minimal", "low", "medium", "high"]
private let nativeGPT51Efforts = ["low", "medium", "high"]
private let nativeGPT52Efforts = ["low", "medium", "high", "xhigh"]
private let nativeGPT56Efforts = ["low", "medium", "high", "xhigh", "max"]
private let nativeGPTCodexEfforts = ["low", "medium", "high", "xhigh"]
private let nativeGPTCodexMiniEfforts = ["medium"]
private let nativeGPTCodexMaxEfforts = ["medium", "high", "xhigh"]
private let nativeGPTProEfforts = ["medium", "high", "xhigh"]
private let nativeGPT5ProEfforts = ["high"]
private let nativeGenericOpenAIEfforts = ["low", "medium", "high"]
private let nativeAnthropicLegacyEfforts = ["minimal", "low", "medium", "high"]
private let nativeAnthropic46Efforts = ["low", "medium", "high", "max"]
private let nativeAnthropicModernEfforts = ["low", "medium", "high", "xhigh", "max"]
private let nativeGoogleEfforts = ["low", "medium", "high"]
private let nativeGoogleFlashEfforts = ["minimal", "low", "medium", "high"]
private let nativeGoogleProEfforts = ["low", "high"]
private let nativeKimiK3Efforts = ["low", "high", "max"]

private func nativeNormalizeModelId(_ id: String?) -> String {
    var model = (id ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    for prefix in ["openai/", "anthropic/", "google/"] where model.hasPrefix(prefix) {
        model = String(model.dropFirst(prefix.count))
    }
    if let dateRange = model.range(of: #"-\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) {
        model = String(model[..<dateRange.lowerBound])
    }
    return model
}

private func nativeResolveOpenAIModelEfforts(_ modelId: String) -> [String] {
    if modelId.range(of: #"^gpt-5\.6(?:-|$)"#, options: .regularExpression) != nil {
        return nativeGPT56Efforts
    }
    if modelId == "gpt-5.1-codex-mini" { return nativeGPTCodexMiniEfforts }
    if modelId == "gpt-5.1-codex-max" { return nativeGPTCodexMaxEfforts }
    if modelId.range(of: #"^gpt-5(?:\.\d+)?-codex(?:-|$)"#, options: .regularExpression) != nil {
        return nativeGPTCodexEfforts
    }
    if modelId == "gpt-5-pro" { return nativeGPT5ProEfforts }
    if modelId.range(of: #"^gpt-5\.[2-9](?:\.\d+)?-pro(?:-|$)"#, options: .regularExpression) != nil {
        return nativeGPTProEfforts
    }
    if modelId.range(of: #"^gpt-5\.[2-9](?:\.\d+)?(?:-|$)"#, options: .regularExpression) != nil {
        return nativeGPT52Efforts
    }
    if modelId.range(of: #"^gpt-5\.1(?:-|$)"#, options: .regularExpression) != nil {
        return nativeGPT51Efforts
    }
    if modelId.range(of: #"^gpt-5(?:-|$)"#, options: .regularExpression) != nil {
        return nativeGPT5Efforts
    }
    return nativeGenericOpenAIEfforts
}

private func nativeResolveAnthropicEfforts(_ modelId: String) -> [String] {
    if !modelId.contains("claude") { return nativeAnthropicLegacyEfforts }
    if modelId.range(of: #"claude-(?:opus|sonnet)-4[-.]6(?:-|$)"#, options: .regularExpression) != nil {
        return nativeAnthropic46Efforts
    }
    if modelId.range(
        of: #"claude-(?:3|opus-4[-.][0-5]|sonnet-4[-.][0-5]|haiku-4[-.]5)(?:-|$)"#,
        options: .regularExpression
    ) != nil {
        return nativeAnthropicLegacyEfforts
    }
    return nativeAnthropicModernEfforts
}

private func nativeSupportedEfforts(provider: String?, model: String?) -> [String] {
    let providerId = (provider ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if nativeBinaryThinkingProviders.contains(providerId) {
        return ["medium"]
    }
    let modelId = nativeNormalizeModelId(model)
    if nativeKimiCodeProviders.contains(providerId),
       modelId.range(of: #"(?:^|/)k3$"#, options: .regularExpression) != nil {
        return nativeKimiK3Efforts
    }
    if nativeAnthropicProviders.contains(providerId) {
        return nativeResolveAnthropicEfforts(modelId)
    }
    if nativeGoogleProviders.contains(providerId) {
        if modelId.range(of: #"^gemini-3(?:\.\d+)?-.*pro"#, options: .regularExpression) != nil {
            return nativeGoogleProEfforts
        }
        if modelId.range(of: #"^gemini-3(?:\.\d+)?-.*flash"#, options: .regularExpression) != nil {
            return nativeGoogleFlashEfforts
        }
        return nativeGoogleEfforts
    }
    if providerId == "openai" || providerId == "openai-codex"
        || providerId == "openai-codex-responses" || providerId == "azure-openai" || modelId.isEmpty {
        return nativeResolveOpenAIModelEfforts(modelId)
    }
    return nativeGenericOpenAIEfforts
}

func nativeSupportsXHighReasoning(provider: String?, model: String?) -> Bool {
    nativeSupportedEfforts(provider: provider, model: model).contains("xhigh")
}

func nativeSupportedReasoningEfforts(provider: String?, model: String?) -> [(value: String, label: String)] {
    let providerId = (provider ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let modelId = nativeNormalizeModelId(model)
    if nativeAdaptiveThinkingProviders.contains(providerId),
       modelId.range(of: #"(?:^|/)minimax-m3(?:[.-]|$)"#, options: .regularExpression) != nil {
        return [("", "Adaptive")]
    }
    if nativeBinaryThinkingProviders.contains(providerId) {
        return [("", "Default"), ("medium", "Thinking")]
    }
    var levels: [(value: String, label: String)] = [("", "Default")]
    for effort in nativeSupportedEfforts(provider: provider, model: model) {
        levels.append((effort, nativeEffortLabels[effort] ?? effort.capitalized))
    }
    return levels
}

func nativeSupportedReasoningEfforts(agent: GatewayAgent) -> [(value: String, label: String)] {
    if agent.reasoning_mode == "adaptive" { return [("", "Adaptive")] }
    if agent.reasoning_mode == "binary" { return [("", "Default"), ("medium", "Thinking")] }
    if let efforts = agent.reasoning_efforts, !efforts.isEmpty {
        return [("", "Default")] + efforts.map { ($0, nativeEffortLabels[$0] ?? $0.capitalized) }
    }
    return nativeSupportedReasoningEfforts(
        provider: agent.providerType ?? agent.providerID,
        model: agent.model
    )
}

func nativeCoerceReasoningEffort(_ effort: String, provider: String?, model: String?) -> String {
    let providerID = (provider ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let modelID = nativeNormalizeModelId(model)
    if nativeKimiCodeProviders.contains(providerID),
       modelID.range(of: #"(?:^|/)k3$"#, options: .regularExpression) != nil {
        if effort == "minimal" || effort == "low" { return "low" }
        if effort == "medium" || effort == "high" { return "high" }
        return "max"
    }
    let supported = nativeSupportedReasoningEfforts(provider: provider, model: model)
    if supported.contains(where: { $0.value == effort }) { return effort }
    let supportedValues = supported.map(\.value).filter { !$0.isEmpty }
    if effort == "xhigh", supportedValues.contains("high") { return "high" }
    if effort == "minimal", supportedValues.contains("low") { return "low" }
    if supportedValues.contains("medium") { return "medium" }
    return supportedValues.first ?? ""
}

func nativeReasoningLabel(effort: String, provider: String?, model: String?) -> String {
    let options = nativeSupportedReasoningEfforts(provider: provider, model: model)
    return options.first { $0.value == effort }?.label ?? "Default"
}

func nativeReasoningLabel(effort: String, agent: GatewayAgent) -> String {
    let options = nativeSupportedReasoningEfforts(agent: agent)
    return options.first { $0.value == effort }?.label
        ?? options.first { $0.value.isEmpty }?.label
        ?? "Default"
}

struct AgentsScreen: View {
    let client: GatewayClient

    @State private var agents: [GatewayAgent] = []
    @State private var providers: [GatewayProvider] = []
    @State private var searchText = ""
    @State private var showingCreate = false
    @State private var editingAgent: GatewayAgent?
    @State private var loadingAgentID: String?
    @State private var deleteTarget: GatewayAgent?
    @State private var error: String?

    private var filteredAgents: [GatewayAgent] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return agents }
        return agents.filter { agent in
            agent.name.lowercased().contains(query)
                || (agent.type ?? "").lowercased().contains(query)
                || (agent.model ?? "").lowercased().contains(query)
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header

                if let error {
                    LoadFailedView(message: error) { Task { await load() } }
                } else if filteredAgents.isEmpty {
                    emptyState
                } else {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(filteredAgents) { agent in
                            agentRow(agent)
                        }
                    }
                }
            }
            .padding(24)
        }
        .task { await load() }
        .sheet(isPresented: $showingCreate) {
            AgentEditorSheet(client: client, providers: providers) {
                showingCreate = false
                await load()
            }
        }
        .sheet(item: $editingAgent) { agent in
            AgentEditorSheet(client: client, agent: agent, providers: providers) {
                editingAgent = nil
                await load()
            }
        }
        .confirmationDialog(
            "Delete “\(deleteTarget?.name ?? "agent")”?",
            isPresented: Binding(
                get: { deleteTarget != nil },
                set: { if !$0 { deleteTarget = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete Agent", role: .destructive) {
                if let deleteTarget {
                    Task { await remove(deleteTarget) }
                }
            }
            Button("Cancel", role: .cancel) { deleteTarget = nil }
        } message: {
            Text("This removes the agent configuration from the gateway.")
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                ScreenHeader(title: "Agents", subtitle: "Create and manage gateway agents")
                Spacer()
                Button {
                    Task { await createDefault() }
                } label: {
                    Label("Default Agent", systemImage: "sparkles")
                }
                .buttonStyle(.bordered)
                Button {
                    showingCreate = true
                } label: {
                    Label("New Agent", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                Button {
                    Task { await load() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                .help("Refresh agents")
            }

            TextField("Search agents", text: $searchText)
                .textFieldStyle(.roundedBorder)
                .frame(maxWidth: 340)
        }
    }

    private var emptyState: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 10) {
                Label("No agents found", systemImage: "cpu")
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                Text("Create a default agent or add a custom agent with a provider, model, and system prompt.")
                    .font(.system(size: 13, design: .rounded))
                    .foregroundStyle(.secondary)
                HStack {
                    Button("Create Default Agent") {
                        Task { await createDefault() }
                    }
                    .buttonStyle(.borderedProminent)
                    Button("Custom Agent") {
                        showingCreate = true
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
    }

    private func agentRow(_ agent: GatewayAgent) -> some View {
        HStack(spacing: 14) {
            Image(systemName: "cpu")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Color.secondary)
                .frame(width: 38, height: 38)
                .background(Circle().fill(Color.white.opacity(0.06)))

            VStack(alignment: .leading, spacing: 4) {
                Text(agent.name)
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                Text([agent.type, agent.model, providerName(for: agent.providerID)]
                    .compactMap { firstNonEmptyGatewayString($0) }
                    .joined(separator: " · "))
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Text("Reasoning · \(nativeReasoningLabel(effort: agent.reasoningEffort, agent: agent))")
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(.tertiary)
                Label(agent.imageStatusLabel, systemImage: agent.supportsImages ? "photo.fill" : "photo")
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(agent.supportsImages ? Color.green : Color.secondary)
            }

            Spacer()

            Button {
                Task { await edit(agent) }
            } label: {
                if loadingAgentID == agent.id {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Image(systemName: "pencil")
                }
            }
            .buttonStyle(.borderless)
            .disabled(loadingAgentID != nil)
            .help("Edit agent")
            Button(role: .destructive) {
                deleteTarget = agent
            } label: {
                Image(systemName: "trash")
            }
            .buttonStyle(.borderless)
            .help("Delete agent")
        }
        .padding(16)
        .cybaraGlass(cornerRadius: 16)
    }

    private func providerName(for id: String?) -> String? {
        guard let id else { return nil }
        return providers.first { $0.id == id }?.displayName ?? id
    }

    private func load() async {
        do {
            async let loadedAgents = client.agents()
            async let loadedProviders = client.providers()
            agents = try await loadedAgents
            providers = try await loadedProviders
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func createDefault() async {
        do {
            try await client.createDefaultAgent()
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func edit(_ agent: GatewayAgent) async {
        guard loadingAgentID == nil else { return }
        loadingAgentID = agent.id
        defer { loadingAgentID = nil }
        do {
            editingAgent = try await client.agent(agent.id)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func remove(_ agent: GatewayAgent) async {
        deleteTarget = nil
        do {
            try await client.deleteAgent(agent.id)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct AgentEditorSheet: View {
    let client: GatewayClient
    let agent: GatewayAgent?
    let providers: [GatewayProvider]
    let onSaved: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var type: String
    @State private var providerID: String
    @State private var model: String
    @State private var reasoningEffort: String
    @State private var toolProfile: String
    @State private var imageInput: String
    @State private var systemPrompt: String
    @State private var providerModels: [GatewayProviderModel] = []
    @State private var saving = false
    @State private var error: String?

    private var selectedProviderType: String {
        providers.first { $0.id == providerID }?.provider ?? providerID
    }

    init(
        client: GatewayClient,
        agent: GatewayAgent? = nil,
        providers: [GatewayProvider],
        onSaved: @escaping () async -> Void
    ) {
        self.client = client
        self.agent = agent
        self.providers = providers
        self.onSaved = onSaved
        _name = State(initialValue: agent?.name ?? "")
        _type = State(initialValue: agent?.type ?? "main")
        _providerID = State(initialValue: agent?.providerID ?? providers.first?.id ?? "")
        _model = State(initialValue: agent?.model ?? "")
        _reasoningEffort = State(initialValue: agent?.reasoningEffort ?? "")
        _toolProfile = State(initialValue: agent?.toolProfile ?? "full")
        _imageInput = State(initialValue: agent?.imageInputMode ?? "auto")
        _systemPrompt = State(initialValue: agent?.system_prompt ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(agent == nil ? "Create Agent" : "Edit Agent")
                .font(.system(size: 22, weight: .bold, design: .rounded))

            Form {
                TextField("Name", text: $name)
                Picker("Type", selection: $type) {
                    ForEach(nativeAgentTypes, id: \.value) { option in
                        Text(option.label).tag(option.value)
                    }
                }
                Picker("Provider", selection: $providerID) {
                    Text("Auto").tag("")
                    ForEach(providers) { provider in
                        Text(provider.displayName).tag(provider.id)
                    }
                }
                Picker("Known model", selection: $model) {
                    Text(model.isEmpty ? "Type a model below" : model).tag(model)
                    ForEach(providerModels) { providerModel in
                        Text(providerModel.displayName).tag(providerModel.model_id)
                    }
                }
                TextField("Model", text: $model)
                Picker("Reasoning effort", selection: $reasoningEffort) {
                    ForEach(nativeSupportedReasoningEfforts(provider: selectedProviderType, model: model), id: \.value) { option in
                        Text(option.label).tag(option.value)
                    }
                }
                Picker("Tool profile", selection: $toolProfile) {
                    Text("Full").tag("full")
                    Text("Coding").tag("coding")
                    Text("Research").tag("research")
                    Text("Read only").tag("safe")
                }
                Picker("Image input", selection: $imageInput) {
                    Text("Auto (model metadata)").tag("auto")
                    Text("Enabled").tag("enabled")
                    Text("Disabled").tag("disabled")
                }
                .onChange(of: providerID) { _, _ in
                    if !nativeSupportedReasoningEfforts(provider: selectedProviderType, model: model)
                        .contains(where: { $0.value == reasoningEffort }) {
                        reasoningEffort = ""
                    }
                }
                .onChange(of: model) { _, _ in
                    if !nativeSupportedReasoningEfforts(provider: selectedProviderType, model: model)
                        .contains(where: { $0.value == reasoningEffort }) {
                        reasoningEffort = ""
                    }
                }
            }
            .formStyle(.grouped)

            VStack(alignment: .leading, spacing: 6) {
                Text("System Prompt")
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
                TextEditor(text: $systemPrompt)
                    .font(.system(size: 13, design: .rounded))
                    .frame(minHeight: 120)
                    .scrollContentBackground(.hidden)
                    .padding(8)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(Color.white.opacity(0.06))
                    )
            }

            if let error {
                Text(error)
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(.red)
            }

            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                Button(saving ? "Saving..." : "Save") {
                    Task { await save() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(saving || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(24)
        .frame(width: 620)
        .frame(minHeight: 560)
        .task(id: providerID) { await loadProviderModels() }
    }

    private func loadProviderModels() async {
        guard !providerID.isEmpty else {
            providerModels = []
            return
        }
        providerModels = (try? await client.providerModels(providerID)) ?? []
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            let body = try JSONSerialization.data(withJSONObject: agentPayload(existingConfig: agent?.config))
            if let agent {
                try await client.updateAgent(agent.id, body: body)
            } else {
                try await client.createAgent(body: body)
            }
            await onSaved()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func agentPayload(existingConfig: [String: JSONValue]?) -> [String: Any] {
        var config = existingConfig?.mapValues(\.anyValue) ?? [:]
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
        config["tool_profile"] = toolProfile
        if imageInput == "auto" {
            config.removeValue(forKey: "image_input")
        } else {
            config["image_input"] = imageInput
        }

        var payload: [String: Any] = [
            "name": name,
            "type": type,
            "model": model,
            "system_prompt": systemPrompt,
            "config": config,
        ]
        if !providerID.isEmpty {
            payload["provider_id"] = providerID
        }
        return payload
    }
}
