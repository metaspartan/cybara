import AppKit
import SwiftUI

struct NativeWorkspaceOpenTargetIcon: View {
    let target: NativeWorkspaceOpenTarget

    var body: some View {
        Group {
            if let image {
                Image(nsImage: image)
                    .renderingMode(.original)
            } else {
                Image(systemName: systemImage)
                    .symbolRenderingMode(.monochrome)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: 12, height: 12)
        .frame(width: 16, height: 16)
    }

    private var image: NSImage? {
        if target.iconUrl == "/cybara.png" {
            return CybaraBrand.logoImage.map(Self.displayImage)
        }
        guard let iconUrl = target.iconUrl?.trimmingCharacters(in: .whitespacesAndNewlines),
              let commaIndex = iconUrl.firstIndex(of: ","),
              iconUrl[..<commaIndex].lowercased().hasPrefix("data:image/")
        else {
            return nil
        }
        let encoded = String(iconUrl[iconUrl.index(after: commaIndex)...])
        guard let data = Data(base64Encoded: encoded) else { return nil }
        return NSImage(data: data).map(Self.displayImage)
    }

    static func displayImage(_ image: NSImage) -> NSImage {
        guard let copy = image.copy() as? NSImage else { return image }
        copy.size = NSSize(width: 14, height: 14)
        return copy
    }

    private var systemImage: String {
        switch target.id {
        case "cybara_ide": "macwindow"
        case "finder", "explorer", "files": "folder"
        case "terminal", "ghostty": "terminal"
        case "xcode": "hammer"
        default: "curlybraces.square"
        }
    }
}
