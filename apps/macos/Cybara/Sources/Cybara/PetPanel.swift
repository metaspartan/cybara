import AppKit
import SwiftUI

extension Notification.Name {
    static let cybaraPetOpenChat = Notification.Name("cybara.petOpenChat")
}

@MainActor
final class PetPanelController {
    static let shared = PetPanelController()

    private var panel: NSPanel?

    static var isEnabled: Bool {
        UserDefaults.standard.object(forKey: "cybara.petEnabled") as? Bool ?? false
    }

    func setVisible(_ visible: Bool) {
        if visible {
            show()
        } else {
            hide()
        }
    }

    func show() {
        if panel == nil {
            panel = makePanel()
        }
        panel?.orderFrontRegardless()
    }

    func hide() {
        panel?.orderOut(nil)
    }

    private func makePanel() -> NSPanel {
        let size: CGFloat = 76
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: size, height: size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.isMovableByWindowBackground = true
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.setFrameAutosaveName("CybaraPetPanel")

        let hosting = NSHostingView(rootView: PetPanelView())
        hosting.frame = panel.contentRect(forFrameRect: panel.frame)
        panel.contentView = hosting

        if !panel.setFrameUsingName("CybaraPetPanel"), let screen = NSScreen.main {
            let visible = screen.visibleFrame
            panel.setFrameOrigin(
                NSPoint(
                    x: visible.maxX - size - 28,
                    y: visible.minY + 96
                )
            )
        }
        return panel
    }
}

private struct PetPanelView: View {
    @State private var hovering = false

    var body: some View {
        ZStack {
            if let petImage = CybaraBrand.logoImage {
                Image(nsImage: petImage)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
                    .frame(width: 64, height: 64)
                    .shadow(color: .black.opacity(0.32), radius: 7, y: 3)
            } else {
                Image(systemName: "sparkles")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: 64, height: 64)
        .scaleEffect(hovering ? 1.06 : 1)
        .animation(.easeOut(duration: 0.15), value: hovering)
        .onHover { hovering = $0 }
        .onTapGesture {
            NSApp.activate(ignoringOtherApps: true)
            for window in NSApp.windows where !(window is NSPanel) {
                window.makeKeyAndOrderFront(nil)
                break
            }
            NotificationCenter.default.post(name: .cybaraPetOpenChat, object: nil)
        }
        .padding(6)
        .contentShape(Circle())
        .help("Cybara — click to open chat, drag to move")
    }
}
