import AppKit
import SwiftUI

extension View {
    /// Liquid Glass surface. Uses the real `.glassEffect()` on macOS 26 (Tahoe)
    /// and a translucent material fallback on macOS 14–15, so the app builds and
    /// looks right across supported releases.
    @ViewBuilder
    func cybaraGlass(cornerRadius: CGFloat = 24) -> some View {
        modifier(CybaraGlassModifier(cornerRadius: cornerRadius))
    }
}

private struct CybaraGlassModifier: ViewModifier {
    @Environment(\.nativeChatAppearance) private var chatAppearance
    let cornerRadius: CGFloat

    @ViewBuilder
    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        if chatAppearance.reduceTransparency {
            content
                .background(Color(nsColor: .windowBackgroundColor), in: shape)
                .overlay(shape.stroke(Color.primary.opacity(chatAppearance.highContrast ? 0.28 : 0.12), lineWidth: 1))
        } else if #available(macOS 26.0, *) {
            content.glassEffect(.regular, in: shape)
        } else {
            content.background(.ultraThinMaterial, in: shape)
        }
    }
}

private final class WindowResolverView: NSView {
    var onResolve: ((NSWindow) -> Void)?
    private weak var resolvedWindow: NSWindow?

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        resolveWindow()
    }

    func resolveWindow() {
        guard let window, window !== resolvedWindow else { return }
        resolvedWindow = window
        onResolve?(window)
    }
}

struct WindowAccessor: NSViewRepresentable {
    let onResolve: (NSWindow) -> Void

    func makeNSView(context: Context) -> NSView {
        let view = WindowResolverView()
        view.onResolve = onResolve
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        guard let view = nsView as? WindowResolverView else { return }
        view.onResolve = onResolve
        view.resolveWindow()
    }
}

/// Behind-window translucency (`NSVisualEffectView`) so the desktop shows through
/// for the Liquid Glass aesthetic. Used as the root window backing.
struct VisualEffectBackground: NSViewRepresentable {
    var material: NSVisualEffectView.Material = .underWindowBackground
    var blendingMode: NSVisualEffectView.BlendingMode = .behindWindow

    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = material
        view.blendingMode = blendingMode
        view.state = .active
        return view
    }

    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {
        nsView.material = material
        nsView.blendingMode = blendingMode
    }
}
