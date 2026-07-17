import SwiftUI

struct LSPScreen: View {
    let client: GatewayClient
    @State private var status: NativeLSPStatus?
    @State private var languages: [NativeLSPLanguage] = []
    @State private var installStatus: [NativeLSPInstallStatus] = []
    @State private var loaded = false
    @State private var busyLanguage: String?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    ScreenHeader(title: "LSP", subtitle: status?.workspace ?? "Language server status")
                    Button {
                        Task { await load() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(.bordered)
                }

                if !loaded {
                    ProgressView().frame(maxWidth: .infinity)
                } else if let error {
                    LoadFailedView(message: error) { Task { await load() } }
                } else {
                    GlassCard {
                        VStack(alignment: .leading, spacing: 10) {
                            NativeMetricGrid(rows: [
                                ("Status", status?.status ?? "unknown"),
                                ("Diagnostics", "\(status?.diagnosticsCount ?? 0)"),
                                ("Languages", "\(languages.count)"),
                                ("Active", "\(activeServers.count)"),
                            ])
                            if !activeServers.isEmpty {
                                Divider()
                                ForEach(activeServers) { server in
                                    HStack(spacing: 8) {
                                        Circle()
                                            .fill(.green)
                                            .frame(width: 6, height: 6)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(server.name)
                                                .font(.system(size: 12, weight: .semibold, design: .rounded))
                                            Text(server.command)
                                                .font(.system(size: 10, design: .monospaced))
                                                .foregroundStyle(.secondary)
                                                .lineLimit(1)
                                        }
                                    }
                                }
                            }
                        }
                    }

                    LazyVStack(spacing: 10) {
                        ForEach(languages) { language in
                            let installed = installStatus.first { $0.language == language.name }
                            let included = language.bundled || installed?.preinstalled == true
                            GlassCard {
                                HStack(alignment: .center) {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(language.name)
                                            .font(.system(size: 14, weight: .bold, design: .rounded))
                                        Text(lspDetail(language, installed))
                                            .font(.system(size: 11, design: .rounded))
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    StatusBadge(
                                        label: included ? "Included" : language.available ? "Available" : "Missing",
                                        color: included || language.available ? .green : .orange
                                    )
                                    if included {
                                        EmptyView()
                                    } else if busyLanguage == language.name {
                                        HStack(spacing: 5) {
                                            ProgressView().controlSize(.small)
                                            Text(installed?.installed == true ? "Removing..." : "Installing...")
                                                .font(.system(size: 11, weight: .medium, design: .rounded))
                                                .foregroundStyle(.secondary)
                                        }
                                    } else {
                                        Button(installed?.installed == true ? "Uninstall" : "Install") {
                                            Task { await toggle(language) }
                                        }
                                        .buttonStyle(.bordered)
                                        .controlSize(.small)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .padding(24)
        }
        .task { await load() }
    }

    private var activeServers: [NativeActiveLSPServer] {
        (status?.active ?? []).filter(\.initialized)
    }

    private func lspDetail(_ language: NativeLSPLanguage, _ installed: NativeLSPInstallStatus?) -> String {
        [
            language.bundled || installed?.preinstalled == true ? "included" : "external",
            installed?.version,
            installed?.path,
            installed?.error,
        ]
        .compactMap { firstNonEmptyGatewayString($0) }
        .joined(separator: " · ")
    }

    private func load() async {
        do {
            async let statusResult = client.lspStatus()
            async let languagesResult = client.lspLanguages()
            async let installResult = client.lspInstallStatus()
            status = try await statusResult
            languages = try await languagesResult
            installStatus = try await installResult.status
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }

    private func toggle(_ language: NativeLSPLanguage) async {
        let installed = installStatus.first { $0.language == language.name }
        if language.bundled || installed?.preinstalled == true { return }
        busyLanguage = language.name
        do {
            let result = installed?.installed == true
                ? try await client.uninstallLSP(language.name)
                : try await client.installLSP(language.name)
            if result.success == false {
                error = result.error ?? "LSP operation failed."
            }
            await load()
        } catch {
            self.error = error.localizedDescription
        }
        busyLanguage = nil
    }
}
