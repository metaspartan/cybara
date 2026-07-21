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

    static func menuBarTemplateImage(
        size: CGFloat = 16,
        showsUpdateIndicator: Bool = false
    ) -> NSImage? {
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
            let templateAlpha = menuBarTemplateAlpha(
                red: raw[offset],
                green: raw[offset + 1],
                blue: raw[offset + 2],
                alpha: raw[offset + 3]
            )
            raw[offset] = 0
            raw[offset + 1] = 0
            raw[offset + 2] = 0
            raw[offset + 3] = templateAlpha
        }
        if showsUpdateIndicator {
            applyMenuBarUpdateIndicator(raw: raw, pixelSize: pixelSize)
        }

        guard let processed = context.makeImage() else { return nil }
        let bitmap = NSBitmapImageRep(cgImage: processed)
        bitmap.size = NSSize(width: size, height: size)
        let image = NSImage(size: NSSize(width: size, height: size))
        image.addRepresentation(bitmap)
        image.isTemplate = true
        return image
    }

    private static func applyMenuBarUpdateIndicator(
        raw: UnsafeMutablePointer<UInt8>,
        pixelSize: Int
    ) {
        let outlineRadius = max(1, Int((CGFloat(pixelSize) * 0.055).rounded(.up)))
        for y in 0 ..< pixelSize {
            for x in 0 ..< pixelSize {
                let arrow = menuBarUpdateArrowPixel(x: x, y: y, pixelSize: pixelSize)
                let outline = !arrow && (-outlineRadius ... outlineRadius).contains { offsetY in
                    (-outlineRadius ... outlineRadius).contains { offsetX in
                        offsetX * offsetX + offsetY * offsetY <= outlineRadius * outlineRadius &&
                            menuBarUpdateArrowPixel(
                                x: x + offsetX,
                                y: y + offsetY,
                                pixelSize: pixelSize
                            )
                    }
                }
                let offset = (y * pixelSize + x) * 4
                if arrow {
                    raw[offset] = 0
                    raw[offset + 1] = 0
                    raw[offset + 2] = 0
                    raw[offset + 3] = 255
                } else if outline {
                    raw[offset + 3] = 0
                }
            }
        }
    }

    static func menuBarUpdateArrowPixel(x: Int, y: Int, pixelSize: Int) -> Bool {
        let size = CGFloat(pixelSize)
        let centerX = size * 0.73
        let tipY = size * 0.48
        let shoulderY = size * 0.68
        let bottomY = size * 0.88
        let x = CGFloat(x)
        let y = CGFloat(y)
        if y >= tipY, y <= shoulderY {
            let halfWidth = ((y - tipY) / (shoulderY - tipY)) * size * 0.14
            return abs(x - centerX) <= halfWidth
        }
        return y > shoulderY && y <= bottomY && abs(x - centerX) <= size * 0.045
    }

    static func menuBarTemplateAlpha(
        red: UInt8,
        green: UInt8,
        blue: UInt8,
        alpha: UInt8
    ) -> UInt8 {
        let sourceAlpha = CGFloat(alpha) / 255
        guard sourceAlpha > 0 else { return 0 }
        let redValue = min(1, CGFloat(red) / 255 / sourceAlpha)
        let greenValue = min(1, CGFloat(green) / 255 / sourceAlpha)
        let blueValue = min(1, CGFloat(blue) / 255 / sourceAlpha)
        let luminance = 0.2126 * redValue + 0.7152 * greenValue + 0.0722 * blueValue
        let detailAlpha = min(1, max(0, (luminance - 0.18) / 0.24))
        return UInt8((sourceAlpha * detailAlpha * 255).rounded())
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
