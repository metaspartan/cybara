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

    func testMobileDeviceModelsExposeStatusAndScopes() throws {
        let device = try JSONDecoder().decode(
            GatewayMobileDevice.self,
            from: Data(
                #"""
                {
                  "id": "mobile_123",
                  "name": "Carsen iPhone",
                  "baseUrl": "http://192.168.1.20:4269",
                  "status": "active",
                  "scopes": ["chat", "manage", "read"],
                  "createdAt": "2026-07-02T18:00:00.000Z"
                }
                """#.utf8
            )
        )

        XCTAssertTrue(device.isActive)
        XCTAssertEqual(device.scopeSummary, "chat, manage, read")
    }

    func testMobilePairingCodeDecodesExpiryAndPayload() throws {
        let pairing = try JSONDecoder().decode(
            GatewayMobilePairingCode.self,
            from: Data(
                #"""
                {
                  "success": true,
                  "code": "ABCD-2345",
                  "expiresAt": 1783015200000,
                  "encoded": "{\"protocol\":\"cybara-mobile-pair-v1\"}",
                  "qrDataUrl": "data:image/png;base64,abcd",
                  "payload": {
                    "protocol": "cybara-mobile-pair-v1",
                    "name": "Studio Gateway",
                    "baseUrl": "http://192.168.1.20:4269",
                    "code": "ABCD-2345",
                    "role": "standard",
                    "expiresAt": 1783015200000
                  }
                }
                """#.utf8
            )
        )

        XCTAssertEqual(pairing.payload.protocol, "cybara-mobile-pair-v1")
        XCTAssertEqual(pairing.payload.role, "standard")
        XCTAssertEqual(pairing.expiresAtDate?.timeIntervalSince1970, 1783015200)
    }

    func testCybaraLogoResourceIsBundled() throws {
        XCTAssertNotNil(CybaraBrand.logoImage)
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
