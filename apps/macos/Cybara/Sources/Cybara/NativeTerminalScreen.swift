import Foundation
import SwiftUI

@MainActor
final class NativeTerminalConnection: ObservableObject {
    @Published var output = ""
    @Published var connected = false
    @Published var error: String?

    private var task: URLSessionWebSocketTask?

    func connect(client: GatewayClient, sessionID: String) {
        disconnect()
        guard var components = URLComponents(url: URL(string: "api/terminal/ws", relativeTo: client.baseURL)!.absoluteURL, resolvingAgainstBaseURL: false) else {
            error = "Invalid terminal URL."
            return
        }
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.queryItems = [URLQueryItem(name: "session", value: sessionID)]
        guard let url = components.url else {
            error = "Invalid terminal URL."
            return
        }
        var request = URLRequest(url: url)
        if let key = GatewayClient.loadAPIKey() {
            request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        }
        if let password = GatewayClient.loadGatewayPassword() {
            request.setValue(password, forHTTPHeaderField: "X-Cybara-Gateway-Password")
        }
        let next = URLSession.shared.webSocketTask(with: request)
        task = next
        output = ""
        error = nil
        connected = true
        next.resume()
        receive()
    }

    func send(_ text: String) {
        guard let task else { return }
        task.send(.string(text)) { [weak self] error in
            Task { @MainActor in
                if let error {
                    self?.error = error.localizedDescription
                }
            }
        }
    }

    func disconnect() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        connected = false
    }

    private func receive() {
        task?.receive { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                switch result {
                case .success(let message):
                    switch message {
                    case .string(let text):
                        self.output += text
                    case .data(let data):
                        self.output += String(data: data, encoding: .utf8) ?? ""
                    @unknown default:
                        break
                    }
                    self.receive()
                case .failure(let error):
                    if self.connected {
                        self.error = error.localizedDescription
                    }
                    self.connected = false
                }
            }
        }
    }
}

struct TerminalScreen: View {
    let client: GatewayClient
    var isActive = true
    var compact = false
    @StateObject private var connection = NativeTerminalConnection()
    @State private var sessions: [NativeTerminalSession] = []
    @State private var activeSessionID = UUID().uuidString
    @State private var command = ""
    @State private var loaded = false
    @State private var error: String?
    @State private var terminalEnabled: Bool?
    @State private var enabling = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if terminalEnabled == false {
                ContentUnavailableView {
                    Label("Terminal Disabled", systemImage: "terminal")
                } description: {
                    Text("Enable terminal access to use a native shell session.")
                } actions: {
                    Button("Enable Terminal") {
                        Task { await enableTerminal() }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(enabling)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                HStack {
                    ScreenHeader(title: "Terminal", subtitle: connection.connected ? "Connected" : "Native shell session")
                    Button("New") {
                        activeSessionID = UUID().uuidString
                        connection.connect(client: client, sessionID: activeSessionID)
                    }
                    .buttonStyle(.borderedProminent)
                    Button(connection.connected ? "Disconnect" : "Connect") {
                        if connection.connected {
                            connection.disconnect()
                        } else {
                            connection.connect(client: client, sessionID: activeSessionID)
                        }
                    }
                    .buttonStyle(.bordered)
                }
                .padding(compact ? 12 : 24)

                if let error = error ?? connection.error {
                    Text(error)
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.red)
                        .padding(.horizontal, compact ? 12 : 24)
                }

                VStack(alignment: .leading, spacing: 10) {
                    ScrollView {
                        Text(connection.output.isEmpty ? "Connect to start a terminal session." : connection.output)
                            .font(.system(size: 12, design: .monospaced))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(14)
                    }
                    .cybaraGlass(cornerRadius: compact ? 10 : 16)

                    HStack {
                        TextField("Command", text: $command)
                            .textFieldStyle(.roundedBorder)
                            .onSubmit { sendCommand() }
                        Button("Send", action: sendCommand)
                            .buttonStyle(.borderedProminent)
                            .disabled(!connection.connected || command.isEmpty)
                    }
                }
                .padding(.horizontal, compact ? 12 : 24)
                .padding(.bottom, compact ? 12 : 24)
            }
        }
        .task(id: isActive) {
            guard isActive else { return }
            await loadSessions()
        }
        .onDisappear { connection.disconnect() }
    }

    private func sendCommand() {
        let trimmed = command
        guard !trimmed.isEmpty else { return }
        connection.send(trimmed + "\n")
        command = ""
    }

    private func loadSessions() async {
        do {
            let config = try await client.appConfig()
            terminalEnabled = config["terminal_enabled"] as? Bool ?? false
            guard terminalEnabled == true else {
                error = nil
                loaded = true
                return
            }
            sessions = try await client.terminalSessions()
            if let first = sessions.first {
                activeSessionID = first.id
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }

    private func enableTerminal() async {
        enabling = true
        defer { enabling = false }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["terminal_enabled": true])
            try await client.updateAppConfig(body)
            terminalEnabled = true
            error = nil
            await loadSessions()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
