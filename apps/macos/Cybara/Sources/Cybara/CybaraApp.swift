import AppKit
import SwiftUI

extension Notification.Name {
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
    private var terminationPending = false

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

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let sidecar else { return .terminateNow }
        guard !terminationPending else { return .terminateLater }
        terminationPending = true
        Task {
            await sidecar.stopAndWait()
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
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
                .environmentObject(updateChecker)
                .task {
                    appDelegate.sidecar = sidecar
                    updateChecker.prepareForRelaunch = { await sidecar.stopForUpdate() }
                    await sidecar.startIfNeeded()
                    await updateChecker.check(userInitiated: false)
                }
                .onReceive(NotificationCenter.default.publisher(for: .cybaraCheckForUpdates)) { _ in
                    Task { await updateChecker.check(userInitiated: true) }
                }
        }
        .defaultSize(width: 1440, height: 920)
        .windowResizability(.contentMinSize)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Chat") {
                    NotificationCenter.default.post(name: .cybaraOpenChat, object: nil)
                }
                .keyboardShortcut("n", modifiers: .command)
            }
            CommandGroup(after: .appInfo) {
                Button("Check for Updates…") {
                    NotificationCenter.default.post(name: .cybaraCheckForUpdates, object: nil)
                }
            }
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
                .environmentObject(updateChecker)
                .frame(width: 760, height: 680)
        }

        MenuBarExtra {
            CybaraMenuBarContent(model: menuBarModel, updateChecker: updateChecker)
                .environmentObject(sidecar)
        } label: {
            CybaraMenuBarLabel(updateChecker: updateChecker)
        }
        .menuBarExtraStyle(.menu)
    }
}
