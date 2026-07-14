import AppKit
import SwiftUI

enum CybaraBrand {
    private static let resourceBundleName = "Cybara_Cybara.bundle"
    private static let logoFileName = "cybara.png"

    static let logoImage: NSImage? = {
        guard let url = logoURL() else {
            return nil
        }
        return NSImage(contentsOf: url)
    }()

    static func menuBarTemplateImage(size: CGFloat = 16) -> NSImage? {
        guard let source = logoImage,
              let sourceImage = source.cgImage(forProposedRect: nil, context: nil, hints: nil)
        else {
            return nil
        }
        let pixelSize = max(1, Int((size * 2).rounded()))
        guard let context = CGContext(
            data: nil,
            width: pixelSize,
            height: pixelSize,
            bitsPerComponent: 8,
            bytesPerRow: pixelSize * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            return nil
        }

        context.interpolationQuality = .high
        context.draw(sourceImage, in: CGRect(x: 0, y: 0, width: pixelSize, height: pixelSize))
        guard let raw = context.data?.assumingMemoryBound(to: UInt8.self) else { return nil }
        for offset in stride(from: 0, to: pixelSize * pixelSize * 4, by: 4) {
            let sourceAlpha = CGFloat(raw[offset + 3]) / 255
            let red = CGFloat(raw[offset]) / 255
            let green = CGFloat(raw[offset + 1]) / 255
            let blue = CGFloat(raw[offset + 2]) / 255
            let luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
            let alpha = sourceAlpha * max(0.18, 1 - luminance)
            raw[offset] = 0
            raw[offset + 1] = 0
            raw[offset + 2] = 0
            raw[offset + 3] = UInt8((alpha * 255).rounded())
        }

        guard let processed = context.makeImage() else { return nil }
        let bitmap = NSBitmapImageRep(cgImage: processed)
        bitmap.size = NSSize(width: size, height: size)
        let image = NSImage(size: NSSize(width: size, height: size))
        image.addRepresentation(bitmap)
        image.isTemplate = true
        return image
    }

    static func logoURL(
        bundleURL: URL = Bundle.main.bundleURL,
        resourceURL: URL? = Bundle.main.resourceURL,
        executableURL: URL? = Bundle.main.executableURL,
        sourceFileURL: URL? = URL(fileURLWithPath: #filePath),
        fileManager: FileManager = .default
    ) -> URL? {
        logoURLCandidates(
            bundleURL: bundleURL,
            resourceURL: resourceURL,
            executableURL: executableURL,
            sourceFileURL: sourceFileURL
        )
        .first { fileManager.fileExists(atPath: $0.path) }
    }

    static func logoURLCandidates(
        bundleURL: URL = Bundle.main.bundleURL,
        resourceURL: URL? = Bundle.main.resourceURL,
        executableURL: URL? = Bundle.main.executableURL,
        sourceFileURL: URL? = URL(fileURLWithPath: #filePath)
    ) -> [URL] {
        var candidates: [URL] = []

        func append(_ url: URL) {
            let path = url.standardizedFileURL.path
            guard !candidates.contains(where: { $0.standardizedFileURL.path == path }) else { return }
            candidates.append(url)
        }

        func appendSwiftPMBundle(in directory: URL?) {
            guard let directory else { return }
            append(
                directory
                    .appendingPathComponent(resourceBundleName, isDirectory: true)
                    .appendingPathComponent(logoFileName)
            )
        }

        appendSwiftPMBundle(in: resourceURL)
        appendSwiftPMBundle(in: bundleURL)

        if let executableURL {
            let executableDirectory = executableURL.deletingLastPathComponent()
            appendSwiftPMBundle(in: executableDirectory)
            appendSwiftPMBundle(
                in: executableDirectory
                    .deletingLastPathComponent()
                    .appendingPathComponent("Resources", isDirectory: true)
            )
        }

        if let sourceFileURL {
            append(
                sourceFileURL
                    .deletingLastPathComponent()
                    .appendingPathComponent("Resources", isDirectory: true)
                    .appendingPathComponent(logoFileName)
            )
        }

        return candidates
    }
}

struct CybaraLogo: View {
    var size: CGFloat
    var showsGlass: Bool = true

    var body: some View {
        ZStack {
            if showsGlass {
                RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                    .fill(.thinMaterial)
                    .overlay(
                        RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                            .stroke(.white.opacity(0.16), lineWidth: 1)
                    )
            }

            if let image = CybaraBrand.logoImage {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFit()
                    .padding(size * 0.12)
                    .accessibilityLabel("Cybara")
            } else {
                Image(systemName: "hexagon.fill")
                    .font(.system(size: size * 0.58, weight: .bold))
                    .foregroundStyle(.tint)
                    .accessibilityLabel("Cybara")
            }
        }
        .frame(width: size, height: size)
    }
}
