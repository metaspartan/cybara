import CryptoKit
import Foundation

/// A downloadable asset attached to a GitHub release.
public struct ReleaseAsset: Codable, Equatable, Sendable {
    public let name: String
    public let downloadURL: String

    enum CodingKeys: String, CodingKey {
        case name
        case downloadURL = "browser_download_url"
    }

    public init(name: String, downloadURL: String) {
        self.name = name
        self.downloadURL = downloadURL
    }
}

/// Metadata for a published GitHub release, parsed from the REST API.
public struct ReleaseInfo: Codable, Equatable, Sendable {
    public let tagName: String
    public let htmlURL: String
    public let name: String?
    public let prerelease: Bool
    public let assets: [ReleaseAsset]

    enum CodingKeys: String, CodingKey {
        case tagName = "tag_name"
        case htmlURL = "html_url"
        case name
        case prerelease
        case assets
    }

    public init(
        tagName: String,
        htmlURL: String,
        name: String?,
        prerelease: Bool,
        assets: [ReleaseAsset] = []
    ) {
        self.tagName = tagName
        self.htmlURL = htmlURL
        self.name = name
        self.prerelease = prerelease
        self.assets = assets
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        tagName = try container.decode(String.self, forKey: .tagName)
        htmlURL = (try container.decodeIfPresent(String.self, forKey: .htmlURL)) ?? ""
        name = try container.decodeIfPresent(String.self, forKey: .name)
        prerelease = (try container.decodeIfPresent(Bool.self, forKey: .prerelease)) ?? false
        assets = (try container.decodeIfPresent([ReleaseAsset].self, forKey: .assets)) ?? []
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

    public static func trustedReleaseAssetURL(_ raw: String) -> URL? {
        guard let url = URL(string: raw), url.scheme?.lowercased() == "https" else { return nil }
        guard let host = url.host?.lowercased() else { return nil }
        guard host == "github.com" || host == "www.github.com" else { return nil }
        return url
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

    /// Architecture slug used in native macOS release asset names.
    public static func currentArchSlug() -> String {
        #if arch(arm64)
        return "arm64"
        #else
        return "x86_64"
        #endif
    }

    /// Pick the native SwiftUI app archive (`CybaraNative-v<version>-<arch>.zip`)
    /// for the given architecture, if one was published in this release.
    public static func selectNativeAsset(_ assets: [ReleaseAsset], arch: String) -> ReleaseAsset? {
        let suffix = "-\(arch).zip".lowercased()
        return assets.first { asset in
            let name = asset.name.lowercased()
            return name.hasPrefix("cybaranative-") && name.hasSuffix(suffix)
        }
    }

    public static func selectChecksumAsset(
        for asset: ReleaseAsset,
        assets: [ReleaseAsset]
    ) -> ReleaseAsset? {
        let expectedName = "\(asset.name).sha256".lowercased()
        return assets.first { $0.name.lowercased() == expectedName }
    }

    public static func parseSHA256(_ text: String) -> String? {
        guard let token = text.split(whereSeparator: { $0.isWhitespace }).first else { return nil }
        let normalized = token.lowercased()
        guard normalized.count == 64 else { return nil }
        guard normalized.allSatisfy({ $0.isHexDigit }) else { return nil }
        return normalized
    }

    public static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// Shell script that swaps the running app bundle with a freshly downloaded
    /// one and relaunches it. Invoked as `bash <script> <pid> <newApp> <destApp>`;
    /// waits for the current process to exit, moves the old bundle aside, copies
    /// the new one into place (rolling back on failure), then reopens the app.
    public static let selfUpdateScript = """
        #!/bin/bash
        set -u
        APP_PID="$1"
        NEW_APP="$2"
        DEST_APP="$3"
        for _ in $(seq 1 300); do
          /bin/kill -0 "$APP_PID" 2>/dev/null || break
          /bin/sleep 0.2
        done
        BACKUP="${DEST_APP}.old"
        /bin/rm -rf "$BACKUP"
        if /bin/mv "$DEST_APP" "$BACKUP"; then
          if /usr/bin/ditto "$NEW_APP" "$DEST_APP"; then
            /usr/bin/xattr -dr com.apple.quarantine "$DEST_APP" 2>/dev/null || true
            /bin/rm -rf "$BACKUP"
          else
            /bin/rm -rf "$DEST_APP"
            /bin/mv "$BACKUP" "$DEST_APP"
          fi
        fi
        /usr/bin/open "$DEST_APP"
        """
}
