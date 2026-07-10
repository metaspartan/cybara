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
    ("xhigh", "Max"),
]

struct AgentsScreen: View {
    let client: GatewayClient

    @State private var agents: [GatewayAgent] = []
    @State private var providers: [GatewayProvider] = []
    @State private var searchText = ""
    @State private var showingCreate = false
    @State private var editingAgent: GatewayAgent?
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
                Text("Reasoning · \(nativeReasoningEfforts.first { $0.value == agent.reasoningEffort }?.label ?? "Default")")
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(.tertiary)
            }

            Spacer()

            Button {
                editingAgent = agent
            } label: {
                Image(systemName: "pencil")
            }
            .buttonStyle(.borderless)
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
    @State private var systemPrompt: String
    @State private var providerModels: [GatewayProviderModel] = []
    @State private var saving = false
    @State private var error: String?

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
                    ForEach(nativeReasoningEfforts, id: \.value) { option in
                        Text(option.label).tag(option.value)
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
