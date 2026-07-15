import SwiftUI

private struct NativeTelemetrySettings: Decodable {
    let enabled: Bool
    let serviceName: String
    let environment: String
    let prometheusEnabled: Bool
    let otlpEnabled: Bool
    let otlpEndpoint: String
    let metricsEnabled: Bool
    let tracesEnabled: Bool
    let exportIntervalMs: Int
}

private struct NativeTelemetryStatus: Decodable {
    let queuedMetrics: Int
    let queuedSpans: Int
    let lastExportAt: String?
    let lastError: String?
    let exportedMetrics: Int
    let exportedSpans: Int
}

private struct NativeTelemetryUpdateResponse: Decodable {
    let settings: NativeTelemetrySettings
}

private struct NativeTelemetryTestResponse: Decodable {
    let status: NativeTelemetryStatus
}

private extension GatewayClient {
    func telemetrySettings() async throws -> NativeTelemetrySettings {
        let data = try await request("api/telemetry/settings")
        return try JSONDecoder().decode(NativeTelemetrySettings.self, from: data)
    }

    func telemetryStatus() async throws -> NativeTelemetryStatus {
        let data = try await request("api/telemetry/status")
        return try JSONDecoder().decode(NativeTelemetryStatus.self, from: data)
    }

    func updateTelemetrySettings(_ body: Data) async throws -> NativeTelemetrySettings {
        let data = try await request(
            "api/telemetry/settings",
            method: "PUT",
            body: body
        )
        return try JSONDecoder().decode(NativeTelemetryUpdateResponse.self, from: data).settings
    }

    func testTelemetry() async throws -> NativeTelemetryStatus {
        let data = try await request("api/telemetry/test", method: "POST", body: Data("{}".utf8))
        return try JSONDecoder().decode(NativeTelemetryTestResponse.self, from: data).status
    }
}

struct NativeTelemetrySettingsScreen: View {
    let client: GatewayClient

    @State private var enabled = false
    @State private var serviceName = "cybara"
    @State private var environment = "production"
    @State private var prometheusEnabled = false
    @State private var otlpEnabled = false
    @State private var otlpEndpoint = "http://127.0.0.1:4318"
    @State private var metricsEnabled = true
    @State private var tracesEnabled = true
    @State private var status: NativeTelemetryStatus?
    @State private var busy = false
    @State private var message: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Label("External Telemetry", systemImage: "waveform.path.ecg.rectangle")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        Text("Export gateway metrics and traces to an operational collector.")
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                        Toggle("External telemetry", isOn: $enabled).toggleStyle(.switch)
                        Toggle("OTLP", isOn: $otlpEnabled).toggleStyle(.switch).disabled(!enabled)
                        Toggle("Prometheus endpoint", isOn: $prometheusEnabled).toggleStyle(.switch).disabled(!enabled)
                        HStack {
                            TextField("Service name", text: $serviceName)
                            TextField("Environment", text: $environment)
                        }
                        .textFieldStyle(.roundedBorder)
                        if otlpEnabled {
                            TextField("OTLP HTTP endpoint", text: $otlpEndpoint)
                                .textFieldStyle(.roundedBorder)
                            HStack {
                                Toggle("Metrics", isOn: $metricsEnabled).toggleStyle(.switch)
                                Toggle("Traces", isOn: $tracesEnabled).toggleStyle(.switch)
                            }
                        }
                        HStack {
                            Button("Save") { Task { await save() } }
                                .buttonStyle(.borderedProminent)
                                .disabled(busy)
                            if enabled && otlpEnabled {
                                Button("Test Collector") { Task { await test() } }
                                    .buttonStyle(.bordered)
                                    .disabled(busy)
                            }
                            if busy { ProgressView().controlSize(.small) }
                        }
                    }
                }

                if let status {
                    GlassCard {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Export Status").font(.system(size: 14, weight: .bold, design: .rounded))
                            LabeledContent("Metrics", value: "\(status.exportedMetrics)")
                            LabeledContent("Spans", value: "\(status.exportedSpans)")
                            LabeledContent("Queued", value: "\(status.queuedMetrics + status.queuedSpans)")
                            if let error = status.lastError {
                                Text(error).font(.system(size: 11, design: .rounded)).foregroundStyle(.red)
                            }
                        }
                    }
                }
                if let message {
                    Text(message).font(.system(size: 11, design: .rounded)).foregroundStyle(.secondary)
                }
            }
            .padding(12)
            .frame(maxWidth: 720, alignment: .topLeading)
        }
        .task { await load() }
    }

    private var updateBody: [String: Any] {
        [
            "enabled": enabled,
            "serviceName": serviceName,
            "environment": environment,
            "prometheusEnabled": prometheusEnabled,
            "otlpEnabled": otlpEnabled,
            "otlpEndpoint": otlpEndpoint,
            "metricsEnabled": metricsEnabled,
            "tracesEnabled": tracesEnabled,
            "exportIntervalMs": 15000,
        ]
    }

    private func apply(_ settings: NativeTelemetrySettings) {
        enabled = settings.enabled
        serviceName = settings.serviceName
        environment = settings.environment
        prometheusEnabled = settings.prometheusEnabled
        otlpEnabled = settings.otlpEnabled
        otlpEndpoint = settings.otlpEndpoint
        metricsEnabled = settings.metricsEnabled
        tracesEnabled = settings.tracesEnabled
    }

    @MainActor
    private func load() async {
        do {
            async let loadedSettings = client.telemetrySettings()
            async let loadedStatus = client.telemetryStatus()
            apply(try await loadedSettings)
            status = try await loadedStatus
        } catch {
            message = error.localizedDescription
        }
    }

    @MainActor
    private func save() async {
        busy = true
        defer { busy = false }
        do {
            let body = try JSONSerialization.data(withJSONObject: updateBody)
            apply(try await client.updateTelemetrySettings(body))
            message = "Telemetry settings saved."
        } catch {
            message = error.localizedDescription
        }
    }

    @MainActor
    private func test() async {
        busy = true
        defer { busy = false }
        do {
            status = try await client.testTelemetry()
            message = status?.lastError ?? "Collector accepted test telemetry."
        } catch {
            message = error.localizedDescription
        }
    }
}
