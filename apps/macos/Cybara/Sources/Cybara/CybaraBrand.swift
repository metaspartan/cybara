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
