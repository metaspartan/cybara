import AppKit
import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var sidecar: SidecarManager
    @Environment(\.openURL) private var openURL

    var body: some View {
        NavigationSplitView {
            sidebar
                .navigationSplitViewColumnWidth(min: 280, ideal: 320, max: 380)
        } detail: {
            detail
        }
        .background(
            VisualEffectBackground()
                .overlay(
                    LinearGradient(
                        colors: [
                            Color(red: 0.05, green: 0.08, blue: 0.16).opacity(0.72),
                            Color(red: 0.02, green: 0.05, blue: 0.10).opacity(0.72),
                            Color(red: 0.02, green: 0.10, blue: 0.18).opacity(0.72),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .ignoresSafeArea()
        )
        .onReceive(NotificationCenter.default.publisher(for: .cybaraRestartSidecar)) { _ in
            Task { await sidecar.restart() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .cybaraOpenInBrowser)) { _ in
            openURL(sidecar.serverURL)
        }
        .onReceive(NotificationCenter.default.publisher(for: .cybaraCopyURL)) { _ in
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(sidecar.serverURL.absoluteString, forType: .string)
        }
        .onOpenURL { url in
            switch SidecarCore.parseDeepLink(url) {
            case .focus:
                NSApplication.shared.activate(ignoringOtherApps: true)
            case .restart:
                Task { await sidecar.restart() }
            case .openBrowser:
                openURL(sidecar.serverURL)
            case .none:
                break
            }
        }
        .background(
            WindowAccessor { window in
                window.setFrameAutosaveName("CybaraMainWindow")
            }
        )
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 10) {
                Text("Cybara")
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                Text("SwiftUI shell for the local Cybara sidecar and web runtime.")
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(.secondary)
            }

            GlassCard {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        StatusPill(status: sidecar.status)
                        Spacer()
                        Text(sidecar.serverURL.absoluteString)
                            .font(.system(size: 12, weight: .medium, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Label(sidecar.binaryPath, systemImage: "shippingbox")
                            .font(.system(size: 12, weight: .medium, design: .monospaced))
                            .lineLimit(2)
                        Label(sidecar.managesGateway ? "Managed gateway" : "Attached gateway", systemImage: sidecar.managesGateway ? "server.rack" : "link")
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(.secondary)
                        Text(sidecar.statusMessage)
                            .font(.system(size: 13, weight: .regular, design: .rounded))
                            .foregroundStyle(.secondary)
                    }
                }
            }

            GlassCard {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Controls")
                        .font(.system(size: 16, weight: .semibold, design: .rounded))

                    HStack(spacing: 10) {
                        Button("Restart") {
                            Task {
                                await sidecar.restart()
                            }
                        }
                        .buttonStyle(.borderedProminent)

                        Button("Open Browser") {
                            openURL(sidecar.serverURL)
                        }
                        .buttonStyle(.bordered)
                    }

                    HStack(spacing: 10) {
                        Button("Copy URL") {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(sidecar.serverURL.absoluteString, forType: .string)
                        }
                        .buttonStyle(.bordered)

                        Button("Reveal Binary") {
                            sidecar.revealBinary()
                        }
                        .buttonStyle(.bordered)
                    }
                }
            }

            GlassCard {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Sidecar Logs")
                        .font(.system(size: 16, weight: .semibold, design: .rounded))

                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 8) {
                            ForEach(sidecar.logs.indices, id: \.self) { index in
                                Text(sidecar.logs[index])
                                    .font(.system(size: 11, weight: .regular, design: .monospaced))
                                    .textSelection(.enabled)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }
                    .frame(maxHeight: .infinity)
                }
            }

            Spacer(minLength: 0)
        }
        .padding(20)
    }

    private var detail: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .fill(.ultraThinMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: 28, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.10))
                )
                .padding(18)

            if sidecar.isReady {
                CybaraWebView(
                    url: sidecar.serverURL,
                    gatewayPort: sidecar.port,
                    managesGateway: sidecar.managesGateway
                )
                    .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                    .padding(28)
            } else {
                VStack(spacing: 14) {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .controlSize(.large)
                    Text(sidecar.statusMessage)
                        .font(.system(size: 15, weight: .medium, design: .rounded))
                    Text("The native shell waits for the same local HTTP API that Tauri uses.")
                        .font(.system(size: 13, weight: .regular, design: .rounded))
                        .foregroundStyle(.secondary)
                }
                .padding(32)
                .cybaraGlass(cornerRadius: 24)
            }
        }
        .padding(12)
    }
}

struct SettingsView: View {
    @EnvironmentObject private var sidecar: SidecarManager

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Cybara Settings")
                .font(.system(size: 22, weight: .bold, design: .rounded))

            Text("Set `CYBARA_NATIVE_SIDECAR_PATH` to point at a compiled Cybara binary or Tauri sidecar. Set `CYBARA_NATIVE_PORT` to override the local server port.")
                .font(.system(size: 13, weight: .regular, design: .rounded))
                .foregroundStyle(.secondary)

            Divider()

            LabeledContent("Binary") {
                Text(sidecar.binaryPath)
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .textSelection(.enabled)
            }

            LabeledContent("Server") {
                Text(sidecar.serverURL.absoluteString)
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .textSelection(.enabled)
            }

            LabeledContent("Gateway Mode") {
                Text(sidecar.managesGateway ? "Managed by app" : "Attached existing gateway")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
            }

            Spacer()
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(
            LinearGradient(
                colors: [
                    Color(red: 0.08, green: 0.10, blue: 0.18),
                    Color(red: 0.03, green: 0.06, blue: 0.14),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
        )
    }
}

private struct GlassCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.10))
            )
    }
}

private struct StatusPill: View {
    let status: SidecarManager.Status

    var body: some View {
        Label(status.title, systemImage: status.systemImage)
            .font(.system(size: 12, weight: .semibold, design: .rounded))
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(status.color.opacity(0.18), in: Capsule())
            .foregroundStyle(status.color)
    }
}
