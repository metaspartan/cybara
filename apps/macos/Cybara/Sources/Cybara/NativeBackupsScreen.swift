import SwiftUI

struct GatewaySystemBackup: Decodable, Identifiable, Hashable {
    let version: Int
    let id: String
    let label: String
    let createdAt: String
    let entries: [String]
    let includesCredentials: Bool
    let bytes: Int
}

struct GatewaySystemRestoreStatus: Decodable, Hashable {
    let state: String
    let backupId: String?
    let updatedAt: String?
    let error: String?
}

struct GatewaySystemBackupsResponse: Decodable {
    let backups: [GatewaySystemBackup]
    let backupDirectory: String
    let restore: GatewaySystemRestoreStatus
}

private struct GatewaySystemBackupCreateResponse: Decodable {
    let success: Bool
    let backup: GatewaySystemBackup?
    let error: String?
}

private struct GatewaySystemBackupActionResponse: Decodable {
    let success: Bool
    let error: String?
}

extension GatewayClient {
    func systemBackups() async throws -> GatewaySystemBackupsResponse {
        let data = try await request("api/system/backups")
        return try JSONDecoder().decode(GatewaySystemBackupsResponse.self, from: data)
    }

    func createSystemBackup(label: String) async throws -> GatewaySystemBackup {
        let body = try JSONSerialization.data(withJSONObject: ["label": label])
        let data = try await request("api/system/backups", method: "POST", body: body)
        let response = try JSONDecoder().decode(GatewaySystemBackupCreateResponse.self, from: data)
        guard response.success, let backup = response.backup else {
            throw GatewayClientError.badStatus(200, response.error ?? "Backup creation failed")
        }
        return backup
    }

    func restoreSystemBackup(_ backupID: String) async throws {
        let id = backupID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? backupID
        let data = try await request("api/system/backups/\(id)/restore", method: "POST")
        let response = try JSONDecoder().decode(GatewaySystemBackupActionResponse.self, from: data)
        guard response.success else {
            throw GatewayClientError.badStatus(200, response.error ?? "Backup restore failed")
        }
    }

    func deleteSystemBackup(_ backupID: String) async throws {
        let id = backupID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? backupID
        let data = try await request("api/system/backups/\(id)", method: "DELETE")
        let response = try JSONDecoder().decode(GatewaySystemBackupActionResponse.self, from: data)
        guard response.success else {
            throw GatewayClientError.badStatus(200, response.error ?? "Backup deletion failed")
        }
    }
}

struct NativeBackupsScreen: View {
    let client: GatewayClient

    @State private var backups: [GatewaySystemBackup] = []
    @State private var backupDirectory = ""
    @State private var restoreStatus = GatewaySystemRestoreStatus(
        state: "idle", backupId: nil, updatedAt: nil, error: nil)
    @State private var loading = true
    @State private var busy = false
    @State private var restoreCandidate: GatewaySystemBackup?
    @State private var deleteCandidate: GatewaySystemBackup?
    @State private var message: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: "externaldrive.badge.timemachine")
                                .font(.system(size: 22, weight: .semibold))
                                .foregroundStyle(.cyan)
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Backup & Restore")
                                    .font(.system(size: 17, weight: .bold, design: .rounded))
                                Text("Local snapshots of gateway settings, conversations, memory, skills, and credentials")
                                    .font(.system(size: 12, design: .rounded))
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button {
                                Task { await createBackup() }
                            } label: {
                                Label("Create Backup", systemImage: "plus.circle")
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(busy)
                        }

                        Label {
                            Text("Backups contain private gateway credentials and use owner-only permissions.")
                                .font(.system(size: 11, design: .rounded))
                        } icon: {
                            Image(systemName: "lock.shield")
                        }
                        .foregroundStyle(.orange)

                        if !backupDirectory.isEmpty {
                            Text(backupDirectory)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                        }
                    }
                }

                if let message {
                    Text(message)
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(restoreStatus.state == "failed" ? .red : .secondary)
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 0) {
                        if loading {
                            HStack {
                                Spacer()
                                ProgressView()
                                Spacer()
                            }
                            .padding(24)
                        } else if backups.isEmpty {
                            ContentUnavailableView(
                                "No Backups",
                                systemImage: "externaldrive",
                                description: Text("Create a restore point before upgrades or major configuration changes.")
                            )
                            .frame(maxWidth: .infinity, minHeight: 180)
                        } else {
                            ForEach(Array(backups.enumerated()), id: \.element.id) { index, backup in
                                backupRow(backup)
                                if index < backups.count - 1 { Divider().opacity(0.35) }
                            }
                        }
                    }
                }
            }
            .padding(EdgeInsets(top: 10, leading: 2, bottom: 16, trailing: 2))
            .frame(maxWidth: 900, alignment: .topLeading)
            .frame(maxWidth: .infinity, alignment: .top)
        }
        .task { await load() }
        .confirmationDialog(
            "Restore System Backup?",
            isPresented: Binding(
                get: { restoreCandidate != nil },
                set: { if !$0 { restoreCandidate = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Restore & Restart", role: .destructive) {
                guard let backup = restoreCandidate else { return }
                Task { await restore(backup) }
            }
            Button("Cancel", role: .cancel) { restoreCandidate = nil }
        } message: {
            Text("Durable gateway data will be replaced by this snapshot. Current logs and caches are preserved.")
        }
        .confirmationDialog(
            "Delete Backup?",
            isPresented: Binding(
                get: { deleteCandidate != nil },
                set: { if !$0 { deleteCandidate = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                guard let backup = deleteCandidate else { return }
                Task { await delete(backup) }
            }
            Button("Cancel", role: .cancel) { deleteCandidate = nil }
        }
    }

    private func backupRow(_ backup: GatewaySystemBackup) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "externaldrive.fill")
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 3) {
                Text(backup.label)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .lineLimit(1)
                Text("\(formattedDate(backup.createdAt)) · \(ByteCountFormatter.string(fromByteCount: Int64(backup.bytes), countStyle: .file)) · \(backup.entries.count) data groups")
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button {
                restoreCandidate = backup
            } label: {
                Label("Restore", systemImage: "arrow.counterclockwise")
            }
            .buttonStyle(.borderless)
            .disabled(busy)
            Button(role: .destructive) {
                deleteCandidate = backup
            } label: {
                Image(systemName: "trash")
            }
            .buttonStyle(.borderless)
            .disabled(busy)
        }
        .padding(.vertical, 10)
    }

    private func formattedDate(_ value: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: value) else { return value }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    @MainActor
    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let response = try await client.systemBackups()
            backups = response.backups
            backupDirectory = response.backupDirectory
            restoreStatus = response.restore
            message = response.restore.state == "failed" ? response.restore.error : nil
        } catch {
            message = error.localizedDescription
        }
    }

    @MainActor
    private func createBackup() async {
        busy = true
        defer { busy = false }
        do {
            _ = try await client.createSystemBackup(label: "Manual backup \(Date().formatted(date: .abbreviated, time: .shortened))")
            message = "Backup created"
            await load()
        } catch {
            message = error.localizedDescription
        }
    }

    @MainActor
    private func restore(_ backup: GatewaySystemBackup) async {
        busy = true
        restoreCandidate = nil
        defer { busy = false }
        do {
            try await client.restoreSystemBackup(backup.id)
            message = "Restoring backup and restarting the gateway"
            _ = try await client.restartGateway()
        } catch {
            message = error.localizedDescription
        }
    }

    @MainActor
    private func delete(_ backup: GatewaySystemBackup) async {
        busy = true
        deleteCandidate = nil
        defer { busy = false }
        do {
            try await client.deleteSystemBackup(backup.id)
            message = "Backup deleted"
            await load()
        } catch {
            message = error.localizedDescription
        }
    }
}
