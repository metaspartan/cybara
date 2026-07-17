import SwiftUI

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
