import AppKit
import Darwin
import Foundation
import SwiftUI

@MainActor
final class SidecarManager: ObservableObject {
    enum GatewayMode: String {
        case idle
        case attached
        case managed
    }

    private enum ExistingGatewayResolution {
        case launch
        case attached
        case blocked
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

    @Published private(set) var port: Int
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
    private var healthMonitorTask: Task<Void, Never>?
    private var userInitiatedStop = false
    private var restartAttempts = 0
    private var consecutiveHealthFailures = 0
    private var stableHealthChecks = 0

    init() {
        let configuredPort = ProcessInfo.processInfo.environment["CYBARA_NATIVE_PORT"]
        port = SidecarCore.port(fromEnv: configuredPort)
    }

    deinit {
        outputHandle?.readabilityHandler = nil
        readinessTask?.cancel()
        healthMonitorTask?.cancel()
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

        switch await resolveExistingGateway() {
        case .attached, .blocked:
            return
        case .launch:
            break
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
                    self.healthMonitorTask?.cancel()
                    self.healthMonitorTask = nil
                    self.process = nil
                    guard self.gatewayMode == .managed else { return }
                    self.gatewayMode = .idle

                    if self.userInitiatedStop {
                        self.status = .stopped
                        return
                    }

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

    func stopAndWait() async {
        await terminateManagedProcess(managedProcessForStop(), timeout: 3)
    }

    func stopForUpdate() async {
        await stopAndWait()
    }

    func restart() async {
        if gatewayMode == .managed {
            await terminateManagedProcess(managedProcessForStop(), timeout: 3)
            await start()
            return
        }

        status = .starting
        switch await resolveExistingGateway() {
        case .attached, .blocked:
            return
        case .launch:
            break
        }

        gatewayMode = .idle
        await start()
    }

    private func managedProcessForStop() -> Process? {
        userInitiatedStop = true
        restartAttempts = 0
        readinessTask?.cancel()
        readinessTask = nil
        healthMonitorTask?.cancel()
        healthMonitorTask = nil
        outputHandle?.readabilityHandler = nil
        outputHandle = nil
        let managedProcess = gatewayMode == .managed ? process : nil
        process = nil
        status = .stopped
        if gatewayMode == .managed {
            gatewayMode = .idle
        }
        return managedProcess
    }

    func waitForAttachedGatewayRestart() async {
        status = .starting
        gatewayMode = .attached
        appendLog("Waiting for attached Cybara gateway to restart at \(serverURL.absoluteString)")
        let deadline = Date().addingTimeInterval(30)
        while Date() < deadline {
            if await compatibleGatewayProbe() != nil {
                markGatewayReady("Attached Cybara gateway is healthy at \(serverURL.absoluteString)")
                return
            }
            try? await Task.sleep(for: .milliseconds(500))
        }
        status = .failed("Timed out waiting for attached gateway restart.")
        appendLog("Timed out waiting for attached gateway restart.")
    }

    private func handleUnexpectedExit() {
        stableHealthChecks = 0
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
            if self.userInitiatedStop || self.process != nil { return }
            await self.start()
        }
    }

    private func markGatewayReady(_ message: String) {
        status = .ready
        consecutiveHealthFailures = 0
        appendLog(message)
        startHealthMonitor()
    }

    private func startHealthMonitor() {
        healthMonitorTask?.cancel()
        healthMonitorTask = Task { [weak self] in
            while let self, !Task.isCancelled {
                try? await Task.sleep(for: .seconds(3))
                guard !Task.isCancelled, self.isReady else { continue }
                if await self.livenessProbe() {
                    self.consecutiveHealthFailures = 0
                    self.stableHealthChecks += 1
                    if SidecarCore.stableHealthResetsRestartBudget(self.stableHealthChecks) {
                        self.restartAttempts = 0
                    }
                    continue
                }
                self.stableHealthChecks = 0
                self.consecutiveHealthFailures += 1
                if !SidecarCore.healthFailureRequiresRestart(self.consecutiveHealthFailures) {
                    continue
                }
                self.consecutiveHealthFailures = 0
                await self.recoverUnresponsiveGateway()
                return
            }
        }
    }

    private func recoverUnresponsiveGateway() async {
        status = .starting
        appendLog("Gateway stopped responding to health probes; restarting it.")
        if gatewayMode == .managed {
            await terminateManagedProcess(process, timeout: 3)
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
            if await compatibleGatewayProbe() != nil {
                markGatewayReady("Cybara gateway is healthy at \(serverURL.absoluteString)")
                return
            }

            try? await Task.sleep(for: .milliseconds(400))
        }

        if !Task.isCancelled {
            status = .failed("Timed out waiting for \(healthURL.absoluteString)")
            appendLog("Timed out waiting for the sidecar health endpoint.")
        }
    }

    private var minimumGatewayVersion: String? {
        let environmentVersion = ProcessInfo.processInfo.environment["CYBARA_NATIVE_APP_VERSION"]?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if environmentVersion?.isEmpty == false { return environmentVersion }
        return SidecarCore.bundleVersion(infoDictionary: Bundle.main.infoDictionary)
    }

    private var healthURL: URL {
        serverURL.appending(path: "api/health")
    }

    private func gatewayProbe(port candidatePort: Int? = nil, timeoutInterval: TimeInterval = 2) async -> GatewayHealthProbe? {
        let targetPort = candidatePort ?? port
        guard let url = URL(string: SidecarCore.healthURLString(port: targetPort)) else { return nil }
        var request = URLRequest(url: url)
        request.timeoutInterval = timeoutInterval
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            return SidecarCore.gatewayHealthProbe(
                statusCode: code, body: String(data: data, encoding: .utf8) ?? "")
        } catch {
            return nil
        }
    }

    private func compatibleGatewayProbe() async -> GatewayHealthProbe? {
        guard let probe = await gatewayProbe(),
              SidecarCore.isGatewayVersionCompatible(
                gatewayVersion: probe.version,
                minimumVersion: minimumGatewayVersion
              )
        else { return nil }
        return probe
    }

    private func livenessProbe(timeoutInterval: TimeInterval = 2) async -> Bool {
        guard let url = URL(string: SidecarCore.livenessURLString(port: port)) else { return false }
        var request = URLRequest(url: url)
        request.timeoutInterval = timeoutInterval
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            return SidecarCore.isLiveResponse(
                statusCode: code, body: String(data: data, encoding: .utf8) ?? "")
        } catch {
            return false
        }
    }

    private func resolveExistingGateway() async -> ExistingGatewayResolution {
        var resolvedProbe = await gatewayProbe()
        if resolvedProbe == nil, !isPortAvailable(port) {
            appendLog("Existing gateway is busy at \(serverURL.absoluteString); waiting for it.")
            let deadline = Date().addingTimeInterval(60)
            while resolvedProbe == nil, !isPortAvailable(port), Date() < deadline {
                try? await Task.sleep(for: .milliseconds(500))
                resolvedProbe = await gatewayProbe()
            }
        }
        guard let probe = resolvedProbe else {
            if isPortAvailable(port) { return .launch }
            status = .failed(
                "Port \(port) is occupied by an unresponsive service. Stop it before starting Cybara."
            )
            appendLog("Refused to launch a second gateway while port \(port) is occupied.")
            return .blocked
        }
        if SidecarCore.isGatewayVersionCompatible(
            gatewayVersion: probe.version,
            minimumVersion: minimumGatewayVersion
        ) {
            gatewayMode = .attached
            markGatewayReady("Attached to existing Cybara gateway at \(serverURL.absoluteString)")
            return .attached
        }

        if await terminateStaleNativeGateway(probe) {
            appendLog("Stopped incompatible native gateway and will launch the bundled gateway.")
            return .launch
        }

        let runningVersion = probe.version.map { "v\($0)" } ?? "an unknown version"
        let requiredVersion = minimumGatewayVersion.map { "v\($0) or newer" } ?? "this app version"
        status = .failed(
            "Gateway \(runningVersion) is incompatible with Cybara Native. Stop the process on port \(port) or update it to \(requiredVersion)."
        )
        appendLog("Refused incompatible gateway \(runningVersion) at \(serverURL.absoluteString)")
        return .blocked
    }

    private func isPortAvailable(_ candidate: Int) -> Bool {
        let descriptor = Darwin.socket(AF_INET, SOCK_STREAM, 0)
        guard descriptor >= 0 else { return false }
        defer { Darwin.close(descriptor) }

        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = in_port_t(candidate).bigEndian
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))

        return withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { socketAddress in
                Darwin.bind(
                    descriptor,
                    socketAddress,
                    socklen_t(MemoryLayout<sockaddr_in>.size)
                ) == 0
            }
        }
    }

    private func terminateStaleNativeGateway(_ probe: GatewayHealthProbe) async -> Bool {
        guard let processID = probe.processID, processID > 1,
              let command = processCommand(processID: processID),
              SidecarCore.isNativeSidecarCommand(command),
              Darwin.kill(pid_t(processID), SIGTERM) == 0
        else { return false }

        let deadline = Date().addingTimeInterval(6)
        while Date() < deadline {
            if await gatewayProbe() == nil { return true }
            try? await Task.sleep(for: .milliseconds(150))
        }
        guard Darwin.kill(pid_t(processID), SIGKILL) == 0 else { return false }
        let forceDeadline = Date().addingTimeInterval(2)
        while Date() < forceDeadline {
            if await gatewayProbe() == nil { return true }
            try? await Task.sleep(for: .milliseconds(100))
        }
        return await gatewayProbe() == nil
    }

    private func terminateManagedProcess(_ runningProcess: Process?, timeout: TimeInterval) async {
        guard let runningProcess, runningProcess.isRunning else { return }
        let processID = runningProcess.processIdentifier
        runningProcess.terminate()
        let deadline = Date().addingTimeInterval(timeout)
        while runningProcess.isRunning && Date() < deadline {
            try? await Task.sleep(for: .milliseconds(50))
        }
        if runningProcess.isRunning {
            Darwin.kill(processID, SIGKILL)
            let forceDeadline = Date().addingTimeInterval(1)
            while runningProcess.isRunning && Date() < forceDeadline {
                try? await Task.sleep(for: .milliseconds(50))
            }
        }
    }

    private func processCommand(processID: Int) -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/ps")
        process.arguments = ["-p", String(processID), "-o", "command="]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()
        do {
            try process.run()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else { return nil }
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let command = String(data: data, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return command?.isEmpty == false ? command : nil
        } catch {
            return nil
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
            resourceDirectory: bundledResourcesExist ? resourceDirectory : nil,
            parentProcessID: Int(ProcessInfo.processInfo.processIdentifier)
        )
    }

    private func resolveLaunchCommand() throws -> LaunchCommand {
        let environment = ProcessInfo.processInfo.environment
        let arguments = ["start"]

        if let override = environment["CYBARA_NATIVE_SIDECAR_PATH"], isExecutable(at: override) {
            return LaunchCommand(
                executableURL: URL(fileURLWithPath: override),
                arguments: arguments,
                displayPath: override
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

        if let pathBinary = resolveBinaryOnPath(named: "cybara"),
           !SidecarCore.isAppBundleExecutableAlias(
               pathBinary,
               executableDirectory: executableDirectory.path
           ) {
            return LaunchCommand(
                executableURL: URL(fileURLWithPath: "/usr/bin/env"),
                arguments: ["cybara"] + arguments,
                displayPath: pathBinary
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
