import SwiftUI

struct ToolsScreen: View {
    let client: GatewayClient
    @State private var tools: [NativeToolSummary] = []
    @State private var dangerous: NativeDangerousTools?
    @State private var approvals: [GatewayPendingApproval] = []
    @State private var query = ""
    @State private var loaded = false
    @State private var error: String?

    private var filteredTools: [NativeToolSummary] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !trimmed.isEmpty else { return tools }
        return tools.filter {
            $0.name.lowercased().contains(trimmed) || ($0.description?.lowercased().contains(trimmed) ?? false)
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    ScreenHeader(title: "Tools", subtitle: "\(tools.count) built-in tools · \(approvals.count) approvals")
                    TextField("Search tools", text: $query)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 220)
                    Button {
                        Task { await load() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(.bordered)
                }

                if !loaded {
                    ProgressView().frame(maxWidth: .infinity)
                } else if let error {
                    LoadFailedView(message: error) { Task { await load() } }
                } else {
                    GlassCard {
                        NativeMetricGrid(rows: [
                            ("Dangerous policy", dangerous?.policy?.displayLabel ?? "ask"),
                            ("Dangerous tools", "\(dangerous?.tools.count ?? 0)"),
                            ("Pending approvals", "\(approvals.count)"),
                        ])
                    }

                    if !approvals.isEmpty {
                        GlassCard {
                            VStack(alignment: .leading, spacing: 10) {
                                Text("Pending approvals")
                                    .font(.system(size: 15, weight: .bold, design: .rounded))
                                ForEach(approvals) { approval in
                                    HStack(alignment: .top) {
                                        NativeInfoRow(title: approval.toolName, detail: approval.argsSummary)
                                        Spacer()
                                        ForEach(["approve_once", "approve_session", "deny"], id: \.self) { decision in
                                            Button(decision.replacingOccurrences(of: "_", with: " ")) {
                                                Task { await resolve(approval, decision) }
                                            }
                                            .buttonStyle(.bordered)
                                            .controlSize(.small)
                                        }
                                    }
                                }
                            }
                        }
                    }

                    LazyVStack(spacing: 10) {
                        ForEach(filteredTools) { tool in
                            GlassCard {
                                VStack(alignment: .leading, spacing: 10) {
                                    HStack(alignment: .top) {
                                        NativeInfoRow(
                                            title: tool.name,
                                            detail: firstNonEmptyGatewayString(tool.description) ?? "Tool schema"
                                        )
                                        Spacer()
                                        Text("\(tool.schema.count) fields")
                                            .font(.system(size: 11, design: .rounded))
                                            .foregroundStyle(.secondary)
                                    }
                                    HStack(spacing: 6) {
                                        if let category = firstNonEmptyGatewayString(tool.category) {
                                            NativeToolChip(category, systemImage: "tag", tint: .cyan)
                                        }
                                        if dangerous?.tools.contains(tool.name) == true {
                                            NativeToolChip("dangerous", systemImage: "exclamationmark.shield", tint: .orange)
                                        }
                                        ForEach((tool.permissions ?? []).prefix(3), id: \.self) { permission in
                                            NativeToolChip(permission, systemImage: "checkmark.seal", tint: .secondary)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .padding(24)
        }
        .task { await load() }
    }

    private func load() async {
        do {
            async let toolsResult = client.nativeTools()
            async let dangerousResult = client.dangerousTools()
            async let approvalsResult = client.pendingToolApprovals()
            tools = try await toolsResult
            dangerous = try await dangerousResult
            approvals = try await approvalsResult
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }

    private func resolve(_ approval: GatewayPendingApproval, _ decision: String) async {
        do {
            try await client.resolveToolApproval(approval.id, decision: decision)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct NativeToolChip: View {
    let label: String
    let systemImage: String
    let tint: Color

    init(_ label: String, systemImage: String, tint: Color) {
        self.label = label
        self.systemImage = systemImage
        self.tint = tint
    }

    var body: some View {
        Label(label, systemImage: systemImage)
            .font(.system(size: 10, weight: .semibold, design: .rounded))
            .foregroundStyle(tint)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(Capsule().fill(tint.opacity(0.12)))
    }
}
