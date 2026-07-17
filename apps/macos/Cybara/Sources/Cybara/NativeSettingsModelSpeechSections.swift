import AppKit
import SwiftUI

extension NativeSettingsScreen {
    var modelTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NativeSettingsLayout.cardSpacing) {
                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Default Agent")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        Text("Used when a channel or request does not specify one.")
                            .font(.system(size: 11, design: .rounded))
                            .foregroundStyle(.secondary)
                        Picker("Default agent", selection: $defaultAgentId) {
                            Text("First available agent (default)").tag("")
                            ForEach(agents) { agent in
                                Text(agent.model.map { "\(agent.name) — \($0)" } ?? agent.name)
                                    .tag(agent.id)
                            }
                        }
                        .pickerStyle(.menu)
                        .onChange(of: defaultAgentId) { _, value in
                            saveConfigPatch(["default_agent_id": value], key: "default_agent_id")
                        }
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Default Model")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        if !availableModels.isEmpty {
                            Picker("Known model", selection: $defaultModel) {
                                Text("Auto").tag("")
                                ForEach(availableModels, id: \.self) { model in
                                    Text(model).tag(model)
                                }
                            }
                            .pickerStyle(.menu)
                            .onChange(of: defaultModel) { _, value in
                                saveConfigPatch(["default_model": value], key: "default_model")
                            }
                        }
                        TextField("Default model", text: $defaultModel)
                            .textFieldStyle(.roundedBorder)
                            .onSubmit {
                                saveConfigPatch(["default_model": defaultModel], key: "default_model")
                            }
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Reasoning")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        Picker("Default reasoning effort", selection: $reasoningEffort) {
                            ForEach(nativeReasoningEfforts, id: \.value) { option in
                                Text(option.label).tag(option.value)
                            }
                        }
                        .pickerStyle(.segmented)
                        .onChange(of: reasoningEffort) { _, value in
                            saveConfigPatch(["reasoning_effort": value], key: "reasoning_effort")
                        }
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Chat and Agent Behavior")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        toggleRow(
                            "Queue / Steer follow-ups",
                            detail: "Allow messages sent during an active response to queue or steer the current run.",
                            isOn: $followUpBehaviorEnabled
                        ) {
                            saveConfigPatch(
                                ["follow_up_behavior_enabled": followUpBehaviorEnabled],
                                key: "follow_up_behavior_enabled"
                            )
                        }
                        Divider()
                        toggleRow(
                            "Self-improving skills",
                            detail: "Let agents save reusable skills after complex tasks.",
                            isOn: $selfImprovingSkills
                        ) {
                            saveConfigPatch(
                                ["self_improving_skills_enabled": selfImprovingSkills],
                                key: "self_improving_skills_enabled"
                            )
                        }
                    }
                }

            }
            .nativeSettingsContentLayout()
        }
    }

    var labTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NativeSettingsLayout.cardSpacing) {
                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Lab Availability", systemImage: "flask")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        toggleRow(
                            "Enable Lab",
                            detail: "Expose evals, traces, benchmarks, and training exports without deleting stored data.",
                            isOn: $labEnabled
                        ) { saveLabSettings() }
                        Divider()
                        toggleRow(
                            "Golden turn actions",
                            detail: "Allow completed assistant turns to be saved as replayable golden tests.",
                            isOn: $labGoldenTurnsEnabled
                        ) { saveLabSettings() }
                        .disabled(!labEnabled)
                        Divider()
                        toggleRow(
                            "Capture completed turns",
                            detail: "Store prompts, responses, observable reasoning, and tool I/O locally.",
                            isOn: $labTrajectoryCaptureEnabled
                        ) { saveLabSettings() }
                        .disabled(!labEnabled)
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Training Exports", systemImage: "cylinder.split.1x2")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        toggleRow(
                            "Redact exports by default",
                            detail: "Remove sensitive prompt, path, reasoning, and tool data unless explicitly changed.",
                            isOn: $labSanitizeExportsByDefault
                        ) { saveLabSettings() }
                        .disabled(!labEnabled)
                        Picker("Default dataset format", selection: $labDefaultExportFormat) {
                            Text("Sequence distillation SFT").tag("distillation_sft")
                            Text("Hugging Face TRL SFT").tag("trl_sft")
                            Text("Hugging Face session trace").tag("hf_session_trace")
                            Text("Full agent trajectory").tag("cybara_trace")
                            Text("Long-context QA").tag("long_context")
                            Text("Prompt and completion").tag("prompt_completion")
                        }
                        .pickerStyle(.menu)
                        .disabled(!labEnabled)
                        .onChange(of: labDefaultExportFormat) { _, _ in saveLabSettings() }
                    }
                }
            }
            .nativeSettingsContentLayout()
        }
    }

    var speechTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NativeSettingsLayout.cardSpacing) {
                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Image(systemName: "speaker.wave.2")
                                .foregroundStyle(.secondary)
                            Text("Text to Speech")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            Spacer()
                            progressLabel(for: "speech", fallback: speechTTSProviderLabel)
                        }
                        Picker("Provider", selection: $speechTTSProvider) {
                            Text("Auto").tag("auto")
                            Text("Kokoro 82M").tag("local")
                            Text("ElevenLabs").tag("elevenlabs")
                            Text("OpenAI").tag("openai")
                            Text("System").tag("system")
                        }
                        .pickerStyle(.segmented)
                        .onChange(of: speechTTSProvider) { _, _ in saveSpeechSettings() }

                        if speechTTSProvider != "local" && speechTTSProvider != "system" {
                            Picker("Provider account", selection: $speechTTSProviderId) {
                                Text("Auto").tag("")
                                ForEach(ttsProviderAccounts) { provider in
                                    Text("\(provider.displayName) (\(provider.providerType))").tag(provider.id)
                                }
                            }
                            .pickerStyle(.menu)
                            .onChange(of: speechTTSProviderId) { _, _ in saveSpeechSettings() }
                        }

                        ViewThatFits(in: .horizontal) {
                            HStack(spacing: 12) { ttsTextFields }
                            VStack(alignment: .leading, spacing: 10) { ttsTextFields }
                        }

                        if speechTTSProvider != "local" && speechTTSProvider != "system" {
                            Picker("Format", selection: $speechTTSFormat) {
                                Text("MP3").tag("mp3")
                                Text("M4A").tag("m4a")
                                Text("WAV").tag("wav")
                                Text("Opus").tag("opus")
                                Text("AAC").tag("aac")
                                Text("AIFF").tag("aiff")
                            }
                            .pickerStyle(.segmented)
                            .onChange(of: speechTTSFormat) { _, _ in saveSpeechSettings() }

                            Toggle("Fallback to system voice", isOn: $speechTTSFallback)
                                .toggleStyle(.switch)
                                .onChange(of: speechTTSFallback) { _, _ in saveSpeechSettings() }
                        }
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Image(systemName: "mic")
                                .foregroundStyle(.secondary)
                            Text("Speech to Text")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            Spacer()
                        }
                        Picker("Mode", selection: $speechSTTProvider) {
                            Text("Auto").tag("auto")
                            Text("On-device").tag("native")
                            Text("Local Whisper").tag("local")
                            Text("OpenAI").tag("openai")
                        }
                        .pickerStyle(.segmented)
                        .onChange(of: speechSTTProvider) { _, _ in saveSpeechSettings() }

                        Picker("Provider account", selection: $speechSTTProviderId) {
                            Text("Auto").tag("")
                            ForEach(sttProviderAccounts) { provider in
                                Text("\(provider.displayName) (\(provider.providerType))").tag(provider.id)
                            }
                        }
                        .pickerStyle(.menu)
                        .onChange(of: speechSTTProviderId) { _, _ in saveSpeechSettings() }

                        ViewThatFits(in: .horizontal) {
                            HStack(spacing: 12) { sttTextFields }
                            VStack(alignment: .leading, spacing: 10) { sttTextFields }
                        }
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Image(systemName: "waveform.circle")
                                .foregroundStyle(.secondary)
                            Text("Hands-free Conversation")
                                .font(.system(size: 15, weight: .bold, design: .rounded))
                            Spacer()
                        }
                        Picker("Engine", selection: $speechRealtimeProvider) {
                            Text("Managed").tag("managed")
                            Text("OpenAI").tag("openai")
                            Text("Gemini").tag("gemini")
                            Text("Moshi").tag("moshi")
                        }
                        .pickerStyle(.segmented)
                        .onChange(of: speechRealtimeProvider) { _, _ in
                            speechRealtimeProviderId = ""
                            saveSpeechSettings()
                        }

                        if speechRealtimeProvider == "moshi" {
                            TextField("Server URL", text: $speechRealtimeServerURL)
                                .textFieldStyle(.roundedBorder)
                                .onSubmit { saveSpeechSettings() }
                        } else if speechRealtimeProvider != "managed" {
                            Picker("Provider account", selection: $speechRealtimeProviderId) {
                                Text("Auto").tag("")
                                ForEach(realtimeProviderAccounts) { provider in
                                    Text(provider.displayName).tag(provider.id)
                                }
                            }
                            .pickerStyle(.menu)
                            .onChange(of: speechRealtimeProviderId) { _, _ in saveSpeechSettings() }
                            ViewThatFits(in: .horizontal) {
                                HStack(spacing: 12) {
                                    TextField("Model", text: $speechRealtimeModel)
                                    TextField("Voice", text: $speechRealtimeVoice)
                                }
                                VStack(alignment: .leading, spacing: 10) {
                                    TextField("Model", text: $speechRealtimeModel)
                                    TextField("Voice", text: $speechRealtimeVoice)
                                }
                            }
                            .textFieldStyle(.roundedBorder)
                        }

                        Toggle("Interrupt while speaking", isOn: $speechRealtimeBargeIn)
                            .toggleStyle(.switch)
                            .onChange(of: speechRealtimeBargeIn) { _, _ in saveSpeechSettings() }
                        Picker("End-of-turn pause", selection: $speechRealtimeSilence) {
                            Text("Fast · 0.4 seconds").tag("400")
                            Text("Balanced · 0.7 seconds").tag("700")
                            Text("Patient · 1 second").tag("1000")
                            Text("Very patient · 1.5 seconds").tag("1500")
                        }
                        .pickerStyle(.menu)
                        .onChange(of: speechRealtimeSilence) { _, _ in saveSpeechSettings() }
                    }
                }

                HStack {
                    Spacer()
                    Button {
                        saveSpeechSettings()
                    } label: {
                        Label("Save Speech", systemImage: "checkmark.circle")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(savingKey == "speech")
                }
            }
            .nativeSettingsContentLayout()
        }
    }

}
