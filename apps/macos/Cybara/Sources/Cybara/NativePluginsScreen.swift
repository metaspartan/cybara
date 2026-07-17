import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct NativeConnectorDraft {
    var clientID = ""
    var clientSecret = ""
    var writeAccess = false
}

struct PluginsScreen: View {
    let client: GatewayClient
    @Environment(\.cybaraAccent) private var accent

    @State private var connectors: [NativeAccountConnector] = []
    @State private var plugins: [NativePluginSummary] = []
    @State private var services: [NativeMCPServer] = []
    @State private var drafts: [String: NativeConnectorDraft] = [:]
    @State private var loaded = false
    @State private var busyID: String?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ScreenHeader(title: "Plugins", subtitle: "Manage reusable skills, account apps, and MCP services")

                if !loaded {
                    ProgressView().frame(maxWidth: .infinity)
                } else {
                    if let error {
                        GlassCard {
                            HStack(spacing: 10) {
                                Image(systemName: "exclamationmark.triangle")
                                    .foregroundStyle(.orange)
                                Text(error)
                                    .font(.system(size: 12, design: .rounded))
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Button("Retry") { Task { await load() } }
                                    .buttonStyle(.bordered)
                                    .controlSize(.small)
                            }
                        }
                    }
                    pluginSummary
                    serviceSummary
                }

                GlassCard {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: "lock.shield")
                            .foregroundStyle(accent)
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Private by default")
                                .font(.system(size: 14, weight: .semibold, design: .rounded))
                            Text("Credentials stay encrypted on this gateway. Reading is the default; account changes remain approval-gated.")
                                .font(.system(size: 12, design: .rounded))
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                if loaded {
                    Text("Account Apps")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(.secondary)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 360), spacing: 14)], spacing: 14) {
                        ForEach(connectors) { connector in
                            connectorCard(connector)
                        }
                    }
                }
            }
            .padding(24)
        }
        .task { await load() }
    }

    private var pluginSummary: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Label("Installed Plugins", systemImage: "shippingbox")
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                    Spacer()
                    Button {
                        Task { await chooseAndInstallPlugin() }
                    } label: {
                        Label("Install", systemImage: "plus")
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(busyID != nil)
                }
                if plugins.isEmpty {
                    Text("No installed plugins. Add a trusted folder or ZIP to get started.")
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(plugins) { plugin in
                        HStack(spacing: 10) {
                            Image(systemName: "puzzlepiece.extension")
                                .foregroundStyle(accent)
                                .frame(width: 20)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(plugin.name)
                                    .font(.system(size: 13, weight: .medium, design: .rounded))
                                Text("v\(plugin.version) · \(plugin.skillCount) skill\(plugin.skillCount == 1 ? "" : "s") · \(plugin.source)")
                                    .font(.system(size: 11, design: .rounded))
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Toggle("", isOn: Binding(
                                get: { plugin.enabled },
                                set: { enabled in Task { await setPluginEnabled(plugin, enabled: enabled) } }
                            ))
                            .labelsHidden()
                            .toggleStyle(.switch)
                            .disabled(busyID == plugin.id)
                        }
                    }
                }
            }
        }
    }

    private var serviceSummary: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                Label("MCP Services", systemImage: "server.rack")
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                if services.isEmpty {
                    Text("No MCP services are configured.")
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(services) { service in
                        HStack(spacing: 10) {
                            Circle()
                                .fill(service.status == "running" ? Color.green : Color.secondary)
                                .frame(width: 7, height: 7)
                            Text(service.name)
                                .font(.system(size: 13, weight: .medium, design: .rounded))
                            Spacer()
                            Text("\(service.toolCount ?? 0) tools")
                                .font(.system(size: 11, design: .rounded))
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func connectorCard(_ connector: NativeAccountConnector) -> some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: connectorSymbol(connector.id))
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(connector.connected ? Color.green : accent)
                        .frame(width: 36, height: 36)
                        .background(accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 9))
                    VStack(alignment: .leading, spacing: 3) {
                        HStack {
                            Text(connector.label)
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            StatusBadge(
                                label: connector.connected ? "Connected" : "Not connected",
                                color: connector.connected ? .green : .secondary
                            )
                        }
                        Text(connector.account ?? connector.description)
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                    Spacer()
                }

                TextField(connector.configured ? "Client ID configured" : connector.clientIdLabel, text: binding(connector.id, \.clientID))
                    .textFieldStyle(.roundedBorder)
                if let secretLabel = connector.clientSecretLabel {
                    SecureField(connector.configured ? "Client secret configured" : secretLabel, text: binding(connector.id, \.clientSecret))
                        .textFieldStyle(.roundedBorder)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text("OAuth callback URL")
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(.secondary)
                    Text(connector.redirectUri)
                        .font(.system(size: 10, design: .monospaced))
                        .textSelection(.enabled)
                }
                Toggle("Allow account changes", isOn: binding(connector.id, \.writeAccess))
                    .toggleStyle(.switch)
                Text("Messages, files, events, and pages still require agent approval.")
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(.secondary)

                HStack {
                    Button(connector.connected ? "Reconnect" : "Connect") {
                        Task { await connect(connector) }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(busyID != nil)
                    if connector.connected {
                        Button("Disconnect", role: .destructive) {
                            Task { await disconnect(connector) }
                        }
                        .buttonStyle(.bordered)
                        .disabled(busyID != nil)
                    }
                    Spacer()
                    if busyID == connector.id { ProgressView().controlSize(.small) }
                    if let url = URL(string: connector.docsUrl) {
                        Link("Setup", destination: url)
                    }
                }
                .controlSize(.small)
            }
        }
    }

    private func connectorSymbol(_ id: String) -> String {
        switch id {
        case "google_workspace": return "envelope"
        case "microsoft_365": return "building.2"
        case "notion": return "note.text"
        default: return "externaldrive.connected.to.line.below"
        }
    }

    private func binding<Value>(_ id: String, _ path: WritableKeyPath<NativeConnectorDraft, Value>) -> Binding<Value> {
        Binding(
            get: { drafts[id, default: NativeConnectorDraft()][keyPath: path] },
            set: { value in
                var draft = drafts[id, default: NativeConnectorDraft()]
                draft[keyPath: path] = value
                drafts[id] = draft
            }
        )
    }

    private func load() async {
        async let connectorResult = try? client.nativeAccountConnectors()
        async let pluginResult = try? client.nativePlugins()
        async let serviceResult = try? client.nativeMCPServers()
        let loadedValues = await (connectorResult, pluginResult, serviceResult)
        if let nextConnectors = loadedValues.0 {
            connectors = nextConnectors
            for connector in connectors where drafts[connector.id] == nil {
                drafts[connector.id] = NativeConnectorDraft(writeAccess: connector.access == "read_write")
            }
        }
        if let nextPlugins = loadedValues.1 { plugins = nextPlugins }
        if let nextServices = loadedValues.2 { services = nextServices }
        let unavailable = [
            loadedValues.0 == nil ? "account apps" : nil,
            loadedValues.1 == nil ? "installed plugins" : nil,
            loadedValues.2 == nil ? "MCP services" : nil,
        ].compactMap { $0 }
        error = unavailable.isEmpty ? nil : "Unavailable: \(unavailable.joined(separator: ", "))."
        loaded = true
    }

    @MainActor
    private func setPluginEnabled(_ plugin: NativePluginSummary, enabled: Bool) async {
        busyID = plugin.id
        do {
            let updated = try await client.setNativePluginEnabled(plugin.id, enabled: enabled)
            plugins = plugins.map { $0.id == updated.id ? updated : $0 }
        } catch {
            self.error = error.localizedDescription
        }
        busyID = nil
    }

    private func chooseAndInstallPlugin() async {
        let panel = NSOpenPanel()
        panel.title = "Choose Plugin Folder or ZIP"
        panel.prompt = "Review Plugin"
        panel.canChooseFiles = true
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = [.zip]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        busyID = "plugin-install"
        do {
            let validation = try await client.validateNativePlugin(path: url.path)
            guard validation.valid, let manifest = validation.manifest else {
                throw GatewayClientError.decodingFailed(
                    "api/plugins/validate",
                    validation.errors.joined(separator: ". ")
                )
            }
            let alert = NSAlert()
            alert.messageText = "Install \(manifest.name)?"
            alert.informativeText = [
                "Version \(manifest.version)",
                manifest.author.map { "By \($0)" },
                manifest.description,
                validation.warnings.isEmpty ? nil : validation.warnings.joined(separator: "\n"),
                "Only install plugins you trust. Plugin skills use the gateway's permissions."
            ].compactMap { $0 }.joined(separator: "\n\n")
            alert.alertStyle = .warning
            alert.addButton(withTitle: "Install")
            alert.addButton(withTitle: "Cancel")
            guard alert.runModal() == .alertFirstButtonReturn else {
                busyID = nil
                return
            }
            _ = try await client.installNativePlugin(path: url.path)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
        busyID = nil
    }

    private func connect(_ connector: NativeAccountConnector) async {
        busyID = connector.id
        do {
            let draft = drafts[connector.id] ?? NativeConnectorDraft()
            try await client.updateAccountConnector(
                connector.id,
                clientID: draft.clientID,
                clientSecret: draft.clientSecret,
                writeAccess: draft.writeAccess
            )
            let started = try await client.startAccountConnectorOAuth(connector.id)
            guard let url = URL(string: started.authUrl) else { throw GatewayClientError.invalidResponse }
            NSWorkspace.shared.open(url)
            let deadline = Date().addingTimeInterval(600)
            while Date() < deadline {
                try await Task.sleep(for: .seconds(1))
                let status = try await client.accountConnectorOAuthStatus(started.state)
                if status.status == "connected" {
                    await load()
                    busyID = nil
                    return
                }
                if status.status == "error" || status.status == "not_found" {
                    throw GatewayClientError.decodingFailed("api/connectors/oauth/status", status.error ?? "Authorization failed")
                }
            }
            throw GatewayClientError.decodingFailed("api/connectors/oauth/status", "Authorization timed out")
        } catch {
            self.error = error.localizedDescription
        }
        busyID = nil
    }

    private func disconnect(_ connector: NativeAccountConnector) async {
        busyID = connector.id
        do {
            try await client.disconnectAccountConnector(connector.id)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
        busyID = nil
    }
}
