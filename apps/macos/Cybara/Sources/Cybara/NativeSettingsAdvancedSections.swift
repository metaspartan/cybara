import AppKit
import SwiftUI

extension NativeSettingsScreen {
    var advancedTab: some View {
        HStack(spacing: 0) {
            List(selection: $advancedSelection) {
                ForEach(SettingsAdvancedSection.allCases) { section in
                    Label(section.title, systemImage: section.systemImage)
                        .tag(section)
                }
            }
            .listStyle(.sidebar)
            .frame(width: 190)

            Divider().opacity(0.35)

            advancedContent
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(.top, 10)
        .padding(.bottom, 16)
    }

    @ViewBuilder
    var advancedContent: some View {
        switch advancedSelection {
        case .router:
            RouterScreen(client: client)
        case .systemPrompt:
            SystemPromptScreen(client: client)
        case .memory:
            MemoryScreen(client: client)
        case .channels:
            ChannelsScreen(client: client)
        case .skills:
            NativeSkillsScreen(client: client)
        case .backups:
            NativeBackupsScreen(client: client)
        case .logs:
            LogsScreen(client: client)
        case .telemetry:
            NativeTelemetrySettingsScreen(client: client)
        case .permissions:
            NativeToolCapabilitySettingsScreen(client: client)
        }
    }

    var uptimeLabel: String {
        guard let uptime = health?.uptime, uptime > 0 else { return "Starting" }
        let minutes = Int(uptime) / 60
        if minutes < 60 { return "\(minutes)m" }
        return "\(minutes / 60)h \(minutes % 60)m"
    }

    var speechTTSProviderLabel: String {
        switch speechTTSProvider {
        case "local": return "Kokoro 82M"
        case "elevenlabs": return "ElevenLabs"
        case "openai": return "OpenAI"
        case "system": return "System"
        default: return "Auto"
        }
    }

    var gatewayActivityEntries: [NativeLogEntryDisplay] {
        nativeLogEntries(gatewayLogs: gatewayLogs, sidecarLogs: sidecar.logs, sidecarLimit: 40)
    }

    func settingRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(.system(size: 12, design: .rounded)).foregroundStyle(.secondary)
            Spacer(minLength: 20)
            Text(value)
                .font(.system(size: 12, weight: .semibold, design: value.count > 42 ? .monospaced : .rounded))
                .lineLimit(2)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
    }

    func toggleRow(
        _ title: String,
        detail: String,
        isOn: Binding<Bool>,
        onChange: @escaping () -> Void
    ) -> some View {
        Toggle(isOn: isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 13, weight: .semibold, design: .rounded))
                Text(detail).font(.system(size: 11, design: .rounded)).foregroundStyle(.secondary)
            }
        }
        .toggleStyle(.switch)
        .onChange(of: isOn.wrappedValue) { _, _ in onChange() }
    }

    func progressLabel(for key: String, fallback: String) -> some View {
        Group {
            if savingKey == key {
                ProgressView().controlSize(.small)
            } else {
                Text(fallback).font(.system(size: 12, weight: .semibold, design: .rounded)).foregroundStyle(.secondary)
            }
        }
    }

    func accentSwatch(_ key: String) -> some View {
        let color = CybaraAccent.palette[key] ?? .accentColor
        return Button {
            selectedAccent = key
            onAccentChanged(key)
            saveConfigPatch(["themeAccent": key], key: "themeAccent") {
                NotificationCenter.default.post(name: .cybaraThemeAccentChanged, object: key)
            }
        } label: {
            ZStack {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(color)
                    .frame(width: 46, height: 46)
                if selectedAccent == key {
                    Image(systemName: "checkmark")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)
                        .shadow(radius: 2)
                }
            }
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(selectedAccent == key ? Color.white.opacity(0.85) : Color.white.opacity(0.16), lineWidth: 2)
            )
        }
        .buttonStyle(.plain)
        .disabled(savingKey == "themeAccent")
        .help(CybaraAccent.label(for: key))
    }

}
