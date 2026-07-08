import XCTest

@testable import Cybara

final class NativeLogViewsTests: XCTestCase {
    func testNativeLogEntriesMergeGatewayAndSidecarLogs() {
        let gateway = GatewayLogEntry(
            id: "log-1",
            level: "warn",
            source: "gateway",
            message: "LAN access is disabled",
            metadata: nil,
            created_at: "2026-07-08T12:00:00.000Z",
            logType: "system"
        )

        let entries = nativeLogEntries(
            gatewayLogs: [gateway],
            sidecarLogs: ["Attached to existing gateway", "Failed to restart sidecar"],
            sidecarLimit: 8
        )

        XCTAssertEqual(entries.count, 3)
        XCTAssertEqual(entries[0].levelKey, "warn")
        XCTAssertEqual(entries[0].sourceKey, "gateway")
        XCTAssertEqual(entries[1].sourceKey, "sidecar")
        XCTAssertEqual(entries[2].levelKey, "error")
    }

    func testFilterNativeLogsMatchesLevelSourceAndQuery() {
        let entries = [
            NativeLogEntryDisplay(
                gateway: GatewayLogEntry(
                    id: "log-1",
                    level: "info",
                    source: "gateway",
                    message: "Mobile pairing code created",
                    metadata: nil,
                    created_at: nil,
                    logType: nil
                )
            ),
            NativeLogEntryDisplay(sidecarLine: "Failed to spawn bundled gateway", index: 0),
            NativeLogEntryDisplay(sidecarLine: "Gateway initialized", index: 1),
        ]

        XCTAssertEqual(
            filterNativeLogs(entries, levelFilter: "error", sourceFilter: "all", query: "").map(\.message),
            ["Failed to spawn bundled gateway"]
        )
        XCTAssertEqual(
            filterNativeLogs(entries, levelFilter: "all", sourceFilter: "gateway", query: "pairing").count,
            1
        )
        XCTAssertEqual(
            filterNativeLogs(entries, levelFilter: "info", sourceFilter: "sidecar", query: "gateway").map(\.message),
            ["Gateway initialized"]
        )
    }
}
