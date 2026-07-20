import XCTest

@testable import Cybara

final class SidecarCoreTests: XCTestCase {

    // MARK: - port(fromEnv:)

    func testPortDefaultsWhenEnvMissing() {
        XCTAssertEqual(SidecarCore.port(fromEnv: nil), SidecarCore.defaultPort)
        XCTAssertEqual(SidecarCore.defaultPort, 4269)
    }

    func testPortParsesValidValue() {
        XCTAssertEqual(SidecarCore.port(fromEnv: "8080"), 8080)
        XCTAssertEqual(SidecarCore.port(fromEnv: "1"), 1)
        XCTAssertEqual(SidecarCore.port(fromEnv: "65535"), 65535)
    }

    func testPortTrimsWhitespace() {
        XCTAssertEqual(SidecarCore.port(fromEnv: "  5000 "), 5000)
        XCTAssertEqual(SidecarCore.port(fromEnv: "\t4269\n"), 4269)
    }

    func testPortRejectsNonNumeric() {
        XCTAssertEqual(SidecarCore.port(fromEnv: "abc"), SidecarCore.defaultPort)
        XCTAssertEqual(SidecarCore.port(fromEnv: ""), SidecarCore.defaultPort)
        XCTAssertEqual(SidecarCore.port(fromEnv: "80a"), SidecarCore.defaultPort)
        XCTAssertEqual(SidecarCore.port(fromEnv: "12.5"), SidecarCore.defaultPort)
    }

    func testPortRejectsOutOfRange() {
        XCTAssertEqual(SidecarCore.port(fromEnv: "0"), SidecarCore.defaultPort)
        XCTAssertEqual(SidecarCore.port(fromEnv: "-1"), SidecarCore.defaultPort)
        XCTAssertEqual(SidecarCore.port(fromEnv: "65536"), SidecarCore.defaultPort)
        XCTAssertEqual(SidecarCore.port(fromEnv: "99999"), SidecarCore.defaultPort)
    }

    // MARK: - URL builders

    func testServerURLString() {
        XCTAssertEqual(SidecarCore.serverURLString(port: 4269), "http://127.0.0.1:4269")
        XCTAssertEqual(SidecarCore.serverURLString(port: 8080), "http://127.0.0.1:8080")
    }

    func testHealthURLString() {
        XCTAssertEqual(SidecarCore.healthURLString(port: 4269), "http://127.0.0.1:4269/api/health")
    }

    func testFallbackPortsFollowPreferredPort() {
        XCTAssertEqual(
            SidecarCore.fallbackPorts(after: 4269, count: 4),
            [4270, 4271, 4272, 4273]
        )
        XCTAssertEqual(SidecarCore.fallbackPorts(after: 4269, count: 0), [])
    }

    func testFallbackPortsWrapWithinUnprivilegedRange() {
        XCTAssertEqual(
            SidecarCore.fallbackPorts(after: 65535, count: 3),
            [1024, 1025, 1026]
        )
    }

    func testFirstAvailableFallbackPortSkipsOccupiedPorts() {
        let occupied = Set([4270, 4271, 4272])
        XCTAssertEqual(
            SidecarCore.firstAvailableFallbackPort(
                after: 4269,
                count: 5,
                isAvailable: { !occupied.contains($0) }
            ),
            4273
        )
        XCTAssertNil(
            SidecarCore.firstAvailableFallbackPort(
                after: 4269,
                count: 3,
                isAvailable: { !occupied.contains($0) }
            )
        )
    }

    func testFallbackPortDecisionPrefersCompatibleGatewayOverEarlierFreePort() {
        XCTAssertEqual(
            SidecarCore.fallbackPortDecision(
                candidates: [4270, 4271, 4272],
                compatiblePorts: [4272],
                availablePorts: [4270, 4271]
            ),
            .attach(4272)
        )
    }

    func testFallbackPortDecisionUsesFirstFreePortWhenNoGatewayIsCompatible() {
        XCTAssertEqual(
            SidecarCore.fallbackPortDecision(
                candidates: [4270, 4271, 4272],
                compatiblePorts: [],
                availablePorts: [4271, 4272]
            ),
            .launch(4271)
        )
        XCTAssertNil(
            SidecarCore.fallbackPortDecision(
                candidates: [4270],
                compatiblePorts: [],
                availablePorts: []
            )
        )
    }

    // MARK: - isHealthyResponse

    func testHealthyResponseAccepts200WithStatus() {
        XCTAssertTrue(SidecarCore.isHealthyResponse(statusCode: 200, body: #"{"status":"healthy"}"#))
        XCTAssertTrue(SidecarCore.isHealthyResponse(statusCode: 200, body: #"{"status":"warning"}"#))
        XCTAssertTrue(SidecarCore.isHealthyResponse(statusCode: 200, body: #"{"status":"critical"}"#))
    }

    func testHealthyResponseToleratesWhitespace() {
        XCTAssertTrue(
            SidecarCore.isHealthyResponse(statusCode: 200, body: #"{ "status" : "healthy" }"#))
        XCTAssertTrue(
            SidecarCore.isHealthyResponse(
                statusCode: 200, body: "{\n  \"status\": \"healthy\",\n  \"uptime\": 5\n}"))
    }

    func testHealthyResponseRejectsNon200() {
        XCTAssertFalse(SidecarCore.isHealthyResponse(statusCode: 500, body: #"{"status":"healthy"}"#))
        XCTAssertFalse(SidecarCore.isHealthyResponse(statusCode: 404, body: #"{"status":"healthy"}"#))
        XCTAssertFalse(SidecarCore.isHealthyResponse(statusCode: 0, body: ""))
    }

    func testHealthyResponseRejectsWrongOrMissingStatus() {
        XCTAssertFalse(SidecarCore.isHealthyResponse(statusCode: 200, body: #"{"status":"degraded"}"#))
        XCTAssertFalse(SidecarCore.isHealthyResponse(statusCode: 200, body: #"{"status":"unhealthy"}"#))
        XCTAssertFalse(SidecarCore.isHealthyResponse(statusCode: 200, body: "OK"))
        XCTAssertFalse(SidecarCore.isHealthyResponse(statusCode: 200, body: ""))
        // A different process squatting on the port must not be mistaken for Cybara.
        XCTAssertFalse(
            SidecarCore.isHealthyResponse(statusCode: 200, body: "<html>It works!</html>"))
    }

    func testGatewayHealthProbeReadsVersionAndProcessIdentifier() {
        let body = #"{"status":"healthy","version":"1.0.1703","system":{"process":{"pid":55441}}}"#
        let probe = SidecarCore.gatewayHealthProbe(statusCode: 200, body: body)
        XCTAssertEqual(probe?.status, "healthy")
        XCTAssertEqual(probe?.version, "1.0.1703")
        XCTAssertEqual(probe?.processID, 55441)
    }

    func testGatewayVersionCompatibilityRequiresCurrentMajorAndMinimumBuild() {
        XCTAssertTrue(
            SidecarCore.isGatewayVersionCompatible(
                gatewayVersion: "1.0.1703", minimumVersion: "1.0.1697"))
        XCTAssertTrue(
            SidecarCore.isGatewayVersionCompatible(
                gatewayVersion: "1.0.1697", minimumVersion: "1.0.1697"))
        XCTAssertFalse(
            SidecarCore.isGatewayVersionCompatible(
                gatewayVersion: "1.0.920", minimumVersion: "1.0.1697"))
        XCTAssertFalse(
            SidecarCore.isGatewayVersionCompatible(
                gatewayVersion: "2.0.0", minimumVersion: "1.0.1697"))
        XCTAssertFalse(
            SidecarCore.isGatewayVersionCompatible(
                gatewayVersion: nil, minimumVersion: "1.0.1697"))
    }

    func testNativeSidecarCommandDetection() {
        XCTAssertTrue(
            SidecarCore.isNativeSidecarCommand(
                "/Applications/CybaraNative.app/Contents/MacOS/sidecar/cybara start"))
        XCTAssertFalse(SidecarCore.isNativeSidecarCommand("/usr/local/bin/cybara start"))
    }

    func testBundleVersionReadsReleaseMetadata() {
        XCTAssertEqual(
            SidecarCore.bundleVersion(infoDictionary: ["CFBundleShortVersionString": " 1.0.1703 "]),
            "1.0.1703"
        )
        XCTAssertNil(SidecarCore.bundleVersion(infoDictionary: [:]))
    }

    // MARK: - launchEnvironment

    func testLaunchEnvironmentPinsExpectedKeys() {
        let env = SidecarCore.launchEnvironment(base: [:], port: 4269)
        XCTAssertEqual(env["PORT"], "4269")
        XCTAssertNil(env["CYBARA_HOST"])
        XCTAssertEqual(env["CYBARA_NATIVE_APP"], "1")
        XCTAssertEqual(env["CYBARA_NATIVE_PORT"], "4269")
        XCTAssertNil(env["CYBARA_NATIVE_PARENT_PID"])
    }

    func testLaunchEnvironmentIncludesOwningNativeProcess() {
        let env = SidecarCore.launchEnvironment(
            base: [:], port: 4269, parentProcessID: 4321)
        XCTAssertEqual(env["CYBARA_NATIVE_PARENT_PID"], "4321")
    }

    func testLaunchEnvironmentPreservesBaseAndOverridesPort() {
        let base = ["PATH": "/usr/bin", "HOME": "/Users/x", "PORT": "9999"]
        let env = SidecarCore.launchEnvironment(base: base, port: 4269)
        XCTAssertEqual(env["PATH"], "/usr/bin")
        XCTAssertEqual(env["HOME"], "/Users/x")
        // The base PORT must be overridden with the resolved port.
        XCTAssertEqual(env["PORT"], "4269")
    }

    func testLaunchEnvironmentSetsBundledResourceDirectoryWhenAvailable() {
        let env = SidecarCore.launchEnvironment(
            base: ["CYBARA_RESOURCE_DIR": "/old/resources"],
            port: 4269,
            resourceDirectory: "/app/Contents/Resources/sidecar"
        )

        XCTAssertEqual(env["CYBARA_RESOURCE_DIR"], "/app/Contents/Resources/sidecar")
    }

    func testBundledResourceDirectoryUsesAppBundleResources() {
        XCTAssertEqual(
            SidecarCore.bundledResourceDirectory(executableDirectory: "/app/Contents/MacOS"),
            "/app/Contents/Resources/sidecar"
        )
    }

    func testAppBundleExecutableAliasDetection() {
        XCTAssertTrue(
            SidecarCore.isAppBundleExecutableAlias(
                "/app/Contents/MacOS/cybara",
                executableDirectory: "/app/Contents/MacOS"
            )
        )
        XCTAssertTrue(
            SidecarCore.isAppBundleExecutableAlias(
                "/app/Contents/MacOS/./cybara",
                executableDirectory: "/app/Contents/MacOS"
            )
        )
        XCTAssertFalse(
            SidecarCore.isAppBundleExecutableAlias(
                "/app/Contents/MacOS/sidecar/cybara",
                executableDirectory: "/app/Contents/MacOS"
            )
        )
        XCTAssertFalse(
            SidecarCore.isAppBundleExecutableAlias(
                "/usr/local/bin/cybara",
                executableDirectory: "/app/Contents/MacOS"
            )
        )
    }

    // MARK: - sidecarCandidatePaths

    func testAncestorDirectoriesWalkUpFromLocalPackagePath() {
        let directories = SidecarCore.ancestorDirectories(
            from: "/work/apps/macos/Cybara/.build/arm64-apple-macosx/debug")

        XCTAssertEqual(directories[0], "/work/apps/macos/Cybara/.build/arm64-apple-macosx/debug")
        XCTAssertTrue(directories.contains("/work/apps/macos/Cybara"))
        XCTAssertTrue(directories.contains("/work"))
        XCTAssertEqual(Set(directories).count, directories.count, "ancestor directories must be unique")
    }

    func testSidecarCandidatePathsOrderAndContents() {
        let paths = SidecarCore.sidecarCandidatePaths(
            currentDirectory: "/work", executableDirectory: "/app/Contents/MacOS")
        XCTAssertEqual(paths[0], "/app/Contents/MacOS/sidecar/cybara")
        XCTAssertEqual(paths[1], "/app/Contents/MacOS/sidecar/cybara-aarch64-apple-darwin")
        XCTAssertEqual(paths[2], "/app/Contents/MacOS/sidecar/cybara-x86_64-apple-darwin")
        XCTAssertTrue(paths.contains("/work/src-tauri/bin/cybara-aarch64-apple-darwin"))
        XCTAssertTrue(paths.contains("/work/release/cybara"))
        XCTAssertEqual(paths.last, "/app/Contents/MacOS/cybara")
        XCTAssertEqual(Set(paths).count, paths.count, "candidate paths must be unique")
    }

    func testSidecarCandidatePathsFindRepoRootFromSwiftPackageCwd() {
        let paths = SidecarCore.sidecarCandidatePaths(
            currentDirectory: "/work/apps/macos/Cybara",
            executableDirectory: "/work/apps/macos/Cybara/.build/arm64-apple-macosx/debug")

        XCTAssertTrue(paths.contains("/work/src-tauri/bin/cybara-aarch64-apple-darwin"))
        XCTAssertTrue(paths.contains("/work/src-tauri/bin/cybara-x86_64-apple-darwin"))
        XCTAssertTrue(paths.contains("/work/release/cybara"))
        XCTAssertLessThan(
            paths.firstIndex(of: "/work/src-tauri/bin/cybara-aarch64-apple-darwin") ?? Int.max,
            paths.firstIndex(of: "/work/apps/macos/Cybara/.build/arm64-apple-macosx/debug/cybara")
                ?? Int.max
        )
    }

    // MARK: - restartDelaySeconds

    func testRestartBackoffSequence() {
        XCTAssertEqual(SidecarCore.restartDelaySeconds(attempt: 1), 1.0)
        XCTAssertEqual(SidecarCore.restartDelaySeconds(attempt: 2), 2.0)
        XCTAssertEqual(SidecarCore.restartDelaySeconds(attempt: 3), 4.0)
        XCTAssertEqual(SidecarCore.restartDelaySeconds(attempt: 4), 8.0)
    }

    func testRestartBackoffCapsAt30() {
        XCTAssertEqual(SidecarCore.restartDelaySeconds(attempt: 6), 30.0)
        XCTAssertEqual(SidecarCore.restartDelaySeconds(attempt: 100), 30.0)
    }

    func testRestartBackoffClampsLowAttempts() {
        XCTAssertEqual(SidecarCore.restartDelaySeconds(attempt: 0), 1.0)
        XCTAssertEqual(SidecarCore.restartDelaySeconds(attempt: -5), 1.0)
    }

    func testMaxRestartAttempts() {
        XCTAssertEqual(SidecarCore.maxRestartAttempts, 4)
    }

    // MARK: - parseDeepLink

    func testParseDeepLinkFocus() {
        XCTAssertEqual(SidecarCore.parseDeepLink(URL(string: "cybara://")!), .focus)
        XCTAssertEqual(SidecarCore.parseDeepLink(URL(string: "cybara://open")!), .focus)
        XCTAssertEqual(SidecarCore.parseDeepLink(URL(string: "cybara://focus")!), .focus)
        XCTAssertEqual(SidecarCore.parseDeepLink(URL(string: "cybara://show")!), .focus)
    }

    func testParseDeepLinkRestart() {
        XCTAssertEqual(SidecarCore.parseDeepLink(URL(string: "cybara://restart")!), .restart)
        XCTAssertEqual(SidecarCore.parseDeepLink(URL(string: "cybara://reload")!), .restart)
    }

    func testParseDeepLinkOpenBrowser() {
        XCTAssertEqual(SidecarCore.parseDeepLink(URL(string: "cybara://browser")!), .openBrowser)
        XCTAssertEqual(SidecarCore.parseDeepLink(URL(string: "cybara://web")!), .openBrowser)
        XCTAssertEqual(SidecarCore.parseDeepLink(URL(string: "cybara://dashboard")!), .openBrowser)
    }

    func testParseDeepLinkIsCaseInsensitive() {
        XCTAssertEqual(SidecarCore.parseDeepLink(URL(string: "CYBARA://RESTART")!), .restart)
        XCTAssertEqual(SidecarCore.parseDeepLink(URL(string: "Cybara://Browser")!), .openBrowser)
    }

    func testParseDeepLinkAcceptsPathStyle() {
        // cybara:///restart — action carried in the path rather than the host.
        XCTAssertEqual(SidecarCore.parseDeepLink(URL(string: "cybara:///restart")!), .restart)
        XCTAssertEqual(SidecarCore.parseDeepLink(URL(string: "cybara:///browser")!), .openBrowser)
    }

    func testParseDeepLinkRejectsUnknown() {
        XCTAssertNil(SidecarCore.parseDeepLink(URL(string: "cybara://nonsense")!))
        XCTAssertNil(SidecarCore.parseDeepLink(URL(string: "cybara://delete-everything")!))
    }

    func testParseDeepLinkRejectsForeignScheme() {
        XCTAssertNil(SidecarCore.parseDeepLink(URL(string: "https://cybara.dev/restart")!))
        XCTAssertNil(SidecarCore.parseDeepLink(URL(string: "file:///etc/passwd")!))
        XCTAssertNil(SidecarCore.parseDeepLink(URL(string: "javascript://restart")!))
    }
}
