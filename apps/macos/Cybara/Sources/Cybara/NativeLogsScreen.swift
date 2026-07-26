import SwiftUI

struct LogsScreen: View {
    let client: GatewayClient
    @EnvironmentObject private var sidecar: SidecarManager

    @State private var logs: [GatewayLogEntry] = []
    @State private var totalLogs: Int?
    @State private var hasMore = false
    @State private var loaded = false
    @State private var loading = false
    @State private var live = true
    @State private var error: String?
    @State private var levelFilter = "all"
    @State private var sourceFilter = "all"
    @State private var searchText = ""

    private let logLimit = 200
    private let levelOptions = ["all", "info", "warn", "error"]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                ScreenHeader(title: "Logs", subtitle: "Gateway, native sidecar, and app events")
                Spacer()
                HStack(spacing: 8) {
                    if loading {
                        ProgressView().controlSize(.small)
                    }
                    Button {
                        live.toggle()
                    } label: {
                        Label(live ? "Pause" : "Live", systemImage: live ? "pause.fill" : "play.fill")
                    }
                    .buttonStyle(.bordered)
                    Button {
                        Task { await load() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(.bordered)
                    .help("Refresh")
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 24)
            .padding(.bottom, 12)

            if loaded && error == nil && !allLogEntries.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 8) { logStats }
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 108), spacing: 8)], spacing: 8) { logStats }
                    }

                    HStack(spacing: 10) {
                        Picker("Level", selection: $levelFilter) {
                            ForEach(levelOptions, id: \.self) { level in
                                Text(level == "all" ? "All Levels" : level.capitalized).tag(level)
                            }
                        }
                        .pickerStyle(.segmented)
                        .labelsHidden()
                        .frame(maxWidth: 330)

                        Picker("Source", selection: $sourceFilter) {
                            ForEach(sourceOptions, id: \.self) { source in
                                Text(source == "all" ? "All Sources" : source.capitalized).tag(source)
                            }
                        }
                        .pickerStyle(.menu)
                        .frame(maxWidth: 190)

                        searchField
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 12)
            }

            if !loaded {
                VStack(spacing: 12) {
                    ProgressView().controlSize(.large)
                    Text("Loading logs…")
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error, allLogEntries.isEmpty {
                LoadFailedView(message: error) { Task { await load() } }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Label(logSummary, systemImage: live ? "dot.radiowaves.left.and.right" : "pause.circle")
                                .font(.system(size: 12, weight: .semibold, design: .rounded))
                                .foregroundStyle(.secondary)
                            Spacer()
                            Text(hasMore ? "Newest \(logLimit) gateway entries" : "Newest first")
                                .font(.system(size: 11, weight: .medium, design: .rounded))
                                .foregroundStyle(.tertiary)
                        }

                        if let error {
                            Label(error, systemImage: "exclamationmark.triangle")
                                .font(.system(size: 12, design: .rounded))
                                .foregroundStyle(.orange)
                        }

                        NativeLogTimeline(
                            entries: filteredLogs,
                            emptyMessage: "No entries match the current filter."
                        )
                    }
                    .padding(16)
                }
                .cybaraGlass(cornerRadius: 18)
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
            }
        }
        .task {
            if !loaded {
                await load()
            }
        }
        .task(id: live) {
            guard live else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                await load(silent: true)
            }
        }
    }

    @ViewBuilder
    private var logStats: some View {
        NativeLogStatPill(label: "Info", value: logCount("info"), tint: .gray)
        NativeLogStatPill(label: "Warnings", value: logCount("warn"), tint: .orange)
        NativeLogStatPill(label: "Errors", value: logCount("error"), tint: .red)
        NativeLogStatPill(label: "Sidecar", value: allLogEntries.filter { $0.sourceKey == "sidecar" }.count, tint: .blue)
    }

    private var searchField: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
            TextField("Search logs", text: $searchText)
                .textFieldStyle(.plain)
                .font(.system(size: 12, design: .rounded))
            if !searchText.isEmpty {
                Button {
                    searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.borderless)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(Color.primary.opacity(0.055))
        )
    }

    private var allLogEntries: [NativeLogEntryDisplay] {
        nativeLogEntries(gatewayLogs: logs, sidecarLogs: sidecar.logs)
    }

    private var sourceOptions: [String] {
        let sources = Set(allLogEntries.map(\.sourceKey)).sorted()
        let preferred = ["gateway", "sidecar"].filter { sources.contains($0) }
        return ["all"] + preferred + sources.filter { !preferred.contains($0) }
    }

    private var filteredLogs: [NativeLogEntryDisplay] {
        filterNativeLogs(
            allLogEntries,
            levelFilter: levelFilter,
            sourceFilter: sourceFilter,
            query: searchText
        )
    }

    private var logSummary: String {
        let visible = filteredLogs.count
        let loadedCount = allLogEntries.count
        if visible != loadedCount { return "\(visible) of \(loadedCount) shown" }
        guard let totalLogs else { return "\(visible) recent events" }
        let total = totalLogs + sidecar.logs.count
        return visible == total ? "\(visible) events" : "\(visible) of \(total) events"
    }

    private func logCount(_ level: String) -> Int {
        allLogEntries.filter { $0.levelKey == level }.count
    }

    private func load(silent: Bool = false) async {
        if loading { return }
        if !silent {
            loading = true
        }
        do {
            let page = try await client.systemLogsPage(limit: logLimit)
            logs = page.logs
            totalLogs = page.total
            hasMore = page.hasMore ?? false
            if !sourceOptions.contains(sourceFilter) {
                sourceFilter = "all"
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
        loading = false
    }
}

