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

    func testPreprocessStripsAssistantReasoningAndFinalMarkup() {
        let raw = """
        <think>Review the current chat renderer.</think>
        <final>Rendered answer only.</final>
        """

        XCTAssertEqual(NativeMarkdown.preprocess(raw), "Rendered answer only.")
        XCTAssertEqual(
            NativeMarkdown.stripAssistantMarkupTags(raw),
            NativeAssistantMarkupResult(
                content: "Rendered answer only.",
                thinking: "Review the current chat renderer."
            )
        )
    }

    func testPreprocessRemovesDanglingAssistantReasoningTags() {
        XCTAssertEqual(NativeMarkdown.preprocess("</think>\nVisible answer."), "Visible answer.")
        XCTAssertEqual(NativeMarkdown.preprocess("<think>Hidden reasoning that never closed."), "")
    }

    func testPreprocessStripsMixedCaseAssistantReasoningWithoutDroppingAnswer() {
        let raw = """
        <Think>Hidden reasoning.</THINK>
        Visible answer.
        """

        XCTAssertEqual(NativeMarkdown.preprocess(raw), "Visible answer.")
    }

    func testPreprocessStripsMiniMaxReasoningAndOrphanCloseTags() {
        let raw = """
        <mm:think>Hidden MiniMax reasoning.</mm:think>
        Visible answer.</think>
        """

        XCTAssertEqual(NativeMarkdown.preprocess(raw), "Visible answer.")
    }

    func testPreprocessStripsMiniMaxTextToolCallMarkup() {
        let raw = """
        Let me search.
        ]<]minimax[>[<tool_call> ]<]minimax[>[<invoke name="websearch"><query>metaspartan cybara</query></invoke></tool_call>
        Visible answer.
        """

        XCTAssertEqual(NativeMarkdown.preprocess(raw), "Let me search.\n\nVisible answer.")
    }

    func testParseCanPreserveUserTypedReasoningTags() {
        let blocks = NativeMarkdown.parse("What does </think> mean?", stripAssistantMarkup: false)

        XCTAssertEqual(blocks.first?.kind, .paragraph("What does </think> mean?"))
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

    func testParseScreenshotMarkdownAsImageBlock() {
        let blocks = NativeMarkdown.parse(
            """
            Result

            ![screenshot](file:///Users/test/.cybara/screenshots/solar.png)
            """
        )

        XCTAssertEqual(blocks.count, 2)
        XCTAssertEqual(blocks[0].kind, .paragraph("Result"))
        XCTAssertEqual(
            blocks[1].kind,
            .image(
                alt: "screenshot",
                source: "file:///Users/test/.cybara/screenshots/solar.png"
            )
        )
    }

    func testUnsafeLocalImageMarkdownRemainsVisibleText() {
        let blocks = NativeMarkdown.parse("![private](file:///Users/test/private.png)")

        XCTAssertEqual(blocks.count, 1)
        XCTAssertEqual(blocks[0].kind, .paragraph("![private](file:///Users/test/private.png)"))
    }

    func testNormalizeCodeLanguageAliases() {
        XCTAssertEqual(NativeMarkdown.normalizeCodeLanguage("zsh"), "bash")
        XCTAssertEqual(NativeMarkdown.normalizeCodeLanguage("js"), "javascript")
        XCTAssertEqual(NativeMarkdown.normalizeCodeLanguage("plaintext"), "text")
        XCTAssertEqual(NativeMarkdown.normalizeCodeLanguage("swift"), "swift")
    }
}
