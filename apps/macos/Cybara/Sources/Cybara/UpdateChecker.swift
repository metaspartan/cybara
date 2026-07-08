import AppKit
import Foundation
import SwiftUI

/// Checks GitHub Releases for a newer build and surfaces it to the user. The app
/// is distributed via GitHub Releases, so this queries the REST API, compares the
/// latest tag against the running `CFBundleShortVersionString`, and (when newer)
/// offers to open the release page — it never silently auto-installs.
@MainActor
final class UpdateChecker: ObservableObject {
    enum State: Equatable {
        case idle
        case checking
        case upToDate(current: String)
        case updateAvailable(ReleaseInfo)
        case failed(String)
    }

    @Published private(set) var state: State = .idle

    /// owner/repo to check. Overridable via env for forks/testing.
    private let repo: String
    private let currentVersion: String

    init(
        repo: String = ProcessInfo.processInfo.environment["CYBARA_RELEASE_REPOSITORY"]
            ?? "metaspartan/cybara",
        currentVersion: String = Bundle.main.infoDictionary?["CFBundleShortVersionString"]
            as? String ?? "0.0.0"
    ) {
        self.repo = repo
        self.currentVersion = currentVersion
    }

    /// Fetch the latest release and update `state`. `userInitiated` controls
    /// whether an "already up to date" result is shown to the user.
    func check(userInitiated: Bool) async {
        state = .checking
        guard let url = URL(string: UpdateCore.latestReleaseAPIURLString(repo: repo)) else {
            state = .failed("Invalid release URL.")
            return
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("Cybara-macOS", forHTTPHeaderField: "User-Agent")

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard code == 200 else {
                state = .failed("GitHub returned HTTP \(code).")
                return
            }
            guard let release = UpdateCore.parseLatestRelease(json: String(data: data, encoding: .utf8) ?? "")
            else {
                state = .failed("Couldn't read the latest release.")
                return
            }

            if UpdateCore.isUpdateAvailable(latestTag: release.tagName, currentVersion: currentVersion) {
                state = .updateAvailable(release)
                presentUpdateAlert(release)
            } else {
                state = .upToDate(current: currentVersion)
                if userInitiated {
                    presentUpToDateAlert()
                }
            }
        } catch {
            state = .failed(error.localizedDescription)
            if userInitiated {
                presentErrorAlert(error.localizedDescription)
            }
        }
    }

    private func presentUpdateAlert(_ release: ReleaseInfo) {
        let asset = UpdateCore.selectNativeAsset(release.assets, arch: UpdateCore.currentArchSlug())
        let alert = NSAlert()
        alert.messageText = "A new version of Cybara is available"
        alert.informativeText =
            "\(release.name ?? release.tagName) is available. You're running \(currentVersion)."
        if asset != nil {
            alert.addButton(withTitle: "Install & Relaunch")
        }
        alert.addButton(withTitle: "Release Notes")
        alert.addButton(withTitle: "Later")

        let response = alert.runModal()
        if let asset, response == .alertFirstButtonReturn {
            Task { await installAndRelaunch(asset) }
            return
        }
        let notesResponse: NSApplication.ModalResponse =
            asset == nil ? .alertFirstButtonReturn : .alertSecondButtonReturn
        if response == notesResponse, let url = UpdateChecker.safeReleaseURL(release.htmlURL) {
            NSWorkspace.shared.open(url)
        }
    }

    static func safeReleaseURL(_ raw: String) -> URL? {
        guard let url = URL(string: raw), url.scheme?.lowercased() == "https" else { return nil }
        guard let host = url.host?.lowercased() else { return nil }
        let allowedHosts: Set<String> = ["github.com", "www.github.com"]
        guard allowedHosts.contains(host) else { return nil }
        return url
    }

    private func installAndRelaunch(_ asset: ReleaseAsset) async {
        do {
            try await UpdateChecker.stageInstaller(
                asset: asset,
                destAppPath: Bundle.main.bundleURL.path,
                scriptBody: UpdateCore.selfUpdateScript
            )
            NSApp.terminate(nil)
        } catch {
            presentErrorAlert("Update failed: \(error.localizedDescription)")
        }
    }

    private func presentUpToDateAlert() {
        let alert = NSAlert()
        alert.messageText = "You're up to date"
        alert.informativeText = "Cybara \(currentVersion) is the latest version."
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    private func presentErrorAlert(_ message: String) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Couldn't check for updates"
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }
}

enum UpdateInstallError: LocalizedError {
    case message(String)

    var errorDescription: String? {
        if case let .message(text) = self { return text }
        return nil
    }
}

extension UpdateChecker {
    /// Download the native app archive, stage it, and launch the detached
    /// swap-and-relaunch installer. Network runs on the cooperative pool;
    /// filesystem and process work runs off the main actor.
    nonisolated static func stageInstaller(
        asset: ReleaseAsset,
        destAppPath: String,
        scriptBody: String
    ) async throws {
        guard let url = URL(string: asset.downloadURL) else {
            throw UpdateInstallError.message("Invalid download URL.")
        }
        let (downloadedURL, response) = try await URLSession.shared.download(from: url)
        if let http = response as? HTTPURLResponse, http.statusCode != 200 {
            throw UpdateInstallError.message("Download failed (HTTP \(http.statusCode)).")
        }

        let fileManager = FileManager.default
        let workDir = fileManager.temporaryDirectory
            .appendingPathComponent("cybara-update-\(UUID().uuidString)", isDirectory: true)
        try fileManager.createDirectory(at: workDir, withIntermediateDirectories: true)
        let zipURL = workDir.appendingPathComponent(asset.name.isEmpty ? "update.zip" : asset.name)
        try fileManager.moveItem(at: downloadedURL, to: zipURL)

        try await Task.detached(priority: .userInitiated) {
            try installStagedArchive(
                zipURL: zipURL,
                workDir: workDir,
                destAppPath: destAppPath,
                scriptBody: scriptBody
            )
        }.value
    }

    nonisolated static func installStagedArchive(
        zipURL: URL,
        workDir: URL,
        destAppPath: String,
        scriptBody: String
    ) throws {
        let fileManager = FileManager.default
        let extractDir = workDir.appendingPathComponent("extracted", isDirectory: true)
        try fileManager.createDirectory(at: extractDir, withIntermediateDirectories: true)
        try runTool("/usr/bin/ditto", ["-x", "-k", zipURL.path, extractDir.path])

        guard let appURL = findAppBundle(in: extractDir) else {
            throw UpdateInstallError.message("Downloaded archive did not contain an app bundle.")
        }
        try? runTool("/usr/bin/xattr", ["-dr", "com.apple.quarantine", appURL.path])

        let scriptURL = workDir.appendingPathComponent("install.sh")
        try scriptBody.write(to: scriptURL, atomically: true, encoding: .utf8)

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [
            scriptURL.path,
            String(ProcessInfo.processInfo.processIdentifier),
            appURL.path,
            destAppPath,
        ]
        try process.run()
    }

    nonisolated static func runTool(_ launchPath: String, _ arguments: [String]) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: launchPath)
        process.arguments = arguments
        try process.run()
        process.waitUntilExit()
        if process.terminationStatus != 0 {
            let tool = (launchPath as NSString).lastPathComponent
            throw UpdateInstallError.message("\(tool) exited with code \(process.terminationStatus).")
        }
    }

    nonisolated static func findAppBundle(in directory: URL) -> URL? {
        let fileManager = FileManager.default
        guard
            let items = try? fileManager.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: [.isDirectoryKey]
            )
        else { return nil }

        if let app = items.first(where: { $0.pathExtension == "app" }) { return app }
        for item in items {
            let isDirectory = (try? item.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
            if isDirectory, let nested = findAppBundle(in: item) { return nested }
        }
        return nil
    }
}
