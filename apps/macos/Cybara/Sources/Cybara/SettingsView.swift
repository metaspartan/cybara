import AppKit
import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var sidecar: SidecarManager
    @EnvironmentObject var updateChecker: UpdateChecker

    var body: some View {
        NativeSettingsScreen(client: GatewayClient(baseURL: sidecar.serverURL))
            .environmentObject(sidecar)
            .environmentObject(updateChecker)
            .frame(width: 860, height: 720)
    }
}
