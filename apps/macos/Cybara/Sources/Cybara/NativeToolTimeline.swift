import AppKit
import Foundation
import SwiftUI

enum NativeToolActivityPhase: String, Hashable {
    case start
    case result
    case error
}

struct NativeToolActivity: Identifiable, Hashable {
    let id: String
    let phase: NativeToolActivityPhase
    let text: String
    let timestamp: Double
    let toolName: String?
    let toolCallId: String?
    let sandboxProvider: String?
}

func nativeAgentUsingBrowser(_ activities: [NativeToolActivity], sessionActive: Bool) -> Bool {
    guard sessionActive else { return false }
    return activities.contains { activity in
        activity.phase == .start && (activity.toolName ?? "").localizedCaseInsensitiveContains("browser")
    }
}

struct NativeToolTimelineView: View {
    let message: GatewaySessionMessage
    let mediaBaseURL: URL
    let mediaToken: String?
    @Environment(\.nativeChatAppearance) private var appearance
    @State private var expanded = false

    private var orderedToolCalls: [GatewayToolCall] {
        nativeOrderedToolCalls(message.tool_calls)
    }

    private var activities: [NativeToolActivity] {
        nativeToolActivities(for: message)
    }

    private var steeringActivities: [NativeToolActivity] {
        activities.filter { $0.toolName == "__steering" }
    }

    private var workActivities: [NativeToolActivity] {
        activities.filter { $0.toolName != "__steering" }
    }

    private var hasContent: Bool {
        !activities.isEmpty || !orderedToolCalls.isEmpty || hiddenToolCallCount > 0
    }

    private var hasWorkContent: Bool {
        !workActivities.isEmpty || !orderedToolCalls.isEmpty || hiddenToolCallCount > 0
    }

    private var hiddenToolCallCount: Int {
        message._tool_calls_hidden_count ?? 0
    }

    var body: some View {
        if hasContent {
            VStack(alignment: .leading, spacing: 8) {
                if hasWorkContent {
                    Button {
                        withAnimation(.easeInOut(duration: 0.16)) {
                            expanded.toggle()
                        }
                    } label: {
                        HStack(spacing: 7) {
                            Image(systemName: expanded ? "chevron.down" : "chevron.right")
                                .font(.system(size: 9.5, weight: .semibold))
                                .foregroundStyle(.secondary)
                            Image(systemName: "clock")
                                .font(.system(size: 11.5, weight: .semibold))
                                .foregroundStyle(.secondary)
                            Text("Worked for \(nativeWorkedDurationLabel(for: message))")
                                .font(.system(size: appearance.activityFontSize, weight: .medium, design: .rounded))
                                .foregroundStyle(.secondary)
                            Spacer(minLength: 0)
                        }
                    }
                    .buttonStyle(.plain)
                    .contentShape(Rectangle())
                    .accessibilityLabel(expanded ? "Hide work details" : "Show work details")
                }

                if hasWorkContent && expanded {
                    VStack(alignment: .leading, spacing: 8) {
                        if !workActivities.isEmpty {
                            NativeGroupedActivities(activities: workActivities)
                        }

                        if !orderedToolCalls.isEmpty {
                            DisclosureGroup {
                                VStack(alignment: .leading, spacing: 7) {
                                    ForEach(orderedToolCalls) { toolCall in
                                        NativeToolCallDetailRow(
                                            toolCall: toolCall,
                                            mediaBaseURL: mediaBaseURL,
                                            mediaToken: mediaToken
                                        )
                                    }
                                }
                                .padding(.top, 6)
                            } label: {
                                Label("Tool calls (\(orderedToolCalls.count))", systemImage: "wrench.and.screwdriver")
                                    .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                                    .foregroundStyle(.secondary)
                            }
                            .disclosureGroupStyle(.automatic)
                        }

                        if hiddenToolCallCount > 0 {
                            let verb = hiddenToolCallCount == 1 ? "was" : "were"
                            Text("\(hiddenToolCallCount) tool call\(hiddenToolCallCount == 1 ? "" : "s") \(verb) hidden by the gateway response.")
                                .font(.system(size: 10.5, design: .rounded))
                                .foregroundStyle(.orange)
                        }
                    }
                    .padding(.leading, 16)
                }

                if !steeringActivities.isEmpty {
                    NativeGroupedActivities(activities: steeringActivities)
                }
            }
            .padding(.bottom, message.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0 : 3)
        }
    }
}

struct NativeLiveToolTimelineView: View {
    let status: String
    let activities: [NativeToolActivity]
    let currentStep: String?
    let startedAt: Date?
    @Environment(\.nativeChatAppearance) private var appearance

    private var visibleActivities: [NativeToolActivity] {
        activities.filter { !nativeIsGenericStatusLabel($0.text) }
    }

    private var activeStep: String? {
        nativeLatestInFlightStep(visibleActivities)
    }

    private var displayCurrentStep: String? {
        if activeStep != nil { return nil }
        if let currentStep = nativeFirstNonEmpty(currentStep),
           !nativeIsGenericStatusLabel(currentStep) {
            return currentStep
        }
        switch status.lowercased() {
        case "generating":
            return "Generating response..."
        case "compacting":
            return "Compacting earlier context..."
        case "thinking", "tool_executing", "tool_completed":
            return "Thinking..."
        default:
            return visibleActivities.isEmpty ? "Thinking..." : nil
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TimelineView(.periodic(from: startedAt ?? Date(), by: 1)) { context in
                HStack(spacing: 7) {
                    Image(systemName: "clock")
                        .font(.system(size: 11.5, weight: .semibold))
                        .foregroundStyle(.secondary)
                    Text("Working for \(nativeLiveWorkedDurationLabel(startedAt: startedAt, activities: visibleActivities, now: context.date))")
                        .font(.system(size: appearance.activityFontSize, weight: .medium, design: .rounded))
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                }
            }

            if !visibleActivities.isEmpty {
                NativeGroupedActivities(activities: visibleActivities)
            }

            if let displayCurrentStep {
                HStack(alignment: .top, spacing: 7) {
                    ProgressView()
                        .controlSize(.mini)
                        .tint(.secondary)
                        .frame(width: 13, height: 13)
                        .padding(.top, 1)
                    nativeActivityMarkdownText(displayCurrentStep)
                        .font(.system(size: 11.8, design: .rounded))
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                        .textSelection(.enabled)
                }
            } else if visibleActivities.isEmpty {
                HStack(spacing: 5) {
                    ProgressView()
                        .controlSize(.mini)
                        .tint(.secondary)
                    Text("Thinking...")
                        .font(.system(size: 11.8, design: .rounded))
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

private struct NativeToolActivityRow: View {
    let activity: NativeToolActivity
    @Environment(\.nativeChatAppearance) private var appearance

    var body: some View {
        HStack(alignment: .top, spacing: 7) {
            if activity.phase == .start {
                ProgressView()
                    .controlSize(.mini)
                    .tint(.secondary)
                    .frame(width: 13, height: 13)
                    .padding(.top, 1)
            } else if activity.toolName == "__thought" {
                Circle()
                    .fill(.secondary)
                    .opacity(0.75)
                    .frame(width: 6, height: 6)
                    .frame(width: 13, alignment: .center)
                    .padding(.top, 5)
            } else {
                Image(systemName: icon)
                    .font(.system(size: 11.5, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 13, alignment: .center)
                    .padding(.top, 1)
            }
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                nativeActivityMarkdownText(activity.text)
                    .font(.system(size: appearance.activityFontSize, design: .rounded))
                    .foregroundStyle(appearance.highContrast ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary))
                    .lineLimit(3)
                    .textSelection(.enabled)
                if let provider = activity.sandboxProvider {
                    NativeToolSandboxBadge(provider: provider)
                }
            }
        }
    }

    private var icon: String {
        if activity.toolName == "sessions_transfer" || activity.toolName == "__steering" {
            return "arrow.left.arrow.right"
        }
        switch activity.phase {
        case .start: return "clock"
        case .result: return "checkmark.circle.fill"
        case .error: return "exclamationmark.triangle.fill"
        }
    }

    private var tint: Color {
        .secondary
    }
}

private func nativeActivityMarkdownText(_ text: String) -> Text {
    if let attributed = try? AttributedString(
        markdown: text,
        options: AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .inlineOnlyPreservingWhitespace
        )
    ) {
        return Text(attributed)
    }
    return Text(text)
}

private struct NativeToolCallDetailRow: View {
    let toolCall: GatewayToolCall
    let mediaBaseURL: URL
    let mediaToken: String?
    @State private var expanded = false

    private var resultImages: [NativeToolResultImage] {
        nativeToolResultImages(toolCall.result)
    }

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 7) {
                if !resultImages.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(resultImages) { image in
                            NativeToolResultImageView(
                                image: image,
                                baseURL: mediaBaseURL,
                                token: mediaToken
                            )
                        }
                    }
                }
                if let command = nativeFirstNonEmpty(toolCall.command, toolCall.detail) {
                    NativeToolPayloadBlock(title: "Detail", content: command)
                }
                if let args = nativeToolArgumentsString(toolCall.args) {
                    NativeToolPayloadBlock(title: "Args", content: args)
                }
                if let error = nativeFirstNonEmpty(toolCall.error) {
                    NativeToolPayloadBlock(title: "Error", content: error)
                }
                if let result = toolCall.result?.jsonString(pretty: true), !result.isEmpty {
                    NativeToolPayloadBlock(title: "Result", content: result)
                }
                if let truncated = nativeFirstNonEmpty(toolCall._truncated) {
                    NativeToolPayloadBlock(title: "Gateway note", content: truncated)
                }
                if nativeToolArgumentsString(toolCall.args) == nil,
                   nativeFirstNonEmpty(toolCall.command, toolCall.detail, toolCall.error) == nil,
                   toolCall.result == nil {
                    Text("No payload stored for this call.")
                        .font(.system(size: 10.5, design: .rounded))
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.top, 6)
            .padding(.leading, 20)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: nativeToolCallIcon(toolCall))
                    .font(.system(size: 11.5, weight: .semibold))
                    .foregroundStyle(nativeToolCallTint(toolCall))
                    .frame(width: 14)
                VStack(alignment: .leading, spacing: 2) {
                    Text(nativeToolCallTitle(toolCall))
                        .font(.system(size: 11.8, weight: .semibold, design: .rounded))
                        .lineLimit(1)
                    if let subtitle = nativeToolCallSubtitle(toolCall) {
                        Text(subtitle)
                            .font(.system(size: 10.5, design: .rounded))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                if let provider = nativeResolvedSandboxProvider(for: toolCall) {
                    NativeToolSandboxBadge(provider: provider)
                }
                Text(nativeToolCallStatusLabel(toolCall))
                    .font(.system(size: 10.2, weight: .semibold, design: .rounded))
                    .foregroundStyle(nativeToolCallTint(toolCall))
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(nativeToolCallTint(toolCall).opacity(0.13)))
            }
            .contentShape(Rectangle())
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(Color.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color.white.opacity(0.07), lineWidth: 1)
        )
    }
}

private struct NativeToolPayloadBlock: View {
    let title: String
    let content: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 10.5, weight: .semibold, design: .rounded))
                .foregroundStyle(.secondary)
            ScrollView(.horizontal) {
                Text(nativeBoundedPayload(content))
                    .font(.system(size: 10.5, design: .monospaced))
                    .foregroundStyle(.primary)
                    .textSelection(.enabled)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Color.black.opacity(0.22), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
    }
}

struct NativeToolResultImage: Identifiable, Hashable {
    let id: String
    let basename: String
    let contentType: String?
}

private struct NativeToolResultImageView: View {
    let image: NativeToolResultImage
    let baseURL: URL
    let token: String?

    private var url: URL? {
        nativeToolMediaURL(baseURL: baseURL, basename: image.basename, token: token)
    }

    var body: some View {
        if let url {
            Button {
                NSWorkspace.shared.open(url)
            } label: {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let loaded):
                        loaded
                            .resizable()
                            .scaledToFit()
                    case .failure:
                        NativeImagePlaceholder(icon: "photo.badge.exclamationmark", text: "Image unavailable")
                    case .empty:
                        NativeImagePlaceholder(icon: "photo", text: "Loading image…")
                    @unknown default:
                        EmptyView()
                    }
                }
                .frame(maxWidth: 400, alignment: .leading)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(Color.white.opacity(0.08), lineWidth: 1)
                )
            }
            .buttonStyle(.plain)
            .help("Open full image")
        }
    }
}

private struct NativeImagePlaceholder: View {
    let icon: String
    let text: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .semibold))
            Text(text)
                .font(.system(size: 10.5, design: .rounded))
        }
        .foregroundStyle(.secondary)
        .frame(maxWidth: 400, minHeight: 64)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

private let nativeImageExtensions: Set<String> = ["png", "jpg", "jpeg", "gif", "webp"]

func nativeToolResultImages(_ value: JSONValue?) -> [NativeToolResultImage] {
    var results: [NativeToolResultImage] = []
    var seen = Set<String>()

    func walk(_ node: JSONValue?) {
        guard let node else { return }
        switch node {
        case .object(let object):
            let filePath = nativeStringField(object, ["filePath", "file_path", "path"])
            let contentType = nativeStringField(object, ["contentType", "content_type", "mimeType", "mime_type"])
            if let filePath, nativeIsImagePath(filePath, contentType: contentType) {
                let basename = filePath
                    .split(whereSeparator: { $0 == "/" || $0 == "\\" })
                    .last
                    .map(String.init) ?? filePath
                if !basename.isEmpty, !seen.contains(basename) {
                    seen.insert(basename)
                    results.append(
                        NativeToolResultImage(id: basename, basename: basename, contentType: contentType)
                    )
                }
            }
            for (_, child) in object { walk(child) }
        case .array(let array):
            for child in array { walk(child) }
        default:
            break
        }
    }

    walk(value)
    return results
}

func nativeToolMediaURL(baseURL: URL, basename: String, token: String?) -> URL? {
    guard var components = URLComponents(
        url: baseURL.appendingPathComponent("api/media"),
        resolvingAgainstBaseURL: false
    ) else { return nil }
    var items = [URLQueryItem(name: "path", value: "screenshots/\(basename)")]
    if let token, !token.isEmpty {
        items.append(URLQueryItem(name: "token", value: token))
    }
    components.queryItems = items
    return components.url
}

private func nativeStringField(_ object: [String: JSONValue], _ keys: [String]) -> String? {
    for key in keys {
        if case .string(let value)? = object[key],
           let trimmed = nativeFirstNonEmpty(value) {
            return trimmed
        }
    }
    return nil
}

private func nativeIsImagePath(_ path: String, contentType: String?) -> Bool {
    if let contentType = contentType?.lowercased(), contentType.hasPrefix("image/") {
        return true
    }
    let ext = (path.split(separator: ".").last.map(String.init) ?? "").lowercased()
    return nativeImageExtensions.contains(ext)
}

private struct NativeToolSandboxBadge: View {
    let provider: String

    var body: some View {
        Text(nativeSandboxProviderLabel(provider))
            .font(.system(size: 9.8, weight: .semibold, design: .rounded))
            .foregroundStyle(.cyan)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Capsule().fill(Color.cyan.opacity(0.10)))
            .overlay(Capsule().stroke(Color.cyan.opacity(0.22), lineWidth: 1))
    }
}

func nativeOrderedToolCalls(_ toolCalls: [GatewayToolCall]?) -> [GatewayToolCall] {
    guard let toolCalls, toolCalls.count > 1 else { return toolCalls ?? [] }
    let indexed = Array(toolCalls.enumerated())
    if toolCalls.contains(where: { $0.timeline_index != nil }) {
        return indexed.sorted { left, right in
            let leftRank = left.element.timeline_index ?? Int.max
            let rightRank = right.element.timeline_index ?? Int.max
            if leftRank == rightRank { return left.offset < right.offset }
            return leftRank < rightRank
        }.map(\.element)
    }
    if toolCalls.contains(where: { $0.started_at != nil }) {
        return indexed.sorted { left, right in
            let leftRank = left.element.started_at ?? Double.greatestFiniteMagnitude
            let rightRank = right.element.started_at ?? Double.greatestFiniteMagnitude
            if leftRank == rightRank { return left.offset < right.offset }
            return leftRank < rightRank
        }.map(\.element)
    }
    return toolCalls
}

func nativeToolActivities(for message: GatewaySessionMessage) -> [NativeToolActivity] {
    let baseTimestamp = nativeTimestampMs(message.timestamp) ?? 0
    var activities: [NativeToolActivity] = []

    if let thinking = nativeFirstNonEmpty(message.thinking) {
        activities.append(
            NativeToolActivity(
                id: "\(message.id.uuidString)-thinking",
                phase: .result,
                text: thinking,
                timestamp: baseTimestamp,
                toolName: "__thought",
                toolCallId: nil,
                sandboxProvider: nil
            )
        )
    }

    let processActivities = message.process_activities ?? []
    for (index, activity) in processActivities.enumerated() {
        let text = nativeNormalizeActivityText(activity.text ?? "")
        if text.isEmpty || nativeIsGenericStatusLabel(text) { continue }
        let phase = nativeFinalizedPhase(nativeActivityPhase(activity.phase))
        activities.append(
            NativeToolActivity(
                id: activity.id,
                phase: phase,
                text: nativeNormalizeVerb(text, phase: phase),
                timestamp: activity.timestamp ?? (baseTimestamp + Double(index + 1)),
                toolName: activity.toolName,
                toolCallId: activity.toolCallId,
                sandboxProvider: nativeNormalizeSandboxProvider(activity.sandboxProvider)
            )
        )
    }

    let renderedProcessActivityCount = activities.filter { $0.toolName != "__thought" }.count
    if renderedProcessActivityCount == 0 {
        for (index, toolCall) in nativeOrderedToolCalls(message.tool_calls).enumerated() {
            let rawPhase = nativeToolPhase(status: toolCall.status, error: toolCall.error)
            let phase = nativeFinalizedPhase(rawPhase)
            let text = nativeNormalizeActivityText(
                nativeFormatToolIntent(
                    toolName: toolCall.name,
                    args: toolCall.args,
                    phase: phase,
                    fallbackDetail: nativeFirstNonEmpty(toolCall.command, toolCall.detail)
                )
            )
            if text.isEmpty || nativeIsGenericStatusLabel(text) { continue }
            activities.append(
                NativeToolActivity(
                    id: "tool-\(toolCall.id)",
                    phase: phase,
                    text: text,
                    timestamp: toolCall.started_at ?? (baseTimestamp + Double(index + 1)),
                    toolName: toolCall.name,
                    toolCallId: toolCall.id,
                    sandboxProvider: nativeResolvedSandboxProvider(for: toolCall)
                )
            )
        }
    }

    return nativeDeduplicateActivities(activities)
        .sorted { left, right in
            if left.timestamp == right.timestamp { return left.id < right.id }
            return left.timestamp < right.timestamp
        }
}

func nativeSteeringProcessActivityPayloads(
    from activities: [NativeToolActivity]
) -> [GatewayProcessActivityPayload] {
    activities
        .filter { activity in
            let text = activity.text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            return !text.isEmpty &&
                !text.contains("steering to follow-up") &&
                !text.contains("starting queued follow-up")
        }
        .suffix(12)
        .map { activity in
            GatewayProcessActivityPayload(
                id: activity.id,
                phase: activity.phase.rawValue,
                text: activity.text,
                timestamp: activity.timestamp,
                toolName: activity.toolName,
                toolCallId: activity.toolCallId,
                sandboxProvider: activity.sandboxProvider
            )
        }
}

func nativeLiveActivity(from event: GatewayStatusEvent) -> NativeToolActivity? {
    guard (event.type ?? "status") == "status" else { return nil }
    let status = event.status?.lowercased() ?? ""
    let timestamp = event.timestamp ?? Date().timeIntervalSince1970 * 1000

    if status == "thinking" || status == "generating" || status == "compacting" {
        guard nativeFirstNonEmpty(event.toolName) == nil else { return nil }
        if status == "compacting" { return nil }
        let detail = nativeFirstNonEmpty(event.detail)
        let text = nativeIsMeaningfulThoughtLabel(detail ?? "")
            ? detail!
            : ""
        guard !text.isEmpty else { return nil }
        return NativeToolActivity(
            id: "thought-\(Int(timestamp))-\(text.prefix(10))",
            phase: .result,
            text: text,
            timestamp: timestamp,
            toolName: "__thought",
            toolCallId: nil,
            sandboxProvider: nil
        )
    }

    guard status == "tool_executing" || status == "tool_completed" || status == "error" else {
        return nil
    }

    let phase: NativeToolActivityPhase =
        status == "tool_executing" ? .start : (status == "tool_completed" ? .result : .error)
    let toolName = nativeFirstNonEmpty(event.toolName) ?? "tool"
    let text = nativeNormalizeActivityText(
        nativeFormatToolIntent(
            toolName: toolName,
            args: nil,
            phase: phase,
            fallbackDetail: event.detail
        )
    )
    guard !text.isEmpty, !nativeIsGenericStatusLabel(text) else { return nil }

    return NativeToolActivity(
        id: nativeFirstNonEmpty(event.toolCallId).map { "live-\($0)-\(phase.rawValue)" }
            ?? "live-\(toolName)-\(Int(timestamp))-\(phase.rawValue)",
        phase: phase,
        text: text,
        timestamp: timestamp,
        toolName: toolName,
        toolCallId: nativeFirstNonEmpty(event.toolCallId),
        sandboxProvider: nativeNormalizeSandboxProvider(event.sandboxProvider)
    )
}

func nativeLiveActivities(from snapshot: GatewaySessionStatusSnapshot) -> [NativeToolActivity] {
    var activities: [NativeToolActivity] = []

    for (index, activity) in snapshot.activities.enumerated() {
        let text = nativeNormalizeActivityText(activity.text ?? "")
        if text.isEmpty || nativeIsGenericStatusLabel(text) { continue }
        let phase = nativeActivityPhase(activity.phase)
        activities.append(
            NativeToolActivity(
                id: activity.id,
                phase: phase,
                text: nativeNormalizeVerb(text, phase: phase),
                timestamp: activity.timestamp ?? ((snapshot.timestamp ?? 0) + Double(index + 1)),
                toolName: activity.toolName,
                toolCallId: activity.toolCallId,
                sandboxProvider: nativeNormalizeSandboxProvider(activity.sandboxProvider)
            )
        )
    }

    if activities.isEmpty,
       let detail = nativeFirstNonEmpty(snapshot.detail),
       nativeIsMeaningfulThoughtLabel(detail) {
        activities.append(
            NativeToolActivity(
                id: "snapshot-thought-\(Int(snapshot.timestamp ?? 0))",
                phase: .result,
                text: detail,
                timestamp: snapshot.timestamp ?? Date().timeIntervalSince1970 * 1000,
                toolName: "__thought",
                toolCallId: nil,
                sandboxProvider: nil
            )
        )
    }

    return nativeDeduplicateActivities(activities)
        .sorted { left, right in
            if left.timestamp == right.timestamp { return left.id < right.id }
            return left.timestamp < right.timestamp
        }
}

func nativeMergeLiveActivity(
    _ existing: [NativeToolActivity],
    incoming: NativeToolActivity
) -> [NativeToolActivity] {
    var next = existing
    if incoming.phase != .start {
        if let toolCallId = nativeFirstNonEmpty(incoming.toolCallId),
           let index = next.lastIndex(where: {
               $0.phase == .start &&
               nativeFirstNonEmpty($0.toolCallId)?.lowercased() == toolCallId.lowercased()
           }) {
            next[index] = NativeToolActivity(
                id: next[index].id,
                phase: incoming.phase,
                text: incoming.text,
                timestamp: next[index].timestamp,
                toolName: incoming.toolName ?? next[index].toolName,
                toolCallId: toolCallId,
                sandboxProvider: incoming.sandboxProvider ?? next[index].sandboxProvider
            )
            return nativeSortedDedupedLiveActivities(next)
        }

        if let toolName = nativeFirstNonEmpty(incoming.toolName),
           let index = next.lastIndex(where: {
               $0.phase == .start &&
               nativeFirstNonEmpty($0.toolName)?.lowercased() == toolName.lowercased()
           }) {
            next[index] = NativeToolActivity(
                id: next[index].id,
                phase: incoming.phase,
                text: incoming.text,
                timestamp: next[index].timestamp,
                toolName: toolName,
                toolCallId: incoming.toolCallId ?? next[index].toolCallId,
                sandboxProvider: incoming.sandboxProvider ?? next[index].sandboxProvider
            )
            return nativeSortedDedupedLiveActivities(next)
        }
    }

    if let previous = next.last,
       previous.phase == incoming.phase,
       nativeNormalizeActivityText(previous.text).lowercased() == nativeNormalizeActivityText(incoming.text).lowercased(),
       incoming.timestamp - previous.timestamp < 750 {
        return next
    }

    next.append(incoming)
    return nativeSortedDedupedLiveActivities(next)
}

func nativeMergeLiveActivities(
    _ existing: [NativeToolActivity],
    incoming: [NativeToolActivity]
) -> [NativeToolActivity] {
    incoming.reduce(existing) { partial, activity in
        nativeMergeLiveActivity(partial, incoming: activity)
    }
}

func nativePrunePersistedLiveActivities(
    _ live: [NativeToolActivity],
    persistedMessages: [GatewaySessionMessage]
) -> [NativeToolActivity] {
    guard !live.isEmpty else { return live }
    var persistedKeys = Set<String>()
    for message in persistedMessages where message.role.lowercased() == "assistant" {
        for activity in nativeToolActivities(for: message) {
            persistedKeys.insert(nativeActivityDedupeKey(activity))
        }
    }
    guard !persistedKeys.isEmpty else { return live }
    return live.filter { !persistedKeys.contains(nativeActivityDedupeKey($0)) }
}

func nativeWorkedDurationLabel(for message: GatewaySessionMessage) -> String {
    let activities = nativeToolActivities(for: message)
    let timestamps = activities.map(\.timestamp).filter { $0 > 0 && $0.isFinite }
    let timestampDuration: Double? = timestamps.count >= 2
        ? max(0, (timestamps.max() ?? 0) - (timestamps.min() ?? 0))
        : nil
    let toolDuration = (message.tool_calls ?? []).reduce(0) { partial, toolCall in
        partial + max(0, toolCall.duration ?? 0)
    }
    let duration = max(timestampDuration ?? 0, toolDuration)
    return nativeFormatWorkedDuration(duration)
}

func nativeFormatToolIntent(
    toolName: String,
    args: [String: JSONValue]?,
    phase: NativeToolActivityPhase,
    fallbackDetail: String? = nil
) -> String {
    if let fallbackDetail = nativeFirstNonEmpty(fallbackDetail),
       !nativeIsGenericStatusLabel(fallbackDetail) {
        return nativeNormalizeVerb(fallbackDetail, phase: phase)
    }

    let key = toolName.lowercased()
    let path = nativeReadStringArg(args, keys: ["path", "file_path", "filePath"])
    let displayPath = path.map(nativeActivityPath)

    if key == "read" || key == "read_file" {
        if let displayPath {
            let offset = nativeReadNumberArg(args, keys: ["offset"])
            let limit = nativeReadNumberArg(args, keys: ["limit"])
            if let offset, let limit, limit > 0 {
                let startLine = max(1, Int(offset.rounded(.down)))
                let endLine = startLine + max(1, Int(limit.rounded(.down))) - 1
                if phase == .start { return "Exploring \(displayPath) (lines \(startLine)-\(endLine))" }
                if phase == .result { return "Explored \(displayPath) (lines \(startLine)-\(endLine))" }
                return "Read failed for \(displayPath)"
            }
            if phase == .start { return "Exploring \(displayPath)" }
            if phase == .result { return "Explored \(displayPath)" }
            return "Read failed for \(displayPath)"
        }
        if phase == .start { return "Exploring files..." }
        if phase == .result { return "Exploration complete" }
        return "Read failed"
    }

    if key == "write" || key == "edit" || key == "apply_patch" {
        if let displayPath {
            if phase == .start { return key == "edit" ? "Editing \(displayPath)" : "Writing \(displayPath)" }
            if phase == .result { return "Edited \(displayPath)" }
            return "Edit failed for \(displayPath)"
        }
        if phase == .start { return key == "edit" ? "Editing file..." : "Writing file..." }
        if phase == .result { return "Edit complete" }
        return "Edit failed"
    }

    if key == "file_search" || key == "grep" || key == "rg" || key == "tool_search" {
        let pattern = nativeReadStringArg(args, keys: ["pattern", "query", "q"])
        let basePath = nativeReadStringArg(args, keys: ["path"])
        if let pattern, let basePath {
            if phase == .start { return "Searching \(basePath) for \"\(pattern)\"" }
            if phase == .result { return "Searched \(basePath) for \"\(pattern)\"" }
            return "Search failed in \(basePath)"
        }
        if let pattern {
            if phase == .start { return "Searching for \"\(pattern)\"" }
            if phase == .result { return "Search complete for \"\(pattern)\"" }
            return "Search failed for \"\(pattern)\""
        }
        if phase == .start { return "Searching files..." }
        if phase == .result { return key == "tool_search" ? "tool_search complete" : "Search complete" }
        return "Search failed"
    }

    if key == "web_search" {
        let query = nativeReadStringArg(args, keys: ["query"])
        if let query {
            if phase == .start { return "Searching web for \"\(query)\"" }
            if phase == .result { return "Web search complete for \"\(query)\"" }
            return "Web search failed for \"\(query)\""
        }
        if phase == .start { return "Searching the web..." }
        if phase == .result { return "Web search complete" }
        return "Web search failed"
    }

    if key == "web_fetch" {
        let url = nativeReadStringArg(args, keys: ["url"])
        if let url {
            if phase == .start { return "Fetching \(url)" }
            if phase == .result { return "Fetched \(url)" }
            return "Fetch failed for \(url)"
        }
        if phase == .start { return "Fetching webpage..." }
        if phase == .result { return "Fetch complete" }
        return "Fetch failed"
    }

    if key == "exec" || key == "process" || key == "git" || key == "shell" || key == "exec_command" {
        let command = nativeReadStringArg(args, keys: ["command", "cmd"]) ?? fallbackDetail
        if let command = nativeFirstNonEmpty(command), !nativeIsGenericStatusLabel(command) {
            let summary = nativeSummarizeCommand(command)
            if phase == .start { return "Running \(summary)" }
            if phase == .result { return "Ran \(summary)" }
            return "Command failed: \(summary)"
        }
        if phase == .start { return "Running command..." }
        if phase == .result { return "Command complete" }
        return "Command failed"
    }

    if key.contains("browser") {
        if phase == .start { return "Using browser..." }
        if phase == .result { return "Browser step complete" }
        return "Browser step failed"
    }

    if key.contains("artifact") {
        if phase == .start { return "Updating artifact..." }
        if phase == .result { return "Artifact updated" }
        return "Artifact update failed"
    }

    if phase == .start { return "\(toolName) running..." }
    if phase == .result { return "\(toolName) complete" }
    return "\(toolName) failed"
}

func nativeResolvedSandboxProvider(for toolCall: GatewayToolCall) -> String? {
    if let provider = nativeNormalizeSandboxProvider(toolCall.sandboxProvider) {
        return provider
    }
    guard case .object(let result)? = toolCall.result else { return nil }
    if case .string(let provider)? = result["sandboxProvider"] ?? result["sandbox_provider"] {
        return nativeNormalizeSandboxProvider(provider)
    }
    return nil
}

func nativeSandboxProviderLabel(_ provider: String) -> String {
    switch provider {
    case "apple_sandbox": return "Apple Sandbox"
    case "podman": return "Podman"
    case "docker": return "Docker"
    case "host": return "Host"
    default:
        return provider
            .split(separator: "_")
            .map { $0.capitalized }
            .joined(separator: " ")
    }
}

func nativeFirstNonEmpty(_ values: String?...) -> String? {
    for value in values {
        if let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty {
            return trimmed
        }
    }
    return nil
}

private func nativeDeduplicateActivities(_ activities: [NativeToolActivity]) -> [NativeToolActivity] {
    var seen = Set<String>()
    var results: [NativeToolActivity] = []
    for activity in activities {
        let key: String
        if let toolCallId = nativeFirstNonEmpty(activity.toolCallId) {
            key = "tool:\(toolCallId):\(activity.phase.rawValue)"
        } else {
            key = "\(activity.phase.rawValue):\(activity.toolName ?? ""):\(nativeNormalizeActivityText(activity.text).lowercased())"
        }
        if seen.contains(key) { continue }
        seen.insert(key)
        results.append(activity)
    }
    return results
}

private func nativeActivityDedupeKey(_ activity: NativeToolActivity) -> String {
    let phase = nativeFinalizedPhase(activity.phase)
    let text = nativeNormalizeVerb(nativeNormalizeActivityText(activity.text), phase: phase)
        .lowercased()
    let toolCallId = nativeFirstNonEmpty(activity.toolCallId) ?? ""
    return "\(toolCallId):\(phase.rawValue):\(activity.toolName ?? ""):\(text)"
}

private func nativeSortedDedupedLiveActivities(_ activities: [NativeToolActivity]) -> [NativeToolActivity] {
    nativeDeduplicateActivities(activities)
        .sorted { left, right in
            if left.timestamp == right.timestamp { return left.id < right.id }
            return left.timestamp < right.timestamp
        }
}

private func nativeToolArgumentsString(_ args: [String: JSONValue]?) -> String? {
    guard let args, !args.isEmpty else { return nil }
    let object = args.mapValues(\.anyValue)
    guard JSONSerialization.isValidJSONObject(object),
          let data = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
    else {
        return args
            .sorted { $0.key < $1.key }
            .map { "\($0.key): \($0.value.displayString)" }
            .joined(separator: "\n")
    }
    return String(data: data, encoding: .utf8)
}

private func nativeBoundedPayload(_ content: String, limit: Int = 12_000) -> String {
    guard content.count > limit else { return content }
    let end = content.index(content.startIndex, offsetBy: limit)
    return String(content[..<end]) + "\n... truncated in view"
}

private func nativeToolCallTitle(_ toolCall: GatewayToolCall) -> String {
    toolCall.name
}

private func nativeToolCallSubtitle(_ toolCall: GatewayToolCall) -> String? {
    if let duration = toolCall.duration, duration > 0 {
        return nativeCompactDuration(duration)
    }
    if let detail = nativeFirstNonEmpty(toolCall.command, toolCall.detail) {
        return nativeSummarizeCommand(detail)
    }
    return nil
}

private func nativeToolCallStatusLabel(_ toolCall: GatewayToolCall) -> String {
    if nativeFirstNonEmpty(toolCall.error) != nil { return "Failed" }
    switch toolCall.status?.lowercased() {
    case "pending": return "Pending"
    case "executing", "running": return "Running"
    case "failed", "error": return "Failed"
    case "success", "completed", "complete": return "Complete"
    default:
        return toolCall.result == nil ? "Recorded" : "Complete"
    }
}

private func nativeToolCallIcon(_ toolCall: GatewayToolCall) -> String {
    if toolCall.name == "sessions_transfer" { return "arrow.left.arrow.right" }
    switch nativeToolPhase(status: toolCall.status, error: toolCall.error) {
    case .start: return "clock"
    case .result: return "checkmark.circle.fill"
    case .error: return "exclamationmark.triangle.fill"
    }
}

private func nativeToolCallTint(_ toolCall: GatewayToolCall) -> Color {
    switch nativeToolPhase(status: toolCall.status, error: toolCall.error) {
    case .start: return .orange
    case .result: return .green
    case .error: return .red
    }
}

private func nativeToolPhase(status: String?, error: String? = nil) -> NativeToolActivityPhase {
    if nativeFirstNonEmpty(error) != nil { return .error }
    switch status?.lowercased() {
    case "pending", "executing", "running":
        return .start
    case "failed", "error":
        return .error
    default:
        return .result
    }
}

private func nativeActivityPhase(_ phase: String?) -> NativeToolActivityPhase {
    switch phase?.lowercased() {
    case "start", "pending", "running":
        return .start
    case "error", "failed":
        return .error
    default:
        return .result
    }
}

private func nativeFinalizedPhase(_ phase: NativeToolActivityPhase) -> NativeToolActivityPhase {
    phase == .start ? .result : phase
}

private func nativeNormalizeVerb(_ text: String, phase: NativeToolActivityPhase) -> String {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty || phase == .start { return trimmed }

    let replacements: [(String, String)]
    if phase == .result {
        replacements = [
            ("Exploring", "Explored"),
            ("Searching", "Searched"),
            ("Fetching", "Fetched"),
            ("Running", "Ran"),
            ("Writing", "Edited"),
            ("Editing", "Edited"),
        ]
    } else {
        replacements = [
            ("Exploring", "Read failed"),
            ("Searching", "Search failed"),
            ("Fetching", "Fetch failed"),
            ("Running", "Command failed"),
            ("Writing", "Edit failed"),
            ("Editing", "Edit failed"),
        ]
    }
    for (from, to) in replacements where trimmed.lowercased().hasPrefix(from.lowercased()) {
        return to + String(trimmed.dropFirst(from.count))
    }
    return trimmed
}

private func nativeReadStringArg(_ args: [String: JSONValue]?, keys: [String]) -> String? {
    guard let args else { return nil }
    for key in keys {
        guard let value = args[key] else { continue }
        switch value {
        case .string(let text):
            if let trimmed = nativeFirstNonEmpty(text) { return trimmed }
        case .number(let number):
            return number.rounded() == number ? String(Int(number)) : String(number)
        case .bool(let flag):
            return flag ? "true" : "false"
        default:
            continue
        }
    }
    return nil
}

private func nativeReadNumberArg(_ args: [String: JSONValue]?, keys: [String]) -> Double? {
    guard let args else { return nil }
    for key in keys {
        guard let value = args[key] else { continue }
        switch value {
        case .number(let number):
            return number
        case .string(let text):
            if let parsed = Double(text.trimmingCharacters(in: .whitespacesAndNewlines)) {
                return parsed
            }
        default:
            continue
        }
    }
    return nil
}

private func nativeActivityPath(_ path: String) -> String {
    let normalized = path.replacingOccurrences(of: "\\", with: "/").trimmingCharacters(in: .whitespacesAndNewlines)
    if normalized.isEmpty { return "file" }
    return normalized.split(separator: "/").last.map(String.init) ?? normalized
}

private func nativeSummarizeCommand(_ command: String) -> String {
    let compact = command
        .components(separatedBy: .newlines)
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
        .joined(separator: " ")
    if compact.isEmpty { return "command" }
    guard compact.count > 72 else { return compact }
    let end = compact.index(compact.startIndex, offsetBy: 69)
    return String(compact[..<end]) + "..."
}

private let nativeReasoningMarkupTokenPattern =
    "</?(?:REASONING_SCRATCHPAD|antthinking|(?:antml:|mm:)?(?:thinking|think|thought)|reasoning|final)\\b[^>]*>|\\[/?(?:thinking|reasoning)\\]"

private func nativeNormalizeActivityText(_ value: String) -> String {
    // Bare reasoning tag deltas (e.g. "</think>") must never render as
    // activity text; also cleans activities persisted before the gateway
    // stripped them at the source.
    value.replacingOccurrences(
        of: nativeReasoningMarkupTokenPattern,
        with: " ",
        options: [.regularExpression, .caseInsensitive]
    )
    .trimmingCharacters(in: .whitespacesAndNewlines)
    .components(separatedBy: .whitespacesAndNewlines)
    .filter { !$0.isEmpty }
    .joined(separator: " ")
}

private func nativeIsGenericStatusLabel(_ value: String) -> Bool {
    [
        "none",
        "value",
        "completed",
        "complete",
        "success",
        "failed",
        "error",
        "running",
        "pending",
    ].contains(value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
}

private func nativeIsMeaningfulThoughtLabel(_ value: String) -> Bool {
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if normalized.isEmpty { return false }
    return ![
        "thinking",
        "thinking...",
        "generating response",
        "generating response...",
        "working",
        "working...",
        "idle",
    ].contains(normalized)
}

private func nativeLatestInFlightStep(_ activities: [NativeToolActivity]) -> String? {
    for activity in activities.reversed() where activity.phase == .start {
        if !nativeIsGenericStatusLabel(activity.text) {
            return activity.text
        }
    }
    return nil
}

func nativeLiveWorkedDurationLabel(
    startedAt: Date?,
    activities: [NativeToolActivity],
    now: Date = Date()
) -> String {
    if let startedAt {
        return nativeFormatWorkedDuration(now.timeIntervalSince(startedAt) * 1000)
    }
    let firstTimestamp = activities
        .map(\.timestamp)
        .filter { $0 > 0 && $0.isFinite }
        .min()
    guard let firstTimestamp else { return nativeFormatWorkedDuration(0) }
    return nativeFormatWorkedDuration(max(0, now.timeIntervalSince1970 * 1000 - firstTimestamp))
}

private func nativeNormalizeSandboxProvider(_ value: String?) -> String? {
    guard let normalized = nativeFirstNonEmpty(value)?.lowercased() else { return nil }
    if ["apple_sandbox", "podman", "docker", "host"].contains(normalized) {
        return normalized
    }
    return nil
}

private func nativeTimestampMs(_ value: String?) -> Double? {
    guard let trimmed = nativeFirstNonEmpty(value) else { return nil }
    if let numeric = Double(trimmed) { return numeric }
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: trimmed) ?? ISO8601DateFormatter().date(from: trimmed) {
        return date.timeIntervalSince1970 * 1000
    }
    let sqlite = DateFormatter()
    sqlite.locale = Locale(identifier: "en_US_POSIX")
    sqlite.timeZone = TimeZone(secondsFromGMT: 0)
    sqlite.dateFormat = "yyyy-MM-dd HH:mm:ss"
    return sqlite.date(from: trimmed).map { $0.timeIntervalSince1970 * 1000 }
}

private func nativeFormatWorkedDuration(_ durationMs: Double) -> String {
    let totalSeconds = max(0, Int(durationMs / 1000))
    let hours = totalSeconds / 3600
    let minutes = (totalSeconds % 3600) / 60
    let seconds = totalSeconds % 60
    return "\(hours)h \(String(format: "%02d", minutes))m \(String(format: "%02d", seconds))s"
}

private func nativeCompactDuration(_ durationMs: Double) -> String {
    if durationMs < 1000 {
        return "\(max(0, Int(durationMs.rounded()))) ms"
    }
    if durationMs < 60_000 {
        return String(format: "%.1fs", durationMs / 1000)
    }
    return nativeFormatWorkedDuration(durationMs)
}

// ── Codex-style tool-call grouping (parity with the web + mobile timeline) ───

enum NativeActivityGroupKind: Hashable {
    case read
    case search
    case list
    case edit
    case fetch
    case command
}

enum NativeTimelineEntry: Identifiable {
    case single(NativeToolActivity)
    case group(id: String, label: String, items: [NativeToolActivity])

    var id: String {
        switch self {
        case .single(let activity): return "single-\(activity.id)"
        case .group(let id, _, _): return id
        }
    }
}

private let nativeGroupableToolKinds: [String: NativeActivityGroupKind] = [
    "read": .read, "grep": .search, "file_search": .search, "glob": .search,
    "web_search": .search, "ls": .list, "list": .list,
    "write": .edit, "edit": .edit, "apply_patch": .edit, "multi_edit": .edit,
    "web_fetch": .fetch, "fetch": .fetch, "http_request": .fetch,
]

private let nativeReadOnlyCommandKinds: [String: NativeActivityGroupKind] = [
    "cat": .read, "head": .read, "tail": .read, "bat": .read, "less": .read, "more": .read,
    "ls": .list, "find": .list, "tree": .list, "fd": .list, "dir": .list,
    "grep": .search, "rg": .search, "ag": .search, "ack": .search, "ripgrep": .search,
    "wc": .command, "cloc": .command, "du": .command, "stat": .command, "file": .command,
    "which": .command, "pwd": .command, "echo": .command, "env": .command, "printenv": .command,
    "date": .command, "whoami": .command, "uname": .command, "hostname": .command,
    "cd": .command, "pushd": .command, "popd": .command, "printf": .command, "true": .command,
    ":": .command,
]

private let nativeReadOnlyGitSubcommands: Set<String> = [
    "log", "status", "diff", "show", "branch", "blame", "remote", "config", "shortlog",
    "rev-parse", "rev-list", "describe", "ls-files", "ls-tree", "cat-file", "reflog",
    "whatchanged", "show-ref", "name-rev", "count-objects", "for-each-ref", "symbolic-ref",
    "merge-base", "grep", "tag", "stash",
]

private let nativeCommandPrefixWrappers: Set<String> = [
    "sudo", "command", "time", "nice", "nohup", "env", "xargs",
]

private func nativeClassifyShellStage(_ stage: String) -> NativeActivityGroupKind? {
    let tokens = stage.trimmingCharacters(in: .whitespaces).split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init)
    guard !tokens.isEmpty else { return nil }
    var index = 0
    while index < tokens.count {
        let token = tokens[index]
        if token.range(of: "^[A-Za-z_][A-Za-z0-9_]*=", options: .regularExpression) != nil {
            index += 1
            continue
        }
        if index > 0 && token.hasPrefix("-") {
            index += 1
            continue
        }
        let stripped = (token.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? token).lowercased()
        if nativeCommandPrefixWrappers.contains(stripped) && stripped != "env" && stripped != "xargs" {
            index += 1
            continue
        }
        if (stripped == "env" || stripped == "xargs") && index + 1 < tokens.count && !tokens[index + 1].hasPrefix("-") {
            index += 1
            continue
        }
        break
    }
    guard index < tokens.count else { return nil }
    let verb = (tokens[index].split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? tokens[index]).lowercased()
    if verb.isEmpty { return nil }
    if verb == "git" {
        let sub = index + 1 < tokens.count ? tokens[index + 1].lowercased() : ""
        return nativeReadOnlyGitSubcommands.contains(sub) ? .command : nil
    }
    return nativeReadOnlyCommandKinds[verb]
}

private func nativeClassifyShellCommand(_ command: String) -> NativeActivityGroupKind? {
    var trimmed = command.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.hasSuffix("...") { trimmed = String(trimmed.dropLast(3)).trimmingCharacters(in: .whitespaces) }
    if trimmed.isEmpty { return nil }
    let stages = trimmed
        .components(separatedBy: CharacterSet(charactersIn: ";\n"))
        .flatMap { $0.components(separatedBy: "&&") }
        .flatMap { $0.components(separatedBy: "||") }
        .flatMap { $0.components(separatedBy: "|") }
        .map { $0.trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty }
    guard !stages.isEmpty else { return nil }
    var kinds: [NativeActivityGroupKind] = []
    for stage in stages {
        guard let kind = nativeClassifyShellStage(stage) else { return nil }
        kinds.append(kind)
    }
    return kinds.first(where: { $0 != .command }) ?? .command
}

private func nativeGroupKind(_ activity: NativeToolActivity) -> NativeActivityGroupKind? {
    guard activity.phase == .result else { return nil }
    let toolName = (activity.toolName ?? "").lowercased()
    if let kind = nativeGroupableToolKinds[toolName] { return kind }
    if toolName == "exec" || toolName == "process" || toolName == "git" || toolName.isEmpty {
        if let range = activity.text.range(of: "^Ran\\s+", options: .regularExpression) {
            return nativeClassifyShellCommand(String(activity.text[range.upperBound...]))
        }
        if toolName.isEmpty {
            if activity.text.hasPrefix("Explored ") { return .read }
            if activity.text.hasPrefix("Searched ") { return .search }
            if activity.text.hasPrefix("Listed ") { return .list }
            if activity.text.range(of: "^(Edited|Created|Updated|Wrote|Deleted) ", options: .regularExpression) != nil { return .edit }
            if activity.text.hasPrefix("Fetched ") { return .fetch }
        }
    }
    return nil
}

private func nativeGroupLabel(_ kinds: [NativeActivityGroupKind], _ count: Int) -> String {
    var ordered: [NativeActivityGroupKind] = []
    var counts: [NativeActivityGroupKind: Int] = [:]
    for kind in kinds {
        if counts[kind] == nil { ordered.append(kind) }
        counts[kind, default: 0] += 1
    }
    let joined = ordered.map { nativeGroupPhrase($0, counts[$0] ?? count) }.joined(separator: ", ")
    guard let first = joined.first else { return "Ran \(count) commands" }
    return String(first).uppercased() + String(joined.dropFirst())
}

private func nativeGroupPhrase(_ kind: NativeActivityGroupKind, _ count: Int) -> String {
    switch kind {
    case .read: return count == 1 ? "read a file" : "read \(count) files"
    case .search: return count == 1 ? "ran a search" : "ran \(count) searches"
    case .list: return count == 1 ? "listed a location" : "listed \(count) locations"
    case .edit: return count == 1 ? "edited a file" : "edited \(count) files"
    case .fetch: return count == 1 ? "fetched a page" : "fetched \(count) pages"
    case .command: return count == 1 ? "ran a command" : "ran \(count) commands"
    }
}

private func nativeGroupIcon(_ items: [NativeToolActivity]) -> String {
    let kinds = items.compactMap(nativeGroupKind)
    if kinds.contains(where: { $0 == .edit }) { return "pencil" }
    if kinds.contains(where: { $0 == .fetch }) { return "globe" }
    if kinds.contains(where: { $0 == .search }) { return "magnifyingglass" }
    if kinds.contains(where: { $0 == .read }) { return "doc.text" }
    if kinds.contains(where: { $0 == .list }) { return "folder" }
    return "terminal"
}

func nativeGroupActivities(_ activities: [NativeToolActivity]) -> [NativeTimelineEntry] {
    var entries: [NativeTimelineEntry] = []
    var runKinds: [NativeActivityGroupKind] = []
    var runItems: [NativeToolActivity] = []

    func flush() {
        guard !runItems.isEmpty else { return }
        if runKinds.count >= 2 {
            entries.append(.group(id: "group-\(runItems[0].id)-\(runItems.count)",
                                  label: nativeGroupLabel(runKinds, runKinds.count),
                                  items: runItems))
        } else {
            for item in runItems { entries.append(.single(item)) }
        }
        runKinds = []
        runItems = []
    }

    for activity in activities {
        if activity.toolName == "__thought" {
            flush()
            entries.append(.single(activity))
            continue
        }
        guard let kind = nativeGroupKind(activity) else {
            flush()
            entries.append(.single(activity))
            continue
        }
        runKinds.append(kind)
        runItems.append(activity)
    }
    flush()
    return entries
}

/// Renders a grouped activity list with collapsible "Ran N commands" rows.
struct NativeGroupedActivities: View {
    let activities: [NativeToolActivity]
    @State private var expanded: Set<String> = []
    @Environment(\.nativeChatAppearance) private var appearance

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            ForEach(nativeGroupActivities(activities)) { entry in
                switch entry {
                case .single(let activity):
                    NativeToolActivityRow(activity: activity)
                case .group(let id, let label, let items):
                    let isExpanded = expanded.contains(id)
                    Button {
                        if isExpanded { expanded.remove(id) } else { expanded.insert(id) }
                    } label: {
                        HStack(alignment: .top, spacing: 7) {
                            Image(systemName: nativeGroupIcon(items))
                                .font(.system(size: 11.5, weight: .semibold))
                                .foregroundStyle(.secondary)
                                .frame(width: 13, alignment: .center)
                                .padding(.top, 1)
                            Text(label)
                                .font(.system(size: appearance.activityFontSize, weight: .medium, design: .rounded))
                                .foregroundStyle(appearance.highContrast ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary))
                            Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                                .font(.system(size: 9, weight: .semibold))
                                .foregroundStyle(.tertiary)
                        }
                    }
                    .buttonStyle(.plain)
                    if isExpanded {
                        VStack(alignment: .leading, spacing: 5) {
                            ForEach(items) { item in
                                NativeToolActivityRow(activity: item)
                            }
                        }
                        .padding(.leading, 10)
                    }
                }
            }
        }
    }
}
