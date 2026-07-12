import { useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { Mic, Radio, Volume2 } from "lucide-react-native";
import type { CybaraMobileApi, FeatureSummary } from "../lib/api";
import { colors } from "../theme/liquidGlass";
import {
  SettingSelector,
  SettingToggle,
  SettingsSection,
  SettingsTextField,
} from "./dashboardControls";
import {
  endpointErrorDetail,
  mobileSpeechProviderOptions,
  readMobileSpeechSettings,
  type MobileSpeechSettings,
} from "./dashboardHelpers";
import { EmptyState, LoadingState } from "./dashboardPrimitives";
import { styles } from "./dashboardStyles";

export function SpeechSettingsPanel({
  accentColor,
  api,
  summary,
  refreshSummary,
}: {
  accentColor: string;
  api: CybaraMobileApi;
  summary: FeatureSummary | null;
  refreshSummary: () => void;
}) {
  const configAvailable = summary?.availability.config.ok === true;
  const speechSettings = readMobileSpeechSettings(summary?.config);
  const [speechDraft, setSpeechDraft] = useState(speechSettings);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSpeechDraft(speechSettings);
  }, [
    speechSettings.stt.language,
    speechSettings.stt.model,
    speechSettings.stt.provider,
    speechSettings.stt.providerId,
    speechSettings.realtime.bargeIn,
    speechSettings.realtime.model,
    speechSettings.realtime.provider,
    speechSettings.realtime.providerId,
    speechSettings.realtime.serverUrl,
    speechSettings.realtime.silenceDurationMs,
    speechSettings.realtime.voice,
    speechSettings.tts.fallbackToSystem,
    speechSettings.tts.maxTextLength,
    speechSettings.tts.model,
    speechSettings.tts.outputFormat,
    speechSettings.tts.provider,
    speechSettings.tts.providerId,
    speechSettings.tts.speed,
    speechSettings.tts.voice,
  ]);

  const saveSpeech = async (
    section: "tts" | "stt" | "realtime",
    patch:
      | Partial<MobileSpeechSettings["tts"]>
      | Partial<MobileSpeechSettings["stt"]>
      | Partial<MobileSpeechSettings["realtime"]>
  ) => {
    if (!configAvailable || saving) return;
    const nextSpeech: MobileSpeechSettings = {
      ...speechDraft,
      [section]: { ...speechDraft[section], ...patch },
    };
    setSpeechDraft(nextSpeech);
    setSaving(true);
    try {
      const result = await api.updateConfig({ speech: nextSpeech });
      if (result.success === false) throw new Error("Speech setting failed");
      await refreshSummary();
    } catch (error) {
      Alert.alert("Speech setting failed", error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  if (!configAvailable) {
    return (
      <SettingsSection title="Speech">
        {!summary ? (
          <LoadingState
            label="Loading speech settings"
            detail="Fetching config from the gateway."
          />
        ) : (
          <EmptyState
            label="Speech settings unavailable"
            detail={endpointErrorDetail(
              summary?.availability.config,
              "The gateway did not return editable speech settings."
            )}
          />
        )}
      </SettingsSection>
    );
  }

  return (
    <>
      <SettingsSection title="Text to speech">
        <View style={styles.settingsGroupHeader}>
          <Volume2 color={accentColor} size={18} strokeWidth={2.1} />
          <Text style={styles.settingsInfoTitle}>Voice output</Text>
        </View>
        <SettingSelector
          disabled={saving}
          label="TTS provider"
          onSelect={(value) => {
            const provider =
              value === "local" ||
              value === "system" ||
              value === "elevenlabs" ||
              value === "openai"
                ? value
                : "auto";
            void saveSpeech("tts", { provider });
          }}
          options={[
            { label: "Auto", value: "auto" },
            { label: "Kokoro 82M · Local", value: "local" },
            { label: "ElevenLabs", value: "elevenlabs" },
            { label: "OpenAI", value: "openai" },
            { label: "System", value: "system" },
          ]}
          selected={speechDraft.tts.provider}
          tone={accentColor}
          variant="menu"
        />
        {speechDraft.tts.provider !== "local" && speechDraft.tts.provider !== "system" ? (
          <>
            <SettingSelector
              disabled={saving}
              label="TTS account"
              onSelect={(providerId) => {
                void saveSpeech("tts", { providerId });
              }}
              options={mobileSpeechProviderOptions(summary?.providers || [], "tts")}
              selected={speechDraft.tts.providerId}
              tone={accentColor}
              variant="menu"
            />
            <SettingsTextField
              label="TTS model"
              onBlur={() => {
                void saveSpeech("tts", { model: speechDraft.tts.model });
              }}
              onChangeText={(model) =>
                setSpeechDraft((current) => ({ ...current, tts: { ...current.tts, model } }))
              }
              placeholder="eleven_multilingual_v2"
              value={speechDraft.tts.model}
            />
          </>
        ) : null}
        <SettingsTextField
          label="Voice"
          onBlur={() => {
            void saveSpeech("tts", { voice: speechDraft.tts.voice });
          }}
          onChangeText={(voice) =>
            setSpeechDraft((current) => ({ ...current, tts: { ...current.tts, voice } }))
          }
          placeholder="Voice ID or name"
          value={speechDraft.tts.voice}
        />
        {speechDraft.tts.provider !== "local" && speechDraft.tts.provider !== "system" ? (
          <>
            <SettingSelector
              disabled={saving}
              label="Audio format"
              onSelect={(outputFormat) => {
                void saveSpeech("tts", { outputFormat });
              }}
              options={[
                { label: "MP3", value: "mp3" },
                { label: "M4A", value: "m4a" },
                { label: "WAV", value: "wav" },
                { label: "Opus", value: "opus" },
                { label: "AAC", value: "aac" },
                { label: "AIFF", value: "aiff" },
              ]}
              selected={speechDraft.tts.outputFormat}
              tone={accentColor}
              variant="menu"
            />
            <SettingToggle
              busy={saving}
              detail="Use the gateway operating system's voice if the selected cloud voice is unavailable."
              disabled={saving}
              label="System voice fallback"
              onPress={() => {
                void saveSpeech("tts", { fallbackToSystem: !speechDraft.tts.fallbackToSystem });
              }}
              tone={accentColor}
              value={speechDraft.tts.fallbackToSystem}
            />
          </>
        ) : null}
      </SettingsSection>
      <SettingsSection title="Speech to text">
        <View style={styles.settingsGroupHeader}>
          <Mic color={accentColor} size={18} strokeWidth={2.1} />
          <Text style={styles.settingsInfoTitle}>Dictation</Text>
        </View>
        <SettingSelector
          disabled={saving}
          label="STT mode"
          onSelect={(provider) => {
            const nextProvider = provider === "native" || provider === "openai" ? provider : "auto";
            void saveSpeech("stt", { provider: nextProvider });
          }}
          options={[
            { label: "Auto", value: "auto" },
            { label: "Native dictation", value: "native" },
            { label: "OpenAI compatible", value: "openai" },
          ]}
          selected={speechDraft.stt.provider}
          tone={accentColor}
          variant="menu"
        />
        <SettingSelector
          disabled={saving}
          label="STT account"
          onSelect={(providerId) => {
            void saveSpeech("stt", { providerId });
          }}
          options={mobileSpeechProviderOptions(summary?.providers || [], "stt")}
          selected={speechDraft.stt.providerId}
          tone={accentColor}
          variant="menu"
        />
        <SettingsTextField
          label="STT model"
          onBlur={() => {
            void saveSpeech("stt", { model: speechDraft.stt.model });
          }}
          onChangeText={(model) =>
            setSpeechDraft((current) => ({ ...current, stt: { ...current.stt, model } }))
          }
          placeholder="gpt-4o-mini-transcribe"
          value={speechDraft.stt.model}
        />
        <SettingsTextField
          label="Language"
          onBlur={() => {
            void saveSpeech("stt", { language: speechDraft.stt.language });
          }}
          onChangeText={(language) =>
            setSpeechDraft((current) => ({ ...current, stt: { ...current.stt, language } }))
          }
          placeholder="en"
          value={speechDraft.stt.language}
        />
      </SettingsSection>
      <SettingsSection title="Hands-free">
        <View style={styles.settingsGroupHeader}>
          <Radio color={accentColor} size={18} strokeWidth={2.1} />
          <Text style={styles.settingsInfoTitle}>Realtime conversation</Text>
        </View>
        <SettingSelector
          disabled={saving}
          label="Conversation engine"
          onSelect={(value) => {
            const provider =
              value === "openai" || value === "gemini" || value === "moshi" ? value : "managed";
            void saveSpeech("realtime", { provider, providerId: "" });
          }}
          options={[
            { label: "Cybara managed", value: "managed" },
            { label: "OpenAI Realtime", value: "openai" },
            { label: "Gemini Live", value: "gemini" },
            { label: "Moshi server", value: "moshi" },
          ]}
          selected={speechDraft.realtime.provider}
          tone={accentColor}
          variant="menu"
        />
        {speechDraft.realtime.provider === "moshi" ? (
          <SettingsTextField
            label="Server URL"
            onBlur={() => {
              void saveSpeech("realtime", { serverUrl: speechDraft.realtime.serverUrl });
            }}
            onChangeText={(serverUrl) =>
              setSpeechDraft((current) => ({
                ...current,
                realtime: { ...current.realtime, serverUrl },
              }))
            }
            placeholder="https://voice.example.com"
            value={speechDraft.realtime.serverUrl}
          />
        ) : speechDraft.realtime.provider !== "managed" ? (
          <SettingSelector
            disabled={saving}
            label="Provider account"
            onSelect={(providerId) => {
              void saveSpeech("realtime", { providerId });
            }}
            options={[
              { label: "Auto select", value: "" },
              ...(summary?.providers || [])
                .filter((provider) => {
                  const type = provider.provider || "";
                  return speechDraft.realtime.provider === "openai"
                    ? type === "openai"
                    : ["google", "gemini", "google-ai", "google_ai"].includes(type);
                })
                .map((provider) => ({ label: provider.name, value: provider.id })),
            ]}
            selected={speechDraft.realtime.providerId}
            tone={accentColor}
            variant="menu"
          />
        ) : null}
        {speechDraft.realtime.provider !== "managed" &&
        speechDraft.realtime.provider !== "moshi" ? (
          <>
            <SettingsTextField
              label="Model"
              onBlur={() => {
                void saveSpeech("realtime", { model: speechDraft.realtime.model });
              }}
              onChangeText={(model) =>
                setSpeechDraft((current) => ({
                  ...current,
                  realtime: { ...current.realtime, model },
                }))
              }
              placeholder={
                speechDraft.realtime.provider === "openai"
                  ? "gpt-realtime-2"
                  : "gemini-3.1-flash-live-preview"
              }
              value={speechDraft.realtime.model}
            />
            <SettingsTextField
              label="Voice"
              onBlur={() => {
                void saveSpeech("realtime", { voice: speechDraft.realtime.voice });
              }}
              onChangeText={(voice) =>
                setSpeechDraft((current) => ({
                  ...current,
                  realtime: { ...current.realtime, voice },
                }))
              }
              placeholder={speechDraft.realtime.provider === "openai" ? "marin" : "Aoede"}
              value={speechDraft.realtime.voice}
            />
          </>
        ) : null}
        <SettingToggle
          busy={saving}
          detail="Stop the response when you begin talking."
          disabled={saving}
          label="Interrupt while speaking"
          onPress={() => {
            void saveSpeech("realtime", { bargeIn: !speechDraft.realtime.bargeIn });
          }}
          tone={accentColor}
          value={speechDraft.realtime.bargeIn}
        />
        <SettingSelector
          disabled={saving}
          label="End-of-turn pause"
          onSelect={(value) => {
            void saveSpeech("realtime", { silenceDurationMs: Number(value) });
          }}
          options={[
            { label: "Fast · 0.4 seconds", value: "400" },
            { label: "Balanced · 0.7 seconds", value: "700" },
            { label: "Patient · 1 second", value: "1000" },
            { label: "Very patient · 1.5 seconds", value: "1500" },
          ]}
          selected={String(speechDraft.realtime.silenceDurationMs)}
          tone={accentColor}
          variant="menu"
        />
      </SettingsSection>
    </>
  );
}
