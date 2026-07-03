import Foundation

/// Deep-link actions parsed from the `cybara://` URL scheme.
public enum DeepLinkAction: Equatable {
    case focus // cybara:// or cybara://open  — bring the window forward
    case restart // cybara://restart            — restart the gateway
    case openBrowser // cybara://browser         — open the web UI in the system browser
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

    /// A gateway is healthy only if it returns 200 AND the body identifies as a
    /// Cybara gateway ("status":"healthy") — so we never attach to an unrelated
    /// process squatting on the port.
    public static func isHealthyResponse(statusCode: Int, body: String) -> Bool {
        guard statusCode == 200 else { return false }
        let normalized = body.replacingOccurrences(of: " ", with: "")
        return normalized.contains("\"status\":\"healthy\"")
    }

    /// Environment for the spawned sidecar: inherits the parent env and pins the
    /// loopback host + native-app markers.
    public static func launchEnvironment(
        base: [String: String], port: Int, resourceDirectory: String? = nil
    ) -> [String: String] {
        var environment = base
        environment["PORT"] = String(port)
        environment["CYBARA_HOST"] = "127.0.0.1"
        environment["CYBARA_NATIVE_APP"] = "1"
        environment["CYBARA_NATIVE_PORT"] = String(port)
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
        var paths: [String] = []

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
            bundledSidecar.appendingPathComponent("cybara").path,
            bundledSidecar.appendingPathComponent("cybara-aarch64-apple-darwin").path,
            bundledSidecar.appendingPathComponent("cybara-x86_64-apple-darwin").path,
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
