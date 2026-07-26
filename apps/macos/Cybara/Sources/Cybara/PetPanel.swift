import AppKit
import SwiftUI

extension Notification.Name {
    static let cybaraPetOpenChat = Notification.Name("cybara.petOpenChat")
}

@MainActor
final class PetPanelController {
    static let shared = PetPanelController()

    private var panel: NSPanel?
    private static let collapsedSize = CGSize(width: 76, height: 76)
    private static let expandedSize = CGSize(width: 188, height: 250)

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

    func setExpanded(_ expanded: Bool) {
        guard let panel else { return }
        let target = expanded ? Self.expandedSize : Self.collapsedSize
        var frame = panel.frame
        guard frame.size != target else { return }
        frame.origin.y += frame.size.height - target.height
        frame.size = target
        panel.setFrame(frame, display: true, animate: false)
    }

    private func makePanel() -> NSPanel {
        let size: CGFloat = Self.collapsedSize.width
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

        let hosting = NSHostingView(
            rootView: PetPanelView(onGameVisibilityChange: { [weak self] visible in
                self?.setExpanded(visible)
            })
        )
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
    let onGameVisibilityChange: (Bool) -> Void

    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    @State private var hovering = false
    @State private var gameVisible = false
    @State private var taps = 0
    @State private var lastTapAt: Double = 0

    var body: some View {
        VStack(spacing: 6) {
            mascot
            if gameVisible {
                PetGamePanel(onClose: { setGameVisible(false) })
            }
        }
        .padding(6)
        .frame(maxWidth: .infinity, alignment: .top)
    }

    private var mascot: some View {
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
        .animation(systemReduceMotion ? nil : .easeOut(duration: 0.15), value: hovering)
        .onHover { hovering = $0 }
        .onTapGesture { handleTap() }
        .contentShape(Circle())
        .help("Cybara — click to open chat, five quick clicks for a surprise")
    }

    private func handleTap() {
        let moment = PetGame.now()
        let result = PetGame.registerTap(taps: taps, lastTapAt: lastTapAt, at: moment)
        taps = result.taps
        lastTapAt = moment
        if result.unlocked {
            setGameVisible(true)
            return
        }
        if gameVisible { return }
        NSApp.activate(ignoringOtherApps: true)
        for window in NSApp.windows where !(window is NSPanel) {
            window.makeKeyAndOrderFront(nil)
            break
        }
        NotificationCenter.default.post(name: .cybaraPetOpenChat, object: nil)
    }

    private func setGameVisible(_ visible: Bool) {
        gameVisible = visible
        onGameVisibilityChange(visible)
    }
}

private struct PetGamePanel: View {
    let onClose: () -> Void

    @State private var state = PetGame.load()
    @State private var blink = false
    @State private var cue: String?
    @State private var menuVisible = false

    private let tick = Timer.publish(every: 15, on: .main, in: .common).autoconnect()
    private let blinkTick = Timer.publish(every: 4.2, on: .main, in: .common).autoconnect()

    private var stage: PetStage { PetGame.stage(of: state) }
    private var mood: PetMood { PetGame.mood(of: state) }
    private var hatched: Bool { stage != .egg && stage != .hatching }

    var body: some View {
        VStack(spacing: 4) {
            header
            screen
            stats
            Text(statusText)
                .font(.system(size: 8))
                .foregroundStyle(.secondary)
            actions
        }
        .padding(7)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color(nsColor: .controlBackgroundColor))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(Color.primary.opacity(0.12), lineWidth: 1)
                )
        )
        .frame(width: 164)
        .onReceive(tick) { _ in state = PetGame.decayed(state, at: PetGame.now()) }
        .onReceive(blinkTick) { _ in
            blink = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.16) { blink = false }
        }
        .onChange(of: state) { _, newValue in PetGame.save(newValue) }
    }

    private var header: some View {
        HStack(spacing: 2) {
            Text(hatched ? "LV \(PetGame.level(of: state))" : "EGG")
                .font(.system(size: 8, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(.secondary)
            Spacer()
            Button {
                menuVisible.toggle()
            } label: {
                Image(systemName: "gearshape")
                    .font(.system(size: 9))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Pet options")
            .popover(isPresented: $menuVisible, arrowEdge: .bottom) {
                Button("Start over") {
                    state = PetGame.initialState()
                    menuVisible = false
                    showCue("reset")
                }
                .buttonStyle(.plain)
                .font(.system(size: 10))
                .padding(8)
            }
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 8))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close pet game")
        }
    }

    private var screen: some View {
        ZStack(alignment: .topTrailing) {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.black.opacity(0.35))
            PetSpriteView(
                rows: PetSprite.rows(for: stage, mood: mood, blink: blink),
                scale: 4
            )
            .padding(2)
            if let cue {
                Text(cue)
                    .font(.system(size: 8))
                    .padding(.horizontal, 3)
                    .background(Color(nsColor: .controlBackgroundColor))
                    .cornerRadius(3)
                    .padding(3)
            }
        }
        .frame(height: 72)
    }

    private var stats: some View {
        HStack(spacing: 5) {
            statPip("fd", state.hunger, Color(red: 0.961, green: 0.510, blue: 0.125))
            statPip("rs", state.energy, Color(red: 0.486, green: 0.663, blue: 0.910))
            statPip("jy", state.joy, Color(red: 0.298, green: 0.686, blue: 0.314))
        }
    }

    private func statPip(_ label: String, _ value: Int, _ tone: Color) -> some View {
        HStack(spacing: 2) {
            Text(label.uppercased())
                .font(.system(size: 7))
                .foregroundStyle(.secondary)
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.primary.opacity(0.14))
                    Capsule()
                        .fill(tone)
                        .frame(width: geometry.size.width * CGFloat(value) / 100)
                }
            }
            .frame(width: 26, height: 3)
        }
        .accessibilityLabel("\(label) \(value) percent")
    }

    private var actions: some View {
        HStack(spacing: 3) {
            careButton("Feed", .feed, "yum")
            careButton("Play", .play, "wheee")
            careButton("Rest", .rest, "zzz")
        }
    }

    private func careButton(_ title: String, _ action: PetCareAction, _ message: String) -> some View {
        Button {
            state = PetGame.applying(action, to: state)
            showCue(message)
        } label: {
            Text(title)
                .font(.system(size: 9))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 2)
        }
        .buttonStyle(.bordered)
        .controlSize(.mini)
    }

    private var statusText: String {
        if stage == .egg { return "Care for the egg" }
        if stage == .hatching { return "Something stirs" }
        return PetGame.moodLabel(mood)
    }

    private func showCue(_ message: String) {
        cue = message
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { cue = nil }
    }
}
