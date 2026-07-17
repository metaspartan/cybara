import AppKit
import SwiftUI

extension NativeSettingsScreen {
    var generalTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NativeSettingsLayout.cardSpacing) {
                GlassCard {
                    HStack(spacing: 14) {
                        CybaraLogo(size: 52)
                        VStack(alignment: .leading, spacing: 5) {
                            Text("Cybara")
                                .font(.system(size: 18, weight: .bold, design: .rounded))
                            Text(sidecar.isReady ? "Gateway online" : sidecar.statusMessage)
                                .font(.system(size: 12, design: .rounded))
                                .foregroundStyle(sidecar.isReady ? Color.green : Color.secondary)
                            Text(sidecar.serverURL.absoluteString)
                                .font(.system(size: 11, weight: .medium, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                        }
                        Spacer()
                        StatusPill(status: sidecar.status)
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Desktop")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        settingRow("Gateway status", sidecar.status.title)
                        settingRow("Gateway URL", sidecar.serverURL.absoluteString)
                    }
                }

                appearanceSettingsCard
            }
            .nativeSettingsContentLayout()
        }
    }

    var updatesTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NativeSettingsLayout.cardSpacing) {
                GlassCard {
                    VStack(alignment: .leading, spacing: 14) {
                        Label("Updates", systemImage: "arrow.down.circle")
                            .font(.system(size: 17, weight: .bold, design: .rounded))
                        settingRow(
                            "Application version",
                            Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown")
                        settingRow("Gateway version", buildInfo?.version ?? health?.version ?? "unknown")
                        settingRow("Update status", updateChecker.statusText)
                        if updateChecker.isBusy {
                            if let progress = updateChecker.progressValue {
                                ProgressView(value: progress)
                                    .progressViewStyle(.linear)
                            } else {
                                ProgressView()
                                    .progressViewStyle(.linear)
                            }
                        }
                        HStack(spacing: 10) {
                            Button {
                                NotificationCenter.default.post(name: .cybaraCheckForUpdates, object: nil)
                            } label: {
                                Label("Check for Updates", systemImage: "arrow.clockwise")
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(updateChecker.isBusy)

                            if let repository = buildInfo?.release_repository_url,
                               let url = URL(string: repository + "/releases") {
                                Button {
                                    NSWorkspace.shared.open(url)
                                } label: {
                                    Label("View Releases", systemImage: "arrow.up.right.square")
                                }
                                .buttonStyle(.bordered)
                            }
                        }
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Build Provenance", systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        nativeBuildValue("Release commit", buildInfo?.commit)
                        Divider()
                        nativeBuildValue("SHA-256", buildInfo?.executable_sha256)
                        Divider()
                        nativeBuildValue("Executable", buildInfo?.executable_name)
                    }
                }
            }
            .nativeSettingsContentLayout()
        }
    }

    func nativeBuildValue(_ title: String, _ value: String?) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(.secondary)
            Text(value ?? "Unavailable")
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundStyle(value == nil ? Color.secondary : Color.primary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    var gatewayTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NativeSettingsLayout.cardSpacing) {
                GlassCard {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack(alignment: .top, spacing: 14) {
                            Image(systemName: sidecar.managesGateway ? "server.rack" : "link")
                                .font(.system(size: 22, weight: .semibold))
                                .foregroundStyle(.secondary)
                                .frame(width: 42, height: 42)
                                .background(Circle().fill(Color.primary.opacity(0.07)))

                            VStack(alignment: .leading, spacing: 5) {
                                Text(sidecar.managesGateway ? "Managed Gateway" : "Attached Gateway")
                                    .font(.system(size: 17, weight: .bold, design: .rounded))
                                Text(sidecar.statusMessage)
                                    .font(.system(size: 12, design: .rounded))
                                    .foregroundStyle(.secondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }

                            Spacer()
                            StatusPill(status: sidecar.status)
                        }

                        Divider().opacity(0.45)

                        settingRow("Server URL", sidecar.serverURL.absoluteString)
                        settingRow("Version", health?.version.map { "v\($0)" } ?? "Unavailable")
                        settingRow("Uptime", uptimeLabel)
                        settingRow("Launch mode", sidecar.managesGateway ? "Managed sidecar" : "Attached gateway")
                        settingRow("Binary", sidecar.binaryPath)
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("Default Workspace")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            Spacer()
                            if savingKey == "default_workspace_dir" {
                                ProgressView().controlSize(.small)
                            }
                        }
                        Text(
                            "New chats, agent prompts, skills status, and system prompt previews use this directory when no session workspace is selected."
                        )
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                        TextField("Default workspace directory", text: $defaultWorkspaceDir)
                            .textFieldStyle(.roundedBorder)
                            .onSubmit {
                                saveConfigPatch(
                                    ["default_workspace_dir": defaultWorkspaceDir],
                                    key: "default_workspace_dir"
                                )
                            }
                        ViewThatFits(in: .horizontal) {
                            HStack(spacing: 10) { defaultWorkspaceButtons }
                            VStack(alignment: .leading, spacing: 10) { defaultWorkspaceButtons }
                        }
                        Text(
                            "This field only changes the workspace default. Use Data Directory below for the gateway data root."
                        )
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.tertiary)
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack(spacing: 10) {
                            Text("Data Directory")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            if cybaraDataDirRestartRequired {
                                Text("Restart required")
                                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                                    .foregroundStyle(.orange)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 3)
                                    .background(Capsule().fill(Color.orange.opacity(0.12)))
                                    .overlay(Capsule().stroke(Color.orange.opacity(0.25), lineWidth: 1))
                            }
                            if cybaraDataDirForced {
                                Text("CYBARA_HOME")
                                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                                    .foregroundStyle(.cyan)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 3)
                                    .background(Capsule().fill(Color.cyan.opacity(0.12)))
                                    .overlay(Capsule().stroke(Color.cyan.opacity(0.25), lineWidth: 1))
                            }
                            Spacer()
                            if savingKey == "cybara_data_dir" {
                                ProgressView().controlSize(.small)
                            }
                        }
                        Text(
                            "Stores gateway config, database, API keys, memory, logs, skills, and local media."
                        )
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                        TextField("Configured data directory", text: $configuredCybaraDataDir)
                            .textFieldStyle(.roundedBorder)
                            .disabled(cybaraDataDirForced || savingKey == "cybara_data_dir")
                            .onSubmit {
                                saveCybaraDataDirectory()
                            }
                        ViewThatFits(in: .horizontal) {
                            HStack(spacing: 10) { dataDirectoryButtons }
                            VStack(alignment: .leading, spacing: 10) { dataDirectoryButtons }
                        }
                        Divider().opacity(0.45)
                        settingRow("Active now", cybaraDataDir.isEmpty ? "Unavailable" : cybaraDataDir)
                        if !configuredCybaraDataDir.isEmpty && configuredCybaraDataDir != cybaraDataDir {
                            settingRow("After restart", configuredCybaraDataDir)
                        }
                        settingRow("Source", cybaraDataDirSource)
                        if !defaultCybaraDataDir.isEmpty {
                            settingRow("Default", defaultCybaraDataDir)
                        }
                        if !cybaraDataDirOverrideFile.isEmpty && !cybaraDataDirForced {
                            settingRow("Override file", cybaraDataDirOverrideFile)
                        }
                        if cybaraDataDirForced {
                            Text("Unset CYBARA_HOME before launch to manage this path from Settings.")
                                .font(.system(size: 11, design: .rounded))
                                .foregroundStyle(.tertiary)
                        }
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Runtime Controls")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        Text(sidecar.managesGateway ? "Restart the managed sidecar process." : "Ask the attached gateway to restart itself, then wait for it to become healthy again.")
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                        ViewThatFits(in: .horizontal) {
                            HStack(spacing: 10) { gatewayControlButtons }
                            VStack(alignment: .leading, spacing: 10) { gatewayControlButtons }
                        }
                    }
                }

                if authAvailable {
                    GlassCard {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                Text("Gateway Auth")
                                    .font(.system(size: 15, weight: .bold, design: .rounded))
                                Spacer()
                                if authBusy { ProgressView().controlSize(.small) }
                            }
                            Text("Root API key used by native apps, the CLI, and remote clients. Paired mobile devices use their own scoped tokens.")
                                .font(.system(size: 11, design: .rounded))
                                .foregroundStyle(.secondary)

                            settingRow("API key", authRevealedKey ?? authKeyPreview)
                            settingRow(
                                "Source",
                                authKeySource == "env" ? "CYBARA_API_KEY environment variable" : "~/.cybara/api_key"
                            )

                            ViewThatFits(in: .horizontal) {
                                HStack(spacing: 10) { authControlButtons }
                                VStack(alignment: .leading, spacing: 10) { authControlButtons }
                            }

                            Divider().opacity(0.45)

                            VStack(alignment: .leading, spacing: 10) {
                                HStack {
                                    Text("Gateway Password")
                                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                                    Spacer()
                                    Text(authGatewayPasswordEnabled ? "Enabled" : "Off")
                                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                                        .foregroundStyle(authGatewayPasswordEnabled ? Color.green : Color.secondary)
                                }
                                Text("Optional second factor for remote root/UI access when the gateway is reachable outside this Mac.")
                                    .font(.system(size: 11, design: .rounded))
                                    .foregroundStyle(.secondary)
                                SecureField("New password", text: $gatewayPasswordDraft)
                                    .textFieldStyle(.roundedBorder)
                                    .disabled(authBusy)
                                SecureField("Confirm password", text: $gatewayPasswordConfirm)
                                    .textFieldStyle(.roundedBorder)
                                    .disabled(authBusy)
                                ViewThatFits(in: .horizontal) {
                                    HStack(spacing: 10) { gatewayPasswordButtons }
                                    VStack(alignment: .leading, spacing: 10) { gatewayPasswordButtons }
                                }
                            }

                            Divider().opacity(0.45)

                            VStack(alignment: .leading, spacing: 10) {
                                HStack {
                                    Text("Remote Access")
                                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                                    Spacer()
                                    Text(remoteAccessReady ? "Ready" : (remoteAccessEnabled ? "Setup needed" : "Off"))
                                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                                        .foregroundStyle(remoteAccessReady ? Color.green : (remoteAccessEnabled ? Color.orange : .secondary))
                                }
                                Text("Use a mesh such as Tailscale, ZeroTier, or NetBird, or a password-protected HTTPS tunnel for a public domain.")
                                    .font(.system(size: 11, design: .rounded))
                                    .foregroundStyle(.secondary)
                                Toggle("Enable remote URL", isOn: $remoteAccessEnabled)
                                    .toggleStyle(.switch)
                                    .disabled(authBusy)
                                Picker("Access", selection: $remoteAccessMode) {
                                    Text("Private Mesh").tag("private_overlay")
                                    Text("Public HTTPS").tag("public_tunnel")
                                }
                                .pickerStyle(.segmented)
                                .disabled(authBusy)
                                Picker("Provider", selection: $remoteAccessProvider) {
                                    Text("Tailscale").tag("tailscale")
                                    Text("ZeroTier").tag("zerotier")
                                    Text("NetBird").tag("netbird")
                                    Text("Cloudflare").tag("cloudflare")
                                    Text("Custom").tag("custom")
                                }
                                .pickerStyle(.menu)
                                .disabled(authBusy)
                                TextField("https://name.tailnet.ts.net", text: $remoteAccessBaseURL)
                                    .textFieldStyle(.roundedBorder)
                                    .disabled(authBusy)
                                if !remoteAccessMessage.isEmpty {
                                    Text(remoteAccessMessage)
                                        .font(.system(size: 11, design: .rounded))
                                        .foregroundStyle(remoteAccessReady ? Color.green : Color.orange)
                                }
                                Button {
                                    Task { await saveRemoteAccess() }
                                } label: {
                                    Label("Save Remote Access", systemImage: "network")
                                }
                                .buttonStyle(.bordered)
                                .disabled(authBusy)
                            }

                            Divider().opacity(0.45)

                            toggleRow(
                                "Require API key for localhost",
                                detail: authRequireForced
                                    ? "Forced on by CYBARA_REQUIRE_AUTH or production mode"
                                    : "When off, same-origin local requests skip the API key",
                                isOn: $authRequireLocalhost
                            ) {
                                guard !authRequireForced else { return }
                                Task { await updateRequireLocalhostAuth() }
                            }
                            .disabled(authRequireForced || authBusy)
                        }
                    }
                    .confirmationDialog(
                        "Rotate API Key?",
                        isPresented: $showRotateConfirm,
                        titleVisibility: .visible
                    ) {
                        Button("Rotate Key", role: .destructive) {
                            Task { await rotateAuthKey() }
                        }
                        Button("Cancel", role: .cancel) {}
                    } message: {
                        Text("The current key stops working immediately. This app keeps working (it reads the key file), but other clients must be updated.")
                    }
                }

                NativeNearbySettingsSection(client: client)

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("Gateway Activity")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            Spacer()
                            Text("\(gatewayActivityEntries.count) entries")
                                .font(.system(size: 12, weight: .semibold, design: .rounded))
                                .foregroundStyle(.secondary)
                        }

                        Text("Live gateway and native sidecar events in one stream.")
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)

                        NativeLogTimeline(
                            entries: Array(gatewayActivityEntries.prefix(100)),
                            emptyMessage: "No gateway or sidecar log entries loaded.",
                            compact: true
                        )
                    }
                }

            }
            .nativeSettingsContentLayout()
        }
    }

    var accessibilityTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NativeSettingsLayout.cardSpacing) {
                GlassCard {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack {
                            Label("Readability", systemImage: "textformat.size")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            Spacer()
                            progressLabel(for: "chat_appearance", fallback: "Saved")
                        }
                        Picker("Chat text size", selection: $chatAppearance.fontSize) {
                            Text("Compact").tag("compact")
                            Text("Standard").tag("standard")
                            Text("Large").tag("large")
                            Text("Extra large").tag("extra_large")
                        }
                        .pickerStyle(.segmented)
                        .onChange(of: chatAppearance.fontSize) { _, _ in saveChatAppearance() }
                        Picker("Code text size", selection: $chatAppearance.codeFontSize) {
                            Text("Compact").tag("compact")
                            Text("Standard").tag("standard")
                            Text("Large").tag("large")
                        }
                        .pickerStyle(.segmented)
                        .onChange(of: chatAppearance.codeFontSize) { _, _ in saveChatAppearance() }
                        Picker("Line spacing", selection: $chatAppearance.lineSpacing) {
                            Text("Compact").tag("compact")
                            Text("Comfortable").tag("comfortable")
                            Text("Spacious").tag("spacious")
                        }
                        .pickerStyle(.segmented)
                        .onChange(of: chatAppearance.lineSpacing) { _, _ in saveChatAppearance() }
                        toggleRow(
                            "Underline chat links",
                            detail: "Keep links recognizable without relying on color alone.",
                            isOn: $chatAppearance.underlineLinks
                        ) { saveChatAppearance() }
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Visual Comfort", systemImage: "eye")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        toggleRow(
                            "Reduce motion",
                            detail: "Minimize decorative movement and animated transitions.",
                            isOn: $chatAppearance.reduceMotion
                        ) { saveChatAppearance() }
                        Divider()
                        toggleRow(
                            "Reduce transparency",
                            detail: "Use opaque surfaces instead of translucent glass effects.",
                            isOn: $chatAppearance.reduceTransparency
                        ) { saveChatAppearance() }
                        Divider()
                        toggleRow(
                            "Increase contrast",
                            detail: "Strengthen muted text, icons, borders, and focus indicators.",
                            isOn: $chatAppearance.highContrast
                        ) { saveChatAppearance() }
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Conversation Preview")
                                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                                Text("Updates immediately as settings change.")
                                    .font(.system(size: 11, design: .rounded))
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text("Live")
                                .font(.system(size: 10, weight: .semibold, design: .rounded))
                                .foregroundStyle(.secondary)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 6))
                        }
                        HStack {
                            Spacer(minLength: 48)
                            Text("Make this settings screen accessible.")
                                .font(.system(size: chatAppearance.bodyFontSize, design: .rounded))
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background(.primary.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
                        }
                        Label("Edited settings and verified contrast", systemImage: "pencil")
                            .font(.system(size: chatAppearance.activityFontSize, design: .rounded))
                            .foregroundStyle(chatAppearance.highContrast ? .primary : .secondary)
                        NativeMarkdownView(
                            content: "Responses use your selected size and spacing. `Inline code` remains readable, and [links](https://cybara.ai) stay recognizable.",
                            isUser: false
                        )
                        VStack(alignment: .leading, spacing: 0) {
                            Text("settings.swift")
                                .font(.system(size: 10, weight: .medium, design: .rounded))
                                .foregroundStyle(.secondary)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(.primary.opacity(0.04))
                            Text("let accessible = true")
                                .font(.system(size: chatAppearance.codeTextSize, design: .monospaced))
                                .padding(10)
                        }
                        .background(.black.opacity(0.18), in: RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(.primary.opacity(chatAppearance.highContrast ? 0.24 : 0.10)))
                        Label("Accessibility check completed", systemImage: "checkmark.circle")
                            .font(.system(size: chatAppearance.activityFontSize, design: .rounded))
                            .foregroundStyle(chatAppearance.highContrast ? .primary : .secondary)
                    }
                }
                .nativeChatAppearance(chatAppearance)
            }
            .nativeSettingsContentLayout()
        }
    }

    @ViewBuilder
    var defaultWorkspaceButtons: some View {
        Button {
            chooseDefaultWorkspaceDirectory()
        } label: {
            Label("Choose Folder", systemImage: "folder")
        }
        .buttonStyle(.bordered)
        .disabled(savingKey == "default_workspace_dir")

        Button {
            saveConfigPatch(
                ["default_workspace_dir": defaultWorkspaceDir],
                key: "default_workspace_dir"
            )
        } label: {
            Label("Save Workspace", systemImage: "checkmark.circle")
        }
        .buttonStyle(.borderedProminent)
        .disabled(savingKey == "default_workspace_dir")
    }

    @ViewBuilder
    var dataDirectoryButtons: some View {
        Button {
            chooseCybaraDataDirectory()
        } label: {
            Label("Choose Folder", systemImage: "folder")
        }
        .buttonStyle(.bordered)
        .disabled(cybaraDataDirForced || savingKey == "cybara_data_dir")

        Button {
            saveCybaraDataDirectory()
        } label: {
            Label("Save Data Directory", systemImage: "checkmark.circle")
        }
        .buttonStyle(.borderedProminent)
        .disabled(
            cybaraDataDirForced
                || savingKey == "cybara_data_dir"
                || configuredCybaraDataDir.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        )
    }

    @ViewBuilder
    var authControlButtons: some View {
        Button {
            Task { await toggleRevealAuthKey() }
        } label: {
            Label(authRevealedKey == nil ? "Reveal" : "Hide", systemImage: authRevealedKey == nil ? "eye" : "eye.slash")
        }
        .buttonStyle(.bordered)
        .disabled(authBusy)

        Button {
            Task { await copyAuthKey() }
        } label: {
            Label(authCopied ? "Copied" : "Copy Key", systemImage: authCopied ? "checkmark" : "doc.on.doc")
        }
        .buttonStyle(.bordered)
        .disabled(authBusy)

        Button {
            showRotateConfirm = true
        } label: {
            Label("Rotate Key", systemImage: "arrow.triangle.2.circlepath")
        }
        .buttonStyle(.bordered)
        .disabled(authBusy || authKeySource == "env")
    }

    @ViewBuilder
    var gatewayPasswordButtons: some View {
        Button {
            Task { await saveGatewayPassword() }
        } label: {
            Label(
                authGatewayPasswordEnabled ? "Update Password" : "Enable Password",
                systemImage: "lock.shield"
            )
        }
        .buttonStyle(.borderedProminent)
        .disabled(
            authBusy ||
                gatewayPasswordDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                gatewayPasswordConfirm.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        )

        Button {
            Task { await clearGatewayPassword() }
        } label: {
            Label("Clear Password", systemImage: "xmark.shield")
        }
        .buttonStyle(.bordered)
        .disabled(authBusy || !authGatewayPasswordEnabled)
    }

    @ViewBuilder
    var gatewayControlButtons: some View {
        Button {
            Task { await restartGateway() }
        } label: {
            Label(gatewayRestarting ? "Restarting" : "Restart Gateway", systemImage: "arrow.clockwise")
        }
        .buttonStyle(.borderedProminent)
        .disabled(gatewayRestarting)

        Button {
            copyServerURL()
        } label: {
            Label(copiedURL ? "Copied" : "Copy URL", systemImage: copiedURL ? "checkmark" : "doc.on.doc")
        }
        .buttonStyle(.bordered)

        Button {
            sidecar.revealBinary()
        } label: {
            Label("Reveal Binary", systemImage: "shippingbox")
        }
        .buttonStyle(.bordered)
    }

    var appearanceSettingsCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Appearance")
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                    Spacer()
                    progressLabel(for: "themeAccent", fallback: CybaraAccent.label(for: selectedAccent))
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 48, maximum: 58), spacing: 12)], spacing: 12) {
                    ForEach(CybaraAccent.orderedKeys, id: \.self) { key in
                        accentSwatch(key)
                    }
                }
                Divider()
                Toggle(isOn: $petEnabled) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Show floating pet")
                            .font(.system(size: 13, weight: .medium, design: .rounded))
                        Text("A draggable Cybara that floats above every app. Click it to jump back into chat.")
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                    }
                }
                .toggleStyle(.switch)
                .onChange(of: petEnabled) { _, enabled in
                    PetPanelController.shared.setVisible(enabled)
                }
            }
        }
    }

}
