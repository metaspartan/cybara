import AppKit
import SwiftUI

/// Menu/keyboard-driven actions, dispatched via NotificationCenter so the
/// SwiftUI `.commands` block stays decoupled from view/model instances.
extension Notification.Name {
    static let cybaraReloadWebView = Notification.Name("cybara.reloadWebView")
    static let cybaraRestartSidecar = Notification.Name("cybara.restartSidecar")
    static let cybaraOpenInBrowser = Notification.Name("cybara.openInBrowser")
    static let cybaraCopyURL = Notification.Name("cybara.copyURL")
    static let cybaraCheckForUpdates = Notification.Name("cybara.checkForUpdates")
    static let cybaraThemeAccentChanged = Notification.Name("cybara.themeAccentChanged")
    static let cybaraShowMainWindow = Notification.Name("cybara.showMainWindow")
    static let cybaraOpenChat = Notification.Name("cybara.openChat")
    static let cybaraOpenUsage = Notification.Name("cybara.openUsage")
    static let cybaraOpenSettings = Notification.Name("cybara.openSettings")
}

@MainActor
final class CybaraAppDelegate: NSObject, NSApplicationDelegate {
    var sidecar: SidecarManager?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(showMainWindow),
            name: .cybaraShowMainWindow,
            object: nil
        )
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationWillTerminate(_ notification: Notification) {
        sidecar?.stop()
    }

    @objc private func showMainWindow() {
        NSApp.activate(ignoringOtherApps: true)
        for window in NSApp.windows where window.identifier?.rawValue == "CybaraMainWindow" {
            window.deminiaturize(nil)
            window.makeKeyAndOrderFront(nil)
        }
    }
}

@main
struct CybaraApp: App {
    @NSApplicationDelegateAdaptor(CybaraAppDelegate.self) private var appDelegate
    @StateObject private var sidecar = SidecarManager()
    @StateObject private var updateChecker = UpdateChecker()
    @StateObject private var menuBarModel = CybaraMenuBarModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(sidecar)
                .task {
                    appDelegate.sidecar = sidecar
                    await sidecar.startIfNeeded()
                    // Quiet background check on launch; only nags if newer exists.
                    await updateChecker.check(userInitiated: false)
                }
                .onReceive(NotificationCenter.default.publisher(for: .cybaraCheckForUpdates)) { _ in
                    Task { await updateChecker.check(userInitiated: true) }
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
            // Manual update check, alongside the standard App menu items.
            CommandGroup(after: .appInfo) {
                Button("Check for Updates…") {
                    NotificationCenter.default.post(name: .cybaraCheckForUpdates, object: nil)
                }
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
                .frame(width: 760, height: 680)
        }

        MenuBarExtra {
            CybaraMenuBarContent(model: menuBarModel)
                .environmentObject(sidecar)
        } label: {
            CybaraMenuBarLabel()
        }
        .menuBarExtraStyle(.menu)
    }
}
