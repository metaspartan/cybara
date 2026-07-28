import Foundation

public enum DeepLinkAction: Equatable {
    case focus
    case restart
    case openBrowser
}

public struct GatewayHealthProbe: Equatable {
    public let status: String
    public let version: String?
    public let processID: Int?
}

public enum FallbackPortDecision: Equatable {
    case attach(Int)
    case launch(Int)
}

public enum SidecarCore {
    public static let defaultPort = 4269

    public static func port(fromEnv value: String?) -> Int {
        guard let value, let parsed = Int(value.trimmingCharacters(in: .whitespaces)), parsed > 0,
            parsed <= 65535
        else { return defaultPort }
        return parsed
    }

    public static func serverURLString(port: Int) -> String {
        "http://127.0.0.1:\(port)"
    }

    public static func healthURLString(port: Int) -> String {
        "\(serverURLString(port: port))/api/health"
    }

    public static func livenessURLString(port: Int) -> String {
        "\(serverURLString(port: port))/api/health/live"
    }

    public static func healthFailureRequiresRestart(_ count: Int) -> Bool {
        count >= 10
    }

    public static func stableHealthResetsRestartBudget(_ count: Int) -> Bool {
        count >= 5
    }

    public static func fallbackPorts(after preferredPort: Int, count: Int = 20) -> [Int] {
        guard count > 0 else { return [] }
        let lowerBound = 1024
        let upperBound = 65535
        let rangeSize = upperBound - lowerBound + 1
        let normalized = min(max(preferredPort, lowerBound), upperBound)
        return (1...min(count, rangeSize - 1)).map { offset in
            lowerBound + ((normalized - lowerBound + offset) % rangeSize)
        }
    }

    public static func firstAvailableFallbackPort(
        after preferredPort: Int,
        count: Int = 20,
        isAvailable: (Int) -> Bool
    ) -> Int? {
        fallbackPorts(after: preferredPort, count: count).first(where: isAvailable)
    }

    public static func fallbackPortDecision(
        candidates: [Int], compatiblePorts: Set<Int>, availablePorts: Set<Int>
    ) -> FallbackPortDecision? {
        if let compatible = candidates.first(where: compatiblePorts.contains) {
            return .attach(compatible)
        }
        if let available = candidates.first(where: availablePorts.contains) {
            return .launch(available)
        }
        return nil
    }

    public static func isHealthyResponse(statusCode: Int, body: String) -> Bool {
        gatewayHealthProbe(statusCode: statusCode, body: body) != nil
    }

    public static func isLiveResponse(statusCode: Int, body: String) -> Bool {
        guard statusCode == 200,
              let data = body.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return false }
        return object["live"] as? Bool == true
    }

    public static func gatewayHealthProbe(statusCode: Int, body: String) -> GatewayHealthProbe? {
        guard statusCode == 200,
              let data = body.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let status = object["status"] as? String,
              ["healthy", "warning", "critical"].contains(status)
        else { return nil }
        let version = (object["version"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let system = object["system"] as? [String: Any]
        let process = system?["process"] as? [String: Any]
        let processID = (process?["pid"] as? NSNumber)?.intValue
        return GatewayHealthProbe(
            status: status,
            version: version?.isEmpty == false ? version : nil,
            processID: processID
        )
    }

    public static func bundleVersion(infoDictionary: [String: Any]?) -> String? {
        guard let value = infoDictionary?["CFBundleShortVersionString"] as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    public static func isGatewayVersionCompatible(
        gatewayVersion: String?, minimumVersion: String?
    ) -> Bool {
        guard let minimumVersion else { return true }
        guard let gateway = versionComponents(gatewayVersion),
              let minimum = versionComponents(minimumVersion),
              gateway[0] == minimum[0]
        else { return false }
        for index in 0 ..< max(gateway.count, minimum.count) {
            let gatewayPart = index < gateway.count ? gateway[index] : 0
            let minimumPart = index < minimum.count ? minimum[index] : 0
            if gatewayPart != minimumPart { return gatewayPart > minimumPart }
        }
        return true
    }

    public static func isNativeSidecarCommand(_ command: String) -> Bool {
        let normalized = command.replacingOccurrences(of: "\\", with: "/").lowercased()
        return normalized.contains(".app/contents/macos/sidecar/cybara")
    }

    private static func versionComponents(_ version: String?) -> [Int]? {
        guard let version else { return nil }
        let core = version.trimmingCharacters(in: .whitespacesAndNewlines)
            .split(separator: "-", maxSplits: 1)
            .first
        guard let core else { return nil }
        let components = core.split(separator: ".").map(String.init)
        guard !components.isEmpty,
              components.allSatisfy({ !$0.isEmpty && $0.allSatisfy(\.isNumber) })
        else { return nil }
        return components.compactMap(Int.init)
    }

    public static func launchEnvironment(
        base: [String: String], port: Int, resourceDirectory: String? = nil,
        parentProcessID: Int? = nil
    ) -> [String: String] {
        var environment = base
        environment["PORT"] = String(port)
        environment["CYBARA_NATIVE_APP"] = "1"
        environment["CYBARA_NATIVE_PORT"] = String(port)
        if let parentProcessID, parentProcessID > 1 {
            environment["CYBARA_NATIVE_PARENT_PID"] = String(parentProcessID)
        }
        if let resourceDirectory, !resourceDirectory.isEmpty {
            environment["CYBARA_RESOURCE_DIR"] = resourceDirectory
        }
        return environment
    }

    public static func bundledResourceDirectory(executableDirectory: String) -> String {
        URL(fileURLWithPath: executableDirectory)
            .deletingLastPathComponent()
            .appendingPathComponent("Resources")
            .appendingPathComponent("sidecar")
            .path
    }

    public static func ancestorDirectories(from path: String, maxDepth: Int = 8) -> [String] {
        var directories: [String] = []
        var seen = Set<String>()
        var current = URL(fileURLWithPath: path).standardizedFileURL

        for _ in 0 ... max(0, maxDepth) {
            let normalized = current.path
            if !seen.contains(normalized) {
                directories.append(normalized)
                seen.insert(normalized)
            }

            let parent = current.deletingLastPathComponent()
            if parent.path == current.path { break }
            current = parent
        }

        return directories
    }

    public static func isAppBundleExecutableAlias(_ path: String, executableDirectory: String)
        -> Bool
    {
        let candidateURL = URL(fileURLWithPath: (path as NSString).standardizingPath)
        let candidateDirectory = (candidateURL.deletingLastPathComponent().path as NSString)
            .standardizingPath
        let executableDirectory = (executableDirectory as NSString).standardizingPath
        guard candidateDirectory == executableDirectory else {
            return false
        }
        return candidateURL.lastPathComponent.lowercased() == "cybara"
    }

    public static func sidecarCandidatePaths(currentDirectory: String, executableDirectory: String)
        -> [String]
    {
        let exec = URL(fileURLWithPath: executableDirectory)
        let bundledSidecar = exec.appendingPathComponent("sidecar")
        var paths: [String] = [
            bundledSidecar.appendingPathComponent("cybara").path,
            bundledSidecar.appendingPathComponent("cybara-aarch64-apple-darwin").path,
            bundledSidecar.appendingPathComponent("cybara-x86_64-apple-darwin").path,
        ]

        let roots =
            ancestorDirectories(from: currentDirectory)
            + ancestorDirectories(from: executableDirectory)
        for root in roots {
            let base = URL(fileURLWithPath: root)
            paths.append(base.appendingPathComponent("src-tauri/bin/cybara-aarch64-apple-darwin").path)
            paths.append(base.appendingPathComponent("src-tauri/bin/cybara-x86_64-apple-darwin").path)
            paths.append(base.appendingPathComponent("release/cybara").path)
        }

        paths.append(contentsOf: [
            exec.appendingPathComponent("cybara-aarch64-apple-darwin").path,
            exec.appendingPathComponent("cybara-x86_64-apple-darwin").path,
            exec.appendingPathComponent("cybara").path,
        ])

        var seen = Set<String>()
        return paths.filter { path in
            if seen.contains(path) { return false }
            seen.insert(path)
            return true
        }
    }

    public static func restartDelaySeconds(attempt: Int) -> Double {
        let clamped = max(1, attempt)
        return min(pow(2.0, Double(clamped - 1)), 30.0)
    }

    public static let maxRestartAttempts = 4

    public static func parseDeepLink(_ url: URL) -> DeepLinkAction? {
        guard url.scheme?.lowercased() == "cybara" else { return nil }
        let host = url.host?.lowercased() ?? ""
        let firstPath = url.pathComponents.first(where: { $0 != "/" })?.lowercased() ?? ""
        let token = host.isEmpty ? firstPath : host
        switch token {
        case "", "open", "focus", "show":
            return .focus
        case "restart", "reload":
            return .restart
        case "browser", "web", "dashboard":
            return .openBrowser
        default:
            return nil
        }
    }

    public static func openFilePath(from url: URL) -> String? {
        guard url.isFileURL else { return nil }
        let path = url.standardizedFileURL.path.trimmingCharacters(in: .whitespacesAndNewlines)
        return path.isEmpty ? nil : path
    }
}
