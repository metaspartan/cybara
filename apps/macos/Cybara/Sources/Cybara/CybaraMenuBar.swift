import AppKit
import SwiftUI

@MainActor
final class CybaraMenuBarModel: ObservableObject {
    @Published private(set) var plans: [ProviderPlanSnapshot] = []
    @Published private(set) var loaded = false

    func refresh(baseURL: URL) async {
        let client = GatewayClient(baseURL: baseURL)
        if let status = try? await client.providerPlanStatus() {
            plans = status.providers
                .filter { plan in
                    plan.managedAutomatically &&
                        (plan.monitored || plan.externalSourceAvailable || !plan.windows.isEmpty)
                }
                .sorted {
                    $0.providerName.localizedCaseInsensitiveCompare($1.providerName) == .orderedAscending
                }
        }
        loaded = true
    }
}

struct CybaraMenuBarContent: View {
    @EnvironmentObject private var sidecar: SidecarManager
    @ObservedObject var model: CybaraMenuBarModel

    var body: some View {
        Group {
            Button("Show Cybara") {
                post(.cybaraShowMainWindow)
            }
            .keyboardShortcut("o")

            Button("New Chat") {
                post(.cybaraOpenChat)
            }
            .keyboardShortcut("n")

            Menu("Usage") {
                if !model.loaded {
                    Text("Loading usage…")
                } else if model.plans.isEmpty {
                    Text("No automatic usage available")
                } else {
                    ForEach(model.plans) { plan in
                        Button(nativeUsageMenuLabel(plan)) {
                            post(.cybaraOpenUsage)
                        }
                    }
                }
                Divider()
                Button("Open Usage") {
                    post(.cybaraOpenUsage)
                }
            }

            Label(
                sidecar.isReady ? "Gateway Connected" : "Gateway Offline",
                systemImage: sidecar.isReady ? "checkmark.circle" : "exclamationmark.circle"
            )

            Divider()

            Button("Settings…") {
                post(.cybaraOpenSettings)
            }
            .keyboardShortcut(",")

            Divider()

            Button("Quit Cybara") {
                NSApp.terminate(nil)
            }
            .keyboardShortcut("q")
        }
        .task {
            await model.refresh(baseURL: sidecar.serverURL)
        }
    }

    private func post(_ name: Notification.Name) {
        if name != .cybaraShowMainWindow {
            NotificationCenter.default.post(name: .cybaraShowMainWindow, object: nil)
        }
        NotificationCenter.default.post(name: name, object: nil)
    }
}

struct CybaraMenuBarLabel: View {
    private var templateLogo: NSImage? {
        guard let image = CybaraBrand.logoImage?.copy() as? NSImage else { return nil }
        image.isTemplate = true
        return image
    }

    var body: some View {
        if let image = templateLogo {
            Image(nsImage: image)
                .renderingMode(.template)
                .accessibilityLabel("Cybara")
        } else {
            Image(systemName: "brain.head.profile")
                .accessibilityLabel("Cybara")
        }
    }
}

func nativeUsageMenuLabel(_ plan: ProviderPlanSnapshot) -> String {
    let name = nativeUsageMenuProviderName(plan.providerName)
    let fiveHour = nativeUsageWindowValue(plan, kind: "rolling_5h").text
    let weekly = nativeUsageWindowValue(plan, kind: "rolling_week").text
    return "\(name)  5h \(fiveHour) · Week \(weekly)"
}

func nativeUsageMenuProviderName(_ value: String) -> String {
    guard value.count > 15 else { return value }
    return String(value.prefix(15)) + "…"
}
