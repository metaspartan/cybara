import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct NativeChatFileChangeItem: Identifiable, Hashable {
    let path: String
    let kind: String
    let added: Int
    let removed: Int

    var id: String { path }
    var systemImage: String {
        switch kind {
        case "created": return "doc.badge.plus"
        case "deleted": return "doc.badge.minus"
        default: return "doc.text"
        }
    }
}

struct NativeChatFileChangeSummary: Hashable {
    let files: [NativeChatFileChangeItem]
    let totalAdded: Int
    let totalRemoved: Int
}

struct NativeChatFilePathDisplay: Hashable {
    let fileName: String
    let parentPath: String?
    let fullPath: String
}

func nativeNormalizeDisplayPath(_ path: String) -> String {
    path.trimmingCharacters(in: .whitespacesAndNewlines)
        .replacingOccurrences(of: "\\", with: "/")
        .replacingOccurrences(of: #"/+"#, with: "/", options: .regularExpression)
}

func nativeIsAbsoluteDisplayPath(_ path: String) -> Bool {
    path.hasPrefix("/") || path.hasPrefix("~/") || path.range(of: #"^[A-Za-z]:/"#, options: .regularExpression) != nil
}

func nativeChatFilePathDisplay(_ path: String, workspaceDir: String?) -> NativeChatFilePathDisplay {
    let fullPath = nativeNormalizeDisplayPath(path)
    let workspace = nativeNormalizeDisplayPath(workspaceDir ?? "").replacingOccurrences(
        of: #"/+$"#,
        with: "",
        options: .regularExpression
    )
    var relativePath = fullPath.replacingOccurrences(of: #"^\./"#, with: "", options: .regularExpression)
    var outsideWorkspace = false
    if !workspace.isEmpty {
        if fullPath.caseInsensitiveCompare(workspace) == .orderedSame {
            relativePath = fullPath.split(separator: "/").last.map(String.init) ?? fullPath
        } else if fullPath.lowercased().hasPrefix("\(workspace.lowercased())/") {
            relativePath = String(fullPath.dropFirst(workspace.count + 1))
        } else if nativeIsAbsoluteDisplayPath(fullPath) {
            outsideWorkspace = true
        }
    }
    var segments = relativePath.split(separator: "/").map(String.init)
    let fileName = segments.popLast() ?? relativePath
    let parentPath = outsideWorkspace && !workspace.isEmpty
        ? "Outside workspace"
        : (segments.isEmpty ? nil : segments.joined(separator: "/"))
    return NativeChatFilePathDisplay(
        fileName: fileName.isEmpty ? "file" : fileName,
        parentPath: parentPath,
        fullPath: fullPath
    )
}

struct NativeSessionPlanItem: Identifiable, Hashable {
    let id = UUID()
    let content: String
    let status: String
    let priority: String
}

struct NativeSessionPlanSnapshot: Hashable {
    let items: [NativeSessionPlanItem]
    let completed: Int
    let total: Int
    let updatedAt: String?

    var progress: Double {
        guard total > 0 else { return 0 }
        return Double(completed) / Double(total)
    }
}

struct NativeEnvironmentSection<Content: View>: View {
    let title: String
    let content: Content

    init(title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Divider().opacity(0.35)
            Text(title)
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundStyle(.secondary)
            content
        }
    }
}

struct NativeEnvironmentRow<Content: View>: View {
    let icon: String
    let label: String
    let content: Content

    init(icon: String, label: String, @ViewBuilder content: () -> Content) {
        self.icon = icon
        self.label = label
        self.content = content()
    }

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: icon)
                .foregroundStyle(.secondary)
                .frame(width: 16)
            Text(label)
                .foregroundStyle(.secondary)
                .frame(width: 58, alignment: .leading)
            Spacer(minLength: 8)
            content
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .font(.system(size: 12, design: .rounded))
    }
}

struct NativeEnvironmentUsageStat: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .medium, design: .rounded))
                .foregroundStyle(.tertiary)
                .lineLimit(1)
            Text(value)
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct NativeEmptyPopoverState: View {
    let icon: String
    let title: String
    let detail: String

    var body: some View {
        VStack(spacing: 7) {
            Image(systemName: icon)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
            Text(detail)
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
    }
}

struct NativeSessionPlanCard: View {
    let plan: NativeSessionPlanSnapshot
    @State var expanded = true

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 7) {
                ForEach(plan.items) { item in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: nativePlanItemIcon(item.status))
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(nativePlanItemTint(item.status))
                            .frame(width: 14)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.content)
                                .font(.system(size: 11.5, design: .rounded))
                                .lineLimit(3)
                            Text(item.priority.capitalized)
                                .font(.system(size: 10, weight: .medium, design: .rounded))
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .padding(.top, 8)
        } label: {
            VStack(alignment: .leading, spacing: 7) {
                HStack {
                    Label("Latest plan", systemImage: "checklist")
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                    Spacer()
                    Text("\(plan.completed)/\(plan.total) complete")
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .foregroundStyle(.secondary)
                }
                ProgressView(value: plan.progress)
                    .tint(plan.completed >= plan.total ? .green : .blue)
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white.opacity(0.05)))
    }
}

struct NativeSubagentCompactRow: View {
    let subagent: NativeSubagentSummary

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(nativeSubagentStatusColor(subagent.status))
                .frame(width: 7, height: 7)
            Text(subagent.label)
                .lineLimit(1)
            Spacer()
            Text(subagent.status.capitalized)
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .foregroundStyle(.secondary)
        }
        .font(.system(size: 12, design: .rounded))
    }
}

struct NativeSubagentDetailRow: View {
    let subagent: NativeSubagentSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Circle()
                    .fill(nativeSubagentStatusColor(subagent.status))
                    .frame(width: 8, height: 8)
                Text(subagent.label)
                    .font(.system(size: 12.5, weight: .semibold, design: .rounded))
                    .lineLimit(1)
                Spacer()
                Text(subagent.status.capitalized)
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
            }
            if let task = firstNonEmptyGatewayString(subagent.task) {
                Text(task)
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }
            HStack(spacing: 8) {
                if let model = firstNonEmptyGatewayString(subagent.model) {
                    Label(model, systemImage: "cpu")
                }
                if let workspace = gatewayWorkspaceLabel(subagent.workspaceDir, maxLength: 28) {
                    Label(workspace, systemImage: "folder")
                }
            }
            .font(.system(size: 10, design: .rounded))
            .foregroundStyle(.tertiary)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white.opacity(0.05)))
    }
}

struct NativeSubagentRunDetail: View {
    let subagent: NativeSubagentSummary
    let mediaBaseURL: URL
    let mediaToken: String?
    let onStop: (() -> Void)?
    let onClear: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Circle()
                    .fill(nativeSubagentStatusColor(subagent.status))
                    .frame(width: 8, height: 8)
                Text(subagent.status.capitalized)
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                Spacer()
                Text("\(subagent.toolCallCount ?? 0) tool calls")
                    .font(.system(size: 10, design: .rounded))
                    .foregroundStyle(.secondary)
            }

            if let task = firstNonEmptyGatewayString(subagent.task) {
                Text(task)
                    .font(.system(size: 12, design: .rounded))
                    .textSelection(.enabled)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(Color.white.opacity(0.05))
                    )
            }

            if let onStop {
                Button(role: .destructive, action: onStop) {
                    Label("Stop Subagent", systemImage: "stop.fill")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            } else if let onClear {
                Button(role: .destructive, action: onClear) {
                    Label("Clear This Run", systemImage: "trash")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }

            let visibleActivities = (subagent.activities ?? []).filter {
                guard let text = firstNonEmptyGatewayString($0.text) else { return true }
                return !nativeIsGenericStatusLabel(text)
            }
            if !visibleActivities.isEmpty {
                nativeSubagentSection("Activity") {
                    VStack(alignment: .leading, spacing: 9) {
                        ForEach(visibleActivities) { activity in
                            HStack(alignment: .top, spacing: 8) {
                                Circle()
                                    .fill(.secondary)
                                    .frame(width: 5, height: 5)
                                    .padding(.top, 6)
                                VStack(alignment: .leading, spacing: 2) {
                                    if let text = firstNonEmptyGatewayString(activity.text) {
                                        Text(text)
                                            .font(.system(size: 11.5, design: .rounded))
                                            .textSelection(.enabled)
                                    }
                                    if let toolName = firstNonEmptyGatewayString(activity.toolName), toolName != "__thought" {
                                        Text("\(toolName) · \(activity.phase ?? "activity")")
                                            .font(.system(size: 9.5, design: .monospaced))
                                            .foregroundStyle(.tertiary)
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if let thinking = firstNonEmptyGatewayString(subagent.thinking),
               !(subagent.activities ?? []).contains(where: { $0.toolName == "__thought" }) {
                nativeSubagentSection("Thinking") {
                    Text(thinking)
                        .font(.system(size: 11.5, design: .rounded))
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            }

            if let toolCalls = subagent.toolCalls, !toolCalls.isEmpty {
                nativeSubagentSection("Tool Calls") {
                    VStack(alignment: .leading, spacing: 7) {
                        ForEach(toolCalls) { toolCall in
                            NativeSubagentToolCallRow(toolCall: toolCall)
                        }
                    }
                }
            }

            if let output = firstNonEmptyGatewayString(subagent.result)
                ?? firstNonEmptyGatewayString(subagent.error) {
                nativeSubagentSection("Final Output") {
                    NativeMarkdownView(
                        content: output,
                        isUser: false,
                        mediaBaseURL: mediaBaseURL,
                        mediaToken: mediaToken
                    )
                        .textSelection(.enabled)
                }
            }
        }
    }

    func nativeSubagentSection<Content: View>(
        _ title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title.uppercased())
                .font(.system(size: 9.5, weight: .semibold, design: .rounded))
                .foregroundStyle(.tertiary)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct NativeSubagentToolCallRow: View {
    let toolCall: GatewayToolCall
    @State var expanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 8) {
                if let args = toolCall.args, !args.isEmpty {
                    nativeToolValue("Arguments", value: JSONValue.object(args).displayString)
                }
                nativeToolValue(
                    "Output",
                    value: nativeSubagentToolOutput(toolCall.result)
                        ?? firstNonEmptyGatewayString(toolCall.error)
                        ?? "No output recorded"
                )
            }
            .padding(.top, 7)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: toolCall.status == "failed" ? "xmark.circle" : "terminal")
                    .foregroundStyle(toolCall.status == "failed" ? .red : .secondary)
                Text(toolCall.name)
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .lineLimit(1)
                Spacer()
                Text((toolCall.status ?? "completed").capitalized)
                    .font(.system(size: 9.5, design: .rounded))
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(9)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.white.opacity(0.04))
        )
    }

    func nativeToolValue(_ label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .semibold, design: .rounded))
                .foregroundStyle(.tertiary)
            Text(value)
                .font(.system(size: 10.5, design: .monospaced))
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    func nativeSubagentToolOutput(_ result: JSONValue?) -> String? {
        guard let result else { return nil }
        if case .object(let values) = result {
            for key in ["content", "output", "stdout"] {
                if case .string(let value) = values[key], let normalized = firstNonEmptyGatewayString(value) {
                    return normalized
                }
            }
        }
        return result.displayString
    }
}

struct NativeToolNameCloud: View {
    let names: [String]

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 76), spacing: 6)], alignment: .leading, spacing: 6) {
            ForEach(names.prefix(18), id: \.self) { name in
                Text(name)
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(Color.white.opacity(0.06)))
            }
        }
    }
}

func summarizeNativeChatFileChanges(
    _ messages: [GatewaySessionMessage],
    liveActivities: [NativeToolActivity] = []
) -> NativeChatFileChangeSummary {
    var files: [String: NativeChatFileChangeItem] = [:]
    func pathKey(_ path: String) -> String {
        path.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\\", with: "/")
            .replacingOccurrences(of: "/+", with: "/", options: .regularExpression)
            .lowercased()
    }
    func matchingKey(_ path: String) -> String? {
        let candidate = pathKey(path)
        return files.keys.first { key in
            key == candidate || key.hasSuffix("/\(candidate)") || candidate.hasSuffix("/\(key)")
        }
    }
    func merge(_ item: NativeChatFileChangeItem) {
        let key = matchingKey(item.path) ?? pathKey(item.path)
        if let existing = files[key] {
            let kind = item.kind == "deleted" || existing.kind == "deleted"
                ? "deleted"
                : (item.kind == "updated" || existing.kind == "updated" ? "updated" : item.kind)
            let preferredPath = item.path.count >= existing.path.count ? item.path : existing.path
            let preferredKey = pathKey(preferredPath)
            files.removeValue(forKey: key)
            files[preferredKey] = NativeChatFileChangeItem(
                path: preferredPath,
                kind: kind,
                added: existing.added + item.added,
                removed: existing.removed + item.removed
            )
        } else {
            files[key] = item
        }
    }

    for tool in messages.flatMap({ $0.tool_calls ?? [] }) {
        let lowerName = tool.name.lowercased()
        let relevant = lowerName.contains("write") || lowerName.contains("edit") || lowerName.contains("patch")
        guard relevant else { continue }
        let paths = nativeToolFilePaths(tool)
        for path in paths {
            let resultObject = nativeJSONObject(tool.result)
            let changeObject = resultObject?["change"].flatMap { nativeJSONObject($0) }
            let diff = nativeJSONString(changeObject, key: "diff")
                ?? nativeJSONString(resultObject, key: "diff")
                ?? nativeJSONString(tool.args, key: "diff")
                ?? ""
            let counts = nativeUnifiedDiffCounts(diff)
            merge(NativeChatFileChangeItem(
                path: path,
                kind: nativeFileChangeKind(tool),
                added: counts.added,
                removed: counts.removed
            ))
        }
    }
    for activity in messages.flatMap({ $0.process_activities ?? [] }) {
        if let item = nativeActivityFileChange(text: activity.text, phase: activity.phase) {
            if let key = matchingKey(item.path), let existing = files[key], existing.added + existing.removed > 0 {
                continue
            }
            merge(item)
        }
    }
    for activity in liveActivities {
        if let item = nativeActivityFileChange(text: activity.text, phase: activity.phase.rawValue) {
            if let key = matchingKey(item.path), let existing = files[key], existing.added + existing.removed > 0 {
                continue
            }
            merge(item)
        }
    }
    let sorted = files.values.sorted { $0.path.localizedCaseInsensitiveCompare($1.path) == .orderedAscending }
    return NativeChatFileChangeSummary(
        files: sorted,
        totalAdded: sorted.reduce(0) { $0 + $1.added },
        totalRemoved: sorted.reduce(0) { $0 + $1.removed }
    )
}

func nativeActivityFileChange(text: String?, phase: String?) -> NativeChatFileChangeItem? {
    guard (phase ?? "result").lowercased() == "result",
          let text = firstNonEmptyGatewayString(text)
    else { return nil }
    let parts = text.split(separator: " ").map(String.init)
    guard parts.count >= 4,
          parts.first?.lowercased() == "edited",
          let addedRaw = parts.dropLast().last,
          let removedRaw = parts.last,
          addedRaw.hasPrefix("+"),
          removedRaw.hasPrefix("-"),
          let added = Int(addedRaw.dropFirst()),
          let removed = Int(removedRaw.dropFirst())
    else { return nil }
    let path = parts.dropFirst().dropLast(2).joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    guard !path.isEmpty, path.lowercased() != "file" else { return nil }
    return NativeChatFileChangeItem(
        path: path,
        kind: removed > 0 ? "updated" : "created",
        added: max(0, added),
        removed: max(0, removed)
    )
}

func nativeToolFilePaths(_ tool: GatewayToolCall) -> [String] {
    var paths: [String] = []
    for object in [tool.args, nativeJSONObject(tool.result)] {
        guard let object else { continue }
        for key in ["path", "file", "filePath", "targetPath", "oldPath", "newPath"] {
            if let path = nativeJSONString(object, key: key) {
                paths.append(path)
            }
        }
        for key in ["files", "changedFiles"] {
            if case .array(let values)? = object[key] {
                for value in values {
                    if case .string(let path) = value {
                        paths.append(path)
                    } else if case .object(let fileObject) = value,
                              let path = nativeJSONString(fileObject, key: "path") ?? nativeJSONString(fileObject, key: "file") {
                        paths.append(path)
                    }
                }
            }
        }
    }
    var seen: Set<String> = []
    let unique = paths.compactMap { rawPath -> String? in
        guard let path = firstNonEmptyGatewayString(rawPath) else { return nil }
        let key = path.replacingOccurrences(of: "\\", with: "/").lowercased()
        guard seen.insert(key).inserted else { return nil }
        return path
    }
    return unique.isEmpty ? ["\(tool.name) change"] : unique
}

func nativeFileChangeKind(_ tool: GatewayToolCall) -> String {
    let name = tool.name.lowercased()
    if name.contains("delete") || name.contains("remove") { return "deleted" }
    if name.contains("create") || name.contains("write") { return "created" }
    return "updated"
}

func nativeUnifiedDiffCounts(_ diff: String) -> (added: Int, removed: Int) {
    guard !diff.isEmpty else { return (0, 0) }
    var added = 0
    var removed = 0
    for line in diff.split(separator: "\n", omittingEmptySubsequences: false) {
        if line.hasPrefix("+"), !line.hasPrefix("+++") { added += 1 }
        if line.hasPrefix("-"), !line.hasPrefix("---") { removed += 1 }
    }
    return (added, removed)
}

func extractNativeSessionPlan(
    from messages: [GatewaySessionMessage],
    sessionID: String?
) -> NativeSessionPlanSnapshot? {
    for message in messages.reversed() {
        guard let tools = message.tool_calls else { continue }
        for tool in tools.reversed() where tool.name.lowercased() == "todo" {
            let items = nativePlanItems(from: tool.result)
            let fallbackItems = items.isEmpty ? nativePlanItems(from: tool.args.map(JSONValue.object)) : items
            guard !fallbackItems.isEmpty else { continue }
            let completed = fallbackItems.filter { $0.status == "completed" }.count
            return NativeSessionPlanSnapshot(
                items: fallbackItems,
                completed: completed,
                total: fallbackItems.count,
                updatedAt: message.timestamp
            )
        }
    }
    return nil
}

func nativePlanItems(from value: JSONValue?) -> [NativeSessionPlanItem] {
    guard case .object(let object)? = value,
          case .array(let rawItems)? = object["items"] else { return [] }
    return rawItems.compactMap { item in
        guard case .object(let itemObject) = item else { return nil }
        guard let content = nativeJSONString(itemObject, key: "content") else { return nil }
        return NativeSessionPlanItem(
            content: String(content.prefix(500)),
            status: nativeJSONString(itemObject, key: "status") == "completed"
                ? "completed"
                : nativeJSONString(itemObject, key: "status") == "in_progress" ? "in_progress" : "pending",
            priority: nativeJSONString(itemObject, key: "priority") ?? "medium"
        )
    }
}

func nativePlanItemIcon(_ status: String) -> String {
    switch status {
    case "completed": return "checkmark.circle.fill"
    case "in_progress": return "circle.dotted"
    default: return "circle"
    }
}

func nativePlanItemTint(_ status: String) -> Color {
    switch status {
    case "completed": return .green
    case "in_progress": return .blue
    default: return .secondary
    }
}

func nativeSubagentStatusColor(_ status: String) -> Color {
    switch status.lowercased() {
    case "completed": return .green
    case "failed", "timeout": return .red
    case "running": return .blue
    default: return .secondary
    }
}

func nativeJSONObject(_ value: JSONValue?) -> [String: JSONValue]? {
    guard case .object(let object)? = value else { return nil }
    return object
}

func nativeJSONString(_ object: [String: JSONValue]?, key: String) -> String? {
    guard let value = object?[key] else { return nil }
    return nativeJSONString(value)
}

func nativeJSONString(_ value: JSONValue?) -> String? {
    guard let value else { return nil }
    switch value {
    case .string(let string):
        return firstNonEmptyGatewayString(string)
    case .number(let number):
        return number.rounded() == number ? String(Int(number)) : String(number)
    case .bool(let bool):
        return bool ? "true" : "false"
    default:
        return nil
    }
}

struct NativeContextProviderPlanUsageRow: Identifiable {
    let id: String
    let label: String
    let value: String
    let percent: Double?
    let unlimited: Bool
    let resetText: String?
}

struct NativeContextProviderPlanUsageBar: View {
    let row: NativeContextProviderPlanUsageRow

    var body: some View {
        let tint = nativeContextProviderPlanUsageTint(row)
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 8) {
                Text(row.label)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 12)
                Text(row.value)
                    .fontWeight(.semibold)
                    .foregroundStyle(tint)
            }
            GeometryReader { proxy in
                Capsule()
                    .fill(Color.white.opacity(0.08))
                    .overlay(alignment: .leading) {
                        Capsule()
                            .fill(tint.opacity(0.82))
                            .frame(
                                width: max(
                                    3,
                                    proxy.size.width * nativeContextProviderPlanProgress(row)
                                )
                            )
                    }
            }
            .frame(height: 5)
            if let resetText = row.resetText {
                Text(resetText)
                    .font(.system(size: 10, design: .rounded))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }
}

func nativeContextProviderPlanUsageTint(_ row: NativeContextProviderPlanUsageRow) -> Color {
    if row.unlimited { return .green }
    guard let percent = row.percent else { return .secondary }
    if percent < 40 { return .green }
    if percent < 65 { return .blue }
    if percent < 80 { return .yellow }
    if percent < 95 { return .orange }
    return .red
}

func nativeContextProviderPlanProgress(_ row: NativeContextProviderPlanUsageRow) -> Double {
    if row.unlimited { return 1 }
    guard let percent = row.percent else { return 0 }
    return min(1, max(0, percent / 100))
}

extension View {
    @ViewBuilder
    func refreshableIfAvailable(_ action: @escaping @Sendable () async -> Void) -> some View {
        self.refreshable { await action() }
    }
}
