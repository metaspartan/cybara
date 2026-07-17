import SwiftUI

struct SessionsManagementScreen: View {
    let client: GatewayClient
    let openChat: (GatewaySession) -> Void

    @State private var sessions: [GatewaySession] = []
    @State private var query = ""
    @State private var loaded = false
    @State private var error: String?
    @State private var renaming: GatewaySession?
    @State private var renameDraft = ""

    private var filtered: [GatewaySession] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let sorted = sessions.sorted { ($0.pinned == true ? 0 : 1, $0.updated_at ?? "") < ($1.pinned == true ? 0 : 1, $1.updated_at ?? "") }
        guard !trimmed.isEmpty else { return sorted }
        return sorted.filter {
            $0.displayTitle.lowercased().contains(trimmed)
                || ($0.workspace_dir?.lowercased().contains(trimmed) ?? false)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                ScreenHeader(title: "Sessions", subtitle: "\(sessions.count) chats")
                TextField("Search sessions", text: $query)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 240)
                Button {
                    Task { await load() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
            }
            .padding(24)

            if !loaded {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error {
                LoadFailedView(message: error) { Task { await load() } }
            } else {
                List(filtered) { session in
                    HStack {
                        Button {
                            openChat(session)
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(session.displayTitle)
                                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                                    .lineLimit(1)
                                Text(session.routeSummary())
                                    .font(.system(size: 11, design: .rounded))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                        .buttonStyle(.plain)
                        Spacer()
                        Text(compactRelativeTimestamp(session.updated_at))
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                        Button {
                            Task { await pin(session) }
                        } label: {
                            Image(systemName: session.pinned == true ? "pin.fill" : "pin")
                        }
                        .buttonStyle(.borderless)
                        Button {
                            renaming = session
                            renameDraft = session.displayTitle
                        } label: {
                            Image(systemName: "pencil")
                        }
                        .buttonStyle(.borderless)
                        Button(role: .destructive) {
                            Task { await delete(session) }
                        } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(.borderless)
                    }
                    .padding(.vertical, 6)
                }
                .listStyle(.inset)
            }
        }
        .task { await load() }
        .sheet(item: $renaming) { session in
            VStack(alignment: .leading, spacing: 14) {
                ScreenHeader(title: "Rename Chat", subtitle: session.id)
                TextField("Title", text: $renameDraft)
                    .textFieldStyle(.roundedBorder)
                HStack {
                    Spacer()
                    Button("Cancel") { renaming = nil }
                    Button("Save") {
                        Task { await rename(session) }
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .padding(24)
            .frame(width: 440)
        }
    }

    private func load() async {
        do {
            sessions = try await client.sessions(limit: 500)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }

    private func pin(_ session: GatewaySession) async {
        do {
            try await client.pinSession(session.id, pinned: !(session.pinned == true))
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func rename(_ session: GatewaySession) async {
        do {
            try await client.renameSession(session.id, title: renameDraft)
            renaming = nil
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func delete(_ session: GatewaySession) async {
        do {
            try await client.deleteSession(session.id)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
