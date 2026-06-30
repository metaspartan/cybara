import AppKit
import SwiftUI

/// Menu/keyboard-driven actions, dispatched via NotificationCenter so the
/// SwiftUI `.commands` block stays decoupled from view/model instances.
extension Notification.Name {
    static let cybaraReloadWebView = Notification.Name("cybara.reloadWebView")
    static let cybaraRestartSidecar = Notification.Name("cybara.restartSidecar")
    static let cybaraOpenInBrowser = Notification.Name("cybara.openInBrowser")
    static let cybaraCopyURL = Notification.Name("cybara.copyURL")
}

@MainActor
final class CybaraAppDelegate: NSObject, NSApplicationDelegate {
    var sidecar: SidecarManager?

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationWillTerminate(_ notification: Notification) {
        sidecar?.stop()
    }
}

@main
struct CybaraApp: App {
    @NSApplicationDelegateAdaptor(CybaraAppDelegate.self) private var appDelegate
    @StateObject private var sidecar = SidecarManager()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(sidecar)
                .task {
                    appDelegate.sidecar = sidecar
                    await sidecar.startIfNeeded()
                }
        }
        .defaultSize(width: 1440, height: 920)
        .windowResizability(.contentMinSize)
        .commands {
            // Reload the web UI (Cmd-R), like a browser.
            CommandGroup(after: .toolbar) {
                Button("Reload") {
                    NotificationCenter.default.post(name: .cybaraReloadWebView, object: nil)
                }
                .keyboardShortcut("r", modifiers: .command)
            }
            // Gateway controls under a dedicated top-level menu.
            CommandMenu("Gateway") {
                Button("Restart Gateway") {
                    NotificationCenter.default.post(name: .cybaraRestartSidecar, object: nil)
                }
                .keyboardShortcut("r", modifiers: [.command, .shift])
                Button("Open in Browser") {
                    NotificationCenter.default.post(name: .cybaraOpenInBrowser, object: nil)
                }
                .keyboardShortcut("o", modifiers: [.command, .shift])
                Button("Copy Server URL") {
                    NotificationCenter.default.post(name: .cybaraCopyURL, object: nil)
                }
            }
        }

        Settings {
            SettingsView()
                .environmentObject(sidecar)
                .frame(width: 520, height: 320)
        }
    }
}
