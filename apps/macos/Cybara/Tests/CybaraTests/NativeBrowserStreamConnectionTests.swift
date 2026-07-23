import Foundation
import Testing
@testable import Cybara

@Suite("Native browser stream")
struct NativeBrowserStreamConnectionTests {
    @Test("Builds a WebSocket route under the gateway base path")
    func streamURL() throws {
        let client = GatewayClient(baseURL: try #require(URL(string: "https://host.test/cybara")))
        let url = try #require(nativeBrowserStreamURL(client: client, pageID: "page/1"))
        let components = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
        let query = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).map { item in
            (item.name, item.value ?? "")
        })

        #expect(components.scheme == "wss")
        #expect(components.host == "host.test")
        #expect(components.percentEncodedPath == "/cybara/api/browser/tabs/page%2F1/stream")
        #expect(query["quality"] == "58")
        #expect(query["maxWidth"] == "1600")
        #expect(query["maxHeight"] == "1200")
        #expect(query["everyNthFrame"] == "1")
    }
}
