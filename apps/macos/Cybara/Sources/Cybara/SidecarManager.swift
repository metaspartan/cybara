import AppKit
import Foundation
import SwiftUI

@MainActor
final class SidecarManager: ObservableObject {
    enum GatewayMode: String {
        case idle
        case attached
        case managed
    }

    enum Status: Equatable {
        case idle
        case starting
        case ready
        case stopped
        case failed(String)

        var title: String {
            switch self {
            case .idle:
                return "Idle"
            case .starting:
                return "Starting"
            case .ready:
                return "Ready"
            case .stopped:
                return "Stopped"
            case .failed:
                return "Failed"
            }
        }

        var systemImage: String {
            switch self {
            case .idle:
                return "moon.zzz.fill"
            case .starting:
                return "bolt.horizontal.circle.fill"
            case .ready:
                return "checkmark.circle.fill"
            case .stopped:
                return "stop.circle.fill"
            case .failed:
                return "xmark.octagon.fill"
            }
        }

        var color: Color {
            switch self {
            case .idle, .stopped:
                return .secondary
            case .starting:
                return .orange
            case .ready:
                return .green
            case .failed:
                return .red
            }
        }
    }

    struct LaunchCommand {
        let executableURL: URL
        let arguments: [String]
        let displayPath: String
    }

    @Published private(set) var status: Status = .idle
    @Published private(set) var binaryPath = "Unresolved"
    @Published private(set) var logs: [String] = ["Cybara initialized."]
    @Published private(set) var gatewayMode: GatewayMode = .idle

    let port: Int
    var serverURL: URL {
        URL(string: "http://127.0.0.1:\(port)")!
    }

    var statusMessage: String {
        switch status {
        case .idle:
            return "Ready to launch the local Cybara sidecar."
        case .starting:
            return "Connecting to the local Cybara gateway on 127.0.0.1:\(port)."
        case .ready:
            if gatewayMode == .attached {
                return "Connected to an existing local Cybara gateway on 127.0.0.1:\(port)."
            }
            return "The managed local Cybara gateway is healthy and the web runtime is attached."
        case .stopped:
            if gatewayMode == .attached {
                return "Detached from the existing local Cybara gateway."
            }
            return "The managed sidecar is not running."
        case .failed(let message):
            return message
        }
    }

    var isReady: Bool {
        if case .ready = status {
            return true
        }
        return false
    }

    var managesGateway: Bool {
        gatewayMode == .managed
    }

    private var process: Process?
    private var outputHandle: FileHandle?
    private var readinessTask: Task<Void, Never>?

    init() {
        port = Int(ProcessInfo.processInfo.environment["CYBARA_NATIVE_PORT"] ?? "") ?? 4269
    }

    deinit {
        outputHandle?.readabilityHandler = nil
        readinessTask?.cancel()
        process?.terminate()
    }

    func startIfNeeded() async {
        guard process == nil else { return }
        await start()
    }

    func start() async {
        guard process == nil else { return }

        status = .starting

        if await isGatewayHealthy() {
            gatewayMode = .attached
            status = .ready
            appendLog("Attached to existing Cybara gateway at \(serverURL.absoluteString)")
            return
        }

        do {
            let command = try resolveLaunchCommand()
            binaryPath = command.displayPath

            let process = Process()
            process.executableURL = command.executableURL
            process.arguments = command.arguments
            process.environment = buildLaunchEnvironment()

            let pipe = Pipe()
            process.standardOutput = pipe
            process.standardError = pipe
            observe(pipe: pipe)

            process.terminationHandler = { [weak self] terminated in
                Task { @MainActor in
                    guard let self else { return }
                    self.appendLog("Sidecar exited with code \(terminated.terminationStatus).")
                    self.outputHandle?.readabilityHandler = nil
                    self.outputHandle = nil
                    self.process = nil
                    if self.gatewayMode == .managed {
                        if case .ready = self.status {
                            self.status = .stopped
                        } else if case .starting = self.status {
                            self.status = .failed("Managed sidecar exited before the gateway became healthy.")
                        }
                        self.gatewayMode = .idle
                    }
                }
            }

            try process.run()
            self.process = process
            self.gatewayMode = .managed
            appendLog("Launching \(command.displayPath) \(command.arguments.joined(separator: " "))")

            readinessTask?.cancel()
            readinessTask = Task {
                await waitForHealth()
            }
        } catch {
            status = .failed(error.localizedDescription)
            appendLog("Failed to launch sidecar: \(error.localizedDescription)")
        }
    }

    func stop() {
        readinessTask?.cancel()
        readinessTask = nil
        outputHandle?.readabilityHandler = nil
        outputHandle = nil
        if gatewayMode == .managed {
            process?.terminate()
        }
        process = nil
        status = .stopped
        if gatewayMode == .managed {
            gatewayMode = .idle
        }
    }

    func restart() async {
        if gatewayMode == .managed {
            stop()
            await start()
            return
        }

        status = .starting
        if await isGatewayHealthy() {
            gatewayMode = .attached
            status = .ready
            appendLog("Reconnected to existing Cybara gateway at \(serverURL.absoluteString)")
            return
        }

        gatewayMode = .idle
        await start()
    }

    func revealBinary() {
        let path = binaryPath
        guard path != "Unresolved" else { return }
        NSWorkspace.shared.selectFile(path, inFileViewerRootedAtPath: "")
    }

    private func waitForHealth() async {
        let deadline = Date().addingTimeInterval(20)
        appendLog("Waiting for gateway health at \(healthURL.absoluteString)")

        while !Task.isCancelled && Date() < deadline {
            if await isGatewayHealthy() {
                status = .ready
                appendLog("Cybara gateway is healthy at \(serverURL.absoluteString)")
                return
            }

            try? await Task.sleep(for: .milliseconds(400))
        }

        if !Task.isCancelled {
            status = .failed("Timed out waiting for \(healthURL.absoluteString)")
            appendLog("Timed out waiting for the sidecar health endpoint.")
        }
    }

    private var healthURL: URL {
        serverURL.appending(path: "api/health")
    }

    private func isGatewayHealthy() async -> Bool {
        do {
            let (_, response) = try await URLSession.shared.data(from: healthURL)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }

    private func observe(pipe: Pipe) {
        outputHandle?.readabilityHandler = nil
        outputHandle = pipe.fileHandleForReading
        outputHandle?.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let output = String(data: data, encoding: .utf8) else { return }
            let lines = output
                .split(whereSeparator: \.isNewline)
                .map(String.init)
                .filter { !$0.isEmpty }

            Task { @MainActor in
                guard let self else { return }
                for line in lines {
                    self.appendLog(line)
                }
            }
        }
    }

    private func appendLog(_ message: String) {
        let timestamp = ISO8601DateFormatter().string(from: Date())
        logs.append("[\(timestamp)] \(message)")
        if logs.count > 120 {
            logs.removeFirst(logs.count - 120)
        }
    }

    private func buildLaunchEnvironment() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        environment["PORT"] = String(port)
        environment["CYBARA_HOST"] = "127.0.0.1"
        environment["CYBARA_NATIVE_APP"] = "1"
        environment["CYBARA_NATIVE_PORT"] = String(port)
        return environment
    }

    private func resolveLaunchCommand() throws -> LaunchCommand {
        let environment = ProcessInfo.processInfo.environment
        let arguments = ["start", "--enable-terminal"]

        if let override = environment["CYBARA_NATIVE_SIDECAR_PATH"], isExecutable(at: override) {
            return LaunchCommand(
                executableURL: URL(fileURLWithPath: override),
                arguments: arguments,
                displayPath: override
            )
        }

        if let pathBinary = resolveBinaryOnPath(named: "cybara") {
            return LaunchCommand(
                executableURL: URL(fileURLWithPath: "/usr/bin/env"),
                arguments: ["cybara"] + arguments,
                displayPath: pathBinary
            )
        }

        let currentDirectory = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        let executableDirectory = URL(fileURLWithPath: CommandLine.arguments[0])
            .deletingLastPathComponent()
        let bundledSidecarDirectory = executableDirectory.appending(path: "sidecar")

        let candidates = [
            currentDirectory.appending(path: "src-tauri/bin/cybara-aarch64-apple-darwin").path(),
            currentDirectory.appending(path: "src-tauri/bin/cybara-x86_64-apple-darwin").path(),
            currentDirectory.appending(path: "release/cybara").path(),
            bundledSidecarDirectory.appending(path: "cybara").path(),
            bundledSidecarDirectory.appending(path: "cybara-aarch64-apple-darwin").path(),
            bundledSidecarDirectory.appending(path: "cybara-x86_64-apple-darwin").path(),
            executableDirectory.appending(path: "cybara-aarch64-apple-darwin").path(),
            executableDirectory.appending(path: "cybara-x86_64-apple-darwin").path(),
            executableDirectory.appending(path: "cybara").path(),
        ]

        if let match = candidates.first(where: isExecutable(at:)) {
            return LaunchCommand(
                executableURL: URL(fileURLWithPath: match),
                arguments: arguments,
                displayPath: match
            )
        }

        throw NSError(
            domain: "Cybara",
            code: 1,
            userInfo: [
                NSLocalizedDescriptionKey:
                    "No Cybara sidecar was found. Set CYBARA_NATIVE_SIDECAR_PATH or build the Tauri sidecar first.",
            ]
        )
    }

    private func resolveBinaryOnPath(named command: String) -> String? {
        let paths = (ProcessInfo.processInfo.environment["PATH"] ?? "")
            .split(separator: ":")
            .map(String.init)
        for path in paths {
            let candidate = URL(fileURLWithPath: path).appending(path: command).path()
            if isExecutable(at: candidate) {
                return candidate
            }
        }
        return nil
    }

    private func isExecutable(at path: String) -> Bool {
        FileManager.default.isExecutableFile(atPath: path)
    }
}
