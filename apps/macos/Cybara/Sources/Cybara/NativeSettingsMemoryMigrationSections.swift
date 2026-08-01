import AppKit
import SwiftUI

extension NativeSettingsScreen {
    static let memoryProviderChoices: [(id: String, label: String)] = [
        ("local", "Built-in (local)"),
        ("supermemory", "Supermemory"),
        ("mem0", "Mem0"),
        ("honcho", "Honcho"),
        ("openviking", "OpenViking"),
        ("hindsight", "Hindsight"),
    ]

    static let memoryProviderFieldSpecs: [String: [(key: String, label: String, secret: Bool, placeholder: String)]] = [
        "supermemory": [
            ("apiKey", "API key", true, ""),
            ("baseUrl", "Base URL", false, "https://api.supermemory.ai"),
            ("containerTag", "Container tag", false, "cybara"),
        ],
        "mem0": [
            ("apiKey", "API key", true, ""),
            ("baseUrl", "Base URL", false, "https://api.mem0.ai"),
            ("userId", "User ID", false, "cybara-user"),
            ("agentId", "Agent ID", false, "cybara"),
        ],
        "honcho": [
            ("apiKey", "API key", true, ""),
            ("baseUrl", "Base URL", false, "https://api.honcho.dev"),
            ("workspace", "Workspace", false, "cybara"),
            ("peer", "Peer", false, "user"),
        ],
        "openviking": [
            ("baseUrl", "Server URL", false, "http://127.0.0.1:1933"),
            ("apiKey", "API key", true, ""),
        ],
        "hindsight": [
            ("apiKey", "API key", true, ""),
            ("baseUrl", "Base URL", false, "https://api.hindsight.vectorize.io"),
            ("tenant", "Tenant", false, "default"),
            ("bankId", "Memory bank", false, "cybara"),
        ],
    ]

    func memoryFieldBinding(_ provider: String, _ key: String) -> Binding<String> {
        Binding(
            get: { memoryProviderFields["\(provider).\(key)"] ?? "" },
            set: { memoryProviderFields["\(provider).\(key)"] = $0 }
        )
    }

    var memoryTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NativeSettingsLayout.cardSpacing) {
                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Image(systemName: "brain.head.profile")
                                .foregroundStyle(.secondary)
                            Text("Memory")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            Spacer()
                        }
                        toggleRow(
                            "Background memory review",
                            detail: "After substantial responses, a silent reviewer saves durable preferences and facts.",
                            isOn: $memoryBackgroundReview
                        ) {
                            saveMemorySettings()
                        }
                        toggleRow(
                            "Flush before compaction",
                            detail: "Before a long chat compacts, the agent gets one chance to save durable memory.",
                            isOn: $memoryFlushEnabled
                        ) {
                            saveMemorySettings()
                        }
                        TextField("Flush threshold (tokens)", text: $memoryFlushThreshold)
                            .textFieldStyle(.roundedBorder)
                            .frame(maxWidth: 220)
                            .onSubmit { saveMemorySettings() }
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Image(systemName: "timer")
                                .foregroundStyle(.secondary)
                            Text("Agent Turn Watchdogs")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            Spacer()
                        }
                        Text("Timeouts trigger on provider silence, never on how long an agent works. Local model endpoints auto-relax these limits. Environment variables (CYBARA_LLM_*) override saved values.")
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                        HStack(spacing: 10) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("First token (s)").font(.system(size: 11, design: .rounded)).foregroundStyle(.secondary)
                                TextField("300", text: $llmFirstTokenSeconds)
                                    .textFieldStyle(.roundedBorder)
                                    .onSubmit { saveLlmTimeoutSettings() }
                            }
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Stall (s, 0 = off)").font(.system(size: 11, design: .rounded)).foregroundStyle(.secondary)
                                TextField("300", text: $llmStallSeconds)
                                    .textFieldStyle(.roundedBorder)
                                    .onSubmit { saveLlmTimeoutSettings() }
                            }
                        }
                        HStack(spacing: 10) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Total cap (s, 0 = ∞)").font(.system(size: 11, design: .rounded)).foregroundStyle(.secondary)
                                TextField("0", text: $llmTotalSeconds)
                                    .textFieldStyle(.roundedBorder)
                                    .onSubmit { saveLlmTimeoutSettings() }
                            }
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Non-streaming (s)").font(.system(size: 11, design: .rounded)).foregroundStyle(.secondary)
                                TextField("1800", text: $llmNonStreamingSeconds)
                                    .textFieldStyle(.roundedBorder)
                                    .onSubmit { saveLlmTimeoutSettings() }
                            }
                        }
                        Button("Save Watchdogs") { saveLlmTimeoutSettings() }
                            .buttonStyle(.borderedProminent)
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Image(systemName: "externaldrive.connected.to.line.below")
                                .foregroundStyle(.secondary)
                            Text("Memory Provider")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            Spacer()
                        }
                        Text("Built-in local memory (MEMORY.md + daily files) always runs. Selecting an external provider mirrors durable memories to it and blends its recall into agent context.")
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                        Picker("Provider", selection: $memoryProvider) {
                            ForEach(Self.memoryProviderChoices, id: \.id) { choice in
                                Text(choice.label).tag(choice.id)
                            }
                        }
                        .pickerStyle(.menu)
                        .onChange(of: memoryProvider) { _, _ in
                            memoryTestResult = nil
                            saveMemoryProviderSettings()
                        }
                        if memoryProvider != "local",
                           let fields = Self.memoryProviderFieldSpecs[memoryProvider] {
                            ForEach(fields, id: \.key) { field in
                                if field.secret {
                                    SecureField(field.label, text: memoryFieldBinding(memoryProvider, field.key))
                                        .textFieldStyle(.roundedBorder)
                                        .onSubmit { saveMemoryProviderSettings() }
                                } else {
                                    TextField(
                                        field.label,
                                        text: memoryFieldBinding(memoryProvider, field.key),
                                        prompt: Text(field.placeholder)
                                    )
                                    .textFieldStyle(.roundedBorder)
                                    .onSubmit { saveMemoryProviderSettings() }
                                }
                            }
                            toggleRow(
                                "Auto recall",
                                detail: "Blend provider memories into agent context.",
                                isOn: $memoryAutoRecall
                            ) {
                                saveMemoryProviderSettings()
                            }
                            toggleRow(
                                "Auto capture",
                                detail: "Mirror new durable memories to the provider.",
                                isOn: $memoryAutoCapture
                            ) {
                                saveMemoryProviderSettings()
                            }
                            HStack(spacing: 10) {
                                Button {
                                    testMemoryProviderConnection()
                                } label: {
                                    if memoryTesting {
                                        Label("Testing…", systemImage: "hourglass")
                                    } else {
                                        Label("Test Connection", systemImage: "bolt.horizontal")
                                    }
                                }
                                .buttonStyle(.bordered)
                                .disabled(memoryTesting)
                                if let memoryTestResult {
                                    Text(memoryTestResult)
                                        .font(.system(size: 11, design: .rounded))
                                        .foregroundStyle(memoryTestOK ? Color.green : Color.red)
                                }
                            }
                        }
                        HStack {
                            Spacer()
                            Button {
                                saveMemorySettings()
                                saveMemoryProviderSettings()
                            } label: {
                                Label("Save Memory", systemImage: "checkmark.circle")
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(savingKey == "memory" || savingKey == "memory_provider")
                        }
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Image(systemName: "square.grid.3x1.below.line.grid.1x2")
                                .foregroundStyle(.secondary)
                            Text("Indexing")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            Spacer()
                        }
                        Text("The embedding index that powers semantic search over memory, sessions, and workspace files. Separate from memory itself — memories persist even with indexing off.")
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                        toggleRow(
                            "Build search index",
                            detail: "Index memories, sessions, and workspace files for faster search.",
                            isOn: $indexEnabled
                        ) {
                            saveIndexingSettings()
                        }
                        toggleRow(
                            "Embedding search",
                            detail: "Use embeddings for similarity search.",
                            isOn: $indexSemantic
                        ) {
                            saveIndexingSettings()
                        }
                        toggleRow(
                            "Include hidden files",
                            detail: "Index dotfiles and hidden directories.",
                            isOn: $indexHidden
                        ) {
                            saveIndexingSettings()
                        }
                        toggleRow(
                            "Auto reindex on workspace change",
                            detail: "Rebuild the index when the agent workspace changes.",
                            isOn: $indexAutoReindex
                        ) {
                            saveIndexingSettings()
                        }
                        Picker("Embedding provider", selection: $indexEmbeddingProvider) {
                            Text("Auto (best available)").tag("auto")
                            Text("Local database (keyword only)").tag("local")
                            Text("Local Transformers.js").tag("transformers_js")
                            Text("Ollama (local)").tag("ollama")
                            Text("OpenAI").tag("openai")
                            Text("Voyage AI").tag("voyage")
                            Text("Gemini").tag("gemini")
                        }
                        .pickerStyle(.menu)
                        .onChange(of: indexEmbeddingProvider) { _, _ in saveIndexingSettings() }
                        TextField("Model override", text: $indexEmbeddingModel, prompt: Text("Auto"))
                            .textFieldStyle(.roundedBorder)
                            .frame(maxWidth: 320)
                            .onSubmit { saveIndexingSettings() }
                    }
                }
            }
            .nativeSettingsContentLayout()
        }
    }

    var migrationTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NativeSettingsLayout.cardSpacing) {
                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Image(systemName: "folder.badge.gearshape")
                                .foregroundStyle(.secondary)
                            Text("Import legacy agent data")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            Spacer()
                            Button {
                                Task { await refreshMigrationSources() }
                            } label: {
                                Label("Refresh", systemImage: "arrow.clockwise")
                            }
                            .controlSize(.small)
                        }
                        Text("Preview chats, memories, skills, persona, workspace instructions, and optional provider keys before applying changes.")
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)

                        if !migrationSources.filter({ $0.exists }).isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                ForEach(migrationSources.filter { $0.exists }) { source in
                                    Button {
                                        migrationSourceKind = source.kind
                                        migrationSourcePath = source.path
                                    } label: {
                                        HStack {
                                            VStack(alignment: .leading, spacing: 3) {
                                                Text(source.label)
                                                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                                                Text("\(source.detected.memoryFiles) memories, \(source.detected.skillCount) skills, \(source.detected.sessionCount ?? 0) chats, \(source.detected.configFiles) config files")
                                                    .font(.system(size: 11, design: .rounded))
                                                    .foregroundStyle(.secondary)
                                                Text(source.path)
                                                    .font(.system(size: 10, design: .monospaced))
                                                    .foregroundStyle(.tertiary)
                                                    .lineLimit(1)
                                            }
                                            Spacer()
                                            if migrationSourcePath == source.path {
                                                Image(systemName: "checkmark.circle.fill")
                                                    .foregroundStyle(.green)
                                            }
                                        }
                                        .contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)
                                    .padding(10)
                                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                                }
                            }
                        }

                        Picker("Source", selection: $migrationSourceKind) {
                            Text("OpenClaw").tag("openclaw")
                            Text("Hermes").tag("hermes")
                            Text("Codex").tag("codex")
                            Text("Claude Code").tag("claude-code")
                            Text("OpenCode").tag("opencode")
                        }
                        .pickerStyle(.segmented)

                        HStack(spacing: 8) {
                            TextField("Source directory", text: $migrationSourcePath)
                                .textFieldStyle(.roundedBorder)
                            Button("Browse") {
                                chooseMigrationSourceDirectory()
                            }
                        }
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Options")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        HStack(spacing: 12) {
                            Picker("Preset", selection: $migrationPreset) {
                                Text("User Data").tag("user-data")
                                Text("Full").tag("full")
                            }
                            .pickerStyle(.menu)
                            Picker("Skill conflicts", selection: $migrationSkillConflict) {
                                Text("Skip").tag("skip")
                                Text("Rename").tag("rename")
                                Text("Overwrite").tag("overwrite")
                            }
                            .pickerStyle(.menu)
                        }
                        Toggle("Import provider keys", isOn: $migrationImportSecrets)
                            .toggleStyle(.switch)
                        Toggle("Allow overwrite", isOn: $migrationOverwrite)
                            .toggleStyle(.switch)
                        HStack(spacing: 8) {
                            TextField("Workspace target for AGENTS.md", text: $migrationWorkspaceTarget)
                                .textFieldStyle(.roundedBorder)
                            Button("Browse") {
                                chooseMigrationWorkspaceDirectory()
                            }
                        }
                        HStack(spacing: 10) {
                            Button {
                                Task { await previewMigration() }
                            } label: {
                                Label("Preview", systemImage: "doc.text.magnifyingglass")
                            }
                            .buttonStyle(.bordered)
                            .disabled(migrationBusy)

                            Button {
                                Task { await applyMigration() }
                            } label: {
                                Label("Run Migration", systemImage: "arrow.down.doc")
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(migrationBusy)

                            if migrationBusy {
                                ProgressView().controlSize(.small)
                            }
                        }
                        if let migrationMessage {
                            Text(migrationMessage)
                                .font(.system(size: 12, design: .rounded))
                                .foregroundStyle(migrationMessage.lowercased().contains("failed") ? .red : .secondary)
                        }
                    }
                }

                if let migrationReport {
                    GlassCard {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                Text(migrationReport.dryRun ? "Preview Report" : "Migration Report")
                                    .font(.system(size: 15, weight: .bold, design: .rounded))
                                Spacer()
                                Text("\(migrationReport.summary["migrated"] ?? 0) migrated, \(migrationReport.summary["conflict"] ?? 0) conflicts")
                                    .font(.system(size: 11, weight: .medium, design: .rounded))
                                    .foregroundStyle(.secondary)
                            }
                            if !migrationReport.warnings.isEmpty {
                                Text(migrationReport.warnings.joined(separator: " "))
                                    .font(.system(size: 11, design: .rounded))
                                    .foregroundStyle(.orange)
                            }
                            VStack(alignment: .leading, spacing: 6) {
                                ForEach(migrationReport.items.prefix(24)) { item in
                                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                                        Text(item.status)
                                            .font(.system(size: 11, weight: .semibold, design: .rounded))
                                            .foregroundStyle(migrationStatusColor(item.status))
                                            .frame(width: 72, alignment: .leading)
                                        Text(item.category)
                                            .font(.system(size: 11, design: .rounded))
                                            .foregroundStyle(.secondary)
                                            .frame(width: 80, alignment: .leading)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(item.name)
                                                .font(.system(size: 12, weight: .medium, design: .rounded))
                                                .lineLimit(1)
                                            if let detail = item.detail {
                                                Text(detail)
                                                    .font(.system(size: 10, design: .rounded))
                                                    .foregroundStyle(.secondary)
                                                    .lineLimit(1)
                                            }
                                        }
                                    }
                                }
                            }
                            if let reportPath = migrationReport.reportPath {
                                Text(reportPath)
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundStyle(.tertiary)
                                    .textSelection(.enabled)
                            }
                        }
                    }
                }
            }
            .nativeSettingsContentLayout()
        }
    }

}
