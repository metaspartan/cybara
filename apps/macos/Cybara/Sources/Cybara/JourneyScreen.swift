import SwiftUI

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
            VStack(alignment: .leading, spacing: 16) {
                Text("Journey")
                    .font(.system(size: 24, weight: .bold, design: .rounded))
                Text("Everything your agent has learned — skills and memories over time")
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(.secondary)

                HStack(spacing: 12) {
                    journeyStat("Skills", journey?.counts.skills ?? 0, .cyan)
                    journeyStat("Memories", journey?.counts.memories ?? 0, .indigo)
                    journeyStat("Total learned", journey?.counts.total ?? 0, .orange)
                }

                if let error {
                    Text(error)
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.red)
                }

                ForEach(grouped, id: \.day) { group in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(group.day.uppercased())
                            .font(.system(size: 11, weight: .semibold, design: .rounded))
                            .foregroundStyle(.secondary)
                        ForEach(group.events) { event in
                            journeyRow(event)
                        }
                    }
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .task { await load() }
    }

    private func journeyStat(_ label: String, _ value: Int, _ tone: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.system(size: 11, design: .rounded)).foregroundStyle(.secondary)
            Text("\(value)").font(.system(size: 22, weight: .bold, design: .rounded)).foregroundStyle(tone)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.04)))
    }

    private func journeyRow(_ event: GatewayJourneyEvent) -> some View {
        let isSkill = event.kind == "skill"
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: isSkill ? "books.vertical" : "brain")
                    .foregroundStyle(isSkill ? Color.cyan : Color.indigo)
                Text(event.title).font(.system(size: 13, weight: .medium, design: .rounded)).lineLimit(1)
                Spacer()
                Text(journeyRelativeTime(event.createdAtMs))
                    .font(.system(size: 11, design: .rounded)).foregroundStyle(.tertiary)
            }
            if !event.detail.isEmpty && event.detail != event.title {
                Text(event.detail).font(.system(size: 11, design: .rounded))
                    .foregroundStyle(.secondary).lineLimit(3)
            }
            HStack(spacing: 6) {
                Text(isSkill ? "skill" : "memory")
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundStyle(isSkill ? Color.cyan : Color.indigo)
                if !event.category.isEmpty {
                    Text(event.category).font(.system(size: 10, design: .rounded)).foregroundStyle(.tertiary)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.04)))
    }

    private func load() async {
        do {
            journey = try await client.journey()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
