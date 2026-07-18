import AppKit
import SwiftUI

extension View {
    @ViewBuilder
    func cybaraGlass(cornerRadius: CGFloat = 24) -> some View {
        modifier(CybaraGlassModifier(cornerRadius: cornerRadius))
    }
}

private struct CybaraGlassModifier: ViewModifier {
    @Environment(\.nativeChatAppearance) private var chatAppearance
    @Environment(\.accessibilityReduceTransparency) private var systemReduceTransparency
    @Environment(\.colorSchemeContrast) private var colorSchemeContrast
    let cornerRadius: CGFloat

    @ViewBuilder
    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        if chatAppearance.reduceTransparency || systemReduceTransparency {
            content
                .background(Color(nsColor: .windowBackgroundColor), in: shape)
                .overlay(shape.stroke(Color.primary.opacity(highContrast ? 0.28 : 0.12), lineWidth: 1))
        } else if #available(macOS 26.0, *) {
            content.glassEffect(.regular, in: shape)
        } else {
            content.background(.ultraThinMaterial, in: shape)
        }
    }

    private var highContrast: Bool {
        chatAppearance.highContrast || colorSchemeContrast == .increased
    }
}

struct CybaraGlassGroup<Content: View>: View {
    let spacing: CGFloat
    let content: Content

    init(spacing: CGFloat = 12, @ViewBuilder content: () -> Content) {
        self.spacing = spacing
        self.content = content()
    }

    @ViewBuilder
    var body: some View {
        if #available(macOS 26.0, *) {
            GlassEffectContainer(spacing: spacing) {
                content
            }
        } else {
            content
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
