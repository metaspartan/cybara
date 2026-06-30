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
        let alert = NSAlert()
        alert.messageText = "A new version of Cybara is available"
        alert.informativeText =
            "\(release.name ?? release.tagName) is available. You're running \(currentVersion)."
        alert.addButton(withTitle: "Download")
        alert.addButton(withTitle: "Later")
        if alert.runModal() == .alertFirstButtonReturn, let url = URL(string: release.htmlURL) {
            NSWorkspace.shared.open(url)
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
