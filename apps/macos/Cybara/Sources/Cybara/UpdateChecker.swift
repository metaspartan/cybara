import AppKit
import Foundation
import SwiftUI

private final class UpdateDownloadDelegate: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    private let progressChanged: @Sendable (Int64, Int64) -> Void

    init(progressChanged: @escaping @Sendable (Int64, Int64) -> Void) {
        self.progressChanged = progressChanged
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        progressChanged(totalBytesWritten, totalBytesExpectedToWrite)
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didFinishDownloadingTo location: URL
    ) {}
}

@MainActor
final class UpdateChecker: ObservableObject {
    enum State: Equatable {
        case idle
        case checking
        case upToDate(current: String)
        case updateAvailable(ReleaseInfo)
        case downloading(asset: ReleaseAsset, receivedBytes: Int64, totalBytes: Int64)
        case verifying
        case installing
        case relaunching
        case failed(String)
    }

    @Published private(set) var state: State = .idle
    var prepareForRelaunch: (() async -> Void)?

    var isBusy: Bool {
        switch state {
        case .checking, .downloading, .verifying, .installing, .relaunching:
            return true
        default:
            return false
        }
    }

    var statusText: String {
        switch state {
        case .idle:
            return "Ready"
        case .checking:
            return "Checking for updates…"
        case .upToDate(let current):
            return "Cybara \(current) is up to date"
        case .updateAvailable(let release):
            return "\(release.name ?? release.tagName) is available"
        case .downloading(let asset, let receivedBytes, let totalBytes):
            let expectedBytes = totalBytes > 0 ? totalBytes : asset.size ?? 0
            if expectedBytes > 0, receivedBytes > 0 {
                let received = ByteCountFormatter.string(fromByteCount: receivedBytes, countStyle: .file)
                let expected = ByteCountFormatter.string(fromByteCount: expectedBytes, countStyle: .file)
                let percentage = min(100, Int((Double(receivedBytes) / Double(expectedBytes)) * 100))
                return "Downloading \(received) of \(expected) (\(percentage)%)…"
            }
            if expectedBytes > 0 {
                return "Downloading \(ByteCountFormatter.string(fromByteCount: expectedBytes, countStyle: .file))…"
            }
            return "Downloading update…"
        case .verifying:
            return "Verifying download…"
        case .installing:
            return "Preparing installation…"
        case .relaunching:
            return "Relaunching Cybara…"
        case .failed(let message):
            return message
        }
    }

    var progressValue: Double? {
        guard case .downloading(let asset, let receivedBytes, let totalBytes) = state else { return nil }
        let expectedBytes = totalBytes > 0 ? totalBytes : asset.size ?? 0
        guard expectedBytes > 0 else { return nil }
        return min(1, max(0, Double(receivedBytes) / Double(expectedBytes)))
    }

    func recordDownloadProgress(asset: ReleaseAsset, receivedBytes: Int64, totalBytes: Int64) {
        state = .downloading(
            asset: asset,
            receivedBytes: receivedBytes,
            totalBytes: totalBytes
        )
    }

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
        let checksumAsset = asset.flatMap {
            UpdateCore.selectChecksumAsset(for: $0, assets: release.assets)
        }
        let alert = NSAlert()
        alert.messageText = "A new version of Cybara is available"
        alert.informativeText =
            updateAlertText(release: release, asset: asset)
        if asset != nil, checksumAsset != nil {
            alert.addButton(withTitle: "Install & Relaunch")
        }
        alert.addButton(withTitle: "Release Notes")
        alert.addButton(withTitle: "Later")

        let response = alert.runModal()
        if let asset, let checksumAsset, response == .alertFirstButtonReturn {
            Task { await installAndRelaunch(asset, checksumAsset: checksumAsset) }
            return
        }
        let notesResponse: NSApplication.ModalResponse =
            asset == nil || checksumAsset == nil ? .alertFirstButtonReturn : .alertSecondButtonReturn
        if response == notesResponse, let url = UpdateChecker.safeReleaseURL(release.htmlURL) {
            NSWorkspace.shared.open(url)
        }
    }

    private func updateAlertText(release: ReleaseInfo, asset: ReleaseAsset?) -> String {
        var text = "\(release.name ?? release.tagName) is available. You're running \(currentVersion)."
        if let size = asset?.size, size > 0 {
            text += " Download size: \(ByteCountFormatter.string(fromByteCount: size, countStyle: .file))."
        }
        return text
    }

    static func safeReleaseURL(_ raw: String) -> URL? {
        guard let url = URL(string: raw), url.scheme?.lowercased() == "https" else { return nil }
        guard let host = url.host?.lowercased() else { return nil }
        let allowedHosts: Set<String> = ["github.com", "www.github.com"]
        guard allowedHosts.contains(host) else { return nil }
        return url
    }

    private func installAndRelaunch(_ asset: ReleaseAsset, checksumAsset: ReleaseAsset) async {
        do {
            recordDownloadProgress(asset: asset, receivedBytes: 0, totalBytes: asset.size ?? 0)
            try await UpdateChecker.stageInstaller(
                asset: asset,
                checksumAsset: checksumAsset,
                destAppPath: Bundle.main.bundleURL.path,
                scriptBody: UpdateCore.selfUpdateScript,
                stateChanged: { [weak self] nextState in
                    Task { @MainActor in self?.state = nextState }
                }
            )
            state = .relaunching
            await prepareForRelaunch?()
            NSApp.terminate(nil)
        } catch {
            state = .failed(error.localizedDescription)
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
    nonisolated static func stageInstaller(
        asset: ReleaseAsset,
        checksumAsset: ReleaseAsset,
        destAppPath: String,
        scriptBody: String,
        stateChanged: @escaping @Sendable (State) -> Void = { _ in }
    ) async throws {
        guard let url = UpdateCore.trustedReleaseAssetURL(asset.downloadURL) else {
            throw UpdateInstallError.message("Invalid download URL.")
        }
        guard let checksumURL = UpdateCore.trustedReleaseAssetURL(checksumAsset.downloadURL) else {
            throw UpdateInstallError.message("Invalid checksum URL.")
        }
        let (checksumData, checksumResponse) = try await URLSession.shared.data(from: checksumURL)
        if let http = checksumResponse as? HTTPURLResponse, http.statusCode != 200 {
            throw UpdateInstallError.message("Checksum download failed (HTTP \(http.statusCode)).")
        }
        guard
            let checksumText = String(data: checksumData, encoding: .utf8),
            let expectedChecksum = UpdateCore.parseSHA256(checksumText)
        else {
            throw UpdateInstallError.message("The published checksum is invalid.")
        }
        let downloadDelegate = UpdateDownloadDelegate { receivedBytes, expectedBytes in
            stateChanged(.downloading(
                asset: asset,
                receivedBytes: receivedBytes,
                totalBytes: expectedBytes > 0 ? expectedBytes : asset.size ?? 0
            ))
        }
        let (downloadedURL, response) = try await URLSession.shared.download(
            from: url,
            delegate: downloadDelegate
        )
        if let http = response as? HTTPURLResponse, http.statusCode != 200 {
            throw UpdateInstallError.message("Download failed (HTTP \(http.statusCode)).")
        }
        stateChanged(.verifying)
        let archiveData = try Data(contentsOf: downloadedURL, options: .mappedIfSafe)
        guard UpdateCore.sha256Hex(archiveData) == expectedChecksum else {
            throw UpdateInstallError.message("The downloaded update failed checksum verification.")
        }

        let fileManager = FileManager.default
        let workDir = fileManager.temporaryDirectory
            .appendingPathComponent("cybara-update-\(UUID().uuidString)", isDirectory: true)
        try fileManager.createDirectory(at: workDir, withIntermediateDirectories: true)
        let zipURL = workDir.appendingPathComponent(asset.name.isEmpty ? "update.zip" : asset.name)
        try fileManager.moveItem(at: downloadedURL, to: zipURL)

        stateChanged(.installing)
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
        try runTool("/usr/bin/codesign", ["--verify", "--deep", "--strict", appURL.path])
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
