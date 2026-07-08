import SwiftUI

struct GatewayPendingApproval: Identifiable, Hashable {
    let id: String
    let toolName: String
    let argsSummary: String
}

struct GatewayJourneyEvent: Decodable, Identifiable, Hashable {
    let id: String
    let kind: String
    let title: String
    let detail: String
    let category: String
    let createdAt: String
    let createdAtMs: Double
}

struct GatewayJourneyCounts: Decodable, Hashable {
    let skills: Int
    let memories: Int
    let total: Int
}

struct GatewayJourney: Decodable, Hashable {
    let events: [GatewayJourneyEvent]
    let counts: GatewayJourneyCounts
}

private func journeyRelativeTime(_ ms: Double) -> String {
    guard ms > 0 else { return "unknown" }
    let diff = Date().timeIntervalSince1970 * 1000 - ms
    let mins = Int(diff / 60000)
    if mins < 1 { return "just now" }
    if mins < 60 { return "\(mins)m ago" }
    let hours = mins / 60
    if hours < 24 { return "\(hours)h ago" }
    let days = hours / 24
    if days < 30 { return "\(days)d ago" }
    let formatter = DateFormatter()
    formatter.dateFormat = "MMM d, yyyy"
    return formatter.string(from: Date(timeIntervalSince1970: ms / 1000))
}

private func journeyDayKey(_ ms: Double) -> String {
    guard ms > 0 else { return "Undated" }
    let formatter = DateFormatter()
    formatter.dateFormat = "EEEE, MMMM d, yyyy"
    return formatter.string(from: Date(timeIntervalSince1970: ms / 1000))
}

struct JourneyScreen: View {
    let client: GatewayClient
    @State private var journey: GatewayJourney?
    @State private var loaded = false
    @State private var loading = false
    @State private var error: String?

    private var grouped: [(day: String, events: [GatewayJourneyEvent])] {
        var order: [String] = []
        var map: [String: [GatewayJourneyEvent]] = [:]
        for event in journey?.events ?? [] {
            let key = journeyDayKey(event.createdAtMs)
            if map[key] == nil { order.append(key) }
            map[key, default: []].append(event)
        }
        return order.map { ($0, map[$0] ?? []) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .center) {
                    ScreenHeader(
                        title: "Journey",
                        subtitle: "Skills, memories, and durable learning over time"
                    )
                    Spacer()
                    Button {
                        Task { await load(force: true) }
                    } label: {
                        Label(loading ? "Refreshing" : "Refresh", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(.bordered)
                    .disabled(loading)
                }

                if !loaded {
                    JourneyLoadingSkeleton()
                } else if let error {
                    LoadFailedView(message: error) { Task { await load(force: true) } }
                } else if let journey {
                    JourneyStatsRow(counts: journey.counts)
                    if grouped.isEmpty {
                        JourneyEmptyState()
                    } else {
                        JourneyTimeline(groups: grouped)
                    }
                } else {
                    JourneyEmptyState()
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .task {
            if !loaded {
                await load()
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
            journey = try await client.journey()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct JourneyStatsRow: View {
    let counts: GatewayJourneyCounts

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                stat("Skills", counts.skills, "books.vertical", .cyan)
                stat("Memories", counts.memories, "brain", .indigo)
                stat("Total Learned", counts.total, "sparkles", .orange)
            }
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 150), spacing: 12, alignment: .top)],
                spacing: 12
            ) {
                stat("Skills", counts.skills, "books.vertical", .cyan)
                stat("Memories", counts.memories, "brain", .indigo)
                stat("Total Learned", counts.total, "sparkles", .orange)
            }
        }
    }

    private func stat(_ label: String, _ value: Int, _ symbol: String, _ tone: Color) -> some View {
        HStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tone)
                .frame(width: 30, height: 30)
                .background(Circle().fill(tone.opacity(0.14)))
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)
                Text("\(value)")
                    .font(.system(size: 22, weight: .bold, design: .rounded))
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 74, alignment: .leading)
        .cybaraGlass(cornerRadius: 16)
    }
}

private struct JourneyTimeline: View {
    let groups: [(day: String, events: [GatewayJourneyEvent])]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(groups, id: \.day) { group in
                JourneyDaySection(day: group.day, events: group.events)
            }
        }
    }
}

private struct JourneyDaySection: View {
    let day: String
    let events: [GatewayJourneyEvent]

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                Label(day, systemImage: "calendar")
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(events.enumerated()), id: \.element.id) { index, event in
                        JourneyTimelineRow(event: event, isLast: index == events.count - 1)
                    }
                }
            }
        }
    }
}

private struct JourneyTimelineRow: View {
    let event: GatewayJourneyEvent
    let isLast: Bool

    private var isSkill: Bool { event.kind == "skill" }
    private var tone: Color { isSkill ? .cyan : .indigo }
    private var symbol: String { isSkill ? "books.vertical" : "brain" }
    private var label: String { isSkill ? "Skill" : "Memory" }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 0) {
                ZStack {
                    Circle()
                        .fill(tone.opacity(0.18))
                        .frame(width: 24, height: 24)
                    Image(systemName: symbol)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(tone)
                }
                if !isLast {
                    Rectangle()
                        .fill(Color.primary.opacity(0.10))
                        .frame(width: 1)
                        .frame(maxHeight: .infinity)
                        .padding(.vertical, 4)
                }
            }
            .frame(width: 26)
            .frame(minHeight: 72)

            VStack(alignment: .leading, spacing: 7) {
                HStack(alignment: .firstTextBaseline) {
                    Text(event.title)
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Spacer(minLength: 12)
                    Text(journeyRelativeTime(event.createdAtMs))
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(.tertiary)
                }
                if !event.detail.isEmpty && event.detail != event.title {
                    Text(event.detail)
                        .font(.system(size: 11.5, design: .rounded))
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack(spacing: 7) {
                    Text(label)
                        .font(.system(size: 10, weight: .semibold, design: .rounded))
                        .foregroundStyle(tone)
                    if !event.category.isEmpty {
                        Text(event.category)
                            .font(.system(size: 10, weight: .medium, design: .rounded))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color.primary.opacity(0.04))
            )
            .help(event.detail.isEmpty ? event.title : event.detail)
        }
        .padding(.vertical, 4)
    }
}

private struct JourneyLoadingSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            JourneySkeletonRow(height: 74)
            GlassCard {
                VStack(alignment: .leading, spacing: 12) {
                    JourneySkeletonLine(width: 170)
                    ForEach(0..<4, id: \.self) { _ in
                        HStack(alignment: .top, spacing: 12) {
                            Circle()
                                .fill(Color.primary.opacity(0.12))
                                .frame(width: 24, height: 24)
                            VStack(alignment: .leading, spacing: 9) {
                                JourneySkeletonLine(width: 220)
                                JourneySkeletonLine(width: 340)
                                JourneySkeletonLine(width: 110)
                            }
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .fill(Color.primary.opacity(0.04))
                            )
                        }
                    }
                }
            }
        }
        .redacted(reason: .placeholder)
        .allowsHitTesting(false)
    }
}

private struct JourneySkeletonRow: View {
    let height: CGFloat

    var body: some View {
        HStack(spacing: 12) {
            ForEach(0..<3, id: \.self) { _ in
                JourneySkeletonLine(width: 120)
                    .padding(18)
                    .frame(maxWidth: .infinity, minHeight: height, alignment: .leading)
                    .cybaraGlass(cornerRadius: 16)
            }
        }
    }
}

private struct JourneySkeletonLine: View {
    let width: CGFloat

    var body: some View {
        RoundedRectangle(cornerRadius: 5, style: .continuous)
            .fill(Color.primary.opacity(0.12))
            .frame(width: width, height: 10)
    }
}

private struct JourneyEmptyState: View {
    var body: some View {
        GlassCard {
            VStack(spacing: 10) {
                Image(systemName: "sparkles")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(.secondary)
                Text("No journey events yet")
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                Text("Skills and memories will appear here as agents learn durable context.")
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, minHeight: 160)
        }
    }
}
