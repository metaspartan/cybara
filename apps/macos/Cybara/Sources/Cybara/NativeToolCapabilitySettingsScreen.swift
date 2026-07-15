import SwiftUI

private struct NativeToolCapabilityResponse: Codable {
    let policy: [String: String]
}

private struct NativeToolCapabilityUpdateResponse: Codable {
    let success: Bool
    let policy: [String: String]
}

private extension GatewayClient {
    func toolCapabilityPolicy() async throws -> [String: String] {
        let data = try await request("api/settings/tool-capabilities")
        return try JSONDecoder().decode(NativeToolCapabilityResponse.self, from: data).policy
    }

    func updateToolCapabilityPolicy(_ policy: [String: String]) async throws -> [String: String] {
        let body = try JSONEncoder().encode(policy)
        let data = try await request("api/settings/tool-capabilities", method: "PUT", body: body)
        return try JSONDecoder().decode(NativeToolCapabilityUpdateResponse.self, from: data).policy
    }
}

struct NativeToolCapabilitySettingsScreen: View {
    let client: GatewayClient

    private let capabilities = [
        ("read", "Read", "Files, memory, and project inspection"),
        ("write", "Write", "File edits and persistent memory changes"),
        ("execution", "Execution", "Commands, processes, and Git operations"),
        ("network", "Network", "Web requests, searches, and channel delivery"),
        ("browser", "Browser", "Browser preview and computer control"),
        ("wallet", "Wallet", "Wallet reads, signing, and transactions"),
        ("destructive", "Destructive", "Deletion, forced changes, and fund movement"),
    ]
    private let modes = [
        ("inherit", "Default"),
        ("ask", "Ask"),
        ("allow", "Allow"),
        ("deny", "Deny"),
    ]

    @State private var policy: [String: String] = [:]
    @State private var busy = false
    @State private var message: String?

    var body: some View {
        ScrollView {
            GlassCard {
                VStack(alignment: .leading, spacing: 0) {
                    Label("Capability Access", systemImage: "key.horizontal")
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .padding(.bottom, 6)
                    Text("Control what agents can do at each security boundary.")
                        .font(.system(size: 11, design: .rounded))
                        .foregroundStyle(.secondary)
                        .padding(.bottom, 8)
                    ForEach(capabilities, id: \.0) { capability in
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(capability.1)
                                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                                Text(capability.2)
                                    .font(.system(size: 10, design: .rounded))
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Picker(capability.1, selection: binding(for: capability.0)) {
                                ForEach(modes, id: \.0) { mode in
                                    Text(mode.1).tag(mode.0)
                                }
                            }
                            .labelsHidden()
                            .frame(width: 120)
                            .disabled(busy)
                        }
                        .padding(.vertical, 8)
                        if capability.0 != capabilities.last?.0 {
                            Divider().opacity(0.35)
                        }
                    }
                    if let message {
                        Text(message)
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                            .padding(.top, 8)
                    }
                }
            }
            .padding(12)
            .frame(maxWidth: 720, alignment: .topLeading)
        }
        .task { await load() }
    }

    private func binding(for capability: String) -> Binding<String> {
        Binding(
            get: { policy[capability] ?? "inherit" },
            set: { value in
                policy[capability] = value
                Task { await save() }
            }
        )
    }

    @MainActor
    private func load() async {
        do {
            policy = try await client.toolCapabilityPolicy()
        } catch {
            message = error.localizedDescription
        }
    }

    @MainActor
    private func save() async {
        busy = true
        defer { busy = false }
        do {
            policy = try await client.updateToolCapabilityPolicy(policy)
            message = nil
        } catch {
            message = error.localizedDescription
        }
    }
}
