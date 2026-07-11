import SwiftUI

// ─── Router ──────────────────────────────────────────────────────────────────

struct RouterScreen: View {
    let client: GatewayClient

    @State private var config: [String: Any] = [:]
    @State private var status: RouterStatusSummary?
    @State private var planConfig: [String: Any] = [:]
    @State private var planStatus: ProviderPlanStatusResponse?
    @State private var monthlyTokenDrafts: [String: String] = [:]
    @State private var monthlySpendDrafts: [String: String] = [:]
    @State private var agents: [GatewayAgent] = []
    @State private var loaded = false
    @State private var saving = false
    @State private var savingPlanProvider: String?
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

                    providerPlanCard
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

    private var providerPlanCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Provider plans")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        Text("Track coding-plan usage and keep exhausted providers out of routing.")
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(planStatus?.routerEnforcement == true ? "Enforced" : "Monitor only")
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(.thinMaterial, in: Capsule())
                }

                HStack(spacing: 12) {
                    planMetric("Monitored", "\(planStatus?.summary.monitored ?? 0)")
                    planMetric("Configured", "\(planStatus?.summary.configured ?? 0)")
                    planMetric("Warnings", "\(planStatus?.summary.warnings ?? 0)")
                    planMetric("Exhausted", "\(planStatus?.summary.exhausted ?? 0)")
                }

                HStack(spacing: 14) {
                    Toggle("Monitor coding plans", isOn: Binding(
                        get: { planConfig["enabled"] as? Bool ?? planStatus?.enabled ?? true },
                        set: { value in
                            var next = planConfig
                            next["enabled"] = value
                            saveProviderPlanConfig(next)
                        }
                    ))
                    .toggleStyle(.switch)
                    Toggle("Block exhausted plans", isOn: Binding(
                        get: { planConfig["routerEnforcement"] as? Bool ?? planStatus?.routerEnforcement ?? true },
                        set: { value in
                            var next = planConfig
                            next["routerEnforcement"] = value
                            saveProviderPlanConfig(next)
                        }
                    ))
                    .toggleStyle(.switch)
                }
                .font(.system(size: 12, design: .rounded))

                let routes = status?.routes ?? []
                if routes.isEmpty {
                    Text("Add provider routes to configure plan limits for router decisions.")
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.secondary)
                } else {
                    VStack(spacing: 10) {
                        ForEach(routes.prefix(8)) { route in
                            providerPlanRouteRow(route)
                        }
                    }
                }
            }
        }
    }

    private func planMetric(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.system(size: 16, weight: .bold, design: .rounded))
            Text(label)
                .font(.system(size: 10, design: .rounded))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func providerPlanRouteRow(_ route: RouterAvailabilityStatus) -> some View {
        let plan = providerPlan(for: route)
        let primaryWindow = plan?.windows.first
        let tokenBinding = Binding(
            get: { monthlyTokenDrafts[route.providerId] ?? "" },
            set: { monthlyTokenDrafts[route.providerId] = $0 }
        )
        let spendBinding = Binding(
            get: { monthlySpendDrafts[route.providerId] ?? "" },
            set: { monthlySpendDrafts[route.providerId] = $0 }
        )
        let manualPlanEditable = plan?.manualPlanEditable ?? true

        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(plan?.providerName ?? route.providerId)
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                    Text(providerPlanSubtitle(plan: plan, route: route))
                        .font(.system(size: 11, design: .rounded))
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(planStatusLabel(plan?.status ?? route.plan?.status ?? "unconfigured"))
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(planStatusColor(plan?.status ?? route.plan?.status ?? "unconfigured"))
            }

            if let plan, plan.managedAutomatically {
                RouterAutomaticPlanUsage(plan: plan)
            } else if let percent = primaryWindow?.usedPercent {
                ProgressView(value: min(max(percent, 0), 100), total: 100)
                    .tint(planStatusColor(plan?.status ?? "ok"))
            }

            if manualPlanEditable {
                HStack(spacing: 8) {
                    TextField("Monthly tokens", text: tokenBinding)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 12, design: .rounded))
                        .onSubmit { saveProviderPlan(route.providerId) }
                    TextField("Monthly $", text: spendBinding)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 12, design: .rounded))
                        .onSubmit { saveProviderPlan(route.providerId) }
                    Button {
                        saveProviderPlan(route.providerId)
                    } label: {
                        if savingPlanProvider == route.providerId {
                            ProgressView().controlSize(.small)
                        } else {
                            Label("Save", systemImage: "checkmark")
                        }
                    }
                    .disabled(savingPlanProvider == route.providerId)
                    .labelStyle(.iconOnly)
                    .help("Save provider plan limits")
                }
            } else {
                Text("Automatic usage tracking is active. Routing uses live provider limits.")
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(.secondary)
            }

            if manualPlanEditable, let plan, !plan.presetSuggestions.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Picker("Coding plan", selection: Binding(
                        get: { providerPlanPresetId(for: route.providerId, plan: plan) },
                        set: { value in
                            if value == "manual" {
                                clearProviderPlanPreset(route.providerId)
                            } else if let preset = plan.presetSuggestions.first(where: { $0.id == value }) {
                                applyProviderPlanPreset(route.providerId, preset)
                            }
                        }
                    )) {
                        Text("Manual / custom").tag("manual")
                        ForEach(plan.presetSuggestions) { preset in
                            Text("\(preset.label) · \(providerPlanPresetLimitLabel(preset))")
                                .tag(preset.id)
                        }
                    }
                    .pickerStyle(.menu)

                    Text(
                        plan.presetSuggestions.first(where: { $0.id == providerPlanPresetId(for: route.providerId, plan: plan) })?.limitDescription
                            ?? "Choose a published plan preset, then override manual caps if needed."
                    )
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(.secondary)
                }
            }
        }
        .padding(10)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private struct RouterAutomaticPlanUsage: View {
        let plan: ProviderPlanSnapshot

        private var windows: [(label: String, window: ProviderPlanUsageWindow)] {
            [
                ("5h", "rolling_5h"),
                ("Weekly", "rolling_week"),
            ].compactMap { label, kind in
                guard let window = plan.windows.first(where: {
                    $0.kind == kind && $0.usageKnown && ($0.unlimited || $0.usedPercent != nil)
                }) else {
                    return nil
                }
                return (label, window)
            }
        }

        var body: some View {
            if windows.isEmpty {
                Text("Automatic usage data is not available yet.")
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(windows, id: \.window.id) { row in
                        VStack(alignment: .leading, spacing: 5) {
                            HStack {
                                Text(row.label)
                                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                                    .foregroundStyle(tint(row.window))
                                Text(row.window.title)
                                    .font(.system(size: 11, design: .rounded))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                Spacer()
                                Text(value(row.window))
                                    .font(.system(size: 11, weight: .bold, design: .rounded))
                                    .foregroundStyle(tint(row.window))
                                if !row.window.resetDescription.isEmpty {
                                    Text(row.window.resetDescription)
                                        .font(.system(size: 10, design: .rounded))
                                        .foregroundStyle(.secondary)
                                }
                            }
                            GeometryReader { proxy in
                                RoundedRectangle(cornerRadius: 4, style: .continuous)
                                    .fill(Color.primary.opacity(0.06))
                                RoundedRectangle(cornerRadius: 4, style: .continuous)
                                    .fill(tint(row.window).opacity(row.window.unlimited ? 0.52 : 0.82))
                                    .frame(
                                        width: max(
                                            4,
                                            proxy.size.width * CGFloat(progress(row.window))
                                        )
                                    )
                            }
                            .frame(height: 6)
                        }
                    }
                }
                .padding(.vertical, 2)
            }
        }

        private func tint(_ window: ProviderPlanUsageWindow) -> Color {
            if window.unlimited { return .green }
            let percent = window.usedPercent ?? 0
            if percent < 40 { return .green }
            if percent < 65 { return .blue }
            if percent < 80 { return .yellow }
            if percent < 95 { return .orange }
            return .red
        }

        private func value(_ window: ProviderPlanUsageWindow) -> String {
            if window.unlimited { return "∞" }
            return "\(Int(ceil(min(100, max(0, window.usedPercent ?? 0)))))%"
        }

        private func progress(_ window: ProviderPlanUsageWindow) -> Double {
            if window.unlimited { return 1 }
            return min(1, max(0, (window.usedPercent ?? 0) / 100))
        }
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

    private func providerPlan(for route: RouterAvailabilityStatus) -> ProviderPlanSnapshot? {
        planStatus?.providers.first {
            $0.providerId == route.providerId ||
                $0.configuredProviderId == route.providerId ||
                $0.providerType == route.providerId
        }
    }

    private func providerPlanSubtitle(
        plan: ProviderPlanSnapshot?,
        route: RouterAvailabilityStatus
    ) -> String {
        if let plan, plan.managedAutomatically {
            return [plan.planName, plan.automaticTrackingLabel, plan.sourceLabel, plan.externalSourceLabel]
                .compactMap { firstNonEmptyGatewayString($0) }
                .prefix(2)
                .joined(separator: " · ")
        }
        if let window = plan?.windows.first,
           let percent = window.usedPercent {
            return "\(window.title): \(String(format: "%.1f", percent))% used · \(window.resetDescription)"
        }
        if let plan,
           plan.monitored {
            return "\(formatLargeNumber(plan.localTokens30d)) tokens · \(String(format: "$%.4f", plan.localSpend30d)) last 30d"
        }
        if let reason = route.plan?.reason {
            return reason
        }
        return "No plan limits configured"
    }

    private func planStatusLabel(_ status: String) -> String {
        switch status.lowercased() {
        case "ok": return "OK"
        case "warning": return "Warning"
        case "exhausted": return "Exhausted"
        case "disabled": return "Disabled"
        default: return "Unconfigured"
        }
    }

    private func planStatusColor(_ status: String) -> Color {
        switch status.lowercased() {
        case "ok": return .green
        case "warning": return .orange
        case "exhausted": return .red
        default: return .secondary
        }
    }

    private func seedProviderPlanDrafts() {
        let providers = planConfig["providers"] as? [String: Any] ?? [:]
        var tokenDrafts: [String: String] = [:]
        var spendDrafts: [String: String] = [:]
        for route in status?.routes ?? [] {
            let providerConfig = providers[route.providerId] as? [String: Any] ?? [:]
            let monthly = providerConfig["monthly"] as? [String: Any] ?? [:]
            tokenDrafts[route.providerId] = limitText(monthly["tokenLimit"] ?? monthly["token_limit"])
            spendDrafts[route.providerId] = limitText(monthly["spendLimit"] ?? monthly["spend_limit"])
        }
        monthlyTokenDrafts = tokenDrafts
        monthlySpendDrafts = spendDrafts
    }

    private func providerPlanPresetId(for providerId: String, plan: ProviderPlanSnapshot?) -> String {
        let providers = planConfig["providers"] as? [String: Any] ?? [:]
        let providerConfig = providers[providerId] as? [String: Any] ?? [:]
        if let presetId = providerConfig["presetId"] as? String, !presetId.isEmpty {
            return presetId
        }
        if let presetId = providerConfig["preset_id"] as? String, !presetId.isEmpty {
            return presetId
        }
        return plan?.appliedPresetId ?? "manual"
    }

    private func providerPlanPresetLimitLabel(_ preset: ProviderPlanPresetSuggestion) -> String {
        if let tokenLimit = preset.monthlyTokenLimit {
            return "\(formatLargeNumber(Int(tokenLimit))) tokens/mo"
        }
        if let spendLimit = preset.monthlySpendLimit {
            return String(format: "$%.0f/mo credits", spendLimit)
        }
        if let routeLimitWeekly = preset.routeLimitWeekly {
            return "\(formatLargeNumber(Int(routeLimitWeekly))) req/week"
        }
        if let routeLimit5h = preset.routeLimit5h {
            return "\(formatLargeNumber(Int(routeLimit5h))) req/5h"
        }
        return "Provider-managed"
    }

    private func clearProviderPlanPreset(_ providerId: String) {
        var next = planConfig
        var providers = next["providers"] as? [String: Any] ?? [:]
        var providerConfig = providers[providerId] as? [String: Any] ?? [:]
        providerConfig.removeValue(forKey: "presetId")
        providerConfig.removeValue(forKey: "preset_id")
        providers[providerId] = providerConfig
        next["providers"] = providers
        saveProviderPlanConfig(next)
    }

    private func applyProviderPlanPreset(_ providerId: String, _ preset: ProviderPlanPresetSuggestion) {
        var nextPlan = planConfig
        var providers = nextPlan["providers"] as? [String: Any] ?? [:]
        var providerConfig = providers[providerId] as? [String: Any] ?? [:]
        providerConfig["enabled"] = true
        providerConfig["presetId"] = preset.id
        providerConfig["planName"] = preset.planName
        providerConfig["sourceMode"] = preset.sourceMode
        providerConfig["externalSourceEnabled"] = preset.externalSourceEnabled
        if preset.monthlyTokenLimit != nil || preset.monthlySpendLimit != nil {
            var monthly = providerConfig["monthly"] as? [String: Any] ?? [:]
            monthly["enabled"] = true
            if let tokenLimit = preset.monthlyTokenLimit {
                monthly["tokenLimit"] = tokenLimit
            }
            if let spendLimit = preset.monthlySpendLimit {
                monthly["spendLimit"] = spendLimit
            }
            providerConfig["monthly"] = monthly
            monthlyTokenDrafts[providerId] = preset.monthlyTokenLimit.map { limitText($0) } ?? ""
            monthlySpendDrafts[providerId] = preset.monthlySpendLimit.map { limitText($0) } ?? ""
        }
        if let weeklyTokenLimit = preset.weeklyTokenLimit {
            var weekly = providerConfig["weekly"] as? [String: Any] ?? [:]
            weekly["enabled"] = true
            weekly["tokenLimit"] = weeklyTokenLimit
            providerConfig["weekly"] = weekly
        }
        if let fiveHourTokenLimit = preset.fiveHourTokenLimit {
            var fiveHour = providerConfig["fiveHour"] as? [String: Any] ?? [:]
            fiveHour["enabled"] = true
            fiveHour["tokenLimit"] = fiveHourTokenLimit
            providerConfig["fiveHour"] = fiveHour
        }
        providers[providerId] = providerConfig
        nextPlan["providers"] = providers

        var nextRouter = config
        var routes = nextRouter["routes"] as? [String: Any] ?? [:]
        var routeConfig = routes[providerId] as? [String: Any] ?? [:]
        if let routeLimit5h = preset.routeLimit5h {
            routeConfig["limit5h"] = routeLimit5h
        }
        if let routeLimitWeekly = preset.routeLimitWeekly {
            routeConfig["limitWeekly"] = routeLimitWeekly
        }
        routes[providerId] = routeConfig
        nextRouter["routes"] = routes

        guard
            let planBody = try? JSONSerialization.data(withJSONObject: nextPlan),
            let routerBody = try? JSONSerialization.data(withJSONObject: nextRouter)
        else { return }
        planConfig = nextPlan
        config = nextRouter
        savingPlanProvider = providerId
        Task {
            do {
                planConfig = try await client.updateProviderPlanConfig(planBody)
                if preset.routeLimit5h != nil || preset.routeLimitWeekly != nil {
                    try await client.updateRouterConfig(routerBody)
                }
                status = try? await client.routerStatus()
                planStatus = try? await client.providerPlanStatus()
                seedProviderPlanDrafts()
                error = nil
            } catch {
                self.error = error.localizedDescription
            }
            savingPlanProvider = nil
        }
    }

    private func saveProviderPlanConfig(_ next: [String: Any]) {
        guard let body = try? JSONSerialization.data(withJSONObject: next) else { return }
        planConfig = next
        saving = true
        Task {
            do {
                planConfig = try await client.updateProviderPlanConfig(body)
                planStatus = try? await client.providerPlanStatus()
                seedProviderPlanDrafts()
                error = nil
            } catch {
                self.error = error.localizedDescription
            }
            saving = false
        }
    }

    private func limitText(_ value: Any?) -> String {
        let number: Double?
        if let value = value as? Double {
            number = value
        } else if let value = value as? Int {
            number = Double(value)
        } else if let value = value as? String {
            number = Double(value.trimmingCharacters(in: .whitespacesAndNewlines))
        } else {
            number = nil
        }
        guard let number, number > 0 else { return "" }
        return number.rounded() == number ? String(Int(number)) : String(number)
    }

    private func positiveLimit(_ value: String?) -> Double? {
        guard let value else { return nil }
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: ",", with: "")
            .replacingOccurrences(of: "$", with: "")
        guard let parsed = Double(normalized), parsed > 0, parsed.isFinite else { return nil }
        return parsed
    }

    private func saveProviderPlan(_ providerId: String) {
        var next = planConfig
        var providers = next["providers"] as? [String: Any] ?? [:]
        var providerConfig = providers[providerId] as? [String: Any] ?? [:]
        var monthly = providerConfig["monthly"] as? [String: Any] ?? [:]
        monthly["enabled"] = true
        if let tokenLimit = positiveLimit(monthlyTokenDrafts[providerId]) {
            monthly["tokenLimit"] = tokenLimit
        } else {
            monthly.removeValue(forKey: "tokenLimit")
            monthly.removeValue(forKey: "token_limit")
        }
        if let spendLimit = positiveLimit(monthlySpendDrafts[providerId]) {
            monthly["spendLimit"] = spendLimit
        } else {
            monthly.removeValue(forKey: "spendLimit")
            monthly.removeValue(forKey: "spend_limit")
        }
        providerConfig["enabled"] = true
        providerConfig["monthly"] = monthly
        providers[providerId] = providerConfig
        next["providers"] = providers
        guard let body = try? JSONSerialization.data(withJSONObject: next) else { return }
        planConfig = next
        savingPlanProvider = providerId
        Task {
            do {
                planConfig = try await client.updateProviderPlanConfig(body)
                planStatus = try? await client.providerPlanStatus()
                seedProviderPlanDrafts()
                error = nil
            } catch {
                self.error = error.localizedDescription
            }
            savingPlanProvider = nil
        }
    }

    private func formatLargeNumber(_ value: Int) -> String {
        if value >= 1_000_000 {
            return String(format: "%.1fM", Double(value) / 1_000_000)
        }
        if value >= 1_000 {
            return String(format: "%.1fK", Double(value) / 1_000)
        }
        return "\(value)"
    }

    private func load() async {
        do {
            config = try await client.routerConfig()
            status = try? await client.routerStatus()
            planConfig = (try? await client.providerPlanConfig()) ?? [:]
            planStatus = try? await client.providerPlanStatus()
            seedProviderPlanDrafts()
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

// ─── Memory ──────────────────────────────────────────────────────────────────

struct MemoryScreen: View {
    let client: GatewayClient
    @Environment(\.cybaraAccent) private var accentTint

    @State private var files: [String] = []
    @State private var memories: [GatewayMemoryFile] = []
    @State private var searchText = ""
    @State private var searchResults: [GatewayMemorySearchResult] = []
    @State private var searchPerformed = false
    @State private var newFile = ""
    @State private var newContent = ""
    @State private var loaded = false
    @State private var saving = false
    @State private var error: String?
    @State private var editingEntry: MemoryEditDraft?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .top, spacing: 12) {
                    ScreenHeader(title: "Memory", subtitle: "Persistent memory files on the gateway")
                    Spacer()
                    Button {
                        Task { await load() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(.borderless)
                    .help("Refresh memory")
                }

                if !loaded {
                    ProgressView().frame(maxWidth: .infinity)
                } else if let error {
                    LoadFailedView(message: error) { Task { await load() } }
                } else {
                    createMemoryCard
                    searchCard
                    memoryList
                }

                if saving { ProgressView().controlSize(.small) }
            }
            .padding(24)
        }
        .task { await load() }
        .sheet(item: $editingEntry) { draft in
            MemoryEditSheet(draft: draft) { updatedContent in
                _ = try await client.updateMemory(file: draft.file, index: draft.index, content: updatedContent)
                editingEntry = nil
                await load()
            }
        }
    }

    private var createMemoryCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                Label("Add Memory", systemImage: "plus.circle")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                TextField("File name, e.g. project.md", text: $newFile)
                    .textFieldStyle(.roundedBorder)
                TextEditor(text: $newContent)
                    .font(.system(size: 12, design: .rounded))
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 72)
                    .padding(8)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(Color.white.opacity(0.06))
                    )
                HStack {
                    Spacer()
                    Button(saving ? "Saving..." : "Add Entry") {
                        Task { await createMemory() }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(saving || newFile.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        || newContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }

    private var searchCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    TextField("Search memory", text: $searchText)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit { Task { await search() } }
                    Button {
                        Task { await search() }
                    } label: {
                        Label("Search", systemImage: "magnifyingglass")
                    }
                    .buttonStyle(.bordered)
                    .disabled(searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    if searchPerformed {
                        Button("Clear") {
                            searchText = ""
                            searchResults = []
                            searchPerformed = false
                        }
                        .buttonStyle(.borderless)
                    }
                }

                if searchPerformed {
                    if searchResults.isEmpty {
                        Text("No memory matches.")
                            .font(.system(size: 12, design: .rounded))
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(searchResults) { result in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(result.file)
                                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                                Text(result.entry.content)
                                    .font(.system(size: 12, design: .rounded))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(3)
                            }
                            .padding(10)
                            .background(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .fill(Color.white.opacity(0.05))
                            )
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var memoryList: some View {
        if files.isEmpty {
            Text("No memory files yet. Agents write memory as they work, or you can add one above.")
                .font(.system(size: 13, design: .rounded))
                .foregroundStyle(.secondary)
        } else {
            LazyVStack(alignment: .leading, spacing: 12) {
                ForEach(files, id: \.self) { file in
                    memoryCard(file: file, memory: memories.first { $0.file == file })
                }
            }
        }
    }

    private func memoryCard(file: String, memory: GatewayMemoryFile?) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: "brain")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(accentTint)
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(Color.white.opacity(0.06)))
                VStack(alignment: .leading, spacing: 3) {
                    Text(file)
                        .font(.system(size: 13, weight: .medium, design: .monospaced))
                        .lineLimit(1)
                    Text(entryCountLabel(memory?.entries.count ?? 0))
                        .font(.system(size: 11.5, design: .rounded))
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button(role: .destructive) {
                    Task { await deleteMemory(file: file, index: nil) }
                } label: {
                    Image(systemName: "trash")
                }
                .buttonStyle(.borderless)
                .help("Delete memory file")
            }

            if let entries = memory?.entries, !entries.isEmpty {
                ForEach(Array(entries.enumerated()), id: \.offset) { index, entry in
                    HStack(alignment: .top, spacing: 10) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(entry.content)
                                .font(.system(size: 12, design: .rounded))
                                .lineLimit(3)
                            Text(memoryEntryMeta(entry))
                                .font(.system(size: 11, design: .rounded))
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button {
                            editingEntry = MemoryEditDraft(file: file, index: index, content: entry.content)
                        } label: {
                            Image(systemName: "pencil")
                        }
                        .buttonStyle(.borderless)
                        .help("Edit entry")
                        Button(role: .destructive) {
                            Task { await deleteMemory(file: file, index: index) }
                        } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(.borderless)
                        .help("Delete entry")
                    }
                    .padding(10)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(Color.white.opacity(0.04))
                    )
                }
            }
        }
        .padding(14)
        .cybaraGlass(cornerRadius: 14)
    }

    private func load() async {
        do {
            let list = try await client.memoryList()
            files = list.files
            memories = list.memories
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }

    private func createMemory() async {
        saving = true
        do {
            _ = try await client.createMemory(file: newFile, content: newContent)
            newContent = ""
            if !files.contains(newFile) {
                newFile = ""
            }
            await load()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }

    private func search() async {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return }
        do {
            searchResults = try await client.searchMemory(query)
            searchPerformed = true
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func deleteMemory(file: String, index: Int?) async {
        saving = true
        do {
            _ = try await client.deleteMemory(file: file, index: index)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }

    private func entryCountLabel(_ count: Int) -> String {
        count == 1 ? "1 entry" : "\(count) entries"
    }

    private func memoryEntryMeta(_ entry: GatewayMemoryEntry) -> String {
        [entry.type, relativeTimestamp(entry.timestamp)].compactMap { value in
            guard let value, !value.isEmpty else { return nil }
            return value
        }.joined(separator: " · ")
    }
}

private struct MemoryEditDraft: Identifiable {
    let file: String
    let index: Int
    let content: String

    var id: String { "\(file)-\(index)" }
}

private struct MemoryEditSheet: View {
    let draft: MemoryEditDraft
    let onSave: (String) async throws -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var content: String
    @State private var saving = false
    @State private var error: String?

    init(draft: MemoryEditDraft, onSave: @escaping (String) async throws -> Void) {
        self.draft = draft
        self.onSave = onSave
        _content = State(initialValue: draft.content)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ScreenHeader(title: "Edit Memory", subtitle: draft.file)
            TextEditor(text: $content)
                .font(.system(size: 12, design: .rounded))
                .scrollContentBackground(.hidden)
                .frame(minHeight: 160)
                .padding(10)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Color.white.opacity(0.06))
                )
            if let error {
                Text(error)
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(.red)
            }
            HStack {
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button(saving ? "Saving..." : "Save") {
                    Task { await save() }
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(saving || content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(24)
        .frame(width: 520)
    }

    private func save() async {
        saving = true
        do {
            try await onSave(content)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}

// ─── Channels ────────────────────────────────────────────────────────────────

struct ChannelsScreen: View {
    let client: GatewayClient
    @Environment(\.cybaraAccent) private var accentTint

    @State private var channels: [GatewayChannel] = []
    @State private var agents: [GatewayAgent] = []
    @State private var modelRouterEnabled = false
    @State private var loaded = false
    @State private var error: String?
    @State private var busyID: String?
    @State private var actionError: String?
    @State private var pendingDelete: GatewayChannel?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ScreenHeader(title: "Channels", subtitle: "Messaging surfaces connected to the gateway")

                if let actionError {
                    Text(actionError)
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.red)
                }

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
                            Menu {
                                Button {
                                    Task { await setRouting(channel, agentID: nil, useModelRouter: false) }
                                } label: {
                                    Label("Gateway default", systemImage: !channel.usesModelRouter && channel.agentID == nil ? "checkmark" : "circle")
                                }
                                if modelRouterEnabled {
                                    Button {
                                        Task { await setRouting(channel, agentID: nil, useModelRouter: true) }
                                    } label: {
                                        Label("Model Router", systemImage: channel.usesModelRouter ? "checkmark" : "point.3.connected.trianglepath.dotted")
                                    }
                                }
                                Divider()
                                ForEach(agents) { agent in
                                    Button {
                                        Task { await setRouting(channel, agentID: agent.id, useModelRouter: false) }
                                    } label: {
                                        Label(agent.name, systemImage: channel.agentID == agent.id ? "checkmark" : "cpu")
                                    }
                                }
                            } label: {
                                Label(agentName(for: channel), systemImage: "cpu")
                                    .lineLimit(1)
                            }
                            .menuStyle(.borderlessButton)
                            .fixedSize()
                            .disabled(busyID != nil || agents.isEmpty)
                            .help("Default agent for new channel conversations")
                            if busyID == channel.id {
                                ProgressView().controlSize(.small)
                            }
                            Toggle(
                                "",
                                isOn: Binding(
                                    get: { channel.isEnabled },
                                    set: { newValue in Task { await setEnabled(channel, newValue) } }
                                )
                            )
                            .labelsHidden()
                            .toggleStyle(.switch)
                            .disabled(busyID != nil)
                            .help(channel.isEnabled ? "Disable channel" : "Enable channel")
                            Button(role: .destructive) {
                                pendingDelete = channel
                            } label: {
                                Image(systemName: "trash")
                            }
                            .buttonStyle(.borderless)
                            .disabled(busyID != nil)
                            .help("Delete channel")
                        }
                        .padding(16)
                        .cybaraGlass(cornerRadius: 16)
                    }
                }
            }
            .padding(24)
        }
        .task { await load() }
        .confirmationDialog(
            "Delete this channel?",
            isPresented: Binding(
                get: { pendingDelete != nil },
                set: { if !$0 { pendingDelete = nil } }
            ),
            presenting: pendingDelete
        ) { channel in
            Button("Delete \(channel.displayName)", role: .destructive) {
                Task { await deleteChannel(channel) }
            }
            Button("Cancel", role: .cancel) { pendingDelete = nil }
        } message: { channel in
            Text("Removes \(channel.displayName) from the gateway. This cannot be undone.")
        }
    }

    private func load() async {
        do {
            async let nextChannels = client.channels()
            async let nextAgents = client.agents()
            async let nextRouter = client.routerConfig()
            channels = try await nextChannels
            agents = try await nextAgents
            let router = try await nextRouter
            modelRouterEnabled = router["enabled"] as? Bool == true
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }

    private func agentName(for channel: GatewayChannel) -> String {
        if channel.usesModelRouter {
            return modelRouterEnabled ? "Model Router" : "Model Router disabled"
        }
        guard let agentID = channel.agentID else { return "Gateway default" }
        return agents.first(where: { $0.id == agentID })?.name ?? "Unavailable agent"
    }

    private func setRouting(
        _ channel: GatewayChannel,
        agentID: String?,
        useModelRouter: Bool
    ) async {
        guard busyID == nil else { return }
        busyID = channel.id
        actionError = nil
        do {
            try await client.setChannelRouting(
                channel.id,
                agentID: agentID,
                useModelRouter: useModelRouter
            )
            await load()
        } catch {
            actionError = error.localizedDescription
        }
        busyID = nil
    }

    private func setEnabled(_ channel: GatewayChannel, _ enabled: Bool) async {
        guard busyID == nil else { return }
        busyID = channel.id
        actionError = nil
        do {
            try await client.setChannelEnabled(channel.id, enabled: enabled)
            await load()
        } catch {
            actionError = error.localizedDescription
        }
        busyID = nil
    }

    private func deleteChannel(_ channel: GatewayChannel) async {
        pendingDelete = nil
        busyID = channel.id
        actionError = nil
        do {
            try await client.deleteChannel(channel.id)
            await load()
        } catch {
            actionError = error.localizedDescription
        }
        busyID = nil
    }
}

// ─── Logs ────────────────────────────────────────────────────────────────────

struct LogsScreen: View {
    let client: GatewayClient
    @EnvironmentObject private var sidecar: SidecarManager

    @State private var logs: [GatewayLogEntry] = []
    @State private var totalLogs: Int?
    @State private var hasMore = false
    @State private var loaded = false
    @State private var loading = false
    @State private var live = true
    @State private var error: String?
    @State private var levelFilter = "all"
    @State private var sourceFilter = "all"
    @State private var searchText = ""

    private let logLimit = 200
    private let levelOptions = ["all", "info", "warn", "error"]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                ScreenHeader(title: "Logs", subtitle: "Gateway, native sidecar, and app events")
                Spacer()
                HStack(spacing: 8) {
                    if loading {
                        ProgressView().controlSize(.small)
                    }
                    Button {
                        live.toggle()
                    } label: {
                        Label(live ? "Pause" : "Live", systemImage: live ? "pause.fill" : "play.fill")
                    }
                    .buttonStyle(.bordered)
                    Button {
                        Task { await load() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(.bordered)
                    .help("Refresh")
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 24)
            .padding(.bottom, 12)

            if loaded && error == nil && !allLogEntries.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 8) { logStats }
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 108), spacing: 8)], spacing: 8) { logStats }
                    }

                    HStack(spacing: 10) {
                        Picker("Level", selection: $levelFilter) {
                            ForEach(levelOptions, id: \.self) { level in
                                Text(level == "all" ? "All Levels" : level.capitalized).tag(level)
                            }
                        }
                        .pickerStyle(.segmented)
                        .labelsHidden()
                        .frame(maxWidth: 330)

                        Picker("Source", selection: $sourceFilter) {
                            ForEach(sourceOptions, id: \.self) { source in
                                Text(source == "all" ? "All Sources" : source.capitalized).tag(source)
                            }
                        }
                        .pickerStyle(.menu)
                        .frame(maxWidth: 190)

                        searchField
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 12)
            }

            if !loaded {
                VStack(spacing: 12) {
                    ProgressView().controlSize(.large)
                    Text("Loading logs…")
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error, allLogEntries.isEmpty {
                LoadFailedView(message: error) { Task { await load() } }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Label(logSummary, systemImage: live ? "dot.radiowaves.left.and.right" : "pause.circle")
                                .font(.system(size: 12, weight: .semibold, design: .rounded))
                                .foregroundStyle(.secondary)
                            Spacer()
                            Text(hasMore ? "Newest \(logLimit) gateway entries" : "Newest first")
                                .font(.system(size: 11, weight: .medium, design: .rounded))
                                .foregroundStyle(.tertiary)
                        }

                        if let error {
                            Label(error, systemImage: "exclamationmark.triangle")
                                .font(.system(size: 12, design: .rounded))
                                .foregroundStyle(.orange)
                        }

                        NativeLogTimeline(
                            entries: filteredLogs,
                            emptyMessage: "No entries match the current filter."
                        )
                    }
                    .padding(16)
                }
                .cybaraGlass(cornerRadius: 18)
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
            }
        }
        .task {
            if !loaded {
                await load()
            }
        }
        .task(id: live) {
            guard live else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                await load(silent: true)
            }
        }
    }

    @ViewBuilder
    private var logStats: some View {
        NativeLogStatPill(label: "Info", value: logCount("info"), tint: .gray)
        NativeLogStatPill(label: "Warnings", value: logCount("warn"), tint: .orange)
        NativeLogStatPill(label: "Errors", value: logCount("error"), tint: .red)
        NativeLogStatPill(label: "Sidecar", value: allLogEntries.filter { $0.sourceKey == "sidecar" }.count, tint: .blue)
    }

    private var searchField: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
            TextField("Search logs", text: $searchText)
                .textFieldStyle(.plain)
                .font(.system(size: 12, design: .rounded))
            if !searchText.isEmpty {
                Button {
                    searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.borderless)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(Color.primary.opacity(0.055))
        )
    }

    private var allLogEntries: [NativeLogEntryDisplay] {
        nativeLogEntries(gatewayLogs: logs, sidecarLogs: sidecar.logs)
    }

    private var sourceOptions: [String] {
        let sources = Set(allLogEntries.map(\.sourceKey)).sorted()
        let preferred = ["gateway", "sidecar"].filter { sources.contains($0) }
        return ["all"] + preferred + sources.filter { !preferred.contains($0) }
    }

    private var filteredLogs: [NativeLogEntryDisplay] {
        filterNativeLogs(
            allLogEntries,
            levelFilter: levelFilter,
            sourceFilter: sourceFilter,
            query: searchText
        )
    }

    private var logSummary: String {
        let visible = filteredLogs.count
        let loadedCount = allLogEntries.count
        if visible != loadedCount { return "\(visible) of \(loadedCount) shown" }
        guard let totalLogs else { return "\(visible) recent events" }
        let total = totalLogs + sidecar.logs.count
        return visible == total ? "\(visible) events" : "\(visible) of \(total) events"
    }

    private func logCount(_ level: String) -> Int {
        allLogEntries.filter { $0.levelKey == level }.count
    }

    private func load(silent: Bool = false) async {
        if loading { return }
        if !silent {
            loading = true
        }
        do {
            let page = try await client.systemLogsPage(limit: logLimit)
            logs = page.logs
            totalLogs = page.total
            hasMore = page.hasMore ?? false
            if !sourceOptions.contains(sourceFilter) {
                sourceFilter = "all"
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
        loading = false
    }
}

// ─── Wallet ──────────────────────────────────────────────────────────────────

struct WalletScreen: View {
    let client: GatewayClient

    @State private var status: [String: Any] = [:]
    @State private var policy: [String: Any] = [:]
    @State private var loaded = false
    @State private var savingAccess = false
    @State private var sendMode = "native"
    @State private var sendChain = "eth"
    @State private var tokenChain = "eth"
    @State private var sendTo = ""
    @State private var sendAmount = ""
    @State private var sendMemo = ""
    @State private var tokenAddress = ""
    @State private var tokenDecimals = "18"
    @State private var sendingWallet = false
    @State private var confirmingSend = false
    @State private var sendResult: String?
    @State private var sendError: String?
    @State private var seedRevealPresented = false
    @State private var seedPassword = ""
    @State private var seedConfirmation = ""
    @State private var revealedSeed = ""
    @State private var revealingSeed = false
    @State private var seedRevealTask: Task<Void, Never>?
    @State private var error: String?

    private static let nativeChains = ["eth", "btc", "sol"]
    private static let tokenChains = ["eth", "sol"]
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
    private var walletUnlocked: Bool { status["unlocked"] as? Bool ?? false }
    private var sendReady: Bool {
        walletUnlocked
            && !sendTo.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !sendAmount.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && (sendMode == "native" || !tokenAddress.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }
    private var sendAssetLabel: String {
        sendMode == "native" ? sendChain.uppercased() : "\(tokenChain.uppercased()) token"
    }

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
                            Text("Recovery Phrase")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            Text("Reveal the seed only to create an offline backup. Anyone with it controls every derived account.")
                                .font(.system(size: 11, design: .rounded))
                                .foregroundStyle(.secondary)
                            HStack {
                                Spacer()
                                Button("Reveal Seed Phrase") {
                                    seedRevealPresented = true
                                }
                                .buttonStyle(.bordered)
                                .disabled(status["exists"] as? Bool != true)
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

                    GlassCard {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text("Send")
                                        .font(.system(size: 15, weight: .bold, design: .rounded))
                                    Text(walletUnlocked
                                        ? "User-initiated wallet send with review confirmation."
                                        : "Unlock the wallet in web or Tauri before sending.")
                                        .font(.system(size: 11, design: .rounded))
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                if sendingWallet {
                                    ProgressView().controlSize(.small)
                                }
                            }

                            Picker("Send type", selection: $sendMode) {
                                Text("Native").tag("native")
                                Text("Token").tag("token")
                            }
                            .pickerStyle(.segmented)
                            .disabled(sendingWallet || !walletUnlocked)

                            Picker(sendMode == "native" ? "Chain" : "Token chain", selection: sendMode == "native" ? $sendChain : $tokenChain) {
                                ForEach(sendMode == "native" ? Self.nativeChains : Self.tokenChains, id: \.self) { chain in
                                    Text(chain.uppercased()).tag(chain)
                                }
                            }
                            .pickerStyle(.menu)
                            .disabled(sendingWallet || !walletUnlocked)

                            if sendMode == "token" {
                                TextField("Token address or mint", text: $tokenAddress)
                                    .textFieldStyle(.roundedBorder)
                                    .disabled(sendingWallet || !walletUnlocked)
                                TextField("Token decimals", text: $tokenDecimals)
                                    .textFieldStyle(.roundedBorder)
                                    .disabled(sendingWallet || !walletUnlocked)
                            }

                            TextField("Recipient address", text: $sendTo)
                                .textFieldStyle(.roundedBorder)
                                .disabled(sendingWallet || !walletUnlocked)
                            TextField("Amount", text: $sendAmount)
                                .textFieldStyle(.roundedBorder)
                                .disabled(sendingWallet || !walletUnlocked)
                            TextField("Memo (optional)", text: $sendMemo)
                                .textFieldStyle(.roundedBorder)
                                .disabled(sendingWallet || !walletUnlocked)

                            HStack {
                                Spacer()
                                Button(sendingWallet ? "Sending..." : "Review Send") {
                                    confirmingSend = true
                                }
                                .buttonStyle(.borderedProminent)
                                .disabled(!sendReady || sendingWallet)
                            }

                            if let sendResult {
                                Text(sendResult)
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundStyle(.secondary)
                                    .textSelection(.enabled)
                            }
                            if let sendError {
                                Text(sendError)
                                    .font(.system(size: 11, design: .rounded))
                                    .foregroundStyle(.red)
                            }
                        }
                    }
                }
            }
            .padding(24)
        }
        .task { await load() }
        .confirmationDialog(
            "Confirm wallet send",
            isPresented: $confirmingSend,
            titleVisibility: .visible
        ) {
            Button("Send \(sendAmount) \(sendAssetLabel)", role: .destructive) {
                Task { await submitSend() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Recipient: \(sendTo)")
        }
        .sheet(isPresented: $seedRevealPresented, onDismiss: clearRevealedSeed) {
            seedRevealSheet
        }
    }

    private var seedRevealSheet: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Reveal Seed Phrase")
                .font(.system(size: 18, weight: .bold, design: .rounded))
            Text("Never share these words, paste them into a website, or store them in cloud notes. The phrase disappears after 60 seconds.")
                .font(.system(size: 12, design: .rounded))
                .foregroundStyle(.orange)
            if revealedSeed.isEmpty {
                SecureField("Wallet password", text: $seedPassword)
                    .textFieldStyle(.roundedBorder)
                TextField("Type REVEAL to confirm", text: $seedConfirmation)
                    .textFieldStyle(.roundedBorder)
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 8) {
                    ForEach(Array(revealedSeed.split(separator: " ").enumerated()), id: \.offset) { index, word in
                        HStack(spacing: 6) {
                            Text("\(index + 1).")
                                .foregroundStyle(.tertiary)
                                .frame(width: 24, alignment: .trailing)
                            Text(String(word))
                                .textSelection(.enabled)
                            Spacer()
                        }
                        .font(.system(size: 12, design: .monospaced))
                    }
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 10).fill(Color.primary.opacity(0.05)))
            }
            HStack {
                Spacer()
                Button(revealedSeed.isEmpty ? "Cancel" : "Done") {
                    seedRevealPresented = false
                }
                if revealedSeed.isEmpty {
                    Button(revealingSeed ? "Revealing…" : "Reveal Phrase", role: .destructive) {
                        Task { await revealSeed() }
                    }
                    .disabled(revealingSeed || seedPassword.isEmpty || seedConfirmation != "REVEAL")
                }
            }
        }
        .padding(24)
        .frame(width: 520)
    }

    @MainActor
    private func revealSeed() async {
        guard seedConfirmation == "REVEAL", !seedPassword.isEmpty else { return }
        revealingSeed = true
        defer { revealingSeed = false }
        do {
            let result = try await client.revealWalletSeed(password: seedPassword)
            guard let mnemonic = result["mnemonic"] as? String, !mnemonic.isEmpty else {
                throw GatewayClientError.invalidResponse
            }
            seedPassword = ""
            revealedSeed = mnemonic
            seedRevealTask?.cancel()
            seedRevealTask = Task {
                try? await Task.sleep(nanoseconds: 60_000_000_000)
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    revealedSeed = ""
                    seedConfirmation = ""
                    seedRevealTask = nil
                }
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func clearRevealedSeed() {
        seedRevealTask?.cancel()
        seedRevealTask = nil
        seedPassword = ""
        seedConfirmation = ""
        revealedSeed = ""
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

    @MainActor
    private func submitSend() async {
        guard sendReady, !sendingWallet else { return }
        sendingWallet = true
        sendError = nil
        defer { sendingWallet = false }
        do {
            let trimmedTo = sendTo.trimmingCharacters(in: .whitespacesAndNewlines)
            let trimmedAmount = sendAmount.trimmingCharacters(in: .whitespacesAndNewlines)
            let trimmedMemo = sendMemo.trimmingCharacters(in: .whitespacesAndNewlines)
            var payload: [String: Any] = [
                "chain": sendMode == "native" ? sendChain : tokenChain,
                "to": trimmedTo,
                "amount": trimmedAmount,
            ]
            if !trimmedMemo.isEmpty {
                payload["memo"] = trimmedMemo
            }
            if sendMode == "token" {
                let trimmedTokenAddress = tokenAddress.trimmingCharacters(in: .whitespacesAndNewlines)
                payload["tokenAddress"] = trimmedTokenAddress
                if !tokenDecimals.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    guard let decimals = Int(tokenDecimals), (0 ... 18).contains(decimals) else {
                        sendError = "Token decimals must be a whole number from 0 to 18."
                        return
                    }
                    payload["decimals"] = decimals
                }
            }
            let body = try JSONSerialization.data(withJSONObject: payload)
            let result: [String: Any]
            if sendMode == "token" {
                result = try await client.sendWalletToken(body)
            } else {
                result = try await client.sendWallet(body)
            }
            let txid = result["txid"] as? String ?? "submitted"
            let explorer = result["explorerUrl"] as? String
            if let explorer, !explorer.isEmpty {
                sendResult = "\(txid)\n\(explorer)"
            } else {
                sendResult = txid
            }
            sendTo = ""
            sendAmount = ""
            sendMemo = ""
            tokenAddress = ""
            await load()
        } catch {
            sendError = error.localizedDescription
        }
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
