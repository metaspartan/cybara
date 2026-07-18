import Foundation
import SwiftUI

private struct NativeBrowserSupervisionSettings: Codable {
    var autoRestart: Bool
    var healthCheckIntervalMs: Int
    var downloadPolicy: String
    var remoteRoutingEnabled: Bool
    var remoteEndpoint: String
    var remoteToken: String
}

private struct NativeBrowserSupervisionStatus: Decodable {
    let owner: String
    let healthy: Bool
    let restartCount: Int
    let lastHealthCheckAt: String?
    let lastDisconnectAt: String?
    let lastError: String?
}

private struct NativeBrowserSupervisionResponse: Decodable {
    let settings: NativeBrowserSupervisionSettings
    let status: NativeBrowserSupervisionStatus
}

extension GatewayClient {
    fileprivate func browserSupervisionSettings() async throws -> NativeBrowserSupervisionResponse {
        let data = try await request("api/browser/supervision")
        return try JSONDecoder().decode(NativeBrowserSupervisionResponse.self, from: data)
    }

    fileprivate func updateBrowserSupervisionSettings(
        _ settings: NativeBrowserSupervisionSettings
    ) async throws -> NativeBrowserSupervisionResponse {
        let body = try JSONEncoder().encode(settings)
        let data = try await request("api/browser/supervision", method: "PUT", body: body)
        return try JSONDecoder().decode(NativeBrowserSupervisionResponse.self, from: data)
    }
}

struct NativeBrowserSupervisionSettingsScreen: View {
    let client: GatewayClient

    @State private var settings = NativeBrowserSupervisionSettings(
        autoRestart: true,
        healthCheckIntervalMs: 30_000,
        downloadPolicy: "ask",
        remoteRoutingEnabled: false,
        remoteEndpoint: "",
        remoteToken: ""
    )
    @State private var status: NativeBrowserSupervisionStatus?
    @State private var remoteTokenConfigured = false
    @State private var busy = false
    @State private var message: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NativeSettingsLayout.cardSpacing) {
                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Browser Safety", systemImage: "globe.badge.chevron.backward")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        Toggle("Restart after unexpected exit", isOn: $settings.autoRestart)
                            .toggleStyle(.switch)
                            .disabled(busy)
                        Picker("Downloads", selection: $settings.downloadPolicy) {
                            Text("Ask").tag("ask")
                            Text("Allow").tag("allow")
                            Text("Block").tag("deny")
                        }
                        .pickerStyle(.segmented)
                        .disabled(busy)
                        Picker("Health check", selection: $settings.healthCheckIntervalMs) {
                            Text("15 seconds").tag(15_000)
                            Text("30 seconds").tag(30_000)
                            Text("1 minute").tag(60_000)
                            Text("5 minutes").tag(300_000)
                        }
                        .pickerStyle(.menu)
                        .disabled(busy)
                        Toggle("Remote browser routing", isOn: $settings.remoteRoutingEnabled)
                            .toggleStyle(.switch)
                            .disabled(busy)
                        if settings.remoteRoutingEnabled {
                            TextField("Remote CDP endpoint", text: $settings.remoteEndpoint)
                                .textFieldStyle(.roundedBorder)
                                .disabled(busy)
                            SecureField(
                                remoteTokenConfigured ? "Stored access token" : "Optional access token",
                                text: $settings.remoteToken
                            )
                            .textFieldStyle(.roundedBorder)
                            .disabled(busy)
                        }
                        HStack {
                            if busy { ProgressView().controlSize(.small) }
                            if remoteTokenConfigured {
                                Button("Remove Access Token", role: .destructive) {
                                    Task { await save(clearRemoteToken: true) }
                                }
                                .disabled(busy)
                            }
                            Spacer()
                            Button("Reload") { Task { await load() } }
                                .disabled(busy)
                            Button("Save") { Task { await save() } }
                                .buttonStyle(.borderedProminent)
                                .disabled(busy)
                        }
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Browser Status")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        settingRow("Owner", status?.owner.capitalized ?? "Idle")
                        settingRow("Health", status?.healthy == true ? "Ready" : "Idle")
                        settingRow("Restarts", String(status?.restartCount ?? 0))
                        if let lastError = status?.lastError, !lastError.isEmpty {
                            Text(lastError)
                                .font(.system(size: 11, design: .rounded))
                                .foregroundStyle(.red)
                                .textSelection(.enabled)
                        }
                        if let message {
                            Text(message)
                                .font(.system(size: 11, design: .rounded))
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .nativeSettingsContentLayout()
        }
        .task { await load() }
    }

    @MainActor
    private func load() async {
        busy = true
        defer { busy = false }
        do {
            apply(try await client.browserSupervisionSettings())
            message = nil
        } catch {
            message = error.localizedDescription
        }
    }

    @MainActor
    private func save(clearRemoteToken: Bool = false) async {
        if settings.remoteRoutingEnabled
            && settings.remoteEndpoint.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        {
            message = "Enter a remote CDP endpoint"
            return
        }
        busy = true
        defer { busy = false }
        do {
            var payload = settings
            if clearRemoteToken {
                payload.remoteToken = ""
            } else if payload.remoteToken.isEmpty && remoteTokenConfigured {
                payload.remoteToken = "***redacted***"
            }
            apply(try await client.updateBrowserSupervisionSettings(payload))
            message = "Browser policy saved"
        } catch {
            message = error.localizedDescription
        }
    }

    @MainActor
    private func apply(_ response: NativeBrowserSupervisionResponse) {
        var next = response.settings
        remoteTokenConfigured = !next.remoteToken.isEmpty
        next.remoteToken = ""
        settings = next
        status = response.status
    }

    private func settingRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 12, design: .rounded))
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
        }
    }
}
