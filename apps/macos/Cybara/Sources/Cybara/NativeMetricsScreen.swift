import SwiftUI

struct MetricsScreen: View {
    let client: GatewayClient
    @Environment(\.cybaraAccent) private var accentTint

    @State private var snapshot: NativeMetricsSnapshot?
    @State private var loaded = false
    @State private var loading = false
    @State private var error: String?
    @State private var lastUpdated: Date?

    private let summaryColumns = [
        GridItem(.adaptive(minimum: 172, maximum: 260), spacing: 12, alignment: .top),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .center) {
                    ScreenHeader(
                        title: "Metrics",
                        subtitle: "Token usage, storage, tools, providers, and model activity"
                    )
                    Spacer()
                    VStack(alignment: .trailing, spacing: 6) {
                        if let lastUpdated {
                            Text("Updated \(lastUpdated.formatted(date: .omitted, time: .shortened))")
                                .font(.system(size: 11, weight: .medium, design: .rounded))
                                .foregroundStyle(.secondary)
                        }
                        Button {
                            Task { await load(force: true) }
                        } label: {
                            Label(loading ? "Refreshing" : "Refresh", systemImage: "arrow.clockwise")
                        }
                        .buttonStyle(.bordered)
                        .disabled(loading)
                    }
                }

                if !loaded {
                    MetricsLoadingSkeleton()
                } else if let error {
                    LoadFailedView(message: error) { Task { await load(force: true) } }
                } else if let snapshot {
                    metricsContent(snapshot)
                }
            }
            .padding(24)
        }
        .task {
            if !loaded {
                await load()
            }
        }
    }

    @ViewBuilder
    private func metricsContent(_ snapshot: NativeMetricsSnapshot) -> some View {
        LazyVGrid(columns: summaryColumns, spacing: 12) {
            MetricsSummaryTile(
                label: "Total Tokens",
                value: metricsFormatCount(snapshot.totalTokens),
                detail: "In \(metricsFormatCount(snapshot.inputTokens)) / out \(metricsFormatCount(snapshot.outputTokens))",
                systemImage: "cpu",
                tint: .blue
            )
            MetricsSummaryTile(
                label: "API Success",
                value: metricsFormatPercent(snapshot.apiSuccessRate),
                detail: "\(metricsFormatCount(snapshot.successfulAPICalls)) ok / \(metricsFormatCount(snapshot.failedAPICalls)) failed",
                systemImage: "checkmark.seal",
                tint: .green
            )
            MetricsSummaryTile(
                label: "Files",
                value: metricsFormatCount(snapshot.totalFiles),
                detail: "\(metricsFormatCount(snapshot.filesRead)) read / \(metricsFormatCount(snapshot.filesEdited)) edited",
                systemImage: "doc.text",
                tint: .orange
            )
            MetricsSummaryTile(
                label: "Messages",
                value: metricsFormatCount(snapshot.totalMessages),
                detail: "\(metricsFormatCount(snapshot.avgTokensPerMessage)) tokens/message",
                systemImage: "bubble.left.and.bubble.right",
                tint: .mint
            )
            MetricsSummaryTile(
                label: "Storage",
                value: metricsFormatBytes(snapshot.storage?.totalBytes),
                detail: "\(snapshot.storageCategoryEntries.count) active categories",
                systemImage: "internaldrive",
                tint: .cyan
            )
        }

        MetricsInsightStrip(snapshot: snapshot, accent: accentTint)

        MetricsResponsiveColumns {
            MetricsPanel(
                title: "30-Day Activity",
                subtitle: "Daily metric volume across the gateway",
                systemImage: "chart.bar.xaxis"
            ) {
                MetricsActivityChart(days: snapshot.timeSeries?.days ?? [], tint: accentTint)
            }

            MetricsPanel(
                title: "Token Velocity",
                subtitle: "24-hour area trend for recent model usage",
                systemImage: "chart.line.uptrend.xyaxis"
            ) {
                MetricsTokenVelocityArea(points: snapshot.tokenAnalysis?.hourlyVelocity24h ?? [], tint: .cyan)
            }

            MetricsPanel(
                title: "Token Heatmap",
                subtitle: "Recent intensity by day and hour",
                systemImage: "square.grid.3x3"
            ) {
                if let heatmap = snapshot.tokenAnalysis?.tokenHeatmap, !heatmap.days.isEmpty {
                    MetricsHeatmapChart(heatmap: heatmap, tint: .cyan)
                    if let hottest = heatmap.hottestHour, let tokens = hottest.tokens {
                        MetricsCallout(
                            title: "Hottest window",
                            value: "\(hottest.dayLabel ?? "Day") \(String(format: "%02d", hottest.hour ?? 0)):00",
                            detail: "\(metricsFormatCount(tokens)) tokens / \(metricsFormatCount(hottest.calls)) calls"
                        )
                    }
                } else {
                    MetricsEmptyState("No heatmap data yet")
                }
            }

            MetricsPanel(
                title: "Token Usage",
                subtitle: "Input, output, cache, and top routes",
                systemImage: "bolt"
            ) {
                MetricsTokenStack(
                    input: snapshot.inputTokens,
                    output: snapshot.outputTokens,
                    cache: snapshot.cacheTokens
                )
                MetricsBarList(
                    title: "By Model",
                    rows: snapshot.tokens?.topModels.prefix(6).map {
                        MetricsBarList.Row(label: $0.model, value: Double($0.tokens), valueLabel: metricsFormatCount($0.tokens))
                    } ?? [],
                    tint: .blue
                )
                MetricsBarList(
                    title: "By Provider",
                    rows: snapshot.tokens?.topProviders.prefix(6).map {
                        MetricsBarList.Row(label: $0.provider, value: Double($0.tokens), valueLabel: metricsFormatCount($0.tokens))
                    } ?? [],
                    tint: .green
                )
            }

            MetricsPanel(
                title: "Prompt vs Output",
                subtitle: "Call mix and token distribution",
                systemImage: "arrow.left.arrow.right"
            ) {
                if let summary = snapshot.tokenAnalysis?.summary {
                    HStack(spacing: 10) {
                        MetricsMiniStat(
                            label: "Input:Output",
                            value: summary.inputToOutputRatio.map { String(format: "%.2f:1", $0) } ?? "n/a",
                            tint: .green
                        )
                        MetricsMiniStat(
                            label: "Avg/Call",
                            value: metricsFormatDouble(summary.averageTokensPerCall),
                            tint: .orange
                        )
                        MetricsMiniStat(
                            label: "Median",
                            value: metricsFormatDouble(summary.medianTokensPerCall),
                            tint: .cyan
                        )
                    }
                }
                MetricsBarList(
                    title: "Distribution",
                    rows: snapshot.tokenAnalysis?.promptOutputDistribution?.bands.map {
                        MetricsBarList.Row(
                            label: $0.band.replacingOccurrences(of: "_", with: " "),
                            value: $0.sharePct,
                            valueLabel: metricsFormatPercent($0.sharePct)
                        )
                    } ?? [],
                    tint: .green
                )
            }

            MetricsPanel(
                title: "Tools",
                subtitle: "Tool call volume and reliability",
                systemImage: "terminal"
            ) {
                if let reliability = snapshot.insights?.toolReliability {
                    HStack(spacing: 10) {
                        MetricsMiniStat(
                            label: "Success",
                            value: metricsFormatPercent(reliability.successRatePct),
                            tint: .green
                        )
                        MetricsMiniStat(
                            label: "Calls",
                            value: metricsFormatCount(reliability.totalCalls),
                            tint: .cyan
                        )
                        MetricsMiniStat(
                            label: "Errors",
                            value: metricsFormatCount(reliability.totalErrors),
                            tint: .red
                        )
                    }
                }
                MetricsBarList(
                    title: "Most Used",
                    rows: snapshot.tools?.mostUsed.prefix(8).map {
                        MetricsBarList.Row(label: $0.tool, value: Double($0.calls), valueLabel: metricsFormatCount($0.calls))
                    } ?? [],
                    tint: .cyan
                )
                MetricsBarList(
                    title: "Most Errors",
                    rows: snapshot.tools?.mostErrors.prefix(5).map {
                        MetricsBarList.Row(label: $0.tool, value: Double($0.errors), valueLabel: metricsFormatCount($0.errors))
                    } ?? [],
                    tint: .red
                )
            }

            MetricsPanel(
                title: "Files",
                subtitle: "Read, write, edit, and search activity",
                systemImage: "doc.on.doc"
            ) {
                HStack(spacing: 10) {
                    MetricsMiniStat(label: "Read", value: metricsFormatCount(snapshot.filesRead), tint: .blue)
                    MetricsMiniStat(label: "Written", value: metricsFormatCount(snapshot.filesWritten), tint: .orange)
                    MetricsMiniStat(label: "Edited", value: metricsFormatCount(snapshot.filesEdited), tint: .purple)
                    MetricsMiniStat(label: "Searched", value: metricsFormatCount(snapshot.filesSearched), tint: .cyan)
                }
                MetricsPathList(title: "Most Read", rows: Array(snapshot.files?.mostRead.prefix(5) ?? []), tint: .blue)
                MetricsPathList(title: "Most Written", rows: Array(snapshot.files?.mostWritten.prefix(5) ?? []), tint: .orange)
                MetricsPathList(title: "Most Edited", rows: Array(snapshot.files?.mostEdited.prefix(5) ?? []), tint: .purple)
            }
        } right: {
            MetricsPanel(
                title: "Providers",
                subtitle: "Tokens, hits, and provider balance",
                systemImage: "network"
            ) {
                MetricsBarList(
                    title: "Provider Efficiency",
                    rows: snapshot.insights?.providerEfficiency.prefix(6).map {
                        MetricsBarList.Row(
                            label: $0.provider,
                            value: $0.tokensPerCall,
                            valueLabel: "\(metricsFormatDouble($0.tokensPerCall)) tok/call"
                        )
                    } ?? [],
                    tint: .green
                )
                ForEach(Array(snapshot.providers?.providers.prefix(5) ?? []), id: \.id) { provider in
                    MetricsProviderRow(provider: provider)
                }
                if snapshot.providers?.providers.isEmpty != false {
                    MetricsEmptyState("No provider metrics yet")
                }
            }

            MetricsPanel(
                title: "Provider Plans",
                subtitle: "Plan limits, billing source coverage, and local usage",
                systemImage: "creditcard"
            ) {
                HStack(spacing: 10) {
                    MetricsMiniStat(
                        label: "Configured",
                        value: metricsFormatCount(snapshot.providerPlans?.summary.configured),
                        tint: .green
                    )
                    MetricsMiniStat(
                        label: "Warnings",
                        value: metricsFormatCount(snapshot.providerPlans?.summary.warnings),
                        tint: .orange
                    )
                    MetricsMiniStat(
                        label: "Stopped",
                        value: metricsFormatCount(snapshot.providerPlans?.summary.exhausted),
                        tint: .red
                    )
                }
                MetricsPlanWindowList(rows: snapshot.providerPlanRows)
            }

            MetricsPanel(
                title: "Model Performance",
                subtitle: "Throughput, latency, and token share",
                systemImage: "gauge.with.dots.needle.50percent"
            ) {
                let models = snapshot.modelMetrics?.models.isEmpty == false
                    ? snapshot.modelMetrics?.models ?? []
                    : snapshot.insights?.modelInsights.map {
                        MetricModelPerformance(
                            model: $0.model,
                            provider: $0.provider,
                            avgTps: $0.avgTps,
                            maxTps: $0.maxTps,
                            minTps: $0.minTps,
                            avgLatencyMs: $0.avgLatencyMs,
                            totalTokens: $0.totalTokens,
                            callCount: $0.callCount
                        )
                    } ?? []
                MetricsModelPerformanceList(models: Array(models.prefix(8)), tint: .mint)
            }

            MetricsPanel(
                title: "Cybara Signal",
                subtitle: "Autonomy, context, and model behavior",
                systemImage: "waveform.path.ecg"
            ) {
                HStack(spacing: 10) {
                    MetricsMiniStat(
                        label: "Tools/Msg",
                        value: String(format: "%.2f", snapshot.toolsPerMessage),
                        tint: .cyan
                    )
                    MetricsMiniStat(
                        label: "Memory Share",
                        value: metricsFormatPercent(snapshot.memoryToolSharePct),
                        tint: .green
                    )
                    MetricsMiniStat(
                        label: "Warnings",
                        value: metricsFormatCount(snapshot.contextWarnings24h),
                        tint: snapshot.contextCriticalWarnings24h > 0 ? .red : .orange
                    )
                }
                if let behavior = snapshot.dominantThinkingStyle {
                    MetricsCallout(title: "Dominant thinking style", value: behavior, detail: "Based on token analysis profiles")
                }
                if let burst = snapshot.tokenAnalysis?.topTokenBursts.first {
                    MetricsCallout(
                        title: "Top token burst",
                        value: "\(metricsFormatCount(burst.totalTokens)) tokens",
                        detail: "\(burst.model) / \(burst.provider)"
                    )
                }
                MetricsTokenCloud(entries: Array(snapshot.tokenAnalysis?.tokenCloud.prefix(18) ?? []))
            }

            MetricsPanel(
                title: "Storage Footprint",
                subtitle: "Local Cybara data and runtime files",
                systemImage: "externaldrive"
            ) {
                if let storage = snapshot.storage {
                    MetricsCallout(
                        title: "Total local storage",
                        value: metricsFormatBytes(storage.totalBytes),
                        detail: storage.directories?.cybaraDir ?? "Cybara data directory"
                    )
                    MetricsStorageList(entries: snapshot.storageCategoryEntries, totalBytes: storage.totalBytes)
                    MetricsPathSizeList(entries: Array((storage.topLevel ?? []).prefix(8)), totalBytes: storage.totalBytes)
                } else {
                    MetricsEmptyState("No storage metrics available")
                }
            }
        }
    }

    private func load(force: Bool = false) async {
        guard !loading || force else { return }
        loading = true
        defer {
            loaded = true
            loading = false
        }
        do {
            async let overviewFetch = client.metricsOverview()
            async let tokensFetch: TokenMetrics? = loadOptional { try await client.metricsTokens() }
            async let tokenAnalysisFetch: TokenAnalysisMetrics? = loadOptional { try await client.metricsTokenAnalysis() }
            async let filesFetch: FileMetrics? = loadOptional { try await client.metricsFiles() }
            async let toolsFetch: ToolMetrics? = loadOptional { try await client.metricsTools() }
            async let timeSeriesFetch: TimeSeriesData? = loadOptional { try await client.metricsTimeSeries() }
            async let storageFetch: MetricsStorage? = loadOptional { try await client.metricsStorage() }
            async let providersFetch: ProviderMetrics? = loadOptional { try await client.metricsProviders() }
            async let modelsFetch: ModelMetrics? = loadOptional { try await client.metricsModels() }
            async let insightsFetch: MetricsInsights? = loadOptional { try await client.metricsInsights() }
            async let providerPlansFetch: ProviderPlanStatusResponse? = loadOptional {
                try await client.providerPlanStatus()
            }
            let overview = try await overviewFetch

            snapshot = NativeMetricsSnapshot(
                overview: overview,
                tokens: await tokensFetch,
                tokenAnalysis: await tokenAnalysisFetch,
                files: await filesFetch,
                tools: await toolsFetch,
                timeSeries: await timeSeriesFetch,
                storage: await storageFetch,
                providers: await providersFetch,
                modelMetrics: await modelsFetch,
                insights: await insightsFetch,
                providerPlans: await providerPlansFetch
            )
            lastUpdated = Date()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func loadOptional<T>(_ operation: () async throws -> T) async -> T? {
        try? await operation()
    }
}

private struct NativeMetricsSnapshot {
    let overview: MetricsOverview
    let tokens: TokenMetrics?
    let tokenAnalysis: TokenAnalysisMetrics?
    let files: FileMetrics?
    let tools: ToolMetrics?
    let timeSeries: TimeSeriesData?
    let storage: MetricsStorage?
    let providers: ProviderMetrics?
    let modelMetrics: ModelMetrics?
    let insights: MetricsInsights?
    let providerPlans: ProviderPlanStatusResponse?

    var totalTokens: Int { overview.tokenUsage?.total ?? 0 }
    var inputTokens: Int { overview.tokenUsage?.input ?? 0 }
    var outputTokens: Int { overview.tokenUsage?.output ?? 0 }
    var cacheTokens: Int { overview.tokenUsage?.cache ?? 0 }
    var filesRead: Int { overview.fileOperations?.filesRead ?? 0 }
    var filesWritten: Int { overview.fileOperations?.filesWritten ?? 0 }
    var filesEdited: Int { overview.fileOperations?.filesEdited ?? 0 }
    var filesSearched: Int { overview.fileOperations?.filesSearched ?? 0 }
    var totalFiles: Int { filesRead + filesWritten + filesEdited + filesSearched }
    var totalMessages: Int { overview.agentActivity?.totalMessages ?? 0 }
    var avgTokensPerMessage: Int { totalMessages > 0 ? totalTokens / totalMessages : 0 }
    var successfulAPICalls: Int { overview.apiCalls?.successfulCalls ?? 0 }
    var failedAPICalls: Int { overview.apiCalls?.failedCalls ?? 0 }
    var apiSuccessRate: Double { overview.apiCalls?.successRate ?? 0 }
    var toolCalls: Int { overview.toolCalls?.totalCalls ?? 0 }

    var toolsPerMessage: Double {
        guard totalMessages > 0 else { return 0 }
        return Double(toolCalls) / Double(totalMessages)
    }

    var memoryToolSharePct: Double {
        let memoryCalls = tools?.mostUsed
            .filter { $0.tool.hasPrefix("memory_") || $0.tool.localizedCaseInsensitiveContains("memory") }
            .reduce(0) { $0 + $1.calls } ?? 0
        guard toolCalls > 0 else { return 0 }
        return Double(memoryCalls) / Double(toolCalls) * 100
    }

    var contextWarnings24h: Int {
        insights?.contextHealth24h?.warnings ?? overview.contextHealth?.warnings ?? 0
    }

    var contextCriticalWarnings24h: Int {
        insights?.contextHealth24h?.criticalWarnings ?? overview.contextHealth?.criticalWarnings ?? 0
    }

    var dominantThinkingStyle: String? {
        let grouped = Dictionary(grouping: tokenAnalysis?.modelThoughtProfiles ?? [], by: \.behavior)
            .mapValues { profiles in profiles.reduce(0) { $0 + $1.totalTokens } }
        return grouped.max(by: { $0.value < $1.value })?.key
    }

    var storageCategoryEntries: [NativeStorageCategoryEntry] {
        guard let components = storage?.components else { return [] }
        let entries: [NativeStorageCategoryEntry] = [
            NativeStorageCategoryEntry(label: "Data", component: components.data),
            NativeStorageCategoryEntry(label: "Sessions", component: components.sessions),
            NativeStorageCategoryEntry(label: "Media", component: components.media),
            NativeStorageCategoryEntry(label: "Channels", component: components.channels),
            NativeStorageCategoryEntry(label: "Artifacts", component: components.artifacts),
            NativeStorageCategoryEntry(label: "Logs", component: components.logs),
            NativeStorageCategoryEntry(label: "Memory", component: components.memory),
            NativeStorageCategoryEntry(label: "Skills", component: components.skills),
            NativeStorageCategoryEntry(label: "Secure", component: components.secure),
            NativeStorageCategoryEntry(label: "Database", component: components.database),
            NativeStorageCategoryEntry(label: "Other", component: components.other),
        ]
        return entries
            .filter { $0.bytes > 0 }
            .sorted { $0.bytes > $1.bytes }
    }

    var providerPlanRows: [NativeProviderPlanWindowRow] {
        Array(
            (providerPlans?.providers ?? [])
                .filter { $0.monitored || !$0.windows.isEmpty || $0.externalSourceAvailable }
                .flatMap { plan in
                    [
                        ("5h", "rolling_5h"),
                        ("Weekly", "rolling_week"),
                    ].compactMap { label, kind -> NativeProviderPlanWindowRow? in
                        guard let usage = nativeProviderPlanWindowMetric(plan: plan, kind: kind) else {
                            return nil
                        }
                        return NativeProviderPlanWindowRow(
                            id: "\(plan.providerId)-\(kind)",
                            providerName: plan.providerName,
                            windowLabel: label,
                            planName: plan.planName ?? plan.automaticTrackingLabel ?? plan.status,
                            valueLabel: usage.valueLabel,
                            resetText: usage.resetText,
                            sourceLabel: plan.sourceLabel ?? plan.externalSourceLabel ?? plan.automaticTrackingLabel,
                            status: plan.status,
                            progress: usage.progress,
                            tint: nativeProviderPlanUsageTint(
                                progress: usage.progress,
                                unlimited: usage.unlimited
                            ),
                            unlimited: usage.unlimited
                        )
                    }
                }
                .prefix(12)
        )
    }
}

private struct NativeProviderPlanWindowRow: Identifiable {
    let id: String
    let providerName: String
    let windowLabel: String
    let planName: String
    let valueLabel: String
    let resetText: String?
    let sourceLabel: String?
    let status: String
    let progress: Double
    let tint: Color
    let unlimited: Bool
}

private struct NativeProviderPlanWindowMetric {
    let progress: Double
    let valueLabel: String
    let resetText: String?
    let unlimited: Bool
}

private func nativeProviderPlanWindowMetric(
    plan: ProviderPlanSnapshot,
    kind: String
) -> NativeProviderPlanWindowMetric? {
    guard plan.managedAutomatically else { return nil }
    guard let window = plan.windows.first(where: {
        $0.kind == kind && $0.usageKnown && ($0.unlimited || $0.usedPercent != nil)
    }) else {
        return nil
    }
    if window.unlimited {
        return NativeProviderPlanWindowMetric(
            progress: 100,
            valueLabel: "∞",
            resetText: nativeProviderPlanMetricResetText(window.resetsAt),
            unlimited: true
        )
    }
    let progress = min(100, max(0, ceil(window.usedPercent ?? 0)))
    return NativeProviderPlanWindowMetric(
        progress: progress,
        valueLabel: "\(Int(progress))%",
        resetText: nativeProviderPlanMetricResetText(window.resetsAt),
        unlimited: false
    )
}

private func nativeProviderPlanUsageTint(progress: Double, unlimited: Bool) -> Color {
    if unlimited || progress < 40 { return .green }
    if progress < 65 { return .blue }
    if progress < 80 { return .yellow }
    if progress < 95 { return .orange }
    return .red
}

private func nativeProviderPlanMetricResetText(_ resetsAt: String?) -> String? {
    guard let resetsAt else { return nil }
    let fractionalFormatter = ISO8601DateFormatter()
    fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let date = fractionalFormatter.date(from: resetsAt) ?? ISO8601DateFormatter().date(from: resetsAt)
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

private struct NativeStorageCategoryEntry: Identifiable, Hashable {
    let label: String
    let bytes: Int
    let path: String

    var id: String { label }

    init(label: String, component: MetricStorageComponent?) {
        self.label = label
        bytes = component?.bytes ?? 0
        path = component?.path ?? ""
    }
}

private struct MetricsResponsiveColumns<Left: View, Right: View>: View {
    let left: Left
    let right: Right

    init(@ViewBuilder left: () -> Left, @ViewBuilder right: () -> Right) {
        self.left = left()
        self.right = right()
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 16) {
                    left
                }
                .frame(maxWidth: .infinity, alignment: .topLeading)

                VStack(alignment: .leading, spacing: 16) {
                    right
                }
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }

            VStack(alignment: .leading, spacing: 16) {
                left
                right
            }
        }
    }
}

private struct MetricsLoadingSkeleton: View {
    private let columns = [
        GridItem(.adaptive(minimum: 172, maximum: 260), spacing: 12, alignment: .top),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            LazyVGrid(columns: columns, spacing: 12) {
                ForEach(0..<5, id: \.self) { _ in
                    MetricsSkeletonBlock(height: 116)
                }
            }
            MetricsResponsiveColumns {
                ForEach(0..<3, id: \.self) { _ in
                    MetricsSkeletonBlock(height: 238)
                }
            } right: {
                ForEach(0..<3, id: \.self) { _ in
                    MetricsSkeletonBlock(height: 214)
                }
            }
        }
        .redacted(reason: .placeholder)
        .allowsHitTesting(false)
    }
}

private struct MetricsSkeletonBlock: View {
    let height: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(Color.primary.opacity(0.14))
                .frame(width: 128, height: 12)
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.primary.opacity(0.10))
                .frame(maxWidth: .infinity, minHeight: max(42, height - 58), maxHeight: max(42, height - 58))
            RoundedRectangle(cornerRadius: 5, style: .continuous)
                .fill(Color.primary.opacity(0.08))
                .frame(width: 190, height: 9)
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: height, alignment: .leading)
        .cybaraGlass(cornerRadius: 18)
    }
}

private struct MetricsInsightStrip: View {
    let snapshot: NativeMetricsSnapshot
    let accent: Color

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                insightCards
            }
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 190), spacing: 12, alignment: .top)],
                spacing: 12
            ) {
                insightCards
            }
        }
    }

    @ViewBuilder
    private var insightCards: some View {
        MetricsInsightCard(
            title: "Current Pace",
            value: metricsFormatCount(snapshot.tokenAnalysis?.summary?.averageTokensPerCall.map(Int.init) ?? snapshot.avgTokensPerMessage),
            detail: "avg tokens per model call",
            systemImage: "speedometer",
            tint: accent
        )
        MetricsInsightCard(
            title: "Reliability",
            value: metricsFormatPercent(snapshot.insights?.toolReliability?.successRatePct ?? snapshot.apiSuccessRate),
            detail: "tool/API success signal",
            systemImage: "checkmark.seal",
            tint: .green
        )
        MetricsInsightCard(
            title: "Context Health",
            value: metricsFormatCount(snapshot.contextWarnings24h),
            detail: "\(metricsFormatCount(snapshot.contextCriticalWarnings24h)) critical warnings",
            systemImage: "circle.dashed.inset.filled",
            tint: snapshot.contextCriticalWarnings24h > 0 ? .red : .orange
        )
        MetricsInsightCard(
            title: "Plan Windows",
            value: metricsFormatCount(snapshot.providerPlanRows.count),
            detail: "automatic provider limits",
            systemImage: "creditcard",
            tint: .cyan
        )
    }
}

private struct MetricsInsightCard: View {
    let title: String
    let value: String
    let detail: String
    let systemImage: String
    let tint: Color

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 28, height: 28)
                .background(Circle().fill(tint.opacity(0.14)))
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)
                Text(value)
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
                Text(detail)
                    .font(.system(size: 10.5, design: .rounded))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            Spacer(minLength: 0)
        }
        .padding(13)
        .frame(maxWidth: .infinity, minHeight: 76, alignment: .leading)
        .cybaraGlass(cornerRadius: 16)
    }
}

private struct MetricsPanel<Content: View>: View {
    let title: String
    let subtitle: String
    let systemImage: String
    let content: Content

    init(
        title: String,
        subtitle: String,
        systemImage: String,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.subtitle = subtitle
        self.systemImage = systemImage
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: systemImage)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 28, height: 28)
                    .background(Circle().fill(Color.primary.opacity(0.07)))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                    Text(subtitle)
                        .font(.system(size: 11, design: .rounded))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .cybaraGlass(cornerRadius: 18)
    }
}

private struct MetricsSummaryTile: View {
    let label: String
    let value: String
    let detail: String
    let systemImage: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: systemImage)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 24, height: 24)
                    .background(Circle().fill(tint.opacity(0.16)))
                Text(label)
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)
            }
            Text(value)
                .font(.system(size: 26, weight: .bold, design: .rounded))
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            Text(detail)
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 116, alignment: .leading)
        .cybaraGlass(cornerRadius: 16)
    }
}

private struct MetricsMiniStat: View {
    let label: String
    let value: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Text(value)
                .font(.system(size: 17, weight: .bold, design: .rounded))
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.primary.opacity(0.055))
        )
    }
}

private struct MetricsCallout: View {
    let title: String
    let value: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
            Text(value)
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(detail)
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .truncationMode(.middle)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.primary.opacity(0.055))
        )
    }
}

private struct MetricsEmptyState: View {
    let message: String

    init(_ message: String) {
        self.message = message
    }

    var body: some View {
        Text(message)
            .font(.system(size: 12, design: .rounded))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color.primary.opacity(0.035))
            )
    }
}

private struct MetricsActivityChart: View {
    let days: [TimeSeriesDay]
    let tint: Color

    var body: some View {
        if days.isEmpty {
            MetricsEmptyState("No activity data yet")
                .frame(height: 178)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                GeometryReader { proxy in
                    let maxTotal = max(days.map(\.total).max() ?? 0, 1)
                    HStack(alignment: .bottom, spacing: 3) {
                        ForEach(days) { day in
                            let height = max(4, proxy.size.height * CGFloat(day.total / maxTotal))
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .fill(tint.opacity(0.24 + min(0.68, day.total / maxTotal * 0.68)))
                                .frame(height: height)
                                .help("\(day.date): \(metricsFormatCount(Int(day.total))) events")
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                }
                .frame(height: 150)
                HStack {
                    Text(days.first?.date ?? "")
                    Spacer()
                    Text(days.last?.date ?? "")
                }
                .font(.system(size: 10, design: .rounded))
                .foregroundStyle(.secondary)
            }
        }
    }
}

private struct MetricsTokenVelocityArea: View {
    let points: [MetricTimelinePoint]
    let tint: Color

    private var values: [(label: String, value: Int, calls: Int)] {
        points.suffix(24).map {
            (
                label: $0.hour ?? $0.timestamp ?? "",
                value: $0.tokens ?? $0.value ?? 0,
                calls: $0.calls ?? 0
            )
        }
    }

    var body: some View {
        if values.isEmpty {
            MetricsEmptyState("No token velocity data yet")
                .frame(height: 178)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                GeometryReader { proxy in
                    let maxValue = max(values.map { $0.value }.max() ?? 0, 1)
                    let width = max(proxy.size.width, 1)
                    let height = max(proxy.size.height, 1)
                    let denominator = max(values.count - 1, 1)

                    ZStack(alignment: .bottomLeading) {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Color.primary.opacity(0.035))

                        Path { path in
                            path.move(to: CGPoint(x: 0, y: height))
                            for index in values.indices {
                                let x = width * CGFloat(index) / CGFloat(denominator)
                                let y = height - (height - 10) * CGFloat(values[index].value) / CGFloat(maxValue)
                                path.addLine(to: CGPoint(x: x, y: y))
                            }
                            path.addLine(to: CGPoint(x: width, y: height))
                            path.closeSubpath()
                        }
                        .fill(
                            LinearGradient(
                                colors: [tint.opacity(0.34), tint.opacity(0.05)],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )

                        Path { path in
                            for index in values.indices {
                                let x = width * CGFloat(index) / CGFloat(denominator)
                                let y = height - (height - 10) * CGFloat(values[index].value) / CGFloat(maxValue)
                                if index == values.startIndex {
                                    path.move(to: CGPoint(x: x, y: y))
                                } else {
                                    path.addLine(to: CGPoint(x: x, y: y))
                                }
                            }
                        }
                        .stroke(tint.opacity(0.9), style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
                    }
                }
                .frame(height: 150)

                HStack {
                    Text(values.first?.label ?? "")
                    Spacer()
                    Text(values.last?.label ?? "")
                }
                .font(.system(size: 10, design: .rounded))
                .foregroundStyle(.secondary)

                if let peak = values.max(by: { $0.value < $1.value }) {
                    MetricsCallout(
                        title: "Peak hour",
                        value: "\(peak.label) / \(metricsFormatCount(peak.value)) tokens",
                        detail: "\(metricsFormatCount(peak.calls)) calls recorded"
                    )
                }
            }
        }
    }
}

private struct MetricsHeatmapChart: View {
    let heatmap: TokenAnalysisMetrics.TokenHeatmap
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            ForEach(heatmap.days.suffix(7)) { day in
                HStack(spacing: 7) {
                    Text(day.dayLabel)
                        .font(.system(size: 10, weight: .medium, design: .rounded))
                        .foregroundStyle(.secondary)
                        .frame(width: 42, alignment: .leading)
                        .lineLimit(1)
                    HStack(spacing: 2) {
                        ForEach(day.hours) { hour in
                            RoundedRectangle(cornerRadius: 2, style: .continuous)
                                .fill(tint.opacity(0.08 + min(0.82, max(0, hour.intensity) * 0.82)))
                                .frame(height: 11)
                                .help("\(day.date) \(String(format: "%02d", hour.hour)):00 - \(metricsFormatCount(hour.tokens)) tokens")
                        }
                    }
                }
            }
            HStack {
                Text("00")
                Spacer()
                Text("12")
                Spacer()
                Text("23")
            }
            .padding(.leading, 49)
            .font(.system(size: 9, design: .rounded))
            .foregroundStyle(.tertiary)
        }
    }
}

private struct MetricsTokenStack: View {
    let input: Int
    let output: Int
    let cache: Int

    private var total: Int { input + output + cache }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            GeometryReader { proxy in
                if total == 0 {
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(Color.primary.opacity(0.06))
                } else {
                    HStack(spacing: 3) {
                        tokenSegment(value: input, total: total, width: proxy.size.width, color: .blue)
                        tokenSegment(value: output, total: total, width: proxy.size.width, color: .green)
                        tokenSegment(value: cache, total: total, width: proxy.size.width, color: .purple)
                    }
                }
            }
            .frame(height: 14)
            HStack(spacing: 8) {
                tokenLegend("Input", input, .blue)
                tokenLegend("Output", output, .green)
                tokenLegend("Cache", cache, .purple)
            }
        }
    }

    private func tokenSegment(value: Int, total: Int, width: CGFloat, color: Color) -> some View {
        RoundedRectangle(cornerRadius: 5, style: .continuous)
            .fill(color.opacity(0.82))
            .frame(width: max(value > 0 ? 4 : 0, width * CGFloat(value) / CGFloat(max(total, 1))))
    }

    private func tokenLegend(_ label: String, _ value: Int, _ color: Color) -> some View {
        HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 7, height: 7)
            Text("\(label) \(metricsFormatCount(value))")
                .font(.system(size: 10, design: .rounded))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
    }
}

private struct MetricsBarList: View {
    struct Row: Identifiable, Hashable {
        let id = UUID()
        let label: String
        let value: Double
        let valueLabel: String
        let tint: Color?
        let progress: Double?

        init(
            label: String,
            value: Double,
            valueLabel: String,
            tint: Color? = nil,
            progress: Double? = nil
        ) {
            self.label = label
            self.value = value
            self.valueLabel = valueLabel
            self.tint = tint
            self.progress = progress
        }
    }

    let title: String
    let rows: [Row]
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(title)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(.secondary)
            if rows.isEmpty {
                MetricsEmptyState("No \(title.lowercased()) data yet")
            } else {
                let maxValue = max(rows.map(\.value).max() ?? 0, 1)
                ForEach(rows) { row in
                    let rowTint = row.tint ?? tint
                    let rowProgress = row.progress ?? row.value
                    let denominator = row.progress == nil ? maxValue : 100
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(row.label)
                                .font(.system(size: 12, weight: .medium, design: .rounded))
                                .lineLimit(1)
                                .truncationMode(.middle)
                            Spacer()
                            Text(row.valueLabel)
                                .font(.system(size: 11, design: .rounded))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        GeometryReader { proxy in
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .fill(Color.primary.opacity(0.06))
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .fill(rowTint.opacity(0.75))
                                .frame(
                                    width: max(
                                        4,
                                        proxy.size.width * CGFloat(rowProgress / denominator)
                                    )
                                )
                        }
                        .frame(height: 6)
                    }
                }
            }
        }
        .padding(.top, 2)
    }
}

private struct MetricsPlanWindowList: View {
    let rows: [NativeProviderPlanWindowRow]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Automatic Plan Windows")
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(.secondary)
            if rows.isEmpty {
                MetricsEmptyState("No automatic provider plan data yet")
            } else {
                ForEach(rows) { row in
                    VStack(alignment: .leading, spacing: 7) {
                        HStack(alignment: .firstTextBaseline) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(row.providerName)
                                    .font(.system(size: 12, weight: .bold, design: .rounded))
                                    .lineLimit(1)
                                HStack(spacing: 6) {
                                    Text(row.windowLabel)
                                        .font(.system(size: 10.5, weight: .semibold, design: .rounded))
                                        .foregroundStyle(row.tint)
                                    Text(row.planName)
                                        .font(.system(size: 10.5, design: .rounded))
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                Text(row.valueLabel)
                                    .font(.system(size: 14, weight: .bold, design: .rounded))
                                    .foregroundStyle(row.tint)
                                if let resetText = row.resetText {
                                    Text(resetText)
                                        .font(.system(size: 10, design: .rounded))
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        GeometryReader { proxy in
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .fill(Color.primary.opacity(0.07))
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .fill(row.tint.opacity(row.unlimited ? 0.52 : 0.78))
                                .frame(width: max(4, proxy.size.width * CGFloat(row.progress / 100)))
                        }
                        .frame(height: 7)
                        HStack(spacing: 6) {
                            Label(row.unlimited ? "Unlimited" : row.status.capitalized, systemImage: row.unlimited ? "infinity" : "gauge.with.dots.needle.50percent")
                            if let sourceLabel = row.sourceLabel, !sourceLabel.isEmpty {
                                Text(sourceLabel)
                            }
                        }
                        .font(.system(size: 10, weight: .medium, design: .rounded))
                        .foregroundStyle(.secondary)
                    }
                    .padding(11)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(Color.primary.opacity(0.045))
                    )
                }
            }
        }
        .padding(.top, 2)
    }
}

private struct MetricsPathList: View {
    let title: String
    let rows: [MetricFilePath]
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(.secondary)
            if rows.isEmpty {
                MetricsEmptyState("No \(title.lowercased()) data yet")
            } else {
                ForEach(rows) { row in
                    HStack(spacing: 8) {
                        Image(systemName: "doc.text")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(tint)
                        Text(metricsFileName(row.path))
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .help(row.path)
                        Spacer()
                        Text(metricsFormatCount(row.count))
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}

private struct MetricsProviderRow: View {
    let provider: MetricProviderSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(provider.provider)
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                    Text(provider.url ?? "URL not recorded")
                        .font(.system(size: 10, design: .rounded))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer()
                Text(metricsFormatCount(provider.tokens))
                    .font(.system(size: 14, weight: .bold, design: .rounded))
            }
            HStack {
                Text("\(metricsFormatCount(provider.hits)) API hits")
                Spacer()
                Text("tokens")
            }
            .font(.system(size: 10, design: .rounded))
            .foregroundStyle(.secondary)
        }
        .padding(11)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.primary.opacity(0.045))
        )
    }
}

private struct MetricsModelPerformanceList: View {
    let models: [MetricModelPerformance]
    let tint: Color

    var body: some View {
        if models.isEmpty {
            MetricsEmptyState("No model performance data yet")
        } else {
            let maxTps = max(models.map(\.avgTps).max() ?? 0, 1)
            VStack(alignment: .leading, spacing: 10) {
                ForEach(models) { model in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(model.model)
                                    .font(.system(size: 12, weight: .bold, design: .rounded))
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                Text(model.provider)
                                    .font(.system(size: 10, design: .rounded))
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text("\(metricsFormatDouble(model.avgTps)) tok/s")
                                .font(.system(size: 12, weight: .bold, design: .rounded))
                                .foregroundStyle(tint)
                        }
                        GeometryReader { proxy in
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .fill(Color.primary.opacity(0.06))
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .fill(tint.opacity(0.78))
                                .frame(width: max(4, proxy.size.width * CGFloat(model.avgTps / maxTps)))
                        }
                        .frame(height: 6)
                        HStack {
                            Label("\(metricsFormatDouble(model.avgLatencyMs)) ms", systemImage: "clock")
                            Spacer()
                            Text("\(metricsFormatCount(model.totalTokens)) tokens")
                            Spacer()
                            Text("\(metricsFormatCount(model.callCount)) calls")
                        }
                        .font(.system(size: 10, design: .rounded))
                        .foregroundStyle(.secondary)
                    }
                    .padding(11)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(Color.primary.opacity(0.045))
                    )
                }
            }
        }
    }
}

private struct MetricsTokenCloud: View {
    let entries: [TokenAnalysisMetrics.TokenCloudEntry]

    private let columns = [
        GridItem(.adaptive(minimum: 72), spacing: 6, alignment: .leading),
    ]

    var body: some View {
        if !entries.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Token Cloud")
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
                LazyVGrid(columns: columns, alignment: .leading, spacing: 6) {
                    ForEach(entries) { entry in
                        Text(entry.token)
                            .font(.system(size: min(15, 10 + entry.sharePct * 0.35), weight: .semibold, design: .rounded))
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 5)
                            .background(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .fill(metricsCloudColor(entry.category).opacity(0.16))
                            )
                            .foregroundStyle(metricsCloudColor(entry.category))
                            .help("\(entry.category) / \(metricsFormatPercent(entry.sharePct))")
                    }
                }
            }
        }
    }

    private func metricsCloudColor(_ category: String) -> Color {
        switch category {
        case "model": return .cyan
        case "provider": return .green
        case "tool": return .purple
        case "pattern": return .orange
        default: return .yellow
        }
    }
}

private struct MetricsStorageList: View {
    let entries: [NativeStorageCategoryEntry]
    let totalBytes: Int

    var body: some View {
        if entries.isEmpty {
            MetricsEmptyState("Storage categories are empty")
        } else {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(entries) { entry in
                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            Text(entry.label)
                                .font(.system(size: 12, weight: .semibold, design: .rounded))
                            Spacer()
                            Text(metricsFormatBytes(entry.bytes))
                                .font(.system(size: 11, design: .rounded))
                                .foregroundStyle(.secondary)
                        }
                        GeometryReader { proxy in
                            let share = totalBytes > 0 ? Double(entry.bytes) / Double(totalBytes) : 0
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .fill(Color.primary.opacity(0.06))
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .fill(Color.cyan.opacity(0.76))
                                .frame(width: max(4, proxy.size.width * CGFloat(share)))
                        }
                        .frame(height: 6)
                        if !entry.path.isEmpty {
                            Text(entry.path)
                                .font(.system(size: 10, design: .rounded))
                                .foregroundStyle(.tertiary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }
                }
            }
        }
    }
}

private struct MetricsPathSizeList: View {
    let entries: [MetricsStorage.TopLevelEntry]
    let totalBytes: Int

    var body: some View {
        if !entries.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Top Local Paths")
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
                ForEach(entries) { entry in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(entry.name)
                                .font(.system(size: 12, weight: .medium, design: .rounded))
                                .lineLimit(1)
                            Text(entry.path)
                                .font(.system(size: 10, design: .rounded))
                                .foregroundStyle(.tertiary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(metricsFormatBytes(entry.bytes))
                                .font(.system(size: 11, weight: .semibold, design: .rounded))
                            Text(metricsFormatPercent(totalBytes > 0 ? Double(entry.bytes) / Double(totalBytes) * 100 : 0))
                                .font(.system(size: 10, design: .rounded))
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(10)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(Color.primary.opacity(0.04))
                    )
                }
            }
        }
    }
}

private func metricsFormatCount(_ value: Int?) -> String {
    guard let value else { return "0" }
    if value >= 1_000_000 { return String(format: "%.2fM", Double(value) / 1_000_000) }
    if value >= 1_000 { return String(format: "%.1fK", Double(value) / 1_000) }
    return "\(value)"
}

private func metricsFormatDouble(_ value: Double?) -> String {
    guard let value, value.isFinite else { return "0" }
    if value >= 1_000 { return metricsFormatCount(Int(value.rounded())) }
    if value.rounded() == value { return String(Int(value)) }
    return String(format: "%.2f", value)
}

private func metricsFormatPercent(_ value: Double?) -> String {
    guard let value, value.isFinite else { return "0%" }
    return String(format: value.rounded() == value ? "%.0f%%" : "%.1f%%", value)
}

private func metricsFormatBytes(_ value: Int?) -> String {
    guard let value else { return "0 B" }
    let bytes = Double(value)
    if bytes >= 1024 * 1024 * 1024 { return String(format: "%.2f GB", bytes / 1024 / 1024 / 1024) }
    if bytes >= 1024 * 1024 { return String(format: "%.2f MB", bytes / 1024 / 1024) }
    if bytes >= 1024 { return String(format: "%.1f KB", bytes / 1024) }
    return "\(value) B"
}

private func metricsFileName(_ path: String) -> String {
    let normalized = path.replacingOccurrences(of: "\\", with: "/")
    return normalized.split(separator: "/").last.map(String.init) ?? path
}
