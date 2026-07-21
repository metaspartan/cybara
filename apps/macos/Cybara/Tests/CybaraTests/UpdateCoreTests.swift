import XCTest

@testable import Cybara

final class UpdateCoreTests: XCTestCase {

    // MARK: - latestReleaseAPIURLString

    func testReleaseAPIURL() {
        XCTAssertEqual(
            UpdateCore.latestReleaseAPIURLString(repo: "metaspartan/cybara"),
            "https://api.github.com/repos/metaspartan/cybara/releases/latest")
    }

    func testTrustedReleaseAssetURL() {
        XCTAssertNotNil(
            UpdateCore.trustedReleaseAssetURL(
                "https://github.com/metaspartan/cybara/releases/download/v1.0.1/update.zip"))
        XCTAssertNil(UpdateCore.trustedReleaseAssetURL("http://github.com/update.zip"))
        XCTAssertNil(UpdateCore.trustedReleaseAssetURL("https://example.com/update.zip"))
    }

    // MARK: - parseSemVer

    func testParseSemVerPlain() {
        XCTAssertEqual(UpdateCore.parseSemVer("1.2.3"), .init(major: 1, minor: 2, patch: 3))
    }

    func testParseSemVerStripsVPrefix() {
        XCTAssertEqual(UpdateCore.parseSemVer("v1.0.327"), .init(major: 1, minor: 0, patch: 327))
        XCTAssertEqual(UpdateCore.parseSemVer("V2.5.0"), .init(major: 2, minor: 5, patch: 0))
    }

    func testParseSemVerDropsPrereleaseAndBuild() {
        XCTAssertEqual(UpdateCore.parseSemVer("1.2.3-rc.1"), .init(major: 1, minor: 2, patch: 3))
        XCTAssertEqual(
            UpdateCore.parseSemVer("v1.2.3-beta.2+abc123"), .init(major: 1, minor: 2, patch: 3))
    }

    func testParseSemVerTrimsWhitespace() {
        XCTAssertEqual(UpdateCore.parseSemVer("  1.4.0\n"), .init(major: 1, minor: 4, patch: 0))
    }

    func testParseSemVerRejectsMalformed() {
        XCTAssertNil(UpdateCore.parseSemVer("1.2"))
        XCTAssertNil(UpdateCore.parseSemVer("latest"))
        XCTAssertNil(UpdateCore.parseSemVer(""))
        XCTAssertNil(UpdateCore.parseSemVer("v1.x.0"))
    }

    // MARK: - SemVer ordering

    func testSemVerComparison() {
        let a = UpdateCore.SemVer(major: 1, minor: 0, patch: 0)
        let b = UpdateCore.SemVer(major: 1, minor: 0, patch: 1)
        let c = UpdateCore.SemVer(major: 1, minor: 2, patch: 0)
        let d = UpdateCore.SemVer(major: 2, minor: 0, patch: 0)
        XCTAssertTrue(a < b)
        XCTAssertTrue(b < c)
        XCTAssertTrue(c < d)
        XCTAssertFalse(d < a)
        XCTAssertEqual(a, UpdateCore.SemVer(major: 1, minor: 0, patch: 0))
    }

    // MARK: - isUpdateAvailable

    func testUpdateAvailableWhenNewer() {
        XCTAssertTrue(UpdateCore.isUpdateAvailable(latestTag: "v1.0.328", currentVersion: "1.0.327"))
        XCTAssertTrue(UpdateCore.isUpdateAvailable(latestTag: "v2.0.0", currentVersion: "1.9.9"))
        XCTAssertTrue(UpdateCore.isUpdateAvailable(latestTag: "1.1.0", currentVersion: "v1.0.999"))
    }

    func testNoUpdateWhenSameOrOlder() {
        XCTAssertFalse(UpdateCore.isUpdateAvailable(latestTag: "v1.0.327", currentVersion: "1.0.327"))
        XCTAssertFalse(UpdateCore.isUpdateAvailable(latestTag: "v1.0.300", currentVersion: "1.0.327"))
        XCTAssertFalse(UpdateCore.isUpdateAvailable(latestTag: "v0.9.0", currentVersion: "1.0.0"))
    }

    func testNoUpdateWhenVersionsUnparseable() {
        // Conservative: never claim an update if either side is garbage.
        XCTAssertFalse(UpdateCore.isUpdateAvailable(latestTag: "nightly", currentVersion: "1.0.0"))
        XCTAssertFalse(UpdateCore.isUpdateAvailable(latestTag: "v2.0.0", currentVersion: "dev"))
    }

    // MARK: - parseLatestRelease

    func testParseLatestReleaseFull() {
        let json = """
            {
              "tag_name": "v1.0.328",
              "html_url": "https://github.com/metaspartan/cybara/releases/tag/v1.0.328",
              "name": "Cybara v1.0.328",
              "prerelease": false,
              "body": "notes"
            }
            """
        let release = UpdateCore.parseLatestRelease(json: json)
        XCTAssertEqual(release?.tagName, "v1.0.328")
        XCTAssertEqual(
            release?.htmlURL, "https://github.com/metaspartan/cybara/releases/tag/v1.0.328")
        XCTAssertEqual(release?.name, "Cybara v1.0.328")
        XCTAssertEqual(release?.prerelease, false)
    }

    func testParseLatestReleaseWithoutName() {
        let json = """
            {"tag_name":"v1.2.0","html_url":"https://example.com/r","prerelease":true}
            """
        let release = UpdateCore.parseLatestRelease(json: json)
        XCTAssertEqual(release?.tagName, "v1.2.0")
        XCTAssertNil(release?.name)
        XCTAssertEqual(release?.prerelease, true)
    }

    func testParseLatestReleaseRejectsGarbage() {
        XCTAssertNil(UpdateCore.parseLatestRelease(json: "not json"))
        XCTAssertNil(UpdateCore.parseLatestRelease(json: "{}"))
        XCTAssertNil(UpdateCore.parseLatestRelease(json: ""))
    }

    // MARK: - assets + native asset selection

    func testParseLatestReleaseDecodesAssets() {
        let json = """
            {
              "tag_name": "v1.0.916",
              "html_url": "https://example.com/r",
              "prerelease": false,
              "assets": [
                {"name": "Cybara_1.0.916_aarch64.dmg", "browser_download_url": "https://x/dmg"},
                {"name": "CybaraNative-v1.0.916-arm64.zip", "browser_download_url": "https://x/native"}
              ]
            }
            """
        let release = UpdateCore.parseLatestRelease(json: json)
        XCTAssertEqual(release?.assets.count, 2)
        XCTAssertEqual(release?.assets.last?.name, "CybaraNative-v1.0.916-arm64.zip")
        XCTAssertEqual(release?.assets.last?.downloadURL, "https://x/native")
    }

    func testSelectNativeAssetPicksArchZip() {
        let assets = [
            ReleaseAsset(name: "Cybara_1.0.916_aarch64.dmg", downloadURL: "https://x/dmg"),
            ReleaseAsset(name: "Cybara_aarch64.app.tar.gz", downloadURL: "https://x/tauri"),
            ReleaseAsset(name: "CybaraNative-v1.0.916-arm64.zip", downloadURL: "https://x/arm"),
            ReleaseAsset(name: "CybaraNative-v1.0.916-x86_64.zip", downloadURL: "https://x/intel"),
        ]
        XCTAssertEqual(UpdateCore.selectNativeAsset(assets, arch: "arm64")?.downloadURL, "https://x/arm")
        XCTAssertEqual(
            UpdateCore.selectNativeAsset(assets, arch: "x86_64")?.downloadURL, "https://x/intel")
    }

    func testSelectNativeAssetIgnoresTauriAndDmg() {
        let assets = [
            ReleaseAsset(name: "Cybara_1.0.916_aarch64.dmg", downloadURL: "https://x/dmg"),
            ReleaseAsset(name: "Cybara_aarch64.app.tar.gz", downloadURL: "https://x/tauri"),
        ]
        XCTAssertNil(UpdateCore.selectNativeAsset(assets, arch: "arm64"))
    }

    func testSelectChecksumAssetMatchesNativeArchive() {
        let archive = ReleaseAsset(
            name: "CybaraNative-v1.0.916-arm64.zip", downloadURL: "https://x/native")
        let checksum = ReleaseAsset(
            name: "CybaraNative-v1.0.916-arm64.sha256", downloadURL: "https://x/checksum")
        XCTAssertEqual(
            UpdateCore.selectChecksumAsset(for: archive, assets: [archive, checksum]),
            checksum)
    }

    func testSelectChecksumAssetAcceptsLegacyArchiveSuffix() {
        let archive = ReleaseAsset(
            name: "CybaraNative-v1.0.916-arm64.zip", downloadURL: "https://x/native")
        let checksum = ReleaseAsset(
            name: "CybaraNative-v1.0.916-arm64.zip.sha256", downloadURL: "https://x/checksum")
        XCTAssertEqual(
            UpdateCore.selectChecksumAsset(for: archive, assets: [archive, checksum]),
            checksum)
    }

    func testSHA256ParsingAndHashing() {
        let digest = UpdateCore.sha256Hex(Data("cybara".utf8))
        XCTAssertEqual(digest, "a00930355f0a279a9c418d061cce9dbbb0e2e54734f4fd8388197bef2b431a1b")
        XCTAssertEqual(UpdateCore.parseSHA256("\(digest)  update.zip\n"), digest)
        XCTAssertNil(UpdateCore.parseSHA256("not-a-checksum"))
    }

    func testCurrentArchSlugIsKnown() {
        XCTAssertTrue(["arm64", "x86_64"].contains(UpdateCore.currentArchSlug()))
    }

    func testSelfUpdateScriptHasSafeSwapAndRelaunch() {
        let script = UpdateCore.selfUpdateScript
        // rolls the old bundle aside, copies the new one, and relaunches.
        XCTAssertTrue(script.contains("mv \"$DEST_APP\" \"$BACKUP\""))
        XCTAssertTrue(script.contains("ditto \"$NEW_APP\" \"$DEST_APP\""))
        XCTAssertTrue(script.contains("mv \"$BACKUP\" \"$DEST_APP\""))
        XCTAssertTrue(script.contains("open \"$DEST_APP\""))
        XCTAssertTrue(script.contains("kill -0 \"$APP_PID\""))
        XCTAssertTrue(script.contains("UPDATED=1"))
    }

    @MainActor
    func testUpdateProgressUsesPublishedSizeUntilServerReportsTotal() {
        let checker = UpdateChecker(currentVersion: "1.0.0")
        let asset = ReleaseAsset(name: "native.zip", downloadURL: "https://github.com/x", size: 200)
        checker.recordDownloadProgress(asset: asset, receivedBytes: 50, totalBytes: 0)
        XCTAssertEqual(checker.progressValue, 0.25)
        XCTAssertTrue(checker.showsMenuBarUpdateIndicator)
        XCTAssertTrue(checker.statusText.contains("25%"))
    }
}
