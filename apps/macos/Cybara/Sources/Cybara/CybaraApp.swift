import AppKit
import SwiftUI

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

        Settings {
            SettingsView()
                .environmentObject(sidecar)
                .frame(width: 520, height: 320)
        }
    }
}
