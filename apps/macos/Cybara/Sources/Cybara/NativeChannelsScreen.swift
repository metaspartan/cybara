import SwiftUI

struct ChannelsScreen: View {
    let client: GatewayClient
    @Environment(\.cybaraAccent) private var accentTint

    @State private var channels: [GatewayChannel] = []
    @State private var agents: [GatewayAgent] = []
    @State private var modelRouterEnabled = false
    @State private var loaded = false
    @State private var error: String?
    @State private var busyID: String?
    @State private var actionError: String?
    @State private var pendingDelete: GatewayChannel?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ScreenHeader(title: "Channels", subtitle: "Messaging surfaces connected to the gateway")

                if let actionError {
                    Text(actionError)
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.red)
                }

                if !loaded {
                    ProgressView().frame(maxWidth: .infinity)
                } else if let error {
                    LoadFailedView(message: error) { Task { await load() } }
                } else if channels.isEmpty {
                    Text("No channels configured — add one from the web UI.")
                        .font(.system(size: 13, design: .rounded))
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(channels) { channel in
                        HStack(spacing: 14) {
                            Image(systemName: "link")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(channel.isEnabled ? accentTint : Color.secondary)
                                .frame(width: 34, height: 34)
                                .background(Circle().fill(Color.white.opacity(0.06)))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(channel.displayName)
                                    .font(.system(size: 14, weight: .bold, design: .rounded))
                                Text(channel.type ?? "channel")
                                    .font(.system(size: 12, design: .rounded))
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Menu {
                                Button {
                                    Task { await setRouting(channel, agentID: nil, useModelRouter: false) }
                                } label: {
                                    Label("Gateway default", systemImage: !channel.usesModelRouter && channel.agentID == nil ? "checkmark" : "circle")
                                }
                                if modelRouterEnabled {
                                    Button {
                                        Task { await setRouting(channel, agentID: nil, useModelRouter: true) }
                                    } label: {
                                        Label("Model Router", systemImage: channel.usesModelRouter ? "checkmark" : "point.3.connected.trianglepath.dotted")
                                    }
                                }
                                Divider()
                                ForEach(agents) { agent in
                                    Button {
                                        Task { await setRouting(channel, agentID: agent.id, useModelRouter: false) }
                                    } label: {
                                        Label(agent.name, systemImage: channel.agentID == agent.id ? "checkmark" : "cpu")
                                    }
                                }
                            } label: {
                                Label(agentName(for: channel), systemImage: "cpu")
                                    .lineLimit(1)
                            }
                            .menuStyle(.borderlessButton)
                            .fixedSize()
                            .disabled(busyID != nil || agents.isEmpty)
                            .help("Default agent for new channel conversations")
                            if busyID == channel.id {
                                ProgressView().controlSize(.small)
                            }
                            Toggle(
                                "",
                                isOn: Binding(
                                    get: { channel.isEnabled },
                                    set: { newValue in Task { await setEnabled(channel, newValue) } }
                                )
                            )
                            .labelsHidden()
                            .toggleStyle(.switch)
                            .disabled(busyID != nil)
                            .help(channel.isEnabled ? "Disable channel" : "Enable channel")
                            Button(role: .destructive) {
                                pendingDelete = channel
                            } label: {
                                Image(systemName: "trash")
                            }
                            .buttonStyle(.borderless)
                            .disabled(busyID != nil)
                            .help("Delete channel")
                        }
                        .padding(16)
                        .cybaraGlass(cornerRadius: 16)
                    }
                }
            }
            .padding(24)
        }
        .task { await load() }
        .confirmationDialog(
            "Delete this channel?",
            isPresented: Binding(
                get: { pendingDelete != nil },
                set: { if !$0 { pendingDelete = nil } }
            ),
            presenting: pendingDelete
        ) { channel in
            Button("Delete \(channel.displayName)", role: .destructive) {
                Task { await deleteChannel(channel) }
            }
            Button("Cancel", role: .cancel) { pendingDelete = nil }
        } message: { channel in
            Text("Removes \(channel.displayName) from the gateway. This cannot be undone.")
        }
    }

    private func load() async {
        do {
            async let nextChannels = client.channels()
            async let nextAgents = client.agents()
            async let nextRouter = client.routerConfig()
            channels = try await nextChannels
            agents = try await nextAgents
            let router = try await nextRouter
            modelRouterEnabled = router["enabled"] as? Bool == true
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }

    private func agentName(for channel: GatewayChannel) -> String {
        if channel.usesModelRouter {
            return modelRouterEnabled ? "Model Router" : "Model Router disabled"
        }
        guard let agentID = channel.agentID else { return "Gateway default" }
        return agents.first(where: { $0.id == agentID })?.name ?? "Unavailable agent"
    }

    private func setRouting(
        _ channel: GatewayChannel,
        agentID: String?,
        useModelRouter: Bool
    ) async {
        guard busyID == nil else { return }
        busyID = channel.id
        actionError = nil
        do {
            try await client.setChannelRouting(
                channel.id,
                agentID: agentID,
                useModelRouter: useModelRouter
            )
            await load()
        } catch {
            actionError = error.localizedDescription
        }
        busyID = nil
    }

    private func setEnabled(_ channel: GatewayChannel, _ enabled: Bool) async {
        guard busyID == nil else { return }
        busyID = channel.id
        actionError = nil
        do {
            try await client.setChannelEnabled(channel.id, enabled: enabled)
            await load()
        } catch {
            actionError = error.localizedDescription
        }
        busyID = nil
    }

    private func deleteChannel(_ channel: GatewayChannel) async {
        pendingDelete = nil
        busyID = channel.id
        actionError = nil
        do {
            try await client.deleteChannel(channel.id)
            await load()
        } catch {
            actionError = error.localizedDescription
        }
        busyID = nil
    }
}

// ─── Logs ────────────────────────────────────────────────────────────────────
