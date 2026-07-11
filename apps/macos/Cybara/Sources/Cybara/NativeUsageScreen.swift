import SwiftUI

struct UsageScreen: View {
    let client: GatewayClient
    @Environment(\.cybaraAccent) private var accentTint

    @State private var status: ProviderPlanStatusResponse?
    @State private var loading = false
    @State private var loaded = false
    @State private var error: String?
    @State private var lastUpdated: Date?
    @AppStorage("cybara.usage.customOrder") private var customOrderData: Data = Data()

    private var customOrder: [String] {
        decodeUsageOrder(customOrderData)
    }

    private var basePlans: [ProviderPlanSnapshot] {
        (status?.providers ?? [])
            .filter { plan in
                plan.managedAutomatically &&
                    (plan.monitored || plan.externalSourceAvailable || !plan.windows.isEmpty)
            }
    }

    private var plans: [ProviderPlanSnapshot] {
        let order = customOrder
        if order.isEmpty {
            return basePlans.sorted { lhs, rhs in
                nativeUsageStatusRank(lhs.status) == nativeUsageStatusRank(rhs.status)
                    ? lhs.providerName.localizedCaseInsensitiveCompare(rhs.providerName) == .orderedAscending
                    : nativeUsageStatusRank(lhs.status) < nativeUsageStatusRank(rhs.status)
            }
        }
        let rank = Dictionary(uniqueKeysWithValues: order.enumerated().map { ($0.element, $0.offset) })
        return basePlans.sorted { lhs, rhs in
            let rankLhs = rank[lhs.id] ?? Int.max
            let rankRhs = rank[rhs.id] ?? Int.max
            if rankLhs != rankRhs { return rankLhs < rankRhs }
            return nativeUsageStatusRank(lhs.status) < nativeUsageStatusRank(rhs.status)
        }
    }

    private func movePlan(_ providerId: String, direction: Int) {
        let ids = plans.map(\.id)
        guard let currentIndex = ids.firstIndex(of: providerId) else { return }
        let targetIndex = currentIndex + direction
        guard targetIndex >= 0 && targetIndex < ids.count else { return }
        var next = ids
        next.swapAt(currentIndex, targetIndex)
        customOrderData = encodeUsageOrder(next)
    }

    private func resetOrder() {
        customOrderData = Data()
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .center) {
                    ScreenHeader(title: "Usage", subtitle: "Coding-plan windows across providers")
                    Spacer()
                    if !customOrder.isEmpty {
                        Button {
                            resetOrder()
                        } label: {
                            Label("Reset", systemImage: "arrow.uturn.backward")
                                .font(.system(size: 11, weight: .medium, design: .rounded))
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                    }
                    if let lastUpdated {
                        Text("Updated \(lastUpdated.formatted(date: .omitted, time: .shortened))")
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundStyle(.secondary)
                    }
                }

                if !loaded {
                    NativeUsageSkeleton()
                } else if let error {
                    LoadFailedView(message: error) { Task { await load(force: true) } }
                } else if plans.isEmpty {
                    NativeUsageEmptyState()
                } else {
                    NativeUsageSummary(status: status, plans: plans, accent: accentTint)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 280), spacing: 12)], spacing: 12) {
                        ForEach(Array(plans.enumerated()), id: \.element.id) { index, plan in
                            NativeUsageProviderCard(
                                plan: plan,
                                canMoveUp: index > 0,
                                canMoveDown: index < plans.count - 1,
                                onMoveUp: { movePlan(plan.id, direction: -1) },
                                onMoveDown: { movePlan(plan.id, direction: 1) }
                            )
                        }
                    }
                }
            }
            .padding(24)
        }
        .task {
            if !loaded {
                await load()
            }
        }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                await load()
            }
        }
    }

    private func load(force: Bool = false) async {
        guard !loading || force else { return }
        loading = true
        defer {
            loading = false
            loaded = true
        }
        do {
            status = try await client.providerPlanStatus()
            lastUpdated = Date()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct NativeUsageSummary: View {
    let status: ProviderPlanStatusResponse?
    let plans: [ProviderPlanSnapshot]
    let accent: Color

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
            NativeUsageStat(title: "Tracked", value: "\(plans.count)", tint: accent)
            NativeUsageStat(title: "Configured", value: "\(status?.summary.configured ?? 0)", tint: .green)
            NativeUsageStat(title: "Warnings", value: "\(plans.filter { $0.status == "warning" }.count)", tint: .yellow)
            NativeUsageStat(title: "Exhausted", value: "\(plans.filter { $0.status == "exhausted" }.count)", tint: .red)
        }
    }
}

private struct NativeUsageStat: View {
    let title: String
    let value: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased())
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: 26, weight: .semibold, design: .rounded))
                .foregroundStyle(.primary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .cybaraGlass(cornerRadius: 16)
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(tint.opacity(0.18), lineWidth: 1)
        )
    }
}

private struct NativeUsageProviderCard: View {
    let plan: ProviderPlanSnapshot
    let canMoveUp: Bool
    let canMoveDown: Bool
    let onMoveUp: () -> Void
    let onMoveDown: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(plan.providerName)
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .lineLimit(1)
                    Text(plan.planName ?? plan.automaticTrackingLabel ?? "Automatic plan")
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                VStack(spacing: 2) {
                    Button(action: onMoveUp) {
                        Image(systemName: "chevron.up")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(canMoveUp ? .secondary : .tertiary)
                    }
                    .buttonStyle(.plain)
                    .disabled(!canMoveUp)
                    Button(action: onMoveDown) {
                        Image(systemName: "chevron.down")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(canMoveDown ? .secondary : .tertiary)
                    }
                    .buttonStyle(.plain)
                    .disabled(!canMoveDown)
                }
                Text(plan.status.capitalized)
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .padding(.horizontal, 9)
                    .padding(.vertical, 5)
                    .background(Capsule().fill(nativeUsageStatusTint(plan.status).opacity(0.14)))
                    .foregroundStyle(nativeUsageStatusTint(plan.status))
            }

            HStack(spacing: 10) {
                NativeUsageWindow(label: "5h", usage: nativeUsageWindowValue(plan, kind: "rolling_5h"))
                NativeUsageWindow(label: "Weekly", usage: nativeUsageWindowValue(plan, kind: "rolling_week"))
            }

            HStack(spacing: 8) {
                Text(plan.sourceLabel ?? "Automatic")
                if let updatedAt = plan.updatedAt {
                    Text(updatedAt)
                }
            }
            .font(.system(size: 10, weight: .medium, design: .rounded))
            .foregroundStyle(.tertiary)
            .lineLimit(1)
        }
        .padding(16)
        .cybaraGlass(cornerRadius: 18)
    }
}

private struct NativeUsageWindow: View {
    let label: String
    let usage: NativeUsageWindowValue

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                Text(label)
                    .foregroundStyle(.secondary)
                Spacer()
                Text(usage.text)
                    .fontWeight(.semibold)
                    .foregroundStyle(nativeUsageTint(usage))
            }
            ProgressView(value: nativeUsageProgress(usage))
                .tint(nativeUsageTint(usage))
            Text(usage.resetText ?? "")
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .font(.system(size: 11, design: .rounded))
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(nativeUsageTint(usage).opacity(0.11))
        )
    }
}

private struct NativeUsageEmptyState: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "gauge.with.dots.needle.67percent")
                .font(.system(size: 28, weight: .medium))
                .foregroundStyle(.secondary)
            Text("No automatic usage yet")
                .font(.system(size: 16, weight: .semibold, design: .rounded))
            Text("Connect a supported OAuth coding-plan provider and usage appears here automatically.")
                .font(.system(size: 13, design: .rounded))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 300)
        .padding(24)
        .cybaraGlass(cornerRadius: 22)
    }
}

private struct NativeUsageSkeleton: View {
    var body: some View {
        VStack(spacing: 12) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                ForEach(0..<4, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(.white.opacity(0.06))
                        .frame(height: 94)
                }
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 280), spacing: 12)], spacing: 12) {
                ForEach(0..<4, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(.white.opacity(0.05))
                        .frame(height: 172)
                }
            }
        }
        .redacted(reason: .placeholder)
    }
}

private func nativeUsageTint(_ usage: NativeUsageWindowValue) -> Color {
    if usage.unlimited { return .green }
    guard let percent = usage.percent else { return .secondary }
    if percent < 40 { return .green }
    if percent < 65 { return .blue }
    if percent < 80 { return .yellow }
    if percent < 95 { return .orange }
    return .red
}

private func nativeUsageProgress(_ usage: NativeUsageWindowValue) -> Double {
    if usage.unlimited { return 1 }
    guard let percent = usage.percent else { return 0 }
    return min(1, max(0, percent / 100))
}

private func nativeUsageStatusTint(_ status: String) -> Color {
    switch status {
    case "ok": return .green
    case "warning": return .yellow
    case "exhausted": return .red
    default: return .secondary
    }
}

private func nativeUsageStatusRank(_ status: String) -> Int {
    switch status {
    case "exhausted": return 0
    case "warning": return 1
    case "ok": return 2
    default: return 3
    }
}

private func encodeUsageOrder(_ ids: [String]) -> Data {
    (try? JSONEncoder().encode(ids)) ?? Data()
}

private func decodeUsageOrder(_ data: Data) -> [String] {
    guard !data.isEmpty,
          let decoded = try? JSONDecoder().decode([String].self, from: data)
    else { return [] }
    return decoded
}
