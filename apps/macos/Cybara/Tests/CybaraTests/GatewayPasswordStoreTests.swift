import Foundation
import XCTest

@testable import Cybara

private final class MemoryGatewayPasswordCredentials: GatewayPasswordCredentialStore {
    var values: [String: String] = [:]

    func read(account: String) throws -> String? {
        values[account]
    }

    func write(_ value: String, account: String) throws {
        values[account] = value
    }

    func remove(account: String) throws {
        values.removeValue(forKey: account)
    }
}

final class GatewayPasswordStoreTests: XCTestCase {
    func testMigratesLegacyPasswordIntoCredentialStore() throws {
        let credentials = MemoryGatewayPasswordCredentials()
        let defaults = try XCTUnwrap(UserDefaults(suiteName: UUID().uuidString))
        defaults.set("  secret-password  ", forKey: GatewayPasswordStore.legacyDefaultsKey)

        XCTAssertEqual(GatewayPasswordStore.load(credentials: credentials, defaults: defaults), "secret-password")
        XCTAssertEqual(credentials.values[GatewayPasswordStore.account], "secret-password")
        XCTAssertNil(defaults.string(forKey: GatewayPasswordStore.legacyDefaultsKey))
    }

    func testSaveLoadAndClearUseCredentialStore() throws {
        let credentials = MemoryGatewayPasswordCredentials()
        let defaults = try XCTUnwrap(UserDefaults(suiteName: UUID().uuidString))

        try GatewayPasswordStore.save(" password ", credentials: credentials, defaults: defaults)
        XCTAssertEqual(GatewayPasswordStore.load(credentials: credentials, defaults: defaults), "password")
        try GatewayPasswordStore.clear(credentials: credentials, defaults: defaults)
        XCTAssertNil(GatewayPasswordStore.load(credentials: credentials, defaults: defaults))
    }
}
