import AppKit
import SwiftUI

private enum MobilePairingRole: String, CaseIterable, Identifiable {
    case standard
    case readonly
    case full

    var id: String { rawValue }

    var label: String {
        switch self {
        case .standard: return "Standard"
        case .readonly: return "Read Only"
        case .full: return "Full"
        }
    }

    var detail: String {
        switch self {
        case .standard:
            return "Chat, manage, and read. No wallet or terminal access."
        case .readonly:
            return "Chat and read-only views for safer monitoring."
        case .full:
            return "Includes wallet, terminal, and MCP scopes. Use only for trusted devices."
        }
    }
}

struct MobileScreen: View {
    let client: GatewayClient

    @Environment(\.cybaraAccent) private var accent

    @State private var devices: [GatewayMobileDevice] = []
    @State private var deviceName: String
    @State private var gatewayName = "Cybara Gateway"
    @State private var baseUrl: String
    @State private var role: MobilePairingRole = .standard
    @State private var pairing: GatewayMobilePairingCode?
    @State private var loading = true
    @State private var generating = false
    @State private var busyDeviceId: String?
    @State private var error: String?

    init(client: GatewayClient, defaultBaseURL: URL) {
        self.client = client
        _baseUrl = State(initialValue: defaultBaseURL.absoluteString)
        _deviceName = State(initialValue: Host.current().localizedName.map { "\($0) iPhone" } ?? "My iPhone")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ScreenHeader(
                    title: "Mobile",
                    subtitle: "Pair iPhone, iPad, and Android companions to this gateway"
                )

                HStack(alignment: .top, spacing: 16) {
                    pairingCard
                        .frame(minWidth: 340, idealWidth: 420, maxWidth: 480)
                    pairedDevicesCard
                        .frame(maxWidth: .infinity)
                }

                if let error {
                    Text(error)
                        .font(.system(size: 12, design: .rounded))
                        .foregroundStyle(.red)
                }
            }
            .padding(24)
        }
        .task { await loadDevices() }
    }

    private var pairingCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 14) {
                Label("Pair Mobile App", systemImage: "qrcode")
                    .font(.system(size: 16, weight: .bold, design: .rounded))

                Text("Create a short-lived code. The phone scans it, redeems it once, and receives a scoped device token.")
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(.secondary)

                LabeledContent("Device") {
                    TextField("Carsen iPhone", text: $deviceName)
                        .textFieldStyle(.roundedBorder)
                }

                LabeledContent("Gateway") {
                    TextField("Cybara Gateway", text: $gatewayName)
                        .textFieldStyle(.roundedBorder)
                }

                VStack(alignment: .leading, spacing: 5) {
                    LabeledContent("URL") {
                        TextField("http://192.168.1.20:4269", text: $baseUrl)
                            .textFieldStyle(.roundedBorder)
                    }
                    Text("Use a LAN-reachable URL when pairing a real phone. 127.0.0.1 only works from this Mac.")
                        .font(.system(size: 11, design: .rounded))
                        .foregroundStyle(.secondary)
                }

                Picker("Access", selection: $role) {
                    ForEach(MobilePairingRole.allCases) { option in
                        Text(option.label).tag(option)
                    }
                }
                .pickerStyle(.segmented)

                Text(role.detail)
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(role == .full ? Color.orange : .secondary)

                Button {
                    Task { await createPairing() }
                } label: {
                    if generating {
                        ProgressView().controlSize(.small)
                    } else {
                        Label("Create Pairing QR", systemImage: "plus")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(generating || baseUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                if let pairing {
                    Divider().opacity(0.35)
                    pairingResult(pairing)
                }
            }
        }
    }

    private var pairedDevicesCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Label("Paired Devices", systemImage: "iphone.gen3")
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                    Spacer()
                    Button {
                        Task { await loadDevices() }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }

                Text("\(devices.filter(\.isActive).count) active, \(devices.count) total records")
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(.secondary)

                if loading {
                    ProgressView().frame(maxWidth: .infinity, minHeight: 120)
                } else if devices.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "iphone.slash")
                            .font(.system(size: 30, weight: .semibold))
                            .foregroundStyle(.secondary)
                        Text("No mobile devices are paired yet.")
                            .font(.system(size: 13, design: .rounded))
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, minHeight: 150)
                } else {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        ForEach(devices) { device in
                            deviceRow(device)
                        }
                    }
                }
            }
        }
    }

    private func pairingResult(_ pairing: GatewayMobilePairingCode) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text("Ready to scan")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                Spacer()
                if let expiresAt = pairing.expiresAtDate {
                    Text("Expires \(relativeTimestamp(expiresAt.ISO8601Format()))")
                        .font(.system(size: 11, design: .rounded))
                        .foregroundStyle(.secondary)
                }
            }

            QRCodeImage(dataURL: pairing.qrDataUrl)
                .frame(maxWidth: .infinity)

            HStack(spacing: 8) {
                codePill(pairing.code)
                Button {
                    copy(pairing.encoded)
                } label: {
                    Label("Copy Payload", systemImage: "doc.on.doc")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }

            Text("The device appears in the paired list after Cybara Mobile scans and redeems this code.")
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(.secondary)
        }
    }

    private func codePill(_ code: String) -> some View {
        Text(code)
            .font(.system(size: 13, weight: .semibold, design: .monospaced))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(accent.opacity(0.18)))
            .foregroundStyle(accent)
            .textSelection(.enabled)
    }

    private func deviceRow(_ device: GatewayMobileDevice) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: device.isActive ? "iphone.gen3" : "iphone.slash")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(device.isActive ? accent : Color.secondary)
                .frame(width: 36, height: 36)
                .background(Circle().fill(Color.white.opacity(0.06)))

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(device.name)
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .lineLimit(1)
                    Text(device.status.capitalized)
                        .font(.system(size: 10, weight: .semibold, design: .rounded))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(
                            Capsule().fill(device.isActive ? Color.green.opacity(0.18) : Color.orange.opacity(0.18))
                        )
                        .foregroundStyle(device.isActive ? Color.green : Color.orange)
                }
                Text(device.id)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                Text(device.baseUrl)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Text("\(device.scopeSummary) · created \(relativeTimestamp(device.createdAt))")
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(.secondary)
                Text(device.pushSummary)
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(device.push?.configured == true ? accent : .secondary)
            }

            Spacer(minLength: 12)

            if busyDeviceId == device.id {
                ProgressView().controlSize(.small)
            } else {
                Menu {
                    Button("Copy Device ID") { copy(device.id) }
                    if device.isActive {
                        Button("Revoke Access", role: .destructive) {
                            Task { await revoke(device) }
                        }
                    }
                    Button("Remove Record", role: .destructive) {
                        Task { await remove(device) }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .help("Device actions")
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.white.opacity(0.05))
        )
    }

    private func createPairing() async {
        generating = true
        error = nil
        do {
            pairing = try await client.createMobilePairingCode(
                baseUrl: baseUrl,
                gatewayName: gatewayName,
                deviceName: deviceName,
                role: role.rawValue
            )
        } catch {
            self.error = error.localizedDescription
        }
        generating = false
    }

    private func loadDevices() async {
        loading = true
        do {
            devices = try await client.mobileDevices()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }

    private func revoke(_ device: GatewayMobileDevice) async {
        busyDeviceId = device.id
        do {
            try await client.revokeMobileDevice(device.id)
            await loadDevices()
        } catch {
            self.error = error.localizedDescription
        }
        busyDeviceId = nil
    }

    private func remove(_ device: GatewayMobileDevice) async {
        busyDeviceId = device.id
        do {
            try await client.deleteMobileDevice(device.id)
            await loadDevices()
        } catch {
            self.error = error.localizedDescription
        }
        busyDeviceId = nil
    }

    private func copy(_ value: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
    }
}

private struct QRCodeImage: View {
    let dataURL: String

    var body: some View {
        Group {
            if let image = nsImage {
                Image(nsImage: image)
                    .resizable()
                    .interpolation(.none)
                    .scaledToFit()
                    .frame(width: 220, height: 220)
                    .padding(14)
                    .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.white))
                    .accessibilityLabel("Cybara Mobile pairing QR code")
            } else {
                Text("QR image unavailable")
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(.secondary)
                    .frame(width: 220, height: 220)
                    .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.white.opacity(0.08)))
            }
        }
    }

    private var nsImage: NSImage? {
        guard let comma = dataURL.firstIndex(of: ",") else { return nil }
        let encoded = String(dataURL[dataURL.index(after: comma)...])
        guard let data = Data(base64Encoded: encoded) else { return nil }
        return NSImage(data: data)
    }
}
