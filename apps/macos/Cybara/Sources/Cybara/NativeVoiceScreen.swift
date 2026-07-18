import AVFoundation
import Speech
import SwiftUI

enum NativeVoiceActivity: String {
    case idle
    case listening
    case thinking
    case speaking
}

enum NativeVoiceMode: String, CaseIterable, Identifiable {
    case tap
    case handsFree

    var id: String { rawValue }

    var label: String {
        switch self {
        case .tap: return "Tap to Talk"
        case .handsFree: return "Hands-Free"
        }
    }
}

enum NativeVoiceError: LocalizedError {
    case microphoneDenied
    case speechRecognitionDenied
    case speechRecognitionUnavailable
    case noRecording
    case noTranscript
    case noResponse

    var errorDescription: String? {
        switch self {
        case .microphoneDenied: return "Microphone access is required for voice conversations."
        case .speechRecognitionDenied: return "Speech recognition access is required for native dictation."
        case .speechRecognitionUnavailable: return "Native speech recognition is currently unavailable."
        case .noRecording: return "No voice recording was available to transcribe."
        case .noTranscript: return "No speech was detected in the recording."
        case .noResponse: return "The agent did not return a response."
        }
    }
}

struct NativeSpeechEngineStatus: Decodable, Equatable {
    let ready: Bool
    let provider: String?
    let type: String?
    let systemFallback: Bool?
    let native: Bool?
    let error: String?
}

struct NativeSpeechSettingsStatus: Decodable, Equatable {
    let ttsProvider: String?
    let ttsVoice: String?
    let sttProvider: String?
    let realtimeProvider: String?
}

struct NativeSpeechStatusResponse: Decodable, Equatable {
    let success: Bool?
    let tts: NativeSpeechEngineStatus
    let stt: NativeSpeechEngineStatus?
    let settings: NativeSpeechSettingsStatus?

    var ttsReady: Bool {
        tts.ready || tts.systemFallback == true
    }

    var sttReady: Bool {
        stt?.ready == true
    }

    var dictationProvider: String {
        if stt?.native == true { return "native" }
        if stt?.type == "local" { return "local" }
        if settings?.sttProvider == "openai" { return "openai" }
        return "auto"
    }
}

private struct NativeSpeechTranscriptionResponse: Decodable {
    let success: Bool?
    let text: String
}

private struct NativeSpeechSynthesisResponse: Decodable {
    let success: Bool?
    let audioPath: String
}

extension GatewayClient {
    func nativeSpeechStatus() async throws -> NativeSpeechStatusResponse {
        let data = try await request("api/speech/status")
        return try JSONDecoder().decode(NativeSpeechStatusResponse.self, from: data)
    }

    func nativeDictateSpeech(
        audioData: Data,
        provider: String?
    ) async throws -> String {
        var payload: [String: Any] = [
            "audioBase64": audioData.base64EncodedString(),
            "mimeType": "audio/wav",
            "fileName": "voice-message.wav",
        ]
        if let provider, ["auto", "local", "openai"].contains(provider) {
            payload["provider"] = provider
        }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let data = try await request(
            "api/speech/dictate",
            method: "POST",
            body: body,
            timeoutInterval: 300
        )
        return try JSONDecoder().decode(NativeSpeechTranscriptionResponse.self, from: data).text
    }

    func nativeSynthesizeSpeech(_ text: String) async throws -> Data {
        let body = try JSONSerialization.data(withJSONObject: ["text": text])
        let data = try await request(
            "api/speech/synthesize",
            method: "POST",
            body: body,
            timeoutInterval: 300
        )
        let response = try JSONDecoder().decode(NativeSpeechSynthesisResponse.self, from: data)
        return try await request(
            "api/media",
            queryItems: [URLQueryItem(name: "path", value: response.audioPath)],
            timeoutInterval: 300
        )
    }
}

struct NativeVoiceRecording {
    let url: URL
    let data: Data
}

@MainActor
final class NativeVoiceRecorder: ObservableObject {
    private var recorder: AVAudioRecorder?
    private var recordingURL: URL?

    var isRecording: Bool {
        recorder?.isRecording == true
    }

    func start() async throws {
        let granted = await AVCaptureDevice.requestAccess(for: .audio)
        guard granted else { throw NativeVoiceError.microphoneDenied }
        cancel()
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("cybara-voice-\(UUID().uuidString).wav")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: 16_000,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
        ]
        let recorder = try AVAudioRecorder(url: url, settings: settings)
        recorder.isMeteringEnabled = true
        recorder.prepareToRecord()
        guard recorder.record() else { throw NativeVoiceError.noRecording }
        self.recorder = recorder
        recordingURL = url
    }

    func level() -> Double {
        guard let recorder, recorder.isRecording else { return 0 }
        recorder.updateMeters()
        let power = Double(recorder.averagePower(forChannel: 0))
        return max(0, min(1, pow(10, power / 20)))
    }

    func stop() throws -> NativeVoiceRecording {
        guard let recorder, let recordingURL else { throw NativeVoiceError.noRecording }
        recorder.stop()
        self.recorder = nil
        self.recordingURL = nil
        return NativeVoiceRecording(url: recordingURL, data: try Data(contentsOf: recordingURL))
    }

    func cancel() {
        recorder?.stop()
        recorder = nil
        if let recordingURL {
            try? FileManager.default.removeItem(at: recordingURL)
        }
        recordingURL = nil
    }
}

private final class NativeSpeechResultBox: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<String, Error>?
    private var task: SFSpeechRecognitionTask?

    init(continuation: CheckedContinuation<String, Error>) {
        self.continuation = continuation
    }

    func setTask(_ task: SFSpeechRecognitionTask) {
        lock.lock()
        self.task = task
        lock.unlock()
    }

    func finish(_ result: Result<String, Error>) {
        lock.lock()
        guard let continuation else {
            lock.unlock()
            return
        }
        self.continuation = nil
        let task = self.task
        self.task = nil
        lock.unlock()
        task?.cancel()
        continuation.resume(with: result)
    }
}

@MainActor
private func transcribeNativeSpeech(at url: URL) async throws -> String {
    let authorization = await withCheckedContinuation { continuation in
        SFSpeechRecognizer.requestAuthorization { status in
            continuation.resume(returning: status)
        }
    }
    guard authorization == .authorized else { throw NativeVoiceError.speechRecognitionDenied }
    guard let recognizer = SFSpeechRecognizer(), recognizer.isAvailable else {
        throw NativeVoiceError.speechRecognitionUnavailable
    }
    let request = SFSpeechURLRecognitionRequest(url: url)
    request.shouldReportPartialResults = false
    return try await withCheckedThrowingContinuation { continuation in
        let box = NativeSpeechResultBox(continuation: continuation)
        let task = recognizer.recognitionTask(with: request) { result, error in
            if let error {
                box.finish(.failure(error))
                return
            }
            guard let result, result.isFinal else { return }
            let transcript = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
            box.finish(transcript.isEmpty ? .failure(NativeVoiceError.noTranscript) : .success(transcript))
        }
        box.setTask(task)
    }
}

private struct NativeVoiceTurn: Identifiable, Equatable {
    let id: String
    let role: String
    let content: String
}

struct NativeVoiceScreen: View {
    let client: GatewayClient
    let openSettings: () -> Void

    @Environment(\.cybaraAccent) private var accent
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    @StateObject private var recorder = NativeVoiceRecorder()
    @AppStorage("cybara.voice.agentID") private var selectedAgentID = ""
    @SceneStorage("cybara.voice.sessionID") private var sessionID = ""
    @State private var agents: [GatewayAgent] = []
    @State private var speechStatus: NativeSpeechStatusResponse?
    @State private var turns: [NativeVoiceTurn] = []
    @State private var input = ""
    @State private var activity = NativeVoiceActivity.idle
    @State private var mode = NativeVoiceMode.tap
    @State private var audioLevel = 0.0
    @State private var setupExpanded = false
    @State private var loading = true
    @State private var errorMessage: String?
    @State private var meterTask: Task<Void, Never>?
    @State private var playbackTask: Task<Void, Never>?
    @State private var audioPlayer: AVAudioPlayer?

    private var selectedAgent: GatewayAgent? {
        agents.first { $0.id == selectedAgentID }
    }

    private var ready: Bool {
        speechStatus?.ttsReady == true && speechStatus?.sttReady == true
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                setup
                controls
                orb
                transcript
                composer
            }
            .frame(maxWidth: 860)
            .padding(24)
            .frame(maxWidth: .infinity)
        }
        .task { await load() }
        .onDisappear { stopRuntime() }
        .alert(
            "Voice Unavailable",
            isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )
        ) {
            Button("OK") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "Voice could not continue.")
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 16) {
            ScreenHeader(title: "Voice", subtitle: "Talk naturally with any configured agent")
            Spacer()
            Button(action: openSettings) {
                Label("Voice Settings", systemImage: "slider.horizontal.3")
            }
            .buttonStyle(.bordered)
        }
    }

    private var setup: some View {
        DisclosureGroup(isExpanded: $setupExpanded) {
            VStack(spacing: 0) {
                setupRow(
                    title: "Voice Output",
                    detail: speechStatus?.tts.provider ?? "Choose a speech provider in Settings",
                    ready: speechStatus?.ttsReady == true
                )
                Divider()
                setupRow(
                    title: "Transcription",
                    detail: speechStatus?.stt?.native == true
                        ? "Native on-device dictation"
                        : speechStatus?.stt?.provider ?? "Choose a transcription provider in Settings",
                    ready: speechStatus?.sttReady == true
                )
            }
            .padding(.top, 8)
        } label: {
            Label(
                ready ? "Voice Ready" : "Setup Needed",
                systemImage: ready ? "checkmark.circle" : "exclamationmark.triangle"
            )
            .foregroundStyle(ready ? Color.green : Color.orange)
        }
        .padding(14)
        .cybaraGlass(cornerRadius: 14)
    }

    private var controls: some View {
        HStack(spacing: 14) {
            Picker("Agent", selection: $selectedAgentID) {
                Text("Gateway Default").tag("")
                ForEach(agents) { agent in
                    Text(agent.model.map { "\(agent.name) - \($0)" } ?? agent.name).tag(agent.id)
                }
            }
            .pickerStyle(.menu)
            .frame(maxWidth: 320)

            Picker("Mode", selection: $mode) {
                ForEach(NativeVoiceMode.allCases) { mode in
                    Text(mode.label).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .frame(width: 260)
            .onChange(of: mode) { _, nextMode in
                if nextMode == .handsFree && activity == .idle {
                    Task { await startRecording() }
                } else if nextMode == .tap && activity == .listening {
                    recorder.cancel()
                    meterTask?.cancel()
                    audioLevel = 0
                    activity = .idle
                }
            }
            Spacer()
        }
    }

    private var orb: some View {
        VStack(spacing: 12) {
            Button {
                if activity == .listening {
                    Task { await finishRecording() }
                } else if activity == .speaking {
                    stopPlayback(restartHandsFree: false)
                } else if activity == .idle {
                    Task { await startRecording() }
                }
            } label: {
                ZStack {
                    Circle()
                        .fill(.regularMaterial)
                    Circle()
                        .fill(accent.opacity(activity == .idle ? 0.16 : 0.28))
                    Circle()
                        .stroke(accent.opacity(0.58), lineWidth: 1)
                    Image(systemName: activitySymbol)
                        .font(.system(size: 35, weight: .medium))
                        .symbolRenderingMode(.monochrome)
                        .foregroundStyle(accent)
                }
                .frame(width: 138, height: 138)
                .scaleEffect(1 + min(0.08, audioLevel * 0.12))
                .shadow(color: accent.opacity(activity == .idle ? 0.12 : 0.28), radius: 24)
                .animation(systemReduceMotion ? nil : .linear(duration: 0.08), value: audioLevel)
            }
            .buttonStyle(.plain)
            .disabled(activity == .thinking || loading)
            .accessibilityLabel(activity == .listening ? "Stop recording" : "Start recording")

            Text(activityLabel)
                .font(.system(size: 14, weight: .semibold, design: .rounded))
            Text(activityDetail)
                .font(.system(size: 12, weight: .regular, design: .rounded))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 4)
    }

    private var transcript: some View {
        Group {
            if turns.isEmpty {
                ContentUnavailableView(
                    "Start a Voice Conversation",
                    systemImage: "waveform.circle",
                    description: Text("Tap the voice control or type a message below.")
                )
                .frame(minHeight: 180)
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 14) {
                            ForEach(turns) { turn in
                                voiceTurn(turn)
                                    .id(turn.id)
                            }
                        }
                        .padding(16)
                    }
                    .frame(minHeight: 180, maxHeight: 340)
                    .background(Color(nsColor: .textBackgroundColor).opacity(0.42), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .onChange(of: turns.count) { _, _ in
                        if let id = turns.last?.id {
                            if systemReduceMotion {
                                proxy.scrollTo(id, anchor: .bottom)
                            } else {
                                withAnimation { proxy.scrollTo(id, anchor: .bottom) }
                            }
                        }
                    }
                }
            }
        }
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField("Type instead of talking", text: $input, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(1 ... 5)
                .padding(.horizontal, 10)
                .padding(.vertical, 9)
                .onSubmit { Task { await sendTypedMessage() } }
            Button {
                Task { await sendTypedMessage() }
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 13, weight: .bold))
                    .frame(width: 30, height: 30)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.circle)
            .disabled(input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || activity == .thinking)
            .accessibilityLabel("Send message")
        }
        .padding(8)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func setupRow(title: String, detail: String, ready: Bool) -> some View {
        HStack(spacing: 12) {
            Image(systemName: ready ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                .symbolRenderingMode(.monochrome)
                .foregroundStyle(ready ? Color.green : Color.orange)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 13, weight: .semibold))
                Text(detail).font(.system(size: 12)).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(.vertical, 9)
    }

    private func voiceTurn(_ turn: NativeVoiceTurn) -> some View {
        HStack {
            if turn.role == "user" { Spacer(minLength: 90) }
            Text(turn.content)
                .font(.system(size: 14, weight: .regular, design: .rounded))
                .textSelection(.enabled)
                .padding(.horizontal, turn.role == "user" ? 12 : 0)
                .padding(.vertical, turn.role == "user" ? 9 : 0)
                .background(
                    turn.role == "user" ? accent.opacity(0.16) : Color.clear,
                    in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                )
            if turn.role != "user" { Spacer(minLength: 90) }
        }
    }

    private var activitySymbol: String {
        switch activity {
        case .idle: return "mic.fill"
        case .listening: return "waveform"
        case .thinking: return "ellipsis"
        case .speaking: return "speaker.wave.2.fill"
        }
    }

    private var activityLabel: String {
        switch activity {
        case .idle: return ready ? "Ready" : "Voice setup required"
        case .listening: return "Listening"
        case .thinking: return "Thinking"
        case .speaking: return "Speaking"
        }
    }

    private var activityDetail: String {
        switch activity {
        case .idle: return mode == .handsFree ? "Listening resumes after each reply" : "Tap to begin speaking"
        case .listening: return mode == .handsFree ? "Stops after a short pause" : "Tap again when finished"
        case .thinking:
            if let selectedAgent { return "Waiting for \(selectedAgent.name)" }
            return "Waiting for the agent"
        case .speaking: return "Tap to stop playback"
        }
    }

    private func load() async {
        guard loading else { return }
        do {
            agents = try await client.agents()
            speechStatus = try await client.nativeSpeechStatus()
            if !selectedAgentID.isEmpty && !agents.contains(where: { $0.id == selectedAgentID }) {
                selectedAgentID = ""
            }
            if !sessionID.isEmpty {
                let messages = try await client.sessionMessages(sessionID)
                turns = messages.compactMap { message in
                    guard ["user", "assistant"].contains(message.role.lowercased()) else { return nil }
                    let content = message.content.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !content.isEmpty else { return nil }
                    return NativeVoiceTurn(id: message.id.uuidString, role: message.role.lowercased(), content: content)
                }
            }
            setupExpanded = !ready
        } catch {
            errorMessage = error.localizedDescription
        }
        loading = false
    }

    private func startRecording() async {
        guard activity == .idle else { return }
        stopPlayback(restartHandsFree: false)
        do {
            try await recorder.start()
            activity = .listening
            startMetering()
        } catch {
            errorMessage = error.localizedDescription
            activity = .idle
        }
    }

    private func startMetering() {
        meterTask?.cancel()
        meterTask = Task { @MainActor in
            let startedAt = Date()
            var detectedSpeech = false
            var silenceStartedAt: Date?
            while !Task.isCancelled && recorder.isRecording {
                let level = recorder.level()
                audioLevel = level
                let now = Date()
                if level > 0.018 {
                    detectedSpeech = true
                    silenceStartedAt = nil
                } else if detectedSpeech {
                    silenceStartedAt = silenceStartedAt ?? now
                }
                if mode == .handsFree,
                   detectedSpeech,
                   let silenceStartedAt,
                   now.timeIntervalSince(silenceStartedAt) >= 1.1,
                   now.timeIntervalSince(startedAt) >= 0.8 {
                    await finishRecording()
                    return
                }
                if mode == .handsFree && now.timeIntervalSince(startedAt) >= 20 {
                    if detectedSpeech {
                        await finishRecording()
                    } else {
                        recorder.cancel()
                        audioLevel = 0
                        activity = .idle
                    }
                    return
                }
                try? await Task.sleep(for: .milliseconds(80))
            }
        }
    }

    private func finishRecording() async {
        guard activity == .listening else { return }
        meterTask?.cancel()
        meterTask = nil
        audioLevel = 0
        activity = .thinking
        do {
            let recording = try recorder.stop()
            defer { try? FileManager.default.removeItem(at: recording.url) }
            let transcript: String
            if speechStatus?.dictationProvider == "native" {
                transcript = try await transcribeNativeSpeech(at: recording.url)
            } else {
                transcript = try await client.nativeDictateSpeech(
                    audioData: recording.data,
                    provider: speechStatus?.dictationProvider
                )
            }
            try await send(transcript)
        } catch {
            activity = .idle
            errorMessage = error.localizedDescription
        }
    }

    private func sendTypedMessage() async {
        let message = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else { return }
        input = ""
        do {
            try await send(message)
        } catch {
            activity = .idle
            errorMessage = error.localizedDescription
        }
    }

    private func send(_ message: String) async throws {
        stopPlayback(restartHandsFree: false)
        activity = .thinking
        turns.append(NativeVoiceTurn(id: UUID().uuidString, role: "user", content: message))
        let result = try await client.sendChat(
            message: message,
            sessionId: sessionID.isEmpty ? nil : sessionID,
            agentId: selectedAgentID.isEmpty ? nil : selectedAgentID
        )
        if let nextSessionID = result.sessionId, !nextSessionID.isEmpty {
            sessionID = nextSessionID
        }
        guard let response = result.response?.trimmingCharacters(in: .whitespacesAndNewlines), !response.isEmpty else {
            throw NativeVoiceError.noResponse
        }
        turns.append(NativeVoiceTurn(id: result.message?.id.uuidString ?? UUID().uuidString, role: "assistant", content: response))
        try await speak(response)
    }

    private func speak(_ text: String) async throws {
        let data = try await client.nativeSynthesizeSpeech(text)
        let player = try AVAudioPlayer(data: data)
        player.prepareToPlay()
        audioPlayer = player
        activity = .speaking
        guard player.play() else { throw NativeVoiceError.noResponse }
        playbackTask?.cancel()
        playbackTask = Task { @MainActor in
            while !Task.isCancelled && player.isPlaying {
                try? await Task.sleep(for: .milliseconds(120))
            }
            guard !Task.isCancelled else { return }
            audioPlayer = nil
            activity = .idle
            if mode == .handsFree {
                try? await Task.sleep(for: .milliseconds(220))
                await startRecording()
            }
        }
    }

    private func stopPlayback(restartHandsFree: Bool) {
        playbackTask?.cancel()
        playbackTask = nil
        audioPlayer?.stop()
        audioPlayer = nil
        if activity == .speaking {
            activity = .idle
        }
        if restartHandsFree && mode == .handsFree {
            Task { await startRecording() }
        }
    }

    private func stopRuntime() {
        meterTask?.cancel()
        meterTask = nil
        recorder.cancel()
        audioLevel = 0
        stopPlayback(restartHandsFree: false)
        if activity != .thinking {
            activity = .idle
        }
    }
}
