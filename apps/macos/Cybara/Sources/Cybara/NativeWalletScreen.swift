import SwiftUI

struct WalletScreen: View {
    let client: GatewayClient

    @State private var status: [String: Any] = [:]
    @State private var policy: [String: Any] = [:]
    @State private var loaded = false
    @State private var savingAccess = false
    @State private var sendMode = "native"
    @State private var sendChain = "eth"
    @State private var tokenChain = "eth"
    @State private var sendTo = ""
    @State private var sendAmount = ""
    @State private var sendMemo = ""
    @State private var tokenAddress = ""
    @State private var tokenDecimals = "18"
    @State private var sendingWallet = false
    @State private var confirmingSend = false
    @State private var sendResult: String?
    @State private var sendError: String?
    @State private var seedRevealPresented = false
    @State private var seedPassword = ""
    @State private var seedConfirmation = ""
    @State private var revealedSeed = ""
    @State private var revealingSeed = false
    @State private var seedRevealTask: Task<Void, Never>?
    @State private var error: String?

    private static let nativeChains = ["eth", "btc", "sol"]
    private static let tokenChains = ["eth", "sol"]
    private static let policyRows: [(key: String, label: String)] = [
        ("allowNativeSend", "Native sends"),
        ("allowTokenSend", "Token sends"),
        ("allowEthContractWrite", "ETH contract writes"),
        ("allowSolProgramInstruction", "SOL program instructions"),
        ("allowEthSwaps", "ETH swaps"),
        ("allowDappInteraction", "dApp interaction"),
        ("allowX402Payments", "x402 payments"),
    ]

    private var agentAccessEnabled: Bool { status["agentAccessEnabled"] as? Bool ?? false }
    private var walletUnlocked: Bool { status["unlocked"] as? Bool ?? false }
    private var sendReady: Bool {
        walletUnlocked
            && !sendTo.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !sendAmount.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && (sendMode == "native" || !tokenAddress.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }
    private var sendAssetLabel: String {
        sendMode == "native" ? sendChain.uppercased() : "\(tokenChain.uppercased()) token"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ScreenHeader(title: "Wallet", subtitle: "Agent wallet status and spending policy")

                if !loaded {
                    ProgressView().frame(maxWidth: .infinity)
                } else if let error {
                    LoadFailedView(message: error) { Task { await load() } }
                } else {
                    GlassCard {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Text("Status")
                                    .font(.system(size: 15, weight: .bold, design: .rounded))
                                Spacer()
                                Text(status["exists"] as? Bool == true
                                    ? (status["unlocked"] as? Bool == true ? "Unlocked" : "Locked")
                                    : "No wallet")
                                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 4)
                                    .background(Capsule().fill(
                                        status["unlocked"] as? Bool == true
                                            ? Color.green.opacity(0.18)
                                            : Color.secondary.opacity(0.15)
                                    ))
                            }
                            ForEach(addressRows, id: \.chain) { row in
                                HStack {
                                    Text(row.chain.uppercased())
                                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                                        .foregroundStyle(.secondary)
                                        .frame(width: 34, alignment: .leading)
                                    Text(row.address)
                                        .font(.system(size: 11, design: .monospaced))
                                        .textSelection(.enabled)
                                        .lineLimit(1)
                                        .truncationMode(.middle)
                                    Spacer()
                                }
                            }
                        }
                    }

                    GlassCard {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Recovery Phrase")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            Text("Reveal the seed only to create an offline backup. Anyone with it controls every derived account.")
                                .font(.system(size: 11, design: .rounded))
                                .foregroundStyle(.secondary)
                            HStack {
                                Spacer()
                                Button("Reveal Seed Phrase") {
                                    seedRevealPresented = true
                                }
                                .buttonStyle(.bordered)
                                .disabled(status["exists"] as? Bool != true)
                            }
                        }
                    }

                    GlassCard {
                        VStack(alignment: .leading, spacing: 12) {
                            Toggle(isOn: Binding(
                                get: { agentAccessEnabled },
                                set: { newValue in
                                    savingAccess = true
                                    Task {
                                        do {
                                            try await client.setWalletAgentAccess(newValue)
                                            await load()
                                        } catch {
                                            self.error = error.localizedDescription
                                        }
                                        savingAccess = false
                                    }
                                }
                            )) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Agent wallet access")
                                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                                    Text("Master switch for agent-initiated wallet actions.")
                                        .font(.system(size: 11, design: .rounded))
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .toggleStyle(.switch)
                            .disabled(savingAccess)
                        }
                    }

                    GlassCard {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Agent policy")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            ForEach(Self.policyRows, id: \.key) { row in
                                Toggle(row.label, isOn: policyBinding(row.key))
                                    .toggleStyle(.switch)
                                    .font(.system(size: 13, weight: .medium, design: .rounded))
                            }
                        }
                    }

                    GlassCard {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text("Send")
                                        .font(.system(size: 15, weight: .bold, design: .rounded))
                                    Text(walletUnlocked
                                        ? "User-initiated wallet send with review confirmation."
                                        : "Unlock the wallet in web or Tauri before sending.")
                                        .font(.system(size: 11, design: .rounded))
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                if sendingWallet {
                                    ProgressView().controlSize(.small)
                                }
                            }

                            Picker("Send type", selection: $sendMode) {
                                Text("Native").tag("native")
                                Text("Token").tag("token")
                            }
                            .pickerStyle(.segmented)
                            .disabled(sendingWallet || !walletUnlocked)

                            Picker(sendMode == "native" ? "Chain" : "Token chain", selection: sendMode == "native" ? $sendChain : $tokenChain) {
                                ForEach(sendMode == "native" ? Self.nativeChains : Self.tokenChains, id: \.self) { chain in
                                    Text(chain.uppercased()).tag(chain)
                                }
                            }
                            .pickerStyle(.menu)
                            .disabled(sendingWallet || !walletUnlocked)

                            if sendMode == "token" {
                                TextField("Token address or mint", text: $tokenAddress)
                                    .textFieldStyle(.roundedBorder)
                                    .disabled(sendingWallet || !walletUnlocked)
                                TextField("Token decimals", text: $tokenDecimals)
                                    .textFieldStyle(.roundedBorder)
                                    .disabled(sendingWallet || !walletUnlocked)
                            }

                            TextField("Recipient address", text: $sendTo)
                                .textFieldStyle(.roundedBorder)
                                .disabled(sendingWallet || !walletUnlocked)
                            TextField("Amount", text: $sendAmount)
                                .textFieldStyle(.roundedBorder)
                                .disabled(sendingWallet || !walletUnlocked)
                            TextField("Memo (optional)", text: $sendMemo)
                                .textFieldStyle(.roundedBorder)
                                .disabled(sendingWallet || !walletUnlocked)

                            HStack {
                                Spacer()
                                Button(sendingWallet ? "Sending..." : "Review Send") {
                                    confirmingSend = true
                                }
                                .buttonStyle(.borderedProminent)
                                .disabled(!sendReady || sendingWallet)
                            }

                            if let sendResult {
                                Text(sendResult)
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundStyle(.secondary)
                                    .textSelection(.enabled)
                            }
                            if let sendError {
                                Text(sendError)
                                    .font(.system(size: 11, design: .rounded))
                                    .foregroundStyle(.red)
                            }
                        }
                    }
                }
            }
            .padding(24)
        }
        .task { await load() }
        .confirmationDialog(
            "Confirm wallet send",
            isPresented: $confirmingSend,
            titleVisibility: .visible
        ) {
            Button("Send \(sendAmount) \(sendAssetLabel)", role: .destructive) {
                Task { await submitSend() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Recipient: \(sendTo)")
        }
        .sheet(isPresented: $seedRevealPresented, onDismiss: clearRevealedSeed) {
            seedRevealSheet
        }
    }

    private var seedRevealSheet: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Reveal Seed Phrase")
                .font(.system(size: 18, weight: .bold, design: .rounded))
            Text("Never share these words, paste them into a website, or store them in cloud notes. The phrase disappears after 60 seconds.")
                .font(.system(size: 12, design: .rounded))
                .foregroundStyle(.orange)
            if revealedSeed.isEmpty {
                SecureField("Wallet password", text: $seedPassword)
                    .textFieldStyle(.roundedBorder)
                TextField("Type REVEAL to confirm", text: $seedConfirmation)
                    .textFieldStyle(.roundedBorder)
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 8) {
                    ForEach(Array(revealedSeed.split(separator: " ").enumerated()), id: \.offset) { index, word in
                        HStack(spacing: 6) {
                            Text("\(index + 1).")
                                .foregroundStyle(.tertiary)
                                .frame(width: 24, alignment: .trailing)
                            Text(String(word))
                                .textSelection(.enabled)
                            Spacer()
                        }
                        .font(.system(size: 12, design: .monospaced))
                    }
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 10).fill(Color.primary.opacity(0.05)))
            }
            HStack {
                Spacer()
                Button(revealedSeed.isEmpty ? "Cancel" : "Done") {
                    seedRevealPresented = false
                }
                if revealedSeed.isEmpty {
                    Button(revealingSeed ? "Revealing…" : "Reveal Phrase", role: .destructive) {
                        Task { await revealSeed() }
                    }
                    .disabled(revealingSeed || seedPassword.isEmpty || seedConfirmation != "REVEAL")
                }
            }
        }
        .padding(24)
        .frame(width: 520)
    }

    @MainActor
    private func revealSeed() async {
        guard seedConfirmation == "REVEAL", !seedPassword.isEmpty else { return }
        revealingSeed = true
        defer { revealingSeed = false }
        do {
            let result = try await client.revealWalletSeed(password: seedPassword)
            guard let mnemonic = result["mnemonic"] as? String, !mnemonic.isEmpty else {
                throw GatewayClientError.invalidResponse
            }
            seedPassword = ""
            revealedSeed = mnemonic
            seedRevealTask?.cancel()
            seedRevealTask = Task {
                try? await Task.sleep(nanoseconds: 60_000_000_000)
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    revealedSeed = ""
                    seedConfirmation = ""
                    seedRevealTask = nil
                }
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func clearRevealedSeed() {
        seedRevealTask?.cancel()
        seedRevealTask = nil
        seedPassword = ""
        seedConfirmation = ""
        revealedSeed = ""
    }

    private var addressRows: [(chain: String, address: String)] {
        let addresses = status["primaryAddresses"] as? [String: Any] ?? [:]
        return addresses.keys.sorted().compactMap { chain in
            guard let address = addresses[chain] as? String else { return nil }
            return (chain, address)
        }
    }

    private func policyBinding(_ key: String) -> Binding<Bool> {
        Binding(
            get: { policy[key] as? Bool ?? false },
            set: { newValue in
                var next = policy
                next[key] = newValue
                policy = next
                guard let body = try? JSONSerialization.data(withJSONObject: next) else { return }
                Task {
                    do {
                        try await client.updateWalletPolicy(body)
                        error = nil
                    } catch {
                        self.error = error.localizedDescription
                    }
                }
            }
        )
    }

    @MainActor
    private func submitSend() async {
        guard sendReady, !sendingWallet else { return }
        sendingWallet = true
        sendError = nil
        defer { sendingWallet = false }
        do {
            let trimmedTo = sendTo.trimmingCharacters(in: .whitespacesAndNewlines)
            let trimmedAmount = sendAmount.trimmingCharacters(in: .whitespacesAndNewlines)
            let trimmedMemo = sendMemo.trimmingCharacters(in: .whitespacesAndNewlines)
            var payload: [String: Any] = [
                "chain": sendMode == "native" ? sendChain : tokenChain,
                "to": trimmedTo,
                "amount": trimmedAmount,
            ]
            if !trimmedMemo.isEmpty {
                payload["memo"] = trimmedMemo
            }
            if sendMode == "token" {
                let trimmedTokenAddress = tokenAddress.trimmingCharacters(in: .whitespacesAndNewlines)
                payload["tokenAddress"] = trimmedTokenAddress
                if !tokenDecimals.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    guard let decimals = Int(tokenDecimals), (0 ... 18).contains(decimals) else {
                        sendError = "Token decimals must be a whole number from 0 to 18."
                        return
                    }
                    payload["decimals"] = decimals
                }
            }
            let body = try JSONSerialization.data(withJSONObject: payload)
            let result: [String: Any]
            if sendMode == "token" {
                result = try await client.sendWalletToken(body)
            } else {
                result = try await client.sendWallet(body)
            }
            let txid = result["txid"] as? String ?? "submitted"
            let explorer = result["explorerUrl"] as? String
            if let explorer, !explorer.isEmpty {
                sendResult = "\(txid)\n\(explorer)"
            } else {
                sendResult = txid
            }
            sendTo = ""
            sendAmount = ""
            sendMemo = ""
            tokenAddress = ""
            await load()
        } catch {
            sendError = error.localizedDescription
        }
    }

    private func load() async {
        do {
            status = try await client.walletStatus()
            policy = try await client.walletPolicy()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
    }
}
