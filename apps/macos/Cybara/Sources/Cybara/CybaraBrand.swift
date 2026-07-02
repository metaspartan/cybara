import AppKit
import SwiftUI

enum CybaraBrand {
    static let logoImage: NSImage? = {
        guard let url = Bundle.module.url(forResource: "cybara", withExtension: "png") else {
            return nil
        }
        return NSImage(contentsOf: url)
    }()
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
