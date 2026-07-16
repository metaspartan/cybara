import Foundation

/// Deep-link actions parsed from the `cybara://` URL scheme.
public enum DeepLinkAction: Equatable {
    case focus // cybara:// or cybara://open  — bring the window forward
    case restart // cybara://restart            — restart the gateway
    case openBrowser // cybara://browser         — open the web UI in the system browser
}

public struct GatewayHealthProbe: Equatable {
    public let status: String
    public let version: String?
    public let processID: Int?
}

/// Pure, side-effect-free logic for the macOS sidecar shell. Kept separate from
/// `SidecarManager` (which is @MainActor and owns Process/network/UI state) so it
/// is straightforward to unit-test without spawning processes or hitting sockets.
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

    public static func isHealthyResponse(statusCode: Int, body: String) -> Bool {
        gatewayHealthProbe(statusCode: statusCode, body: body) != nil
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

    /// Environment for the spawned sidecar: inherits the parent env and lets the
    /// gateway config choose the secure loopback host by default.
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

    /// `PATH` can include an app bundle's `Contents/MacOS` directory after a
    /// native launch. Treat a lowercase `cybara` binary there as an app-bundle
    /// executable alias, not as the external Bun sidecar, to avoid recursion.
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

    /// Ordered sidecar-binary candidate paths (most-specific first). Pure so the
    /// resolution order is testable without a filesystem.
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

        // SwiftPM/Xcode local runs commonly start from apps/macos/Cybara or a
        // .build directory, while the sidecar is generated at the repo root.
        // Walk ancestors from both cwd and executable location so dev launches
        // resolve the same sidecar that release packaging embeds.
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

    /// Exponential backoff (capped) between automatic restart attempts after an
    /// unexpected sidecar crash. attempt is 1-based.
    public static func restartDelaySeconds(attempt: Int) -> Double {
        let clamped = max(1, attempt)
        return min(pow(2.0, Double(clamped - 1)), 30.0) // 1, 2, 4, 8, 16, 30, 30…
    }

    /// Maximum consecutive auto-restart attempts before giving up and surfacing a
    /// failure (so a crash-looping sidecar doesn't restart forever).
    public static let maxRestartAttempts = 4

    /// Parse a `cybara://` deep link into an action. Returns nil for unknown URLs.
    public static func parseDeepLink(_ url: URL) -> DeepLinkAction? {
        guard url.scheme?.lowercased() == "cybara" else { return nil }
        // Host or first path component identifies the action.
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
}
