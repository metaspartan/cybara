import Foundation

struct NativeUsageWindowValue {
    let text: String
    let percent: Double?
    let unlimited: Bool
    let resetText: String?
}

func nativeUsageWindowValue(_ plan: ProviderPlanSnapshot, kind: String) -> NativeUsageWindowValue {
    guard let window = plan.windows.first(where: {
        $0.kind == kind && $0.usageKnown && ($0.unlimited || $0.usedPercent != nil)
    }) else {
        return NativeUsageWindowValue(text: "--", percent: nil, unlimited: false, resetText: nil)
    }
    let resetText = nativeUsageResetText(window.resetsAt)
    if window.unlimited {
        return NativeUsageWindowValue(text: "∞", percent: nil, unlimited: true, resetText: resetText)
    }
    let percent = min(100, max(0, ceil(window.usedPercent ?? 0)))
    return NativeUsageWindowValue(text: "\(Int(percent))%", percent: percent, unlimited: false, resetText: resetText)
}

func nativeUsageResetText(_ resetsAt: String?) -> String? {
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
    if seconds < hour { return "resets in \(max(1, Int(ceil(seconds / minute))))m" }
    if seconds < day {
        let hours = Int(seconds / hour)
        let minutes = Int(ceil(seconds.truncatingRemainder(dividingBy: hour) / minute))
        return minutes > 0 ? "resets in \(hours)h \(minutes)m" : "resets in \(hours)h"
    }
    return "resets in \(Int(ceil(seconds / day)))d"
}
