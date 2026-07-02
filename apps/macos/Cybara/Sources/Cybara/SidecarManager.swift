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
    /// Set when the user explicitly stops/restarts, so an expected exit isn't
    /// treated as a crash by the auto-restart logic.
    private var userInitiatedStop = false
    /// Consecutive auto-restart attempts since the gateway was last healthy.
    private var restartAttempts = 0

    init() {
        port = SidecarCore.port(fromEnv: ProcessInfo.processInfo.environment["CYBARA_NATIVE_PORT"])
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

        userInitiatedStop = false
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
                let code = terminated.terminationStatus
                Task { @MainActor in
                    guard let self else { return }
                    self.appendLog("Sidecar exited with code \(code).")
                    self.outputHandle?.readabilityHandler = nil
                    self.outputHandle = nil
                    self.process = nil
                    guard self.gatewayMode == .managed else { return }
                    self.gatewayMode = .idle

                    // Expected exit (user stop/restart) — don't auto-recover.
                    if self.userInitiatedStop {
                        self.status = .stopped
                        return
                    }

                    // Unexpected crash — auto-restart with capped exponential backoff.
                    self.handleUnexpectedExit()
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
        userInitiatedStop = true
        restartAttempts = 0
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

    /// Recover from an unexpected managed-sidecar exit by restarting with a
    /// capped exponential backoff. Gives up after `maxRestartAttempts` so a
    /// crash-looping sidecar surfaces a failure instead of restarting forever.
    private func handleUnexpectedExit() {
        restartAttempts += 1
        guard restartAttempts <= SidecarCore.maxRestartAttempts else {
            status = .failed(
                "The Cybara gateway crashed repeatedly (\(restartAttempts - 1) restarts). Use Gateway ▸ Restart to try again."
            )
            appendLog("Auto-restart giving up after \(restartAttempts - 1) attempts.")
            restartAttempts = 0
            return
        }

        let delay = SidecarCore.restartDelaySeconds(attempt: restartAttempts)
        status = .starting
        appendLog(
            "Gateway crashed — auto-restarting in \(Int(delay))s (attempt \(restartAttempts)/\(SidecarCore.maxRestartAttempts))."
        )
        readinessTask?.cancel()
        readinessTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard let self, !Task.isCancelled else { return }
            // Bail if the user stopped us or another start already happened.
            if self.userInitiatedStop || self.process != nil { return }
            await self.start()
        }
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
                restartAttempts = 0
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
            let (data, response) = try await URLSession.shared.data(from: healthURL)
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            return SidecarCore.isHealthyResponse(
                statusCode: code, body: String(data: data, encoding: .utf8) ?? "")
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
        let executableDirectory = URL(fileURLWithPath: CommandLine.arguments[0])
            .deletingLastPathComponent()
            .path
        let resourceDirectory = SidecarCore.bundledResourceDirectory(
            executableDirectory: executableDirectory)
        let bundledResourcesExist = FileManager.default.fileExists(atPath: resourceDirectory)

        return SidecarCore.launchEnvironment(
            base: ProcessInfo.processInfo.environment,
            port: port,
            resourceDirectory: bundledResourcesExist ? resourceDirectory : nil
        )
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

        let executableDirectory = URL(fileURLWithPath: CommandLine.arguments[0])
            .deletingLastPathComponent()
        let candidates = SidecarCore.sidecarCandidatePaths(
            currentDirectory: FileManager.default.currentDirectoryPath,
            executableDirectory: executableDirectory.path
        )

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
