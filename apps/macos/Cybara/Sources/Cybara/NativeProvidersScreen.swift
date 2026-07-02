import SwiftUI

struct ProvidersScreen: View {
    let client: GatewayClient
    @Environment(\.cybaraAccent) private var accentTint

    @State private var providers: [GatewayProvider] = []
    @State private var availableProviders: [GatewayAvailableProvider] = []
    @State private var searchText = ""
    @State private var showingCreate = false
    @State private var editingProvider: GatewayProvider?
    @State private var deleteTarget: GatewayProvider?
    @State private var busyProvider: String?
    @State private var error: String?

    private var filteredProviders: [GatewayProvider] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return providers }
        return providers.filter { provider in
            provider.displayName.lowercased().contains(query)
                || provider.providerType.lowercased().contains(query)
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header

                if let error {
                    LoadFailedView(message: error) { Task { await load() } }
                } else if filteredProviders.isEmpty {
                    emptyState
                } else {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(filteredProviders) { provider in
                            providerRow(provider)
                        }
                    }
                }

                availableProviderSummary
            }
            .padding(24)
        }
        .task { await load() }
        .sheet(isPresented: $showingCreate) {
            ProviderEditorSheet(availableProviders: availableProviders) { draft in
                try await client.createProvider(
                    provider: draft.providerType,
                    name: draft.name,
                    baseURL: draft.baseURL,
                    apiKey: draft.apiKey,
                    accessToken: draft.accessToken,
                    isDefault: draft.isDefault
                )
                showingCreate = false
                await load()
            }
        }
        .sheet(item: $editingProvider) { provider in
            ProviderEditorSheet(provider: provider, availableProviders: availableProviders) { draft in
                try await client.updateProvider(
                    provider.id,
                    name: draft.name,
                    baseURL: draft.baseURL,
                    apiKey: draft.apiKey,
                    accessToken: draft.accessToken,
                    isDefault: draft.isDefault
                )
                editingProvider = nil
                await load()
            }
        }
        .confirmationDialog(
            "Delete “\(deleteTarget?.displayName ?? "provider")”?",
            isPresented: Binding(
                get: { deleteTarget != nil },
                set: { if !$0 { deleteTarget = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete Provider", role: .destructive) {
                if let deleteTarget {
                    Task { await remove(deleteTarget) }
                }
            }
            Button("Cancel", role: .cancel) { deleteTarget = nil }
        } message: {
            Text("Agents using this provider may stop working.")
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                ScreenHeader(title: "Providers", subtitle: "Connect and manage model providers")
                Spacer()
                Button {
                    Task { await discoverOllama() }
                } label: {
                    Label("Discover Ollama", systemImage: "magnifyingglass")
                }
                .buttonStyle(.bordered)
                Button {
                    showingCreate = true
                } label: {
                    Label("Add Provider", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                Button {
                    Task { await load() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                .help("Refresh providers")
            }

            TextField("Search providers", text: $searchText)
                .textFieldStyle(.roundedBorder)
                .frame(maxWidth: 340)
        }
    }

    private var emptyState: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 10) {
                Label("No providers found", systemImage: "shippingbox")
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                Text("Add an AI provider before creating model-backed agents.")
                    .font(.system(size: 13, design: .rounded))
                    .foregroundStyle(.secondary)
                Button("Add Provider") {
                    showingCreate = true
                }
                .buttonStyle(.borderedProminent)
            }
        }
    }

    private func providerRow(_ provider: GatewayProvider) -> some View {
        HStack(spacing: 14) {
            Image(systemName: provider.is_default == true ? "star.fill" : "shippingbox")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(provider.is_default == true ? Color.yellow : accentTint)
                .frame(width: 38, height: 38)
                .background(Circle().fill(Color.white.opacity(0.06)))

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(provider.displayName)
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                    if provider.is_default == true {
                        Text("Default")
                            .font(.system(size: 10.5, weight: .semibold, design: .rounded))
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3)
                            .background(Capsule().fill(Color.yellow.opacity(0.18)))
                            .foregroundStyle(Color.yellow)
                    }
                }
                Text([provider.providerType, provider.base_url].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            if busyProvider == provider.id {
                ProgressView().controlSize(.small)
            } else {
                Button {
                    Task { await test(provider) }
                } label: {
                    Label("Test", systemImage: "checkmark.seal")
                }
                .buttonStyle(.bordered)
            }
            Button {
                editingProvider = provider
            } label: {
                Image(systemName: "pencil")
            }
            .buttonStyle(.borderless)
            .help("Edit provider")
            Button(role: .destructive) {
                deleteTarget = provider
            } label: {
                Image(systemName: "trash")
            }
            .buttonStyle(.borderless)
            .help("Delete provider")
        }
        .padding(16)
        .cybaraGlass(cornerRadius: 16)
    }

    private var availableProviderSummary: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 10) {
                Text("Available Provider Types")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 190), spacing: 10)], spacing: 10) {
                    ForEach(availableProviders.prefix(9)) { provider in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(provider.name)
                                .font(.system(size: 12.5, weight: .semibold, design: .rounded))
                                .lineLimit(1)
                            Text("\(provider.authType ?? "api_key") · \(provider.models.count) models")
                                .font(.system(size: 11, design: .rounded))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        .padding(10)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(Color.white.opacity(0.04))
                        )
                    }
                }
            }
        }
    }

    private func load() async {
        do {
            async let loadedProviders = client.providers()
            async let loadedAvailable = client.availableProviders()
            providers = try await loadedProviders
            availableProviders = try await loadedAvailable
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func test(_ provider: GatewayProvider) async {
        busyProvider = provider.id
        do {
            try await client.testProvider(provider.id)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        busyProvider = nil
    }

    private func discoverOllama() async {
        do {
            try await client.discoverOllamaProviders()
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func remove(_ provider: GatewayProvider) async {
        deleteTarget = nil
        do {
            try await client.deleteProvider(provider.id)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct ProviderEditorDraft {
    let providerType: String
    let name: String
    let baseURL: String?
    let apiKey: String?
    let accessToken: String?
    let isDefault: Bool
}

private struct ProviderEditorSheet: View {
    let provider: GatewayProvider?
    let availableProviders: [GatewayAvailableProvider]
    let onSave: (ProviderEditorDraft) async throws -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var providerType: String
    @State private var name: String
    @State private var baseURL: String
    @State private var apiKey = ""
    @State private var accessToken = ""
    @State private var isDefault: Bool
    @State private var saving = false
    @State private var error: String?

    init(
        provider: GatewayProvider? = nil,
        availableProviders: [GatewayAvailableProvider],
        onSave: @escaping (ProviderEditorDraft) async throws -> Void
    ) {
        self.provider = provider
        self.availableProviders = availableProviders
        self.onSave = onSave
        _providerType = State(initialValue: provider?.providerType ?? availableProviders.first?.id ?? "openai")
        _name = State(initialValue: provider?.displayName ?? "")
        _baseURL = State(initialValue: provider?.base_url ?? "")
        _isDefault = State(initialValue: provider?.is_default ?? false)
    }

    private var selectedProvider: GatewayAvailableProvider? {
        availableProviders.first { $0.id == providerType }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(provider == nil ? "Add Provider" : "Edit Provider")
                .font(.system(size: 22, weight: .bold, design: .rounded))

            Form {
                Picker("Provider type", selection: $providerType) {
                    ForEach(availableProviders) { provider in
                        Text(provider.name).tag(provider.id)
                    }
                }
                .disabled(provider != nil)
                TextField("Display name", text: $name)
                TextField("Base URL", text: $baseURL)
                SecureField("API key", text: $apiKey)
                SecureField("Access token", text: $accessToken)
                Toggle("Use as default provider", isOn: $isDefault)
            }
            .formStyle(.grouped)

            if let selectedProvider {
                Text(selectedProvider.description ?? "\(selectedProvider.name) provider")
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(.secondary)
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
        .frame(width: 560)
        .frame(minHeight: 430)
        .onChange(of: providerType) { _, next in
            if provider == nil, name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
               let selected = availableProviders.first(where: { $0.id == next }) {
                name = "My \(selected.name)"
            }
            if provider == nil, baseURL.isEmpty,
               let selected = availableProviders.first(where: { $0.id == next }),
               let selectedBaseURL = selected.baseUrl {
                baseURL = selectedBaseURL
            }
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            try await onSave(ProviderEditorDraft(
                providerType: providerType,
                name: name,
                baseURL: firstNonEmptyGatewayString(baseURL),
                apiKey: firstNonEmptyGatewayString(apiKey),
                accessToken: firstNonEmptyGatewayString(accessToken),
                isDefault: isDefault
            ))
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
