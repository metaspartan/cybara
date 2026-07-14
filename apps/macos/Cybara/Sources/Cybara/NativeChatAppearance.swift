import SwiftUI

struct NativeChatAppearanceSettings: Equatable {
    var fontSize = "standard"
    var codeFontSize = "standard"
    var lineSpacing = "comfortable"
    var reduceMotion = false
    var reduceTransparency = false
    var highContrast = false
    var underlineLinks = false

    init() {}

    init(config: [String: Any]) {
        let value = config["chat_appearance"] as? [String: Any]
            ?? config["chatAppearance"] as? [String: Any]
            ?? [:]
        fontSize = Self.option(value["fontSize"] ?? value["font_size"], allowed: ["compact", "standard", "large", "extra_large"], fallback: "standard")
        codeFontSize = Self.option(value["codeFontSize"] ?? value["code_font_size"], allowed: ["compact", "standard", "large"], fallback: "standard")
        lineSpacing = Self.option(value["lineSpacing"] ?? value["line_spacing"], allowed: ["compact", "comfortable", "spacious"], fallback: "comfortable")
        reduceMotion = Self.boolean(value["reduceMotion"] ?? value["reduce_motion"])
        reduceTransparency = Self.boolean(value["reduceTransparency"] ?? value["reduce_transparency"])
        highContrast = Self.boolean(value["highContrast"] ?? value["high_contrast"])
        underlineLinks = Self.boolean(value["underlineLinks"] ?? value["underline_links"])
    }

    var payload: [String: Any] {
        [
            "fontSize": fontSize,
            "codeFontSize": codeFontSize,
            "lineSpacing": lineSpacing,
            "reduceMotion": reduceMotion,
            "reduceTransparency": reduceTransparency,
            "highContrast": highContrast,
            "underlineLinks": underlineLinks,
        ]
    }

    var bodyFontSize: CGFloat {
        switch fontSize {
        case "compact": return 13
        case "large": return 16
        case "extra_large": return 18
        default: return 14
        }
    }

    var codeTextSize: CGFloat {
        switch codeFontSize {
        case "compact": return 11
        case "large": return 14
        default: return 12
        }
    }

    var lineSpacingPoints: CGFloat {
        switch lineSpacing {
        case "compact": return 1.5
        case "spacious": return 5
        default: return 3
        }
    }

    var activityFontSize: CGFloat {
        max(11, bodyFontSize * 0.84)
    }

    private static func option(_ value: Any?, allowed: Set<String>, fallback: String) -> String {
        guard let string = value as? String, allowed.contains(string) else { return fallback }
        return string
    }

    private static func boolean(_ value: Any?) -> Bool {
        value as? Bool ?? false
    }
}

private struct NativeChatAppearanceEnvironmentKey: EnvironmentKey {
    static let defaultValue = NativeChatAppearanceSettings()
}

extension EnvironmentValues {
    var nativeChatAppearance: NativeChatAppearanceSettings {
        get { self[NativeChatAppearanceEnvironmentKey.self] }
        set { self[NativeChatAppearanceEnvironmentKey.self] = newValue }
    }
}

extension View {
    func nativeChatAppearance(_ settings: NativeChatAppearanceSettings) -> some View {
        environment(\.nativeChatAppearance, settings)
    }
}
