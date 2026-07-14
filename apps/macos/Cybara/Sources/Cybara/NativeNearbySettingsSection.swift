import SwiftUI

struct NativeNearbySettings: Codable, Hashable {
    var enabled: Bool
    var displayName: String
    var port: Int
    var discoveryMinutes: Int
}

struct NativeNearbyPairing: Decodable, Identifiable, Hashable {
    let id: String
    let direction: String
    let peerId: String
    let peerName: String
    let peerBaseUrl: String
    let verificationCode: String
    let localConfirmed: Bool
    let remoteConfirmed: Bool
    let expiresAt: String
}

struct NativeNearbyDiscoveredPeer: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let baseUrl: String
    let fingerprint: String
    let lastSeenAt: String
}

struct NativeNearbyPairedPeer: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let baseUrl: String
    let fingerprint: String
    let pairedAt: String
    let syncEnabled: Bool
}

struct NativeNearbyIncomingTransfer: Decodable, Identifiable, Hashable {
    struct Workspace: Decodable, Hashable {
        let name: String
        let branch: String?
        let commit: String?
        let dirty: Bool?
    }

    let id: String
    let peerId: String
    let peerName: String
    let receivedAt: String
    let title: String?
    let messageCount: Int
    let workspace: Workspace?
}

struct NativeNearbyStatus: Decodable, Hashable {
    struct Identity: Decodable, Hashable {
        let id: String
        let fingerprint: String
    }

    let settings: NativeNearbySettings
    let identity: Identity
    let running: Bool
    let discoverableUntil: String?
    let discoveredPeers: [NativeNearbyDiscoveredPeer]
    let pairedPeers: [NativeNearbyPairedPeer]
    let pairings: [NativeNearbyPairing]
    let incomingTransfers: [NativeNearbyIncomingTransfer]
}

private struct NativeNearbySettingsResponse: Decodable {
    let success: Bool
    let settings: NativeNearbySettings
    let status: NativeNearbyStatus
}

private struct NativeNearbySuccessResponse: Decodable {
    let success: Bool?
}

private struct NativeNearbyPairRequest: Encodable {
    let peerId: String
    let baseUrl: String
}

private struct NativeNearbyAcceptRequest: Encodable {
    let workspaceDir: String?
}

private struct NativeNearbySendRequest: Encodable {
    let sessionId: String
}

extension GatewayClient {
    func nearbyStatus() async throws -> NativeNearbyStatus {
        let data = try await request("api/nearby")
        return try JSONDecoder().decode(NativeNearbyStatus.self, from: data)
    }

    func updateNearbySettings(_ settings: NativeNearbySettings) async throws -> NativeNearbyStatus {
        let data = try await request(
            "api/nearby/settings",
            method: "PUT",
            body: try JSONEncoder().encode(settings)
        )
        return try JSONDecoder().decode(NativeNearbySettingsResponse.self, from: data).status
    }

    func makeNearbyDiscoverable() async throws {
        _ = try await request("api/nearby/discoverable", method: "POST")
    }

    func stopNearbyDiscovery() async throws {
        _ = try await request("api/nearby/discoverable", method: "DELETE")
    }

    func pairNearby(_ peer: NativeNearbyDiscoveredPeer) async throws {
        _ = try await request(
            "api/nearby/pair",
            method: "POST",
            body: try JSONEncoder().encode(NativeNearbyPairRequest(peerId: peer.id, baseUrl: peer.baseUrl))
        )
    }

    func confirmNearbyPairing(_ id: String) async throws {
        _ = try await request("api/nearby/pairings/\(id)/confirm", method: "POST")
    }

    func rejectNearbyPairing(_ id: String) async throws {
        _ = try await request("api/nearby/pairings/\(id)", method: "DELETE")
    }

    func removeNearbyPeer(_ id: String) async throws {
        _ = try await request("api/nearby/peers/\(id)", method: "DELETE")
    }

    func acceptNearbyTransfer(_ id: String) async throws {
        _ = try await request(
            "api/nearby/transfers/\(id)/accept",
            method: "POST",
            body: try JSONEncoder().encode(NativeNearbyAcceptRequest(workspaceDir: nil))
        )
    }

    func dismissNearbyTransfer(_ id: String) async throws {
        _ = try await request("api/nearby/transfers/\(id)", method: "DELETE")
    }

    func sendNearbySession(peerID: String, sessionID: String) async throws {
        _ = try await request(
            "api/nearby/peers/\(peerID)/sessions",
            method: "POST",
            body: try JSONEncoder().encode(NativeNearbySendRequest(sessionId: sessionID))
        )
    }
}

struct NativeNearbySettingsSection: View {
    let client: GatewayClient

    @State private var status: NativeNearbyStatus?
    @State private var settings = NativeNearbySettings(
        enabled: false,
        displayName: "Cybara",
        port: 4270,
        discoveryMinutes: 10
    )
    @State private var busy = false
    @State private var error: String?

    private var discoverable: Bool {
        guard let value = status?.discoverableUntil,
              let date = ISO8601DateFormatter().date(from: value) else { return false }
        return date > Date()
    }

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Label("Nearby Cybara", systemImage: "network")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        Text("Pair trusted Cybara installations on your local network and send chats between them.")
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Toggle("", isOn: Binding(
                        get: { settings.enabled },
                        set: { enabled in
                            settings.enabled = enabled
                            Task { await saveSettings() }
                        }
                    ))
                    .toggleStyle(.switch)
                    .labelsHidden()
                    .disabled(busy)
                }

                Label(
                    "Off by default. Discovery is temporary and both devices must confirm the same code.",
                    systemImage: "lock.shield"
                )
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(.secondary)

                if settings.enabled {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 10) { settingsFields }
                        VStack(alignment: .leading, spacing: 10) { settingsFields }
                    }

                    HStack(spacing: 8) {
                        Button("Save") { Task { await saveSettings() } }
                            .buttonStyle(.borderedProminent)
                        Button(discoverable ? "Stop Discovery" : "Find Nearby") {
                            Task { await toggleDiscovery() }
                        }
                        .buttonStyle(.bordered)
                        if busy { ProgressView().controlSize(.small) }
                        Spacer()
                        Text(status?.running == true ? "Listening privately" : "Stopped")
                            .font(.system(size: 11, weight: .semibold, design: .rounded))
                            .foregroundStyle(status?.running == true ? Color.green : Color.secondary)
                    }

                    if let status {
                        nearbyContent(status)
                    }
                }

                if let error {
                    Text(error)
                        .font(.system(size: 11, design: .rounded))
                        .foregroundStyle(.red)
                }
            }
        }
        .task {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(4))
            }
        }
    }

    @ViewBuilder
    private var settingsFields: some View {
        TextField("Device name", text: $settings.displayName)
            .textFieldStyle(.roundedBorder)
        TextField("Port", value: $settings.port, format: .number)
            .textFieldStyle(.roundedBorder)
            .frame(maxWidth: 110)
        TextField("Minutes", value: $settings.discoveryMinutes, format: .number)
            .textFieldStyle(.roundedBorder)
            .frame(maxWidth: 110)
    }

    @ViewBuilder
    private func nearbyContent(_ value: NativeNearbyStatus) -> some View {
        if !value.discoveredPeers.isEmpty {
            Divider().opacity(0.45)
            Text("Available Nearby").font(.system(size: 12, weight: .semibold, design: .rounded))
            ForEach(value.discoveredPeers.filter { peer in
                !value.pairedPeers.contains(where: { $0.id == peer.id })
            }) { peer in
                HStack {
                    Label(peer.name, systemImage: "desktopcomputer")
                    Spacer()
                    Button("Connect") { Task { await pair(peer) } }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                }
            }
        }

        if !value.pairings.isEmpty {
            Divider().opacity(0.45)
            Text("Verify Pairing").font(.system(size: 12, weight: .semibold, design: .rounded))
            ForEach(value.pairings) { pairing in
                VStack(alignment: .leading, spacing: 8) {
                    Text(pairing.peerName).font(.system(size: 12, weight: .semibold, design: .rounded))
                    Text(pairing.verificationCode)
                        .font(.system(size: 23, weight: .bold, design: .monospaced))
                    Text("Confirm only if this code matches the other device.")
                        .font(.system(size: 10, design: .rounded))
                        .foregroundStyle(.secondary)
                    HStack {
                        if !pairing.localConfirmed {
                            Button("Codes Match") { Task { await confirm(pairing.id) } }
                                .buttonStyle(.borderedProminent)
                        } else {
                            Label("Confirmed Here", systemImage: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                        }
                        Button("Cancel") { Task { await reject(pairing.id) } }
                            .buttonStyle(.bordered)
                    }
                }
                .padding(10)
                .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 10))
            }
        }

        if !value.pairedPeers.isEmpty {
            Divider().opacity(0.45)
            Text("Paired Devices").font(.system(size: 12, weight: .semibold, design: .rounded))
            ForEach(value.pairedPeers) { peer in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(peer.name)
                        Text("Verified \(peer.fingerprint.prefix(12))")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button(role: .destructive) { Task { await remove(peer.id) } } label: {
                        Image(systemName: "trash")
                    }
                    .buttonStyle(.borderless)
                }
            }
        }

        if !value.incomingTransfers.isEmpty {
            Divider().opacity(0.45)
            Text("Received Chats").font(.system(size: 12, weight: .semibold, design: .rounded))
            ForEach(value.incomingTransfers) { transfer in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(transfer.title ?? "Shared chat")
                        Text("From \(transfer.peerName) · \(transfer.messageCount) messages")
                            .font(.system(size: 10, design: .rounded))
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Accept") { Task { await accept(transfer.id) } }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                    Button("Dismiss") { Task { await dismiss(transfer.id) } }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                }
            }
        }
    }

    private func run(_ operation: @escaping () async throws -> Void) async {
        busy = true
        error = nil
        do {
            try await operation()
            await load()
        } catch {
            self.error = error.localizedDescription
        }
        busy = false
    }

    private func load() async {
        do {
            let loaded = try await client.nearbyStatus()
            status = loaded
            settings = loaded.settings
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func saveSettings() async {
        await run { status = try await client.updateNearbySettings(settings) }
    }

    private func toggleDiscovery() async {
        await run {
            if discoverable { try await client.stopNearbyDiscovery() }
            else { try await client.makeNearbyDiscoverable() }
        }
    }

    private func pair(_ peer: NativeNearbyDiscoveredPeer) async {
        await run { try await client.pairNearby(peer) }
    }

    private func confirm(_ id: String) async {
        await run { try await client.confirmNearbyPairing(id) }
    }

    private func reject(_ id: String) async {
        await run { try await client.rejectNearbyPairing(id) }
    }

    private func remove(_ id: String) async {
        await run { try await client.removeNearbyPeer(id) }
    }

    private func accept(_ id: String) async {
        await run { try await client.acceptNearbyTransfer(id) }
    }

    private func dismiss(_ id: String) async {
        await run { try await client.dismissNearbyTransfer(id) }
    }
}
