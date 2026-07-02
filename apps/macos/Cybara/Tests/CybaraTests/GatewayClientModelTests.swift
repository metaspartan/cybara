import XCTest

@testable import Cybara

final class GatewayClientModelTests: XCTestCase {

    func testSessionDisplayTitleTrimsGatewayTitle() throws {
        let session = try decodeSession(#"{"id":"session-123456789","title":"  Release planning  "}"#)

        XCTAssertEqual(session.displayTitle, "Release planning")
    }

    func testSessionDisplayTitleFallsBackForBlankOrMissingTitle() throws {
        let blank = try decodeSession(#"{"id":"session-abcdef123","title":"   "}"#)
        let missing = try decodeSession(#"{"id":"session-fedcba987"}"#)

        XCTAssertEqual(blank.displayTitle, "session-")
        XCTAssertEqual(missing.displayTitle, "session-")
    }

    func testProviderDisplayNamePrefersFirstNonEmptyGatewayLabel() throws {
        let named = try decodeProvider(
            #"{"id":"openai","name":"  OpenAI  ","provider":"openai","enabled":true}"#)
        let providerFallback = try decodeProvider(
            #"{"id":"anthropic-id","name":"   ","provider":" Anthropic ","enabled":true}"#)
        let idFallback = try decodeProvider(#"{"id":"local","name":" ","provider":"\n"}"#)

        XCTAssertEqual(named.displayName, "OpenAI")
        XCTAssertEqual(providerFallback.displayName, "Anthropic")
        XCTAssertEqual(idFallback.displayName, "local")
    }

    func testChannelDisplayNamePrefersFirstNonEmptyGatewayLabel() throws {
        let named = try decodeChannel(#"{"id":"telegram-1","name":"  Telegram Ops  ","type":"telegram"}"#)
        let typeFallback = try decodeChannel(#"{"id":"slack-1","name":" ","type":" Slack "}"#)
        let idFallback = try decodeChannel(#"{"id":"webhook-1","name":" ","type":""}"#)

        XCTAssertEqual(named.displayName, "Telegram Ops")
        XCTAssertEqual(typeFallback.displayName, "Slack")
        XCTAssertEqual(idFallback.displayName, "webhook-1")
    }

    private func decodeSession(_ json: String) throws -> GatewaySession {
        try JSONDecoder().decode(GatewaySession.self, from: Data(json.utf8))
    }

    private func decodeProvider(_ json: String) throws -> GatewayProvider {
        try JSONDecoder().decode(GatewayProvider.self, from: Data(json.utf8))
    }

    private func decodeChannel(_ json: String) throws -> GatewayChannel {
        try JSONDecoder().decode(GatewayChannel.self, from: Data(json.utf8))
    }
}
