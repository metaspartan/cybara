import SwiftUI

struct NativeLogEntryDisplay: Identifiable, Hashable {
    let id: String
    let level: String
    let source: String
    let message: String
    let timestamp: String?
    let detail: String

    var levelKey: String {
        switch level.lowercased() {
        case "warn", "warning":
            return "warn"
        case "error":
            return "error"
        default:
            return "info"
        }
    }

    var sourceKey: String {
        source.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    init(gateway entry: GatewayLogEntry) {
        let resolvedSource = firstNonEmptyGatewayString(entry.source, entry.logType) ?? "gateway"
        id = "gateway-\(entry.id)"
        level = firstNonEmptyGatewayString(entry.level)?.uppercased() ?? "INFO"
        source = resolvedSource
        message = firstNonEmptyGatewayString(entry.message) ?? "No log message"
        timestamp = entry.created_at
        let relative = relativeTimestamp(entry.created_at)
        detail = relative.isEmpty ? resolvedSource : "\(resolvedSource) · \(relative)"
    }

    init(sidecarLine line: String, index: Int) {
        id = "sidecar-\(index)-\(line.hashValue)"
        level = NativeLogEntryDisplay.inferredLevel(for: line).uppercased()
        source = "sidecar"
        message = line
        timestamp = nil
        detail = "native sidecar"
    }

    private static func inferredLevel(for line: String) -> String {
        let lower = line.lowercased()
        if lower.contains("error") || lower.contains("failed") || lower.contains("crash") {
            return "error"
        }
        if lower.contains("warn") || lower.contains("retry") || lower.contains("degraded") {
            return "warn"
        }
        return "info"
    }
}

func nativeLogEntries(
    gatewayLogs: [GatewayLogEntry],
    sidecarLogs: [String],
    sidecarLimit: Int = 80
) -> [NativeLogEntryDisplay] {
    let gatewayEntries = gatewayLogs.map(NativeLogEntryDisplay.init(gateway:))
    let sidecarEntries = Array(sidecarLogs.suffix(sidecarLimit).enumerated()).map { offset, line in
        NativeLogEntryDisplay(sidecarLine: line, index: offset)
    }
    return gatewayEntries + sidecarEntries
}

func filterNativeLogs(
    _ entries: [NativeLogEntryDisplay],
    levelFilter: String,
    sourceFilter: String,
    query: String
) -> [NativeLogEntryDisplay] {
    let normalizedLevel = levelFilter.lowercased()
    let normalizedSource = sourceFilter.lowercased()
    let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return entries.filter { entry in
        if normalizedLevel != "all", entry.levelKey != normalizedLevel {
            return false
        }
        if normalizedSource != "all", entry.sourceKey != normalizedSource {
            return false
        }
        if normalizedQuery.isEmpty {
            return true
        }
        return [entry.level, entry.source, entry.message, entry.detail]
            .joined(separator: " ")
            .lowercased()
            .contains(normalizedQuery)
    }
}

struct NativeLogTimeline: View {
    let entries: [NativeLogEntryDisplay]
    var emptyMessage = "No log entries loaded."
    var compact = false

    var body: some View {
        if entries.isEmpty {
            Label(emptyMessage, systemImage: "text.page")
                .font(.system(size: 12, design: .rounded))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 8)
        } else {
            LazyVStack(alignment: .leading, spacing: compact ? 5 : 7) {
                ForEach(entries) { entry in
                    NativeLogRow(entry: entry, compact: compact)
                }
            }
        }
    }
}

private struct NativeLogRow: View {
    let entry: NativeLogEntryDisplay
    let compact: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(levelColor.opacity(entry.levelKey == "info" ? 0.42 : 0.72))
                .frame(width: 7, height: 7)
                .padding(.top, 7)

            VStack(alignment: .leading, spacing: compact ? 3 : 5) {
                HStack(spacing: 7) {
                    Text(entry.level)
                        .font(.system(size: 9.5, weight: .bold, design: .monospaced))
                        .foregroundStyle(levelColor)
                        .frame(minWidth: 42, alignment: .leading)
                    Text(entry.source)
                        .font(.system(size: 10.5, weight: .semibold, design: .rounded))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Text(entry.detail)
                        .font(.system(size: 10, design: .rounded))
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }

                Text(entry.message)
                    .font(.system(size: compact ? 10.5 : 11.5, design: .monospaced))
                    .foregroundStyle(.primary.opacity(0.82))
                    .textSelection(.enabled)
                    .lineLimit(compact ? 3 : nil)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.horizontal, compact ? 10 : 12)
        .padding(.vertical, compact ? 7 : 9)
        .background(
            RoundedRectangle(cornerRadius: compact ? 10 : 12, style: .continuous)
                .fill(rowBackground)
        )
        .overlay(
            RoundedRectangle(cornerRadius: compact ? 10 : 12, style: .continuous)
                .stroke(levelColor.opacity(entry.levelKey == "info" ? 0.08 : 0.16), lineWidth: 1)
        )
    }

    private var levelColor: Color {
        switch entry.levelKey {
        case "error":
            return .red
        case "warn":
            return .orange
        default:
            return .secondary
        }
    }

    private var rowBackground: Color {
        switch entry.levelKey {
        case "error":
            return Color.red.opacity(0.065)
        case "warn":
            return Color.orange.opacity(0.06)
        default:
            return Color.primary.opacity(0.035)
        }
    }
}

struct NativeLogStatPill: View {
    let label: String
    let value: Int
    let tint: Color

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(tint.opacity(0.75))
                .frame(width: 7, height: 7)
            Text(label)
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(.secondary)
            Text("\(value)")
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .foregroundStyle(.primary.opacity(0.86))
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(
            Capsule(style: .continuous)
                .fill(tint.opacity(0.10))
        )
        .overlay(
            Capsule(style: .continuous)
                .stroke(tint.opacity(0.16), lineWidth: 1)
        )
    }
}
