import XCTest

@testable import Cybara

final class NativeMarkdownTests: XCTestCase {
    func testPreprocessStripsGatewayContextAndTimestampPrefix() {
        let raw = """
        [Thu 2026-07-02 14:30:00 UTC] Conversation info (untrusted metadata):
        ```json
        {"session":"abc"}
        ```
        # Result


        Done
        """

        XCTAssertEqual(NativeMarkdown.preprocess(raw), "# Result\n\nDone")
    }

    func testParseFencedDiffCodeBlock() {
        let blocks = NativeMarkdown.parse(
            """
            ```patch
            @@ -1 +1 @@
            -old
            +new
            ```
            """
        )

        XCTAssertEqual(blocks.count, 1)
        XCTAssertEqual(blocks.first?.kind, .code(language: "patch", code: "@@ -1 +1 @@\n-old\n+new", isDiff: true))
    }

    func testParseHeadingsListsAndTables() {
        let blocks = NativeMarkdown.parse(
            """
            ## Plan

            - Audit
            - Fix

            | Item | Status |
            | --- | --- |
            | Chat | Done |
            """
        )

        XCTAssertEqual(blocks.count, 3)
        XCTAssertEqual(blocks[0].kind, .heading(level: 2, text: "Plan"))
        XCTAssertEqual(blocks[1].kind, .unorderedList(["Audit", "Fix"]))
        XCTAssertEqual(blocks[2].kind, .table([["Item", "Status"], ["Chat", "Done"]]))
    }

    func testNormalizeCodeLanguageAliases() {
        XCTAssertEqual(NativeMarkdown.normalizeCodeLanguage("zsh"), "bash")
        XCTAssertEqual(NativeMarkdown.normalizeCodeLanguage("js"), "javascript")
        XCTAssertEqual(NativeMarkdown.normalizeCodeLanguage("plaintext"), "text")
        XCTAssertEqual(NativeMarkdown.normalizeCodeLanguage("swift"), "swift")
    }
}
