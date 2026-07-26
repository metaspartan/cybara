import AppKit
import SwiftUI

struct ProvidersScreen: View {
    let client: GatewayClient
    @Environment(\.cybaraAccent) private var accentTint

    @State private var providers: [GatewayProvider] = []
    @State private var availableProviders: [GatewayAvailableProvider] = []
    @State private var providerPlanStatus: ProviderPlanStatusResponse?
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
            ProviderEditorSheet(client: client, availableProviders: availableProviders) { draft in
                try await client.createProvider(
                    provider: draft.providerType,
                    name: draft.name,
                    baseURL: draft.baseURL,
                    apiKey: draft.apiKey,
                    accessToken: draft.accessToken,
                    refreshToken: draft.refreshToken,
                    expiresAt: draft.expiresAt,
                    isDefault: draft.isDefault
                )
                showingCreate = false
                await load()
            }
        }
        .sheet(item: $editingProvider) { provider in
            ProviderEditorSheet(client: client, provider: provider, availableProviders: availableProviders) { draft in
                try await client.updateProvider(
                    provider.id,
                    name: draft.name,
                    baseURL: draft.baseURL,
                    apiKey: draft.apiKey,
                    accessToken: draft.accessToken,
                    refreshToken: draft.refreshToken,
                    expiresAt: draft.expiresAt,
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
                Text([
                    provider.providerType,
                    providerAuthLabel(provider),
                    provider.base_url,
                ].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if let plan = providerPlan(for: provider) {
                    ProviderPlanInlineView(plan: plan)
                }
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
            async let loadedPlanStatus = loadProviderPlanStatus()
            providers = try await loadedProviders
            availableProviders = try await loadedAvailable
            providerPlanStatus = await loadedPlanStatus
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func loadProviderPlanStatus() async -> ProviderPlanStatusResponse? {
        try? await client.providerPlanStatus()
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

    private func providerAuthLabel(_ provider: GatewayProvider) -> String? {
        switch firstNonEmptyGatewayString(provider.authType) {
        case "api_key": return "API key"
        case "oauth": return provider.oauthFlow == "device_code" ? "OAuth device code" : "OAuth"
        case "aws-sdk": return "AWS SDK"
        case "none": return "No auth"
        case let value?: return value
        case nil: return nil
        }
    }

    private func providerPlan(for provider: GatewayProvider) -> ProviderPlanSnapshot? {
        providerPlanStatus?.providers.first { plan in
            [plan.providerId, plan.configuredProviderId, plan.providerType].contains(provider.id)
        } ?? providerPlanStatus?.providers.first { plan in
            [plan.providerId, plan.configuredProviderId, plan.providerType].contains(provider.providerType)
        }
    }
}

private struct ProviderPlanInlineView: View {
    let plan: ProviderPlanSnapshot

    private var fiveHourUsage: ProviderPlanUsageValue {
        providerPlanWindowValue(plan, kind: "rolling_5h")
    }

    private var weeklyUsage: ProviderPlanUsageValue {
        providerPlanWindowValue(plan, kind: "rolling_week")
    }

    var body: some View {
        Group {
            if plan.managedAutomatically {
                HStack(spacing: 8) {
                    ProviderPlanUsageCapsule(label: "5h", usage: fiveHourUsage)
                    ProviderPlanUsageCapsule(label: "Weekly", usage: weeklyUsage)
                }
                .padding(.top, 3)
            }
        }
    }
}

private struct ProviderPlanUsageValue {
    let text: String
    let percent: Double?
    let unlimited: Bool
    let resetText: String?
}

private struct ProviderPlanUsageCapsule: View {
    let label: String
    let usage: ProviderPlanUsageValue

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(label)
                    .foregroundStyle(.secondary)
                Text(usage.text)
                    .fontWeight(.semibold)
                    .foregroundStyle(providerPlanUsageTint(usage))
            }
            GeometryReader { proxy in
                let width = proxy.size.width * providerPlanProgress(usage)
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .fill(.white.opacity(0.1))
                    .overlay(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 3, style: .continuous)
                            .fill(providerPlanUsageTint(usage))
                            .frame(width: width)
                    }
            }
            .frame(height: 5)
            if let resetText = usage.resetText {
                Text(resetText)
                    .font(.system(size: 9, design: .rounded))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .font(.system(size: 11, design: .rounded))
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(providerPlanUsageTint(usage).opacity(0.12))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(providerPlanUsageTint(usage).opacity(0.2), lineWidth: 1)
        )
    }
}

private func providerPlanWindowValue(_ plan: ProviderPlanSnapshot, kind: String) -> ProviderPlanUsageValue {
    guard plan.managedAutomatically else {
        return ProviderPlanUsageValue(text: "--", percent: nil, unlimited: false, resetText: nil)
    }
    guard let window = plan.windows.first(where: {
        $0.kind == kind && $0.usageKnown && ($0.unlimited || $0.usedPercent != nil)
    }) else {
        return ProviderPlanUsageValue(text: "--", percent: nil, unlimited: false, resetText: nil)
    }
    let resetText = providerPlanResetText(window.resetsAt)
    if window.unlimited {
        return ProviderPlanUsageValue(text: "∞", percent: nil, unlimited: true, resetText: resetText)
    }
    let percent = min(100, max(0, ceil(window.usedPercent ?? 0)))
    return ProviderPlanUsageValue(text: "\(Int(percent))%", percent: percent, unlimited: false, resetText: resetText)
}

private func providerPlanResetText(_ resetsAt: String?) -> String? {
    guard let resetsAt else { return nil }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let date = formatter.date(from: resetsAt) ?? ISO8601DateFormatter().date(from: resetsAt)
    guard let date else { return nil }
    let seconds = date.timeIntervalSinceNow
    if seconds <= 0 { return "reset ready" }
    let minute = 60.0
    let hour = 60.0 * minute
    let day = 24.0 * hour
    if seconds < hour { return "\(max(1, Int(ceil(seconds / minute))))m reset" }
    if seconds < day {
        let hours = Int(seconds / hour)
        let minutes = Int(ceil(seconds.truncatingRemainder(dividingBy: hour) / minute))
        return minutes > 0 ? "\(hours)h \(minutes)m reset" : "\(hours)h reset"
    }
    return "\(Int(ceil(seconds / day)))d reset"
}

private func providerPlanUsageTint(_ usage: ProviderPlanUsageValue) -> Color {
    if usage.unlimited { return .green }
    guard let percent = usage.percent else { return .secondary }
    if percent < 40 { return .green }
    if percent < 65 { return .blue }
    if percent < 80 { return .yellow }
    if percent < 95 { return .orange }
    return .red
}

private func providerPlanProgress(_ usage: ProviderPlanUsageValue) -> Double {
    if usage.unlimited { return 1 }
    guard let percent = usage.percent else { return 0 }
    return min(1, max(0, percent / 100))
}

struct ProviderEditorDraft {
    let providerType: String
    let name: String
    let baseURL: String?
    let apiKey: String?
    let accessToken: String?
    let refreshToken: String?
    let expiresAt: Double?
    let isDefault: Bool
}

private struct ProviderEditorSheet: View {
    let client: GatewayClient
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
    @State private var oauthState: ProviderOAuthState = .idle
    @State private var oauthDeviceCode: GatewayOAuthDeviceCodeResponse?
    @State private var oauthToken = ""
    @State private var oauthRefreshToken = ""
    @State private var oauthExpiresAt: Double?
    @State private var oauthError: String?
    @State private var planConfig: [String: Any]?
    @State private var planPresets: [ProviderPlanPresetSuggestion] = []
    @State private var planPresetId = ""
    @State private var planName = ""
    @State private var planFiveHourTokens = ""
    @State private var planWeeklyTokens = ""
    @State private var planMonthlyTokens = ""
    @State private var planMonthlySpend = ""
    @State private var planPriceInput = ""
    @State private var planPriceOutput = ""
    @State private var routerConfig: [String: Any]?
    @State private var planManualEditable = true

    init(
        client: GatewayClient,
        provider: GatewayProvider? = nil,
        availableProviders: [GatewayAvailableProvider],
        onSave: @escaping (ProviderEditorDraft) async throws -> Void
    ) {
        self.client = client
        self.provider = provider
        self.availableProviders = availableProviders
        self.onSave = onSave
        _providerType = State(initialValue: provider?.providerType ?? availableProviders.first?.id ?? "openai")
        _name = State(initialValue: provider?.displayName ?? availableProviders.first.map { "My \($0.name)" } ?? "")
        _baseURL = State(initialValue: provider?.base_url ?? availableProviders.first?.baseUrl ?? "")
        _isDefault = State(initialValue: provider?.is_default ?? false)
    }

    private var selectedProvider: GatewayAvailableProvider? {
        availableProviders.first { $0.id == providerType }
    }

    private var selectedAuthType: String {
        firstNonEmptyGatewayString(selectedProvider?.authType, provider?.authType) ?? "api_key"
    }

    private var selectedOAuthFlow: String? {
        firstNonEmptyGatewayString(selectedProvider?.oauthFlow, provider?.oauthFlow)
    }

    private var selectedHasOAuthConfig: Bool {
        selectedProvider?.hasOAuthConfig ?? provider?.hasOAuthConfig ?? false
    }

    private var selectedOAuthLoginUrl: String? {
        firstNonEmptyGatewayString(selectedProvider?.oauthLoginUrl, provider?.oauthLoginUrl)
    }

    private var selectedApiConsoleUrl: URL? {
        guard let value = firstNonEmptyGatewayString(selectedProvider?.apiConsoleUrl) else { return nil }
        return URL(string: value)
    }

    private var selectedProviderName: String {
        selectedProvider?.name ?? provider?.displayName ?? "Provider"
    }

    private var saveDisabled: Bool {
        let missingCustomURL = providerType == "custom"
            && baseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let missingCustomKey = providerType == "custom" && provider == nil
            && apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return saving
            || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || missingCustomURL
            || missingCustomKey
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
                credentialSection
                Toggle("Use as default provider", isOn: $isDefault)
                    .toggleStyle(.switch)
                if provider != nil, planConfig != nil, !planManualEditable {
                    Section("Provider plan") {
                        Text("Plan usage is automatic")
                            .font(.system(size: 12, weight: .semibold, design: .rounded))
                        Text("Live provider usage is used for routing. No manual plan limits are needed.")
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                    }
                }
                if provider != nil, planConfig != nil, planManualEditable {
                    Section("Plan limits") {
                        if !planPresets.isEmpty {
                            Picker("Plan preset", selection: $planPresetId) {
                                Text("Custom / manual").tag("")
                                ForEach(planPresets) { preset in
                                    Text(preset.label).tag(preset.id)
                                }
                            }
                            .onChange(of: planPresetId) { _, next in
                                applyPlanPreset(next)
                            }
                            if let preset = planPresets.first(where: { $0.id == planPresetId }) {
                                Text(preset.limitDescription)
                                    .font(.system(size: 11, design: .rounded))
                                    .foregroundStyle(.secondary)
                            }
                        }
                        TextField("Plan name (e.g. Pro, Max 5x)", text: $planName)
                        TextField("5-hour token limit (rolling)", text: $planFiveHourTokens)
                        TextField("Weekly token limit (rolling)", text: $planWeeklyTokens)
                        TextField("Monthly token limit", text: $planMonthlyTokens)
                        TextField("Monthly budget", text: $planMonthlySpend)
                        TextField("$ / 1M input tokens (catalog when blank)", text: $planPriceInput)
                        TextField("$ / 1M output tokens (catalog when blank)", text: $planPriceOutput)
                        Text("Subscription coding plans use rolling 5-hour and weekly windows; pay-as-you-go tracks a monthly budget. Custom per-token pricing overrides the model catalog for spend estimates. Leave everything empty to keep the plan unconfigured.")
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .formStyle(.grouped)

            if let selectedProvider {
                VStack(alignment: .leading, spacing: 4) {
                    Text(selectedProvider.description ?? "\(selectedProvider.name) provider")
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.secondary)
                    Text("\(authDescription) · \(selectedProvider.models.count) models")
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(.tertiary)
                }
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
                .disabled(saveDisabled)
            }
        }
        .padding(24)
        .frame(width: 560)
        .frame(minHeight: 430)
        .task { await loadPlanConfig() }
        .onChange(of: providerType) { _, next in
            resetOAuth()
            if provider == nil, name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
               let selected = availableProviders.first(where: { $0.id == next }) {
                name = "My \(selected.name)"
            }
            if provider == nil, baseURL.isEmpty,
               let selected = availableProviders.first(where: { $0.id == next }),
               let selectedBaseURL = selected.baseUrl {
                baseURL = selectedBaseURL
            } else if provider == nil,
                      let selected = availableProviders.first(where: { $0.id == next }),
                      let selectedBaseURL = selected.baseUrl,
                      availableProviders.compactMap(\.baseUrl).contains(baseURL) {
                baseURL = selectedBaseURL
            }
        }
    }

    @ViewBuilder
    private var credentialSection: some View {
        switch selectedAuthType {
        case "api_key":
            SecureField("API key", text: $apiKey)
            Text("Paste the provider API key. Leave blank while editing to keep the saved key.")
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(.secondary)
            apiConsoleLink
        case "oauth":
            oauthSection
        case "aws-sdk":
            credentialInfo(
                title: "AWS SDK authentication",
                detail: "Use AWS environment variables, AWS CLI profiles, or your instance role. No API key is saved here.",
                systemImage: "key.radiowaves.forward"
            )
        case "none":
            credentialInfo(
                title: "No authentication required",
                detail: "This provider connects without saved credentials, usually to a local runtime.",
                systemImage: "link"
            )
        default:
            SecureField("Access token", text: $accessToken)
            Text("Paste a bearer token for this provider. Leave blank while editing to keep the saved token.")
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(.secondary)
            apiConsoleLink
        }
    }

    @ViewBuilder
    private var apiConsoleLink: some View {
        if let selectedApiConsoleUrl {
            Link(destination: selectedApiConsoleUrl) {
                Label("Open \(selectedProviderName) API console", systemImage: "arrow.up.right.square")
            }
            .font(.system(size: 11, weight: .medium, design: .rounded))
        }
    }

    @ViewBuilder
    private var oauthSection: some View {
        if selectedHasOAuthConfig {
            VStack(alignment: .leading, spacing: 10) {
                credentialInfo(
                    title: "\(selectedProviderName) uses OAuth",
                    detail: "Sign in through the gateway. Cybara stores the returned access token; no API key is required.",
                    systemImage: "person.badge.key"
                )

                switch oauthState {
                case .idle:
                    Button {
                        Task { await startOAuth() }
                    } label: {
                        Label(
                            selectedOAuthFlow == "device_code" ? "Connect via OAuth" : "Sign in with \(selectedProviderName)",
                            systemImage: "arrow.up.forward.app"
                        )
                    }
                    .buttonStyle(.borderedProminent)
                case .connecting:
                    Label("Starting OAuth...", systemImage: "arrow.triangle.2.circlepath")
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(.secondary)
                case .polling:
                    oauthPollingView
                case .success:
                    credentialInfo(
                        title: "Connected",
                        detail: "Save this provider to store the OAuth token.",
                        systemImage: "checkmark.seal"
                    )
                case .error:
                    VStack(alignment: .leading, spacing: 8) {
                        Text(oauthError ?? "OAuth sign-in failed.")
                            .font(.system(size: 12, design: .rounded))
                            .foregroundStyle(.red)
                        Button("Try Again") {
                            Task { await startOAuth() }
                        }
                        .buttonStyle(.bordered)
                    }
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 10) {
                credentialInfo(
                    title: "\(selectedProviderName) uses OAuth",
                    detail: selectedOAuthLoginUrl == nil
                        ? "Paste an access token for this provider. Leave blank while editing to keep the saved token."
                        : "Open the provider page, create or copy a token, then paste it below.",
                    systemImage: "person.badge.key"
                )
                if let loginUrl = selectedOAuthLoginUrl, let url = URL(string: loginUrl) {
                    Button {
                        NSWorkspace.shared.open(url)
                    } label: {
                        Label("Open Provider Page", systemImage: "safari")
                    }
                    .buttonStyle(.bordered)
                }
                SecureField("Access token", text: $accessToken)
            }
        }
    }

    @ViewBuilder
    private var oauthPollingView: some View {
        if let oauthDeviceCode {
            VStack(alignment: .leading, spacing: 8) {
                Text("Enter this code in the browser")
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                HStack {
                    Text(oauthDeviceCode.userCode)
                        .font(.system(size: 22, weight: .bold, design: .monospaced))
                        .textSelection(.enabled)
                    Spacer()
                    Button("Copy") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(oauthDeviceCode.userCode, forType: .string)
                    }
                }
                Text(oauthDeviceCode.verificationUri)
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                ProgressView("Waiting for authorization...")
                    .controlSize(.small)
            }
            .padding(10)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color.white.opacity(0.055))
            )
        } else {
            ProgressView("Waiting for sign-in...")
                .controlSize(.small)
        }
    }

    private func credentialInfo(title: String, detail: String, systemImage: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.secondary)
                .frame(width: 24, height: 24)
                .background(Circle().fill(Color.white.opacity(0.07)))
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                Text(detail)
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.white.opacity(0.055))
        )
    }

    private var authDescription: String {
        switch selectedAuthType {
        case "api_key": return "API key"
        case "oauth": return selectedOAuthFlow == "device_code" ? "OAuth device code" : "OAuth redirect"
        case "aws-sdk": return "AWS SDK"
        case "none": return "No auth"
        default: return selectedAuthType
        }
    }

    @MainActor
    private func resetOAuth() {
        oauthState = .idle
        oauthDeviceCode = nil
        oauthToken = ""
        oauthRefreshToken = ""
        oauthExpiresAt = nil
        oauthError = nil
    }

    @MainActor
    private func startOAuth() async {
        resetOAuth()
        oauthState = .connecting
        do {
            if selectedOAuthFlow == "device_code" {
                try await startDeviceCodeOAuth()
            } else {
                try await startRedirectOAuth()
            }
        } catch {
            oauthError = error.localizedDescription
            oauthState = .error
        }
    }

    @MainActor
    private func startRedirectOAuth() async throws {
        let response = try await client.startProviderOAuth(providerType: providerType)
        guard
            let url = URL(string: response.authUrl),
            !response.state.isEmpty,
            !response.pollToken.isEmpty
        else {
            throw GatewayClientError.invalidResponse
        }
        NSWorkspace.shared.open(url)
        oauthState = .polling

        let deadline = Date().addingTimeInterval(600)
        while Date() < deadline, oauthState == .polling {
            try await Task.sleep(nanoseconds: 3_000_000_000)
            let status = try await client.providerOAuthCallbackStatus(
                state: response.state,
                pollToken: response.pollToken
            )
            if status.status == "success", let token = status.accessToken {
                oauthToken = token
                accessToken = token
                oauthRefreshToken = status.refreshToken ?? ""
                oauthExpiresAt = status.expiresAt
                oauthState = .success
                return
            }
            if status.status == "error" {
                oauthError = status.error ?? "Authorization failed."
                oauthState = .error
                return
            }
        }
        if oauthState == .polling {
            oauthError = "Authorization timed out. Please try again."
            oauthState = .error
        }
    }

    @MainActor
    private func startDeviceCodeOAuth() async throws {
        let response = try await client.startProviderDeviceCodeOAuth(providerType: providerType)
        oauthDeviceCode = response
        if let url = URL(string: response.verificationUriComplete ?? response.verificationUri) {
            NSWorkspace.shared.open(url)
        }
        oauthState = .polling

        var interval = max(5, response.interval)
        let deadline = Date().addingTimeInterval(TimeInterval(max(60, response.expiresIn)))
        while Date() < deadline, oauthState == .polling {
            try await Task.sleep(nanoseconds: UInt64(interval) * 1_000_000_000)
            let status = try await client.pollProviderDeviceCodeOAuth(
                providerType: providerType,
                deviceCode: response.deviceCode
            )
            if status.status == "success", let token = status.accessToken {
                oauthToken = token
                accessToken = token
                oauthRefreshToken = status.refreshToken ?? ""
                oauthExpiresAt = status.expiresAt
                oauthState = .success
                return
            }
            if status.status == "expired" || status.status == "denied" || status.status == "error" {
                oauthError = status.error ?? (status.status == "denied"
                    ? "Authorization was denied."
                    : "Authorization expired. Please try again.")
                oauthState = .error
                return
            }
            if status.status == "slow_down" {
                interval += 5
            }
        }
        if oauthState == .polling {
            oauthError = "Authorization timed out. Please try again."
            oauthState = .error
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            let resolvedAccessToken = firstNonEmptyGatewayString(oauthToken, accessToken)
            let resolvedRefreshToken = firstNonEmptyGatewayString(oauthRefreshToken)
            try await onSave(ProviderEditorDraft(
                providerType: providerType,
                name: name,
                baseURL: firstNonEmptyGatewayString(baseURL),
                apiKey: firstNonEmptyGatewayString(apiKey),
                accessToken: resolvedAccessToken,
                refreshToken: resolvedRefreshToken,
                expiresAt: oauthExpiresAt,
                isDefault: isDefault
            ))
            try await savePlanLimits()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private var planConfigKey: String {
        guard let provider else { return providerType }
        let entries = planConfig?["providers"] as? [String: Any] ?? [:]
        if entries[provider.id] != nil { return provider.id }
        if entries[provider.providerType] != nil { return provider.providerType }
        return provider.id
    }

    private func windowTokenText(_ entry: [String: Any]?, _ window: String) -> String {
        let config = entry?[window] as? [String: Any]
        guard let tokens = config?["tokenLimit"] as? Double, tokens > 0 else { return "" }
        return String(Int(tokens))
    }

    private func decimalText(_ value: Double?) -> String {
        guard let value, value > 0 else { return "" }
        return value == value.rounded() ? String(Int(value)) : String(value)
    }

    private func loadPlanConfig() async {
        guard let provider else { return }
        guard let config = try? await client.providerPlanConfig() else { return }
        planConfig = config
        let entries = config["providers"] as? [String: Any] ?? [:]
        let entry = entries[planConfigKey] as? [String: Any]
        planPresetId = entry?["presetId"] as? String ?? ""
        planName = entry?["planName"] as? String ?? ""
        planFiveHourTokens = windowTokenText(entry, "fiveHour")
        planWeeklyTokens = windowTokenText(entry, "weekly")
        planMonthlyTokens = windowTokenText(entry, "monthly")
        let monthly = entry?["monthly"] as? [String: Any]
        planMonthlySpend = decimalText(monthly?["spendLimit"] as? Double)

        if let status = try? await client.providerPlanStatus() {
            let snapshot = status.providers.first { plan in
                [plan.providerId, plan.configuredProviderId, plan.providerType].contains(provider.id)
            } ?? status.providers.first { plan in
                [plan.providerId, plan.configuredProviderId, plan.providerType].contains(provider.providerType)
            }
            planPresets = snapshot?.presetSuggestions ?? []
            planManualEditable = snapshot?.manualPlanEditable ?? true
        }

        if let router = try? await client.routerConfig() {
            routerConfig = router
            let routes = router["routes"] as? [String: Any] ?? [:]
            let route = routes[provider.id] as? [String: Any]
            planPriceInput = decimalText(route?["priceInputPerM"] as? Double)
            planPriceOutput = decimalText(route?["priceOutputPerM"] as? Double)
        }
    }

    private func applyPlanPreset(_ presetId: String) {
        guard let preset = planPresets.first(where: { $0.id == presetId }) else { return }
        planName = preset.planName
        planFiveHourTokens = decimalText(preset.fiveHourTokenLimit)
        planWeeklyTokens = decimalText(preset.weeklyTokenLimit)
        planMonthlyTokens = decimalText(preset.monthlyTokenLimit)
        planMonthlySpend = decimalText(preset.monthlySpendLimit)
    }

    private func parsePlanLimit(_ value: String) -> Double? {
        let cleaned = value.replacingOccurrences(of: ",", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let parsed = Double(cleaned), parsed > 0 else { return nil }
        return parsed
    }

    private func planWindow(tokenLimit: Double?, spendLimit: Double? = nil) -> [String: Any]? {
        guard tokenLimit != nil || spendLimit != nil else { return nil }
        var window: [String: Any] = ["enabled": true]
        if let tokenLimit { window["tokenLimit"] = tokenLimit }
        if let spendLimit { window["spendLimit"] = spendLimit }
        return window
    }

    private func savePlanLimits() async throws {
        guard provider != nil, var config = planConfig else { return }
        if !planManualEditable {
            try await saveRoutePricing()
            return
        }
        let trimmedPlanName = planName.trimmingCharacters(in: .whitespacesAndNewlines)
        let fiveHourLimit = parsePlanLimit(planFiveHourTokens)
        let weeklyLimit = parsePlanLimit(planWeeklyTokens)
        let tokenLimit = parsePlanLimit(planMonthlyTokens)
        let spendLimit = parsePlanLimit(planMonthlySpend)
        var entries = config["providers"] as? [String: Any] ?? [:]
        let key = planConfigKey
        let entry = entries[key] as? [String: Any]
        let hasInput = !trimmedPlanName.isEmpty || !planPresetId.isEmpty
            || fiveHourLimit != nil || weeklyLimit != nil || tokenLimit != nil || spendLimit != nil
        if !hasInput, entry == nil {
            try await saveRoutePricing()
            return
        }

        if !hasInput {
            entries.removeValue(forKey: key)
        } else {
            var next = entry ?? [:]
            next["enabled"] = true
            let preset = planPresets.first { $0.id == planPresetId }
            if let preset {
                next["presetId"] = preset.id
                next["sourceMode"] = preset.sourceMode
                next["externalSourceEnabled"] = preset.externalSourceEnabled
            } else {
                next.removeValue(forKey: "presetId")
            }
            let resolvedName = trimmedPlanName.isEmpty ? preset?.planName : trimmedPlanName
            if let resolvedName, !resolvedName.isEmpty {
                next["planName"] = resolvedName
            } else {
                next.removeValue(forKey: "planName")
            }
            for (window, value) in [
                ("fiveHour", planWindow(tokenLimit: fiveHourLimit)),
                ("weekly", planWindow(tokenLimit: weeklyLimit)),
                ("monthly", planWindow(tokenLimit: tokenLimit, spendLimit: spendLimit)),
            ] {
                if let value {
                    next[window] = value
                } else {
                    next.removeValue(forKey: window)
                }
            }
            entries[key] = next
        }
        config["providers"] = entries
        config["enabled"] = true
        let body = try JSONSerialization.data(withJSONObject: config)
        _ = try await client.updateProviderPlanConfig(body)
        try await saveRoutePricing()
    }

    private func saveRoutePricing() async throws {
        guard let provider, var config = routerConfig else { return }
        let priceInput = parsePlanLimit(planPriceInput)
        let priceOutput = parsePlanLimit(planPriceOutput)
        let wantsPricing = priceInput != nil || priceOutput != nil
        var routes = config["routes"] as? [String: Any] ?? [:]
        var route = routes[provider.id] as? [String: Any] ?? ["weight": 1]
        let hadPricing = route["priceInputPerM"] != nil || route["priceOutputPerM"] != nil
        if !wantsPricing, !hadPricing { return }

        if wantsPricing {
            route["priceInputPerM"] = priceInput ?? 0
            route["priceOutputPerM"] = priceOutput ?? 0
        } else {
            route.removeValue(forKey: "priceInputPerM")
            route.removeValue(forKey: "priceOutputPerM")
        }
        routes[provider.id] = route
        config["routes"] = routes
        let body = try JSONSerialization.data(withJSONObject: config)
        try await client.updateRouterConfig(body)
    }
}

private enum ProviderOAuthState {
    case idle
    case connecting
    case polling
    case success
    case error
}
