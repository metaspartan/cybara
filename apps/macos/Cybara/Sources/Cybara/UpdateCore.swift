import Foundation

/// Metadata for a published GitHub release, parsed from the REST API.
public struct ReleaseInfo: Codable, Equatable {
    public let tagName: String
    public let htmlURL: String
    public let name: String?
    public let prerelease: Bool

    enum CodingKeys: String, CodingKey {
        case tagName = "tag_name"
        case htmlURL = "html_url"
        case name
        case prerelease
    }

    public init(tagName: String, htmlURL: String, name: String?, prerelease: Bool) {
        self.tagName = tagName
        self.htmlURL = htmlURL
        self.name = name
        self.prerelease = prerelease
    }
}

/// Pure, side-effect-free update logic. The app distributes via GitHub Releases
/// (not a Sparkle appcast), so updates are checked by querying the Releases API,
/// comparing semantic versions, and pointing the user at the release page — no
/// hosted appcast, signing keys, or auto-installer required. Kept separate from
/// the @MainActor network/UI manager so the comparison + parsing logic is unit
/// testable without hitting the network.
public enum UpdateCore {
    /// Semantic version (pre-release/build metadata ignored for ordering).
    public struct SemVer: Equatable, Comparable {
        public let major: Int
        public let minor: Int
        public let patch: Int

        public static func < (lhs: SemVer, rhs: SemVer) -> Bool {
            if lhs.major != rhs.major { return lhs.major < rhs.major }
            if lhs.minor != rhs.minor { return lhs.minor < rhs.minor }
            return lhs.patch < rhs.patch
        }
    }

    public static func latestReleaseAPIURLString(repo: String) -> String {
        "https://api.github.com/repos/\(repo)/releases/latest"
    }

    /// Parse a version string like "v1.2.3", "1.2.3", or "1.2.3-beta.1".
    /// Returns nil if it doesn't contain at least major.minor.patch.
    public static func parseSemVer(_ raw: String) -> SemVer? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.hasPrefix("v") || text.hasPrefix("V") {
            text.removeFirst()
        }
        // Drop pre-release / build metadata: "1.2.3-rc.1+sha" -> "1.2.3".
        let core = text.split(whereSeparator: { $0 == "-" || $0 == "+" }).first.map(String.init) ?? text
        let parts = core.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        guard parts.count >= 3,
            let major = Int(parts[0]),
            let minor = Int(parts[1]),
            let patch = Int(parts[2])
        else { return nil }
        guard major >= 0, minor >= 0, patch >= 0 else { return nil }
        return SemVer(major: major, minor: minor, patch: patch)
    }

    /// True when `latestTag` is a strictly newer release than `currentVersion`.
    /// Conservative: unparseable versions never report an update available.
    public static func isUpdateAvailable(latestTag: String, currentVersion: String) -> Bool {
        guard let latest = parseSemVer(latestTag), let current = parseSemVer(currentVersion) else {
            return false
        }
        return latest > current
    }

    /// Decode a GitHub `releases/latest` JSON payload.
    public static func parseLatestRelease(json: String) -> ReleaseInfo? {
        guard let data = json.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(ReleaseInfo.self, from: data)
    }
}
