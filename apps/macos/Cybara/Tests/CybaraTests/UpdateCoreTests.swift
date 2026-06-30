import XCTest

@testable import Cybara

final class UpdateCoreTests: XCTestCase {

    // MARK: - latestReleaseAPIURLString

    func testReleaseAPIURL() {
        XCTAssertEqual(
            UpdateCore.latestReleaseAPIURLString(repo: "metaspartan/cybara"),
            "https://api.github.com/repos/metaspartan/cybara/releases/latest")
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
}
