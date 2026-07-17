import SwiftUI

struct MCPScreen: View {
    let client: GatewayClient
    @Environment(\.cybaraAccent) private var accent

    @State private var servers: [NativeMCPServer] = []
    @State private var tools: [NativeToolSummary] = []
    @State private var loaded = false
    @State private var busyID: String?
    @State private var error: String?
    @State private var showingAdd = false
    @State private var newName = ""
    @State private var newCommand = ""
    @State private var newArgs = ""
    @State private var newEnv = ""
    @State private var newEnabled = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    ScreenHeader(title: "MCP Servers", subtitle: "\(servers.count) servers · \(tools.count) tools")
                    Button {
                        showingAdd = true
                    } label: {
                        Label("Add", systemImage: "plus")
                    }
                    .buttonStyle(.borderedProminent)
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
                    VStack(spacing: 12) {
                        ForEach(servers) { server in
                            GlassCard {
                                VStack(alignment: .leading, spacing: 12) {
                                    HStack(alignment: .top) {
                                        VStack(alignment: .leading, spacing: 3) {
                                            Text(server.name)
                                                .font(.system(size: 15, weight: .bold, design: .rounded))
                                            Text(server.commandLine)
                                                .font(.system(size: 11, design: .monospaced))
                                                .foregroundStyle(.secondary)
                                                .textSelection(.enabled)
                                        }
                                        Spacer()
                                        StatusBadge(label: server.status ?? "stopped", color: mcpTint(server.status))
                                    }

                                    if let error = firstNonEmptyGatewayString(server.error) {
                                        Text(error)
                                            .font(.system(size: 11, design: .rounded))
                                            .foregroundStyle(.red)
                                    }

                                    HStack {
                                        Label("\(server.toolCount ?? 0) tools", systemImage: "wrench.and.screwdriver")
                                            .foregroundStyle(.secondary)
                                        Spacer()
                                        Button("Start") { Task { await run(server, "start") } }
                                            .disabled(busyID != nil || server.status == "running")
                                        Button("Stop") { Task { await run(server, "stop") } }
                                            .disabled(busyID != nil || server.status != "running")
                                        Button("Restart") { Task { await run(server, "restart") } }
                                            .disabled(busyID != nil)
                                        Button(role: .destructive) { Task { await delete(server) } } label: {
                                            Image(systemName: "trash")
                                        }
                                        .disabled(busyID != nil)
                                    }
                                    .buttonStyle(.bordered)
                                    .controlSize(.small)
                                }
                            }
                        }

                        if !tools.isEmpty {
                            GlassCard {
                                VStack(alignment: .leading, spacing: 10) {
                                    Text("Active tools")
                                        .font(.system(size: 15, weight: .bold, design: .rounded))
                                    ForEach(tools.prefix(24)) { tool in
                                        NativeInfoRow(title: tool.name, detail: tool.description ?? "MCP tool")
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
        .sheet(isPresented: $showingAdd) {
            VStack(alignment: .leading, spacing: 14) {
                ScreenHeader(title: "Add MCP Server", subtitle: "Add a trusted local MCP command")
                TextField("Name", text: $newName)
                TextField("Command", text: $newCommand)
                TextField("Arguments", text: $newArgs)
                TextField("Environment, KEY=value pairs", text: $newEnv)
                Toggle("Enabled", isOn: $newEnabled)
                    .toggleStyle(.switch)
                HStack {
                    Spacer()
                    Button("Cancel") { showingAdd = false }
                    Button("Add Server") {
                        Task { await create() }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(newName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || newCommand.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .textFieldStyle(.roundedBorder)
            .padding(24)
            .frame(width: 460)
        }
    }

    private func mcpTint(_ status: String?) -> Color {
        switch status?.lowercased() {
        case "running": return .green
        case "starting": return .orange
        case "error": return .red
        default: return .secondary
        }
    }

    private func load() async {
        do {
            async let serverResult = client.nativeMCPServers()
            async let toolResult = client.nativeMCPTools()
            servers = try await serverResult
            tools = try await toolResult
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }

    private func run(_ server: NativeMCPServer, _ action: String) async {
        busyID = server.id
        do {
            try await client.mcpAction(server.id, action: action)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
        busyID = nil
    }

    private func delete(_ server: NativeMCPServer) async {
        busyID = server.id
        do {
            try await client.deleteMCPServer(server.id)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
        busyID = nil
    }

    private func create() async {
        do {
            try await client.createMCPServer(
                name: newName,
                command: newCommand,
                args: newArgs,
                env: newEnv,
                enabled: newEnabled
            )
            newName = ""
            newCommand = ""
            newArgs = ""
            newEnv = ""
            showingAdd = false
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

extension NativeMCPServer {
    var commandLine: String {
        firstNonEmptyGatewayString(url, [command, args].compactMap { firstNonEmptyGatewayString($0) }.joined(separator: " "))
            ?? "No command"
    }
}
