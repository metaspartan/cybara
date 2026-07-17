import XCTest

@testable import Cybara

extension XCTestCase {
    func decodeSession(_ json: String) throws -> GatewaySession {
        try JSONDecoder().decode(GatewaySession.self, from: Data(json.utf8))
    }

    func decodeProvider(_ json: String) throws -> GatewayProvider {
        try JSONDecoder().decode(GatewayProvider.self, from: Data(json.utf8))
    }

    func decodeAgent(_ json: String) throws -> GatewayAgent {
        try JSONDecoder().decode(GatewayAgent.self, from: Data(json.utf8))
    }

    func decodeTask(_ json: String) throws -> GatewayTask {
        try JSONDecoder().decode(GatewayTask.self, from: Data(json.utf8))
    }

    func decodeSessionMessage(_ json: String) throws -> GatewaySessionMessage {
        try JSONDecoder().decode(GatewaySessionMessage.self, from: Data(json.utf8))
    }

    func decodeChannel(_ json: String) throws -> GatewayChannel {
        try JSONDecoder().decode(GatewayChannel.self, from: Data(json.utf8))
    }

    func decodeStatusEvent(_ json: String) throws -> GatewayStatusEvent {
        try JSONDecoder().decode(GatewayStatusEvent.self, from: Data(json.utf8))
    }
}
