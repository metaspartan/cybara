import Foundation

struct ProviderPlanRouteConstraint: Decodable, Hashable {
    let monitored: Bool
    let configured: Bool
    let enforced: Bool
    let status: String
    let reason: String?
    let primaryRemainingPercent: Double?

    private enum CodingKeys: String, CodingKey {
        case monitored, configured, enforced, status, reason, primaryRemainingPercent, primary_remaining_percent
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        monitored = try container.decodeFlexibleBool(forKeys: [.monitored]) ?? false
        configured = try container.decodeFlexibleBool(forKeys: [.configured]) ?? false
        enforced = try container.decodeFlexibleBool(forKeys: [.enforced]) ?? false
        status = try container.decodeFlexibleString(forKeys: [.status]) ?? "unconfigured"
        reason = try container.decodeFlexibleString(forKeys: [.reason])
        primaryRemainingPercent = try container.decodeFlexibleDouble(
            forKeys: [.primaryRemainingPercent, .primary_remaining_percent]
        )
    }
}

struct RouterAvailabilityStatus: Decodable, Identifiable, Hashable {
    let providerId: String
    let weight: Int
    let priority: Int
    let enabled: Bool
    let available: Bool
    let reason: String?
    let requestsIn5hWindow: Int
    let requestsInWeekWindow: Int
    let spendToday: Double
    let spendThisWeek: Double
    let plan: ProviderPlanRouteConstraint?

    var id: String { providerId }

    private enum CodingKeys: String, CodingKey {
        case providerId, provider_id, weight, priority, enabled, available, reason
        case requestsIn5hWindow, requests_in_5h_window, requestsInWeekWindow, requests_in_week_window
        case spendToday, spend_today, spendThisWeek, spend_this_week, plan
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        providerId = try container.decodeFlexibleString(forKeys: [.providerId, .provider_id]) ?? "provider"
        weight = try container.decodeFlexibleInt(forKeys: [.weight]) ?? 0
        priority = try container.decodeFlexibleInt(forKeys: [.priority]) ?? 0
        enabled = try container.decodeFlexibleBool(forKeys: [.enabled]) ?? true
        available = try container.decodeFlexibleBool(forKeys: [.available]) ?? false
        reason = try container.decodeFlexibleString(forKeys: [.reason])
        requestsIn5hWindow = try container.decodeFlexibleInt(
            forKeys: [.requestsIn5hWindow, .requests_in_5h_window]
        ) ?? 0
        requestsInWeekWindow = try container.decodeFlexibleInt(
            forKeys: [.requestsInWeekWindow, .requests_in_week_window]
        ) ?? 0
        spendToday = try container.decodeFlexibleDouble(forKeys: [.spendToday, .spend_today]) ?? 0
        spendThisWeek = try container.decodeFlexibleDouble(forKeys: [.spendThisWeek, .spend_this_week]) ?? 0
        plan = try? container.decodeIfPresent(ProviderPlanRouteConstraint.self, forKey: .plan)
    }
}

struct RouterStatusSummary: Decodable {
    let enabled: Bool?
    let strategy: String?
    let globalSpendToday: Double?
    let globalSpendLimitDaily: Double?
    let routes: [RouterAvailabilityStatus]
    let totalRequests: Int?

    private enum CodingKeys: String, CodingKey {
        case enabled, strategy, globalSpendToday, global_spend_today
        case globalSpendLimitDaily, global_spend_limit_daily, routes, totalRequests, total_requests
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        enabled = try container.decodeFlexibleBool(forKeys: [.enabled])
        strategy = try container.decodeFlexibleString(forKeys: [.strategy])
        globalSpendToday = try container.decodeFlexibleDouble(forKeys: [.globalSpendToday, .global_spend_today])
        globalSpendLimitDaily = try container.decodeFlexibleDouble(
            forKeys: [.globalSpendLimitDaily, .global_spend_limit_daily]
        )
        routes = (try? container.decodeIfPresent([RouterAvailabilityStatus].self, forKey: .routes)) ?? []
        totalRequests = try container.decodeFlexibleInt(forKeys: [.totalRequests, .total_requests])
    }
}

struct ProviderPlanUsageWindow: Decodable, Identifiable, Hashable {
    let id: String
    let title: String
    let kind: String
    let usedTokens: Int
    let tokenLimit: Double?
    let usedSpend: Double
    let spendLimit: Double?
    let usedPercent: Double?
    let remainingPercent: Double?
    let resetsAt: String?
    let resetDescription: String
    let usageKnown: Bool
    let unlimited: Bool

    private enum CodingKeys: String, CodingKey {
        case id, title, kind, usedTokens, used_tokens, tokenLimit, token_limit, usedSpend, used_spend
        case spendLimit, spend_limit, usedPercent, used_percent, remainingPercent, remaining_percent
        case resetsAt, resets_at, resetDescription, reset_description, usageKnown, usage_known
        case unlimited
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeFlexibleString(forKeys: [.id]) ?? UUID().uuidString
        title = try container.decodeFlexibleString(forKeys: [.title]) ?? "Plan window"
        kind = try container.decodeFlexibleString(forKeys: [.kind]) ?? "billing_month"
        usedTokens = try container.decodeFlexibleInt(forKeys: [.usedTokens, .used_tokens]) ?? 0
        tokenLimit = try container.decodeFlexibleDouble(forKeys: [.tokenLimit, .token_limit])
        usedSpend = try container.decodeFlexibleDouble(forKeys: [.usedSpend, .used_spend]) ?? 0
        spendLimit = try container.decodeFlexibleDouble(forKeys: [.spendLimit, .spend_limit])
        usedPercent = try container.decodeFlexibleDouble(forKeys: [.usedPercent, .used_percent])
        remainingPercent = try container.decodeFlexibleDouble(forKeys: [.remainingPercent, .remaining_percent])
        resetsAt = try container.decodeFlexibleString(forKeys: [.resetsAt, .resets_at])
        resetDescription = try container.decodeFlexibleString(
            forKeys: [.resetDescription, .reset_description]
        ) ?? ""
        usageKnown = try container.decodeFlexibleBool(forKeys: [.usageKnown, .usage_known]) ?? true
        unlimited = try container.decodeFlexibleBool(forKeys: [.unlimited]) ?? false
    }
}

struct ProviderPlanPresetSuggestion: Decodable, Identifiable, Hashable {
    let id: String
    let label: String
    let planName: String
    let description: String
    let confidence: String
    let sourceMode: String
    let sourceUrl: String?
    let limitDescription: String
    let monthlyTokenLimit: Double?
    let monthlySpendLimit: Double?
    let weeklyTokenLimit: Double?
    let fiveHourTokenLimit: Double?
    let routeLimit5h: Double?
    let routeLimitWeekly: Double?
    let externalSourceEnabled: Bool

    private enum CodingKeys: String, CodingKey {
        case id, label, planName, plan_name, description, confidence, sourceMode, source_mode
        case sourceUrl, source_url, limitDescription, limit_description
        case monthlyTokenLimit, monthly_token_limit, monthlySpendLimit, monthly_spend_limit
        case weeklyTokenLimit, weekly_token_limit, fiveHourTokenLimit, five_hour_token_limit
        case routeLimit5h, route_limit_5h, routeLimitWeekly, route_limit_weekly
        case externalSourceEnabled, external_source_enabled
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeFlexibleString(forKeys: [.id]) ?? UUID().uuidString
        label = try container.decodeFlexibleString(forKeys: [.label]) ?? "Provider plan"
        planName = try container.decodeFlexibleString(forKeys: [.planName, .plan_name]) ?? label
        description = try container.decodeFlexibleString(forKeys: [.description]) ?? ""
        confidence = try container.decodeFlexibleString(forKeys: [.confidence]) ?? "estimated"
        sourceMode = try container.decodeFlexibleString(forKeys: [.sourceMode, .source_mode]) ?? "local"
        sourceUrl = try container.decodeFlexibleString(forKeys: [.sourceUrl, .source_url])
        limitDescription = try container.decodeFlexibleString(
            forKeys: [.limitDescription, .limit_description]
        ) ?? ""
        monthlyTokenLimit = try container.decodeFlexibleDouble(forKeys: [.monthlyTokenLimit, .monthly_token_limit])
        monthlySpendLimit = try container.decodeFlexibleDouble(forKeys: [.monthlySpendLimit, .monthly_spend_limit])
        weeklyTokenLimit = try container.decodeFlexibleDouble(forKeys: [.weeklyTokenLimit, .weekly_token_limit])
        fiveHourTokenLimit = try container.decodeFlexibleDouble(forKeys: [.fiveHourTokenLimit, .five_hour_token_limit])
        routeLimit5h = try container.decodeFlexibleDouble(forKeys: [.routeLimit5h, .route_limit_5h])
        routeLimitWeekly = try container.decodeFlexibleDouble(forKeys: [.routeLimitWeekly, .route_limit_weekly])
        externalSourceEnabled = try container.decodeFlexibleBool(
            forKeys: [.externalSourceEnabled, .external_source_enabled]
        ) ?? false
    }
}

struct ProviderPlanSnapshot: Decodable, Identifiable, Hashable {
    let providerId: String
    let configuredProviderId: String?
    let providerType: String
    let providerName: String
    let authType: String
    let monitored: Bool
    let managedAutomatically: Bool
    let manualPlanEditable: Bool
    let automaticTrackingLabel: String?
    let appliedPresetId: String?
    let planName: String?
    let source: String?
    let sourceMode: String?
    let sourceLabel: String?
    let sourceDescription: String?
    let externalSourceAvailable: Bool
    let externalSourceMode: String?
    let externalSourceLabel: String?
    let externalSourceHint: String?
    let status: String
    let reason: String?
    let warningThresholdPct: Double?
    let hardStopPct: Double?
    let dataConfidence: String?
    let updatedAt: String?
    let localTokens30d: Int
    let localSpend30d: Double
    let windows: [ProviderPlanUsageWindow]
    let presetSuggestions: [ProviderPlanPresetSuggestion]

    var id: String { providerId }

    private enum CodingKeys: String, CodingKey {
        case providerId, provider_id, configuredProviderId, configured_provider_id
        case providerType, provider_type, providerName, provider_name, authType, auth_type
        case monitored, managedAutomatically, managed_automatically, manualPlanEditable, manual_plan_editable
        case automaticTrackingLabel, automatic_tracking_label, appliedPresetId, applied_preset_id
        case planName, plan_name, source, status, reason
        case sourceMode, source_mode, sourceLabel, source_label, sourceDescription, source_description
        case externalSourceAvailable, external_source_available, externalSourceMode, external_source_mode
        case externalSourceLabel, external_source_label, externalSourceHint, external_source_hint
        case warningThresholdPct, warning_threshold_pct, hardStopPct, hard_stop_pct
        case dataConfidence, data_confidence, updatedAt, updated_at
        case localTokens30d, local_tokens_30d, localSpend30d, local_spend_30d, windows
        case presetSuggestions, preset_suggestions
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        providerId = try container.decodeFlexibleString(forKeys: [.providerId, .provider_id]) ?? "provider"
        configuredProviderId = try container.decodeFlexibleString(
            forKeys: [.configuredProviderId, .configured_provider_id]
        )
        providerType = try container.decodeFlexibleString(forKeys: [.providerType, .provider_type]) ?? providerId
        providerName = try container.decodeFlexibleString(forKeys: [.providerName, .provider_name]) ?? providerId
        authType = try container.decodeFlexibleString(forKeys: [.authType, .auth_type]) ?? "unknown"
        monitored = try container.decodeFlexibleBool(forKeys: [.monitored]) ?? false
        managedAutomatically = try container.decodeFlexibleBool(
            forKeys: [.managedAutomatically, .managed_automatically]
        ) ?? false
        manualPlanEditable = try container.decodeFlexibleBool(
            forKeys: [.manualPlanEditable, .manual_plan_editable]
        ) ?? true
        automaticTrackingLabel = try container.decodeFlexibleString(
            forKeys: [.automaticTrackingLabel, .automatic_tracking_label]
        )
        appliedPresetId = try container.decodeFlexibleString(forKeys: [.appliedPresetId, .applied_preset_id])
        planName = try container.decodeFlexibleString(forKeys: [.planName, .plan_name])
        source = try container.decodeFlexibleString(forKeys: [.source])
        sourceMode = try container.decodeFlexibleString(forKeys: [.sourceMode, .source_mode])
        sourceLabel = try container.decodeFlexibleString(forKeys: [.sourceLabel, .source_label])
        sourceDescription = try container.decodeFlexibleString(forKeys: [.sourceDescription, .source_description])
        externalSourceAvailable = try container.decodeFlexibleBool(
            forKeys: [.externalSourceAvailable, .external_source_available]
        ) ?? false
        externalSourceMode = try container.decodeFlexibleString(forKeys: [.externalSourceMode, .external_source_mode])
        externalSourceLabel = try container.decodeFlexibleString(forKeys: [.externalSourceLabel, .external_source_label])
        externalSourceHint = try container.decodeFlexibleString(forKeys: [.externalSourceHint, .external_source_hint])
        status = try container.decodeFlexibleString(forKeys: [.status]) ?? "unconfigured"
        reason = try container.decodeFlexibleString(forKeys: [.reason])
        warningThresholdPct = try container.decodeFlexibleDouble(
            forKeys: [.warningThresholdPct, .warning_threshold_pct]
        )
        hardStopPct = try container.decodeFlexibleDouble(forKeys: [.hardStopPct, .hard_stop_pct])
        dataConfidence = try container.decodeFlexibleString(forKeys: [.dataConfidence, .data_confidence])
        updatedAt = try container.decodeFlexibleString(forKeys: [.updatedAt, .updated_at])
        localTokens30d = try container.decodeFlexibleInt(forKeys: [.localTokens30d, .local_tokens_30d]) ?? 0
        localSpend30d = try container.decodeFlexibleDouble(forKeys: [.localSpend30d, .local_spend_30d]) ?? 0
        windows = (try? container.decodeIfPresent([ProviderPlanUsageWindow].self, forKey: .windows)) ?? []
        presetSuggestions = (try? container.decodeIfPresent(
            [ProviderPlanPresetSuggestion].self,
            forKey: .presetSuggestions
        )) ?? (try? container.decodeIfPresent([ProviderPlanPresetSuggestion].self, forKey: .preset_suggestions)) ?? []
    }
}

struct ProviderPlanStatusResponse: Decodable, Hashable {
    struct Summary: Decodable, Hashable {
        let total: Int
        let monitored: Int
        let configured: Int
        let warnings: Int
        let exhausted: Int
    }

    let enabled: Bool
    let routerEnforcement: Bool
    let warningThresholdPct: Double
    let providers: [ProviderPlanSnapshot]
    let summary: Summary

    private enum CodingKeys: String, CodingKey {
        case enabled, routerEnforcement, router_enforcement, warningThresholdPct, warning_threshold_pct
        case providers, summary
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        enabled = try container.decodeFlexibleBool(forKeys: [.enabled]) ?? true
        routerEnforcement = try container.decodeFlexibleBool(
            forKeys: [.routerEnforcement, .router_enforcement]
        ) ?? true
        warningThresholdPct = try container.decodeFlexibleDouble(
            forKeys: [.warningThresholdPct, .warning_threshold_pct]
        ) ?? 80
        providers = (try? container.decodeIfPresent([ProviderPlanSnapshot].self, forKey: .providers)) ?? []
        summary = (try? container.decodeIfPresent(Summary.self, forKey: .summary))
            ?? Summary(total: 0, monitored: 0, configured: 0, warnings: 0, exhausted: 0)
    }
}
