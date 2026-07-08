import AppKit
import SwiftUI

struct NativeSkillsScreen: View {
    let client: GatewayClient

    @Environment(\.cybaraAccent) private var accentTint

    @State private var selectedTab = "installed"
    @State private var skills: [GatewaySkillStatus] = []
    @State private var summary: GatewaySkillsStatusSummary?
    @State private var registry: GatewaySkillsRegistryResponse?
    @State private var search = ""
    @State private var sourceFilter = "all"
    @State private var registryMode = "browse"
    @State private var registryQuery = ""
    @State private var registryFilter = "all"
    @State private var registrySort = "downloads"
    @State private var loaded = false
    @State private var registryLoaded = false
    @State private var error: String?
    @State private var actionError: String?
    @State private var busyID: String?
    @State private var updatingAll = false
    @State private var showingAddSkill = false
    @State private var selectedSkill: GatewaySkillStatus?
    @State private var pendingDelete: GatewaySkillStatus?
    @State private var suspiciousInstall: GatewayRegistrySkill?
    @State private var confirmingSuspicious = false

    private var filteredSkills: [GatewaySkillStatus] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return skills.filter { skill in
            let matchesSource = sourceFilter == "all" || skill.source == sourceFilter
            guard matchesSource else { return false }
            guard !query.isEmpty else { return true }
            return [
                skill.name,
                skill.description,
                skill.location,
                skill.source,
            ].joined(separator: " ").lowercased().contains(query)
        }
    }

    private var registrySkills: [GatewayRegistrySkill] {
        registry?.skills ?? []
    }

    private var availableRegistries: [String] {
        let values = registry?.registries ?? registrySkills.map(\.registry)
        return Array(Set(values)).sorted { formatSkillRegistryName($0) < formatSkillRegistryName($1) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header

            Picker("Skills view", selection: $selectedTab) {
                Label("Installed", systemImage: "wand.and.stars").tag("installed")
                Label("Registry", systemImage: "shippingbox").tag("registry")
            }
            .pickerStyle(.segmented)
            .frame(width: 260)
            .padding(.horizontal, 24)
            .padding(.bottom, 14)

            if let actionError {
                Text(actionError)
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(.red)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 8)
            }

            if selectedTab == "installed" {
                installedBody
            } else {
                registryBody
            }
        }
        .task { await loadInstalled() }
        .onChange(of: selectedTab) { _, next in
            if next == "registry", !registryLoaded {
                Task { await loadRegistry() }
            }
        }
        .sheet(isPresented: $showingAddSkill) {
            NativeAddSkillSheet { draft in
                try await createSkill(draft)
            }
            .frame(minWidth: 560, idealWidth: 620, minHeight: 640)
        }
        .sheet(item: $selectedSkill) { skill in
            NativeSkillDetailSheet(skill: skill) {
                pendingDelete = skill
            }
            .frame(minWidth: 520, idealWidth: 580, minHeight: 560)
        }
        .confirmationDialog(
            "Delete this skill?",
            isPresented: Binding(
                get: { pendingDelete != nil },
                set: { if !$0 { pendingDelete = nil } }
            ),
            presenting: pendingDelete
        ) { skill in
            Button("Delete \(skill.name)", role: .destructive) {
                Task { await delete(skill) }
            }
            Button("Cancel", role: .cancel) { pendingDelete = nil }
        } message: { skill in
            Text("Removes \(skill.name) from local Cybara skills. Bundled skills remain available.")
        }
        .confirmationDialog(
            "Install suspicious skill?",
            isPresented: Binding(
                get: { suspiciousInstall != nil },
                set: { if !$0 { suspiciousInstall = nil } }
            ),
            presenting: suspiciousInstall
        ) { skill in
            Button("Install Anyway", role: .destructive) {
                Task { await install(skill, allowSuspicious: true) }
            }
            Button("Cancel", role: .cancel) { suspiciousInstall = nil }
        } message: { skill in
            Text("\(skill.name) was flagged by the registry. Install only if you trust the source.")
        }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            ScreenHeader(title: "Skills", subtitle: "\(skills.count) skills available to agents")
            Spacer()
            Button {
                showingAddSkill = true
            } label: {
                Label("Add Skill", systemImage: "plus")
            }
            .buttonStyle(.borderedProminent)

            Button {
                Task { await updateAll() }
            } label: {
                if updatingAll {
                    ProgressView().controlSize(.small)
                } else {
                    Label("Update", systemImage: "arrow.triangle.2.circlepath")
                }
            }
            .buttonStyle(.bordered)
            .disabled(updatingAll || busyID != nil)
            .help("Update installed skills from their registries")

            Button {
                Task {
                    await loadInstalled()
                    if selectedTab == "registry" { await loadRegistry() }
                }
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(.bordered)
            .help("Refresh skills")
        }
        .padding(.horizontal, 24)
        .padding(.top, 24)
        .padding(.bottom, 12)
    }

    @ViewBuilder
    private var installedBody: some View {
        if !loaded {
            NativeSkillsLoadingSkeleton()
        } else if let error {
            LoadFailedView(message: error) { Task { await loadInstalled() } }
                .padding(24)
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    skillSummaryRow
                    installedFilters

                    if filteredSkills.isEmpty {
                        NativeSkillsEmptyState(
                            title: skills.isEmpty ? "No skills installed" : "No matching skills",
                            detail: "Add a local skill or browse the registry for more agent capabilities."
                        )
                    } else {
                        LazyVStack(spacing: 10) {
                            ForEach(filteredSkills) { skill in
                                NativeSkillRow(
                                    skill: skill,
                                    busy: busyID == skill.id,
                                    accentTint: accentTint,
                                    onSelect: { selectedSkill = skill },
                                    onDelete: canDelete(skill) ? { pendingDelete = skill } : nil
                                )
                            }
                        }
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
            }
        }
    }

    private var skillSummaryRow: some View {
        let currentSummary = summary ?? GatewaySkillsStatusSummary(
            total: skills.count,
            eligible: skills.filter(\.eligible).count,
            disabled: skills.filter(\.disabled).count,
            blocked: skills.filter { !$0.eligible && !$0.disabled }.count
        )
        return HStack(spacing: 10) {
            NativeSkillStatPill(label: "Total", value: currentSummary.total, tint: .secondary, icon: "square.grid.2x2")
            NativeSkillStatPill(label: "Ready", value: currentSummary.eligible, tint: .green, icon: "checkmark.circle")
            NativeSkillStatPill(label: "Blocked", value: currentSummary.blocked, tint: .orange, icon: "exclamationmark.triangle")
            NativeSkillStatPill(label: "Disabled", value: currentSummary.disabled, tint: .secondary, icon: "pause.circle")
        }
    }

    private var installedFilters: some View {
        HStack(spacing: 12) {
            TextField("Search installed skills", text: $search)
                .textFieldStyle(.roundedBorder)
                .frame(maxWidth: 360)

            Picker("Source", selection: $sourceFilter) {
                Text("All").tag("all")
                Text("Workspace").tag("workspace")
                Text("Local").tag("local")
                Text("Bundled").tag("bundled")
            }
            .pickerStyle(.segmented)
            .frame(width: 360)

            Spacer()
        }
    }

    @ViewBuilder
    private var registryBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                registryControls

                if !registryLoaded {
                    NativeSkillsLoadingSkeleton()
                        .padding(.top, 4)
                } else if let error {
                    LoadFailedView(message: error) { Task { await loadRegistry() } }
                } else if registrySkills.isEmpty {
                    NativeSkillsEmptyState(
                        title: registryMode == "search" && registryQuery.isEmpty ? "Search for a skill" : "No registry skills found",
                        detail: "Browse popular skills or search registries for a specific workflow."
                    )
                } else {
                    LazyVStack(spacing: 10) {
                        ForEach(registrySkills) { skill in
                            NativeRegistrySkillRow(
                                skill: skill,
                                installed: installedMatch(for: skill),
                                busy: busyID == skill.id,
                                onInstall: { await install(skill, allowSuspicious: false) }
                            )
                        }
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
    }

    private var registryControls: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Picker("Registry mode", selection: $registryMode) {
                    Text("Browse").tag("browse")
                    Text("Search").tag("search")
                }
                .pickerStyle(.segmented)
                .frame(width: 220)
                .onChange(of: registryMode) { _, _ in Task { await loadRegistry() } }

                if registryMode == "search" {
                    TextField("Search registries", text: $registryQuery)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit { Task { await loadRegistry() } }
                }

                Button {
                    Task { await loadRegistry() }
                } label: {
                    Label(registryMode == "search" ? "Search" : "Reload", systemImage: "magnifyingglass")
                }
                .buttonStyle(.bordered)
                .disabled(registryMode == "search" && registryQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }

            HStack(spacing: 10) {
                Picker("Sort", selection: $registrySort) {
                    Text("Downloads").tag("downloads")
                    Text("Trending").tag("trending")
                    Text("Stars").tag("stars")
                    Text("Updated").tag("updated")
                    Text("Current Installs").tag("installsCurrent")
                    Text("All-Time Installs").tag("installsAllTime")
                }
                .frame(width: 190)
                .onChange(of: registrySort) { _, _ in Task { await loadRegistry() } }

                Picker("Registry", selection: $registryFilter) {
                    Text("All Registries").tag("all")
                    ForEach(availableRegistries, id: \.self) { registry in
                        Text(formatSkillRegistryName(registry)).tag(registry)
                    }
                }
                .frame(width: 190)
                .onChange(of: registryFilter) { _, _ in Task { await loadRegistry() } }

                if let count = registry?.skills.count {
                    Text("\(count) shown")
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(14)
        .cybaraGlass(cornerRadius: 16)
    }

    private func loadInstalled() async {
        do {
            let response = try await client.skillsStatus()
            skills = response.skills.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            summary = response.summary
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }

    private func loadRegistry() async {
        registryLoaded = false
        do {
            let selectedRegistry = registryFilter == "all" ? nil : registryFilter
            if registryMode == "search" {
                let query = registryQuery.trimmingCharacters(in: .whitespacesAndNewlines)
                registry = query.isEmpty
                    ? GatewaySkillsRegistryResponse(skills: [], registries: availableRegistries, counts: [:])
                    : try await client.skillsRegistrySearch(
                        query: query,
                        registry: selectedRegistry,
                        sort: registrySort,
                        maxPages: registrySort == "updated" ? 2 : 1
                    )
            } else {
                registry = try await client.skillsRegistryBrowse(
                    registry: selectedRegistry,
                    sort: registrySort,
                    maxPages: registrySort == "updated" ? 2 : 1
                )
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        registryLoaded = true
    }

    private func createSkill(_ draft: NativeSkillDraft) async throws {
        _ = try await client.createSkill(
            name: draft.name,
            category: draft.category,
            description: draft.description,
            content: draft.content
        )
        await loadInstalled()
    }

    private func delete(_ skill: GatewaySkillStatus) async {
        pendingDelete = nil
        busyID = skill.id
        actionError = nil
        do {
            try await client.deleteSkill(skill.name)
            await loadInstalled()
        } catch {
            actionError = error.localizedDescription
        }
        busyID = nil
    }

    private func updateAll() async {
        guard !updatingAll else { return }
        updatingAll = true
        actionError = nil
        do {
            try await client.updateSkills()
            await loadInstalled()
        } catch {
            actionError = error.localizedDescription
        }
        updatingAll = false
    }

    private func install(_ skill: GatewayRegistrySkill, allowSuspicious: Bool) async {
        if allowSuspicious {
            confirmingSuspicious = true
        }
        suspiciousInstall = nil
        busyID = skill.id
        actionError = nil
        do {
            let result = try await client.installSkill(
                slug: skill.slug,
                registry: skill.registry,
                allowSuspicious: allowSuspicious
            )
            if result.success {
                await loadInstalled()
                await loadRegistry()
            } else if result.blockedReason == "suspicious" && result.requiresConfirmation == true {
                suspiciousInstall = skill
            } else {
                actionError = result.error ?? "Failed to install \(skill.name)."
            }
        } catch {
            actionError = error.localizedDescription
        }
        busyID = nil
        confirmingSuspicious = false
    }

    private func installedMatch(for registrySkill: GatewayRegistrySkill) -> GatewaySkillStatus? {
        let candidates = [
            normalizeNativeSkillKey(registrySkill.slug),
            normalizeNativeSkillKey(registrySkill.name),
        ]
        return skills.first { skill in
            let name = normalizeNativeSkillKey(skill.name)
            let leaf = normalizeNativeSkillKey(URL(fileURLWithPath: skill.location).deletingPathExtension().lastPathComponent)
            return candidates.contains(name) || candidates.contains(leaf)
        }
    }

    private func canDelete(_ skill: GatewaySkillStatus) -> Bool {
        skill.source == "local" || skill.location.contains(".cybara/skills")
    }
}

private struct NativeSkillDraft {
    let name: String
    let category: String
    let description: String
    let content: String
}

private struct NativeSkillStatPill: View {
    let label: String
    let value: Int
    let tint: Color
    let icon: String

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: icon)
                .foregroundStyle(tint)
            Text("\(value)")
                .font(.system(size: 13, weight: .bold, design: .rounded))
            Text(label)
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.white.opacity(0.055))
        )
    }
}

private struct NativeSkillRow: View {
    let skill: GatewaySkillStatus
    let busy: Bool
    let accentTint: Color
    let onSelect: () -> Void
    let onDelete: (() -> Void)?

    var body: some View {
        Button(action: onSelect) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: skillStatusIcon(skill))
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(skillStatusTint(skill, accentTint: accentTint))
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(Color.white.opacity(0.06)))

                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 8) {
                        Text(skill.name)
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                            .lineLimit(1)
                        NativeSkillStatusBadge(skill: skill, accentTint: accentTint)
                        NativeSkillSourceBadge(source: skill.source)
                    }
                    Text(skill.description)
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                    Text(skill.location)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.secondary.opacity(0.8))
                        .lineLimit(1)
                }

                Spacer(minLength: 10)

                if busy {
                    ProgressView().controlSize(.small)
                }

                if let onDelete {
                    Button(role: .destructive, action: onDelete) {
                        Image(systemName: "trash")
                    }
                    .buttonStyle(.borderless)
                    .help("Delete local skill")
                }

                Image(systemName: "chevron.right")
                    .foregroundStyle(.secondary)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .cybaraGlass(cornerRadius: 14)
        }
        .buttonStyle(.plain)
    }
}

private struct NativeRegistrySkillRow: View {
    let skill: GatewayRegistrySkill
    let installed: GatewaySkillStatus?
    let busy: Bool
    let onInstall: () async -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: installed == nil ? "shippingbox" : "checkmark.seal")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(installed == nil ? Color.secondary : Color.green)
                .frame(width: 34, height: 34)
                .background(Circle().fill(Color.white.opacity(0.06)))

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    Text(skill.name)
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .lineLimit(1)
                    NativeRegistryBadge(text: formatSkillRegistryName(skill.registry))
                    if let installed {
                        NativeRegistryBadge(text: "Installed \(formatSkillSource(installed.source))", tint: .green)
                    }
                }
                Text("/\(skill.slug)")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Text(skill.description)
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                HStack(spacing: 14) {
                    if let author = skill.author {
                        Label(author, systemImage: "person")
                    }
                    if let downloads = skill.downloads {
                        Label(downloads.formatted(), systemImage: "arrow.down.circle")
                    }
                    if let stars = skill.stars {
                        Label(stars.formatted(), systemImage: "star")
                    }
                    if let updated = formatSkillUpdatedAt(skill.updatedAt) {
                        Label(updated, systemImage: "calendar")
                    }
                }
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(.secondary)
            }

            Spacer(minLength: 12)

            Button {
                Task { await onInstall() }
            } label: {
                if busy {
                    ProgressView().controlSize(.small)
                } else {
                    Label(installed == nil ? "Install" : "Reinstall", systemImage: "arrow.down.circle")
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(busy)
        }
        .padding(14)
        .cybaraGlass(cornerRadius: 14)
    }
}

private struct NativeSkillStatusBadge: View {
    let skill: GatewaySkillStatus
    let accentTint: Color

    var body: some View {
        Text(skillStatusTitle(skill))
            .font(.system(size: 10, weight: .bold, design: .rounded))
            .foregroundStyle(skillStatusTint(skill, accentTint: accentTint))
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(Capsule().fill(skillStatusTint(skill, accentTint: accentTint).opacity(0.13)))
    }
}

private struct NativeSkillSourceBadge: View {
    let source: String

    var body: some View {
        NativeRegistryBadge(text: formatSkillSource(source))
    }
}

private struct NativeRegistryBadge: View {
    let text: String
    var tint: Color = .secondary

    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .semibold, design: .rounded))
            .foregroundStyle(tint)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(Capsule().fill(Color.white.opacity(0.07)))
    }
}

private struct NativeSkillDetailSheet: View {
    let skill: GatewaySkillStatus
    let onDelete: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.cybaraAccent) private var accentTint

    private var missingRequirements: [(String, [String])] {
        [
            ("Missing binaries", skill.missing.bins),
            ("Need one binary", skill.missing.anyBins),
            ("Missing environment", skill.missing.env),
            ("Need one environment variable", skill.missing.anyEnv),
            ("Missing config", skill.missing.config),
            ("Requires OS", skill.missing.os),
        ].filter { !$0.1.isEmpty }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                ScreenHeader(title: skill.name, subtitle: formatSkillSource(skill.source))
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                }
                .buttonStyle(.borderless)
                .foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    NativeSkillStatusBadge(skill: skill, accentTint: accentTint)
                    NativeSkillSourceBadge(source: skill.source)
                    if skill.blockedByAllowlist {
                        NativeRegistryBadge(text: "Allowlist blocked", tint: .orange)
                    }
                }

                Text(skill.description)
                    .font(.system(size: 13, design: .rounded))
                    .foregroundStyle(.primary)

                Divider()

                if missingRequirements.isEmpty {
                    Label("All requirements are satisfied", systemImage: "checkmark.circle")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(.green)
                } else {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Missing Requirements")
                            .font(.system(size: 13, weight: .bold, design: .rounded))
                        ForEach(missingRequirements, id: \.0) { label, values in
                            HStack(alignment: .top, spacing: 8) {
                                Image(systemName: "exclamationmark.triangle")
                                    .foregroundStyle(.orange)
                                Text("\(label): \(values.joined(separator: ", "))")
                                    .font(.system(size: 12, design: .rounded))
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                if !skill.install.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Install Commands")
                            .font(.system(size: 13, weight: .bold, design: .rounded))
                        ForEach(skill.install) { item in
                            HStack {
                                Text(item.command)
                                    .font(.system(size: 12, design: .monospaced))
                                    .lineLimit(1)
                                Spacer()
                                Button("Copy") {
                                    NSPasteboard.general.clearContents()
                                    NSPasteboard.general.setString(item.command, forType: .string)
                                }
                                .buttonStyle(.bordered)
                                .controlSize(.small)
                            }
                            .padding(10)
                            .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.055)))
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("Location")
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                    HStack {
                        Text(skill.location)
                            .font(.system(size: 12, design: .monospaced))
                            .lineLimit(1)
                        Spacer()
                        Button("Copy Path") {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(skill.location, forType: .string)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                }
            }
            .padding(16)
            .cybaraGlass(cornerRadius: 18)

            HStack {
                if skill.source == "local" || skill.location.contains(".cybara/skills") {
                    Button(role: .destructive) {
                        dismiss()
                        onDelete()
                    } label: {
                        Label("Delete Skill", systemImage: "trash")
                    }
                    .buttonStyle(.bordered)
                }
                Spacer()
                Button("Done") { dismiss() }
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(24)
    }
}

private struct NativeAddSkillSheet: View {
    let onSave: (NativeSkillDraft) async throws -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var category = "custom"
    @State private var description = ""
    @State private var content = ""
    @State private var saving = false
    @State private var error: String?

    private var canSave: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !saving
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                ScreenHeader(title: "Add Skill", subtitle: "Create a local SKILL.md for this gateway")
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                }
                .buttonStyle(.borderless)
                .foregroundStyle(.secondary)
            }

            if let error {
                Text(error)
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(.red)
            }

            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 12) {
                GridRow {
                    Text("Name")
                    TextField("weather-helper", text: $name)
                }
                GridRow {
                    Text("Category")
                    TextField("development", text: $category)
                }
                GridRow {
                    Text("Description")
                    TextField("What this skill helps agents do", text: $description)
                }
            }
            .font(.system(size: 13, design: .rounded))

            Text("SKILL.md Content")
                .font(.system(size: 13, weight: .bold, design: .rounded))
            TextEditor(text: $content)
                .font(.system(size: 12, design: .monospaced))
                .scrollContentBackground(.hidden)
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.055)))

            HStack {
                Button("Use Template") {
                    content = defaultSkillContent()
                }
                .buttonStyle(.bordered)
                Spacer()
                Button("Cancel") { dismiss() }
                    .buttonStyle(.bordered)
                Button {
                    Task { await save() }
                } label: {
                    if saving {
                        ProgressView().controlSize(.small)
                    } else {
                        Label("Add Skill", systemImage: "checkmark")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!canSave)
            }
        }
        .padding(24)
    }

    private func save() async {
        saving = true
        error = nil
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? defaultSkillContent()
            : content
        do {
            try await onSave(
                NativeSkillDraft(
                    name: trimmedName,
                    category: firstNonEmptyGatewayString(category) ?? "custom",
                    description: description,
                    content: body
                )
            )
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }

    private func defaultSkillContent() -> String {
        let title = firstNonEmptyGatewayString(name) ?? "New Skill"
        let summary = firstNonEmptyGatewayString(description) ?? "Describe what this skill helps agents do."
        return "# \(title)\n\n\(summary)\n\n## Usage\n\nDescribe when the agent should use this skill.\n"
    }
}

private struct NativeSkillsLoadingSkeleton: View {
    var body: some View {
        VStack(spacing: 10) {
            ForEach(0 ..< 5, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color.white.opacity(0.055))
                    .frame(height: 78)
                    .redacted(reason: .placeholder)
            }
        }
        .padding(24)
    }
}

private struct NativeSkillsEmptyState: View {
    let title: String
    let detail: String

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "wand.and.stars")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.system(size: 14, weight: .semibold, design: .rounded))
            Text(detail)
                .font(.system(size: 12, design: .rounded))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .cybaraGlass(cornerRadius: 18)
    }
}

private func normalizeNativeSkillKey(_ value: String) -> String {
    value.trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased()
        .replacingOccurrences(of: #"[^a-z0-9]+"#, with: "-", options: .regularExpression)
        .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
}

private func formatSkillRegistryName(_ registry: String) -> String {
    registry == "clawhub" ? "ClawHub" : registry
}

private func formatSkillSource(_ source: String) -> String {
    switch source {
    case "workspace": return "Workspace"
    case "local": return "Local"
    case "bundled": return "Bundled"
    default: return source.capitalized
    }
}

private func skillStatusTitle(_ skill: GatewaySkillStatus) -> String {
    if skill.disabled { return "Disabled" }
    if skill.eligible { return "Ready" }
    return "Missing Reqs"
}

private func skillStatusIcon(_ skill: GatewaySkillStatus) -> String {
    if skill.disabled { return "pause.circle" }
    if skill.eligible { return "checkmark.circle" }
    return "exclamationmark.triangle"
}

private func skillStatusTint(_ skill: GatewaySkillStatus, accentTint: Color) -> Color {
    if skill.disabled { return .secondary }
    if skill.eligible { return .green }
    return .orange
}

private func formatSkillUpdatedAt(_ updatedAt: Double?) -> String? {
    guard let updatedAt, updatedAt.isFinite else { return nil }
    let seconds = updatedAt > 10_000_000_000 ? updatedAt / 1000 : updatedAt
    let date = Date(timeIntervalSince1970: seconds)
    return date.formatted(.dateTime.month(.abbreviated).day().year())
}
