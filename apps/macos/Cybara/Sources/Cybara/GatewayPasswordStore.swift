import Foundation
import Security

protocol GatewayPasswordCredentialStore {
    func read(account: String) throws -> String?
    func write(_ value: String, account: String) throws
    func remove(account: String) throws
}

enum GatewayPasswordStoreError: LocalizedError {
    case keychain(OSStatus)
    case invalidData

    var errorDescription: String? {
        switch self {
        case .keychain(let status):
            return "Keychain operation failed with status \(status)."
        case .invalidData:
            return "The saved gateway password could not be decoded."
        }
    }
}

struct KeychainGatewayPasswordCredentialStore: GatewayPasswordCredentialStore {
    private let service = "com.ck.cybara.gateway"

    func read(account: String) throws -> String? {
        var query = baseQuery(account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw GatewayPasswordStoreError.keychain(status) }
        guard let data = result as? Data, let value = String(data: data, encoding: .utf8) else {
            throw GatewayPasswordStoreError.invalidData
        }
        return value
    }

    func write(_ value: String, account: String) throws {
        let query = baseQuery(account: account)
        let data = Data(value.utf8)
        let updateStatus = SecItemUpdate(
            query as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )
        if updateStatus == errSecItemNotFound {
            var insert = query
            insert[kSecValueData as String] = data
            let addStatus = SecItemAdd(insert as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw GatewayPasswordStoreError.keychain(addStatus)
            }
            return
        }
        guard updateStatus == errSecSuccess else {
            throw GatewayPasswordStoreError.keychain(updateStatus)
        }
    }

    func remove(account: String) throws {
        let status = SecItemDelete(baseQuery(account: account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw GatewayPasswordStoreError.keychain(status)
        }
    }

    private func baseQuery(account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
    }
}

enum GatewayPasswordStore {
    static let account = "gateway-password"
    static let validationAccount = "gateway-password-validation"
    static let legacyDefaultsKey = "cybara_gateway_password"

    static func load(
        credentials: any GatewayPasswordCredentialStore = KeychainGatewayPasswordCredentialStore(),
        defaults: UserDefaults = .standard
    ) -> String? {
        if let stored = try? credentials.read(account: account), let normalized = normalize(stored) {
            return normalized
        }
        guard let legacy = normalize(defaults.string(forKey: legacyDefaultsKey)) else { return nil }
        do {
            try credentials.write(legacy, account: account)
            defaults.removeObject(forKey: legacyDefaultsKey)
        } catch {
            return legacy
        }
        return legacy
    }

    static func validateWrite(
        _ value: String,
        credentials: any GatewayPasswordCredentialStore = KeychainGatewayPasswordCredentialStore()
    ) throws {
        try credentials.write(value, account: validationAccount)
        try credentials.remove(account: validationAccount)
    }

    static func save(
        _ value: String,
        credentials: any GatewayPasswordCredentialStore = KeychainGatewayPasswordCredentialStore(),
        defaults: UserDefaults = .standard
    ) throws {
        guard let normalized = normalize(value) else {
            try clear(credentials: credentials, defaults: defaults)
            return
        }
        try credentials.write(normalized, account: account)
        defaults.removeObject(forKey: legacyDefaultsKey)
    }

    static func clear(
        credentials: any GatewayPasswordCredentialStore = KeychainGatewayPasswordCredentialStore(),
        defaults: UserDefaults = .standard
    ) throws {
        try credentials.remove(account: account)
        try credentials.remove(account: validationAccount)
        defaults.removeObject(forKey: legacyDefaultsKey)
    }

    private static func normalize(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }
}
