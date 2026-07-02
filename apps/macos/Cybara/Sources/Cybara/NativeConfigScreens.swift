import SwiftUI

// ─── Router ──────────────────────────────────────────────────────────────────

struct RouterScreen: View {
    let client: GatewayClient

    @State private var config: [String: Any] = [:]
    @State private var status: RouterStatusSummary?
    @State private var agents: [GatewayAgent] = []
    @State private var loaded = false
    @State private var saving = false
    @State private var error: String?

    private static let strategies: [(value: String, label: String)] = [
        ("weighted", "Weighted"),
        ("round_robin", "Round Robin"),
        ("lowest_cost", "Lowest Cost"),
        ("priority", "Priority"),
        ("mixture_of_agents", "Mixture of Agents"),
    ]

    private var enabled: Bool { config["enabled"] as? Bool ?? false }
    private var strategy: String { config["strategy"] as? String ?? "weighted" }
    private var fallbackToAny: Bool { config["fallbackToAny"] as? Bool ?? true }
    private var moaMaxAgents: Int { config["moaMaxAgents"] as? Int ?? 0 }
    private var moaAggregator: String { config["moaAggregatorAgentId"] as? String ?? "" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ScreenHeader(title: "Model Router", subtitle: "Provider routing, fallback, and strategies")

                if !loaded {
                    ProgressView().frame(maxWidth: .infinity)
                } else {
                    GlassCard {
                        VStack(alignment: .leading, spacing: 14) {
                            Toggle(isOn: bindingBool("enabled")) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Model router")
                                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                                    Text("Route chats across configured providers with fallback rules.")
                                        .font(.system(size: 11, design: .rounded))
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .toggleStyle(.switch)

                            Picker("Selection strategy", selection: bindingString("strategy", default: "weighted")) {
                                ForEach(Self.strategies, id: \.value) { item in
                                    Text(item.label).tag(item.value)
                                }
                            }
                            .pickerStyle(.menu)

                            if strategy == "mixture_of_agents" {
                                Stepper(
                                    "Max proposer agents: \(moaMaxAgents > 0 ? String(moaMaxAgents) : "4 (default)")",
                                    value: Binding(
                                        get: { moaMaxAgents > 0 ? moaMaxAgents : 4 },
                                        set: { save { $0["moaMaxAgents"] = $1 } (max(1, $0)) }
                                    ),
                                    in: 1 ... 16
                                )
                                .font(.system(size: 12, design: .rounded))

                                Picker("Aggregator agent", selection: Binding(
                                    get: { moaAggregator },
                                    set: { newValue in
                                        save { cfg, value in
                                            if value.isEmpty {
                                                cfg.removeValue(forKey: "moaAggregatorAgentId")
                                            } else {
                                                cfg["moaAggregatorAgentId"] = value
                                            }
                                        } (newValue)
                                    }
                                )) {
                                    Text("Auto (first proposer)").tag("")
                                    ForEach(agents) { agent in
                                        Text(agent.name).tag(agent.id)
                                    }
                                }
                                .pickerStyle(.menu)
                            }

                            Toggle(isOn: bindingBool("fallbackToAny")) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Fallback providers")
                                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                                    Text("Use any healthy provider when configured routes are unavailable.")
                                        .font(.system(size: 11, design: .rounded))
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .toggleStyle(.switch)
                        }
                    }

                    GlassCard {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Status")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            infoRow("Router", status?.enabled == true ? "Enabled" : "Disabled")
                            infoRow("Strategy", (status?.strategy ?? strategy).replacingOccurrences(of: "_", with: " "))
                            infoRow("Requests", "\(status?.totalRequests ?? 0)")
                            infoRow(
                                "Spent today",
                                String(format: "$%.4f", status?.globalSpendToday ?? 0)
                            )
                        }
                    }
                }

                if saving { ProgressView().controlSize(.small) }
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

    private func infoRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 12, design: .rounded))
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
        }
    }

    private func bindingBool(_ key: String) -> Binding<Bool> {
        Binding(
            get: { config[key] as? Bool ?? false },
            set: { newValue in save { cfg, value in cfg[key] = value } (newValue) }
        )
    }

    private func bindingString(_ key: String, default defaultValue: String) -> Binding<String> {
        Binding(
            get: { config[key] as? String ?? defaultValue },
            set: { newValue in save { cfg, value in cfg[key] = value } (newValue) }
        )
    }

    /// Returns a setter that mutates the config dict and PUTs the whole object
    /// back (preserving fields like `routes` the native UI doesn't model).
    private func save<T>(_ mutate: @escaping (inout [String: Any], T) -> Void) -> (T) -> Void {
        { value in
            var next = config
            mutate(&next, value)
            config = next
            guard let body = try? JSONSerialization.data(withJSONObject: next) else { return }
            saving = true
            Task {
                do {
                    try await client.updateRouterConfig(body)
                    status = try? await client.routerStatus()
                    error = nil
                } catch {
                    self.error = error.localizedDescription
                }
                saving = false
            }
        }
    }

    private func load() async {
        do {
            config = try await client.routerConfig()
            status = try? await client.routerStatus()
            agents = (try? await client.agents()) ?? []
            loaded = true
            error = nil
        } catch {
            self.error = error.localizedDescription
            loaded = true
        }
    }
}

// ─── System Prompt ───────────────────────────────────────────────────────────

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
            }
            loaded = true
            error = nil
        } catch {
            self.error = error.localizedDescription
            loaded = true
        }
    }
}

// ─── Memory ──────────────────────────────────────────────────────────────────

struct MemoryScreen: View {
    let client: GatewayClient
    @Environment(\.cybaraAccent) private var accentTint

    @State private var files: [String] = []
    @State private var loaded = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ScreenHeader(title: "Memory", subtitle: "Persistent memory files on the gateway")

                if !loaded {
                    ProgressView().frame(maxWidth: .infinity)
                } else if let error {
                    LoadFailedView(message: error) { Task { await load() } }
                } else if files.isEmpty {
                    Text("No memory files yet — agents write memory as they work.")
                        .font(.system(size: 13, design: .rounded))
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(files, id: \.self) { file in
                        HStack(spacing: 12) {
                            Image(systemName: "brain")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(accentTint)
                                .frame(width: 34, height: 34)
                                .background(Circle().fill(Color.white.opacity(0.06)))
                            Text(file)
                                .font(.system(size: 13, weight: .medium, design: .monospaced))
                                .lineLimit(1)
                            Spacer()
                        }
                        .padding(14)
                        .cybaraGlass(cornerRadius: 14)
                    }
                }
            }
            .padding(24)
        }
        .task { await load() }
    }

    private func load() async {
        do {
            files = try await client.memoryFiles()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

struct MetricsScreen: View {
    let client: GatewayClient

    @State private var overview: MetricsOverview?
    @State private var loaded = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ScreenHeader(title: "Metrics", subtitle: "Gateway usage and activity")

                if !loaded {
                    ProgressView().frame(maxWidth: .infinity)
                } else if let error {
                    LoadFailedView(message: error) { Task { await load() } }
                } else {
                    HStack(spacing: 14) {
                        metricTile(
                            label: "Total tokens",
                            value: formatCount(overview?.tokenUsage?.total),
                            detail: "in \(formatCount(overview?.tokenUsage?.input)) · out \(formatCount(overview?.tokenUsage?.output))",
                            systemImage: "number"
                        )
                        metricTile(
                            label: "Chats",
                            value: formatCount(overview?.sessions?.totalSessions),
                            detail: "\(overview?.sessions?.memoryFlushes ?? 0) memory flushes",
                            systemImage: "bubble.left.and.bubble.right"
                        )
                        metricTile(
                            label: "Tool calls",
                            value: formatCount(overview?.toolCalls?.totalCalls),
                            detail: "across all sessions",
                            systemImage: "wrench.and.screwdriver"
                        )
                    }
                }
            }
            .padding(24)
        }
        .task { await load() }
    }

    private func metricTile(label: String, value: String, detail: String, systemImage: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(label, systemImage: systemImage)
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
            Text(value)
                .font(.system(size: 24, weight: .bold, design: .rounded))
            Text(detail)
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cybaraGlass(cornerRadius: 16)
    }

    private func formatCount(_ value: Int?) -> String {
        guard let value else { return "0" }
        if value >= 1_000_000 { return String(format: "%.1fM", Double(value) / 1_000_000) }
        if value >= 1_000 { return String(format: "%.1fK", Double(value) / 1_000) }
        return "\(value)"
    }

    private func load() async {
        do {
            overview = try await client.metricsOverview()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }
}

// ─── Channels ────────────────────────────────────────────────────────────────

struct ChannelsScreen: View {
    let client: GatewayClient
    @Environment(\.cybaraAccent) private var accentTint

    @State private var channels: [GatewayChannel] = []
    @State private var loaded = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ScreenHeader(title: "Channels", subtitle: "Messaging surfaces connected to the gateway")

                if !loaded {
                    ProgressView().frame(maxWidth: .infinity)
                } else if let error {
                    LoadFailedView(message: error) { Task { await load() } }
                } else if channels.isEmpty {
                    Text("No channels configured — add one from the web UI.")
                        .font(.system(size: 13, design: .rounded))
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(channels) { channel in
                        HStack(spacing: 14) {
                            Image(systemName: "link")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(channel.isEnabled ? accentTint : Color.secondary)
                                .frame(width: 34, height: 34)
                                .background(Circle().fill(Color.white.opacity(0.06)))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(channel.displayName)
                                    .font(.system(size: 14, weight: .bold, design: .rounded))
                                Text(channel.type ?? "channel")
                                    .font(.system(size: 12, design: .rounded))
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(channel.isEnabled ? "Enabled" : "Disabled")
                                .font(.system(size: 11, weight: .semibold, design: .rounded))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 4)
                                .background(
                                    Capsule().fill(
                                        channel.isEnabled
                                            ? Color.green.opacity(0.18)
                                            : Color.secondary.opacity(0.15)
                                    )
                                )
                        }
                        .padding(16)
                        .cybaraGlass(cornerRadius: 16)
                    }
                }
            }
            .padding(24)
        }
        .task { await load() }
    }

    private func load() async {
        do {
            channels = try await client.channels()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }
}

// ─── Logs ────────────────────────────────────────────────────────────────────

struct LogsScreen: View {
    let client: GatewayClient

    @State private var logs: [GatewayLogEntry] = []
    @State private var loaded = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                ScreenHeader(title: "Logs", subtitle: "Recent gateway events")
                Button {
                    Task { await load() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .help("Refresh")
            }
            .padding(.horizontal, 24)
            .padding(.top, 24)
            .padding(.bottom, 12)

            if !loaded {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error {
                LoadFailedView(message: error) { Task { await load() } }
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 6) {
                        ForEach(logs) { entry in
                            HStack(alignment: .top, spacing: 10) {
                                Text(entry.level?.uppercased() ?? "INFO")
                                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                                    .foregroundStyle(levelColor(entry.level))
                                    .frame(width: 44, alignment: .leading)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(entry.message ?? "")
                                        .font(.system(size: 11, design: .monospaced))
                                        .textSelection(.enabled)
                                    Text("\(entry.source ?? "gateway") · \(relativeTimestamp(entry.created_at))")
                                        .font(.system(size: 10, design: .rounded))
                                        .foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(.vertical, 4)
                            .padding(.horizontal, 12)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 20)
                }
                .cybaraGlass(cornerRadius: 18)
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
            }
        }
        .task { await load() }
    }

    private func levelColor(_ level: String?) -> Color {
        switch level?.lowercased() {
        case "error": return .red
        case "warn", "warning": return .orange
        default: return .secondary
        }
    }

    private func load() async {
        do {
            logs = try await client.systemLogs()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }
}

// ─── Wallet ──────────────────────────────────────────────────────────────────

struct WalletScreen: View {
    let client: GatewayClient

    @State private var status: [String: Any] = [:]
    @State private var policy: [String: Any] = [:]
    @State private var loaded = false
    @State private var savingAccess = false
    @State private var error: String?

    private static let policyRows: [(key: String, label: String)] = [
        ("allowNativeSend", "Native sends"),
        ("allowTokenSend", "Token sends"),
        ("allowEthContractWrite", "ETH contract writes"),
        ("allowSolProgramInstruction", "SOL program instructions"),
        ("allowEthSwaps", "ETH swaps"),
        ("allowDappInteraction", "dApp interaction"),
        ("allowX402Payments", "x402 payments"),
    ]

    private var agentAccessEnabled: Bool { status["agentAccessEnabled"] as? Bool ?? false }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ScreenHeader(title: "Wallet", subtitle: "Agent wallet status and spending policy")

                if !loaded {
                    ProgressView().frame(maxWidth: .infinity)
                } else if let error {
                    LoadFailedView(message: error) { Task { await load() } }
                } else {
                    GlassCard {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Text("Status")
                                    .font(.system(size: 15, weight: .bold, design: .rounded))
                                Spacer()
                                Text(status["exists"] as? Bool == true
                                    ? (status["unlocked"] as? Bool == true ? "Unlocked" : "Locked")
                                    : "No wallet")
                                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 4)
                                    .background(Capsule().fill(
                                        status["unlocked"] as? Bool == true
                                            ? Color.green.opacity(0.18)
                                            : Color.secondary.opacity(0.15)
                                    ))
                            }
                            ForEach(addressRows, id: \.chain) { row in
                                HStack {
                                    Text(row.chain.uppercased())
                                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                                        .foregroundStyle(.secondary)
                                        .frame(width: 34, alignment: .leading)
                                    Text(row.address)
                                        .font(.system(size: 11, design: .monospaced))
                                        .textSelection(.enabled)
                                        .lineLimit(1)
                                        .truncationMode(.middle)
                                    Spacer()
                                }
                            }
                        }
                    }

                    GlassCard {
                        VStack(alignment: .leading, spacing: 12) {
                            Toggle(isOn: Binding(
                                get: { agentAccessEnabled },
                                set: { newValue in
                                    savingAccess = true
                                    Task {
                                        do {
                                            try await client.setWalletAgentAccess(newValue)
                                            await load()
                                        } catch {
                                            self.error = error.localizedDescription
                                        }
                                        savingAccess = false
                                    }
                                }
                            )) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Agent wallet access")
                                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                                    Text("Master switch for agent-initiated wallet actions.")
                                        .font(.system(size: 11, design: .rounded))
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .toggleStyle(.switch)
                            .disabled(savingAccess)
                        }
                    }

                    GlassCard {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Agent policy")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            ForEach(Self.policyRows, id: \.key) { row in
                                Toggle(row.label, isOn: policyBinding(row.key))
                                    .toggleStyle(.switch)
                                    .font(.system(size: 13, weight: .medium, design: .rounded))
                            }
                        }
                    }
                }
            }
            .padding(24)
        }
        .task { await load() }
    }

    private var addressRows: [(chain: String, address: String)] {
        let addresses = status["primaryAddresses"] as? [String: Any] ?? [:]
        return addresses.keys.sorted().compactMap { chain in
            guard let address = addresses[chain] as? String else { return nil }
            return (chain, address)
        }
    }

    private func policyBinding(_ key: String) -> Binding<Bool> {
        Binding(
            get: { policy[key] as? Bool ?? false },
            set: { newValue in
                var next = policy
                next[key] = newValue
                policy = next
                guard let body = try? JSONSerialization.data(withJSONObject: next) else { return }
                Task {
                    do {
                        try await client.updateWalletPolicy(body)
                        error = nil
                    } catch {
                        self.error = error.localizedDescription
                    }
                }
            }
        )
    }

    private func load() async {
        do {
            status = try await client.walletStatus()
            policy = try await client.walletPolicy()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }
}

// ─── Skills ──────────────────────────────────────────────────────────────────

struct SkillsScreen: View {
    let client: GatewayClient
    @Environment(\.cybaraAccent) private var accentTint

    @State private var skills: [GatewaySkill] = []
    @State private var search = ""
    @State private var loaded = false
    @State private var error: String?

    private var filtered: [GatewaySkill] {
        let query = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !query.isEmpty else { return skills }
        return skills.filter {
            $0.name.lowercased().contains(query)
                || ($0.description?.lowercased().contains(query) ?? false)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                ScreenHeader(title: "Skills", subtitle: "\(skills.count) skills available to agents")
                TextField("Search skills…", text: $search)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 220)
            }
            .padding(.horizontal, 24)
            .padding(.top, 24)
            .padding(.bottom, 12)

            if !loaded {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error {
                LoadFailedView(message: error) { Task { await load() } }
            } else {
                ScrollView {
                    LazyVStack(spacing: 10) {
                        ForEach(filtered) { skill in
                            HStack(alignment: .top, spacing: 12) {
                                Image(systemName: "wand.and.stars")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(skill.enabled == false ? Color.secondary : accentTint)
                                    .frame(width: 32, height: 32)
                                    .background(Circle().fill(Color.white.opacity(0.06)))
                                VStack(alignment: .leading, spacing: 2) {
                                    HStack(spacing: 8) {
                                        Text(skill.name)
                                            .font(.system(size: 13, weight: .bold, design: .rounded))
                                        if let category = skill.category {
                                            Text(category)
                                                .font(.system(size: 10, weight: .semibold, design: .rounded))
                                                .padding(.horizontal, 7)
                                                .padding(.vertical, 2)
                                                .background(Capsule().fill(Color.white.opacity(0.08)))
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                    Text(skill.description ?? "")
                                        .font(.system(size: 12, design: .rounded))
                                        .foregroundStyle(.secondary)
                                        .lineLimit(2)
                                }
                                Spacer()
                            }
                            .padding(14)
                            .cybaraGlass(cornerRadius: 14)
                        }
                    }
                    .padding(.horizontal, 24)
                    .padding(.bottom, 24)
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        do {
            skills = try await client.skills()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }
}
