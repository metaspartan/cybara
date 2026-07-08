import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { settingsApi } from "@/lib/api";
import { useProviders } from "@/hooks/useApi";
import { useUIStore } from "@/stores/uiStore";
import { Mic, RefreshCw, Save, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";

export type SpeechSettingsState = {
  tts: {
    provider: "auto" | "system" | "elevenlabs" | "openai";
    providerId: string;
    model: string;
    voice: string;
    outputFormat: "mp3" | "m4a" | "wav" | "aiff" | "opus" | "aac";
    speed: number;
    maxTextLength: number;
    fallbackToSystem: boolean;
  };
  stt: {
    provider: "auto" | "native" | "openai";
    providerId: string;
    model: string;
    language: string;
  };
};

const defaultSpeechSettings: SpeechSettingsState = {
  tts: {
    provider: "auto",
    providerId: "",
    model: "",
    voice: "",
    outputFormat: "mp3",
    speed: 1,
    maxTextLength: 8000,
    fallbackToSystem: true,
  },
  stt: {
    provider: "auto",
    providerId: "",
    model: "",
    language: "",
  },
};

function speechRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readSpeechSettings(value: unknown): SpeechSettingsState {
  const root = speechRecord(value);
  const tts = speechRecord(root.tts);
  const stt = speechRecord(root.stt);
  const ttsProvider =
    tts.provider === "system" || tts.provider === "elevenlabs" || tts.provider === "openai"
      ? tts.provider
      : "auto";
  const sttProvider =
    stt.provider === "native" || stt.provider === "openai" ? stt.provider : "auto";
  const outputFormat =
    tts.outputFormat === "m4a" ||
    tts.outputFormat === "wav" ||
    tts.outputFormat === "aiff" ||
    tts.outputFormat === "opus" ||
    tts.outputFormat === "aac"
      ? tts.outputFormat
      : "mp3";
  return {
    tts: {
      provider: ttsProvider,
      providerId: typeof tts.providerId === "string" ? tts.providerId : "",
      model: typeof tts.model === "string" ? tts.model : "",
      voice: typeof tts.voice === "string" ? tts.voice : "",
      outputFormat,
      speed: typeof tts.speed === "number" && Number.isFinite(tts.speed) ? tts.speed : 1,
      maxTextLength:
        typeof tts.maxTextLength === "number" && Number.isFinite(tts.maxTextLength)
          ? tts.maxTextLength
          : 8000,
      fallbackToSystem: typeof tts.fallbackToSystem === "boolean" ? tts.fallbackToSystem : true,
    },
    stt: {
      provider: sttProvider,
      providerId: typeof stt.providerId === "string" ? stt.providerId : "",
      model: typeof stt.model === "string" ? stt.model : "",
      language: typeof stt.language === "string" ? stt.language : "",
    },
  };
}

export function SpeechSettingsSection() {
  const { data: providers } = useProviders();
  const { addToast } = useUIStore();
  const [speech, setSpeech] = useState<SpeechSettingsState>(defaultSpeechSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const result = await settingsApi.getConfig();
        if (!mounted || !result.success) return;
        setSpeech(readSpeechSettings(result.data?.speech));
      } catch {
        void 0;
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const providerOptions = [
    { value: "", label: "Auto select" },
    ...((providers || [])
      .filter((provider) => {
        const type = provider.provider || provider.type || "";
        return type === "elevenlabs" || type === "openai" || type === "openai-codex";
      })
      .map((provider) => ({
        value: provider.id,
        label: `${provider.name} (${provider.provider || provider.type})`,
      })) || []),
  ];
  const sttProviderOptions = [
    { value: "", label: "Auto select" },
    ...((providers || [])
      .filter((provider) => {
        const type = provider.provider || provider.type || "";
        return type === "openai" || type === "openai-codex";
      })
      .map((provider) => ({
        value: provider.id,
        label: `${provider.name} (${provider.provider || provider.type})`,
      })) || []),
  ];

  const save = async () => {
    setSaving(true);
    try {
      const result = await settingsApi.updateConfig({ speech });
      if (!result.success || result.data?.success === false) {
        throw new Error(result.error || "Speech settings were not saved");
      }
      addToast("success", "Speech settings saved");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to save speech settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card variant="liquid">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Volume2 className="w-5 h-5 text-cyan-400" />
          Speech
        </CardTitle>
        <CardDescription>
          TTS and dictation defaults shared by Web, Tauri, mobile, and native apps
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-cyan-300" />
              <h3 className="text-sm font-semibold text-white">Text to Speech</h3>
            </div>
            <Select
              label="Provider"
              options={[
                { value: "auto", label: "Auto" },
                { value: "elevenlabs", label: "ElevenLabs" },
                { value: "openai", label: "OpenAI" },
                { value: "system", label: "System voice" },
              ]}
              value={speech.tts.provider}
              onChange={(provider) =>
                setSpeech((current) => ({
                  ...current,
                  tts: {
                    ...current.tts,
                    provider: provider as SpeechSettingsState["tts"]["provider"],
                  },
                }))
              }
            />
            <Select
              label="Provider account"
              options={providerOptions}
              value={speech.tts.providerId}
              onChange={(providerId) =>
                setSpeech((current) => ({ ...current, tts: { ...current.tts, providerId } }))
              }
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Model"
                placeholder="eleven_multilingual_v2"
                value={speech.tts.model}
                onChange={(event) =>
                  setSpeech((current) => ({
                    ...current,
                    tts: { ...current.tts, model: event.target.value },
                  }))
                }
              />
              <Input
                label="Voice"
                placeholder="Voice ID or name"
                value={speech.tts.voice}
                onChange={(event) =>
                  setSpeech((current) => ({
                    ...current,
                    tts: { ...current.tts, voice: event.target.value },
                  }))
                }
              />
              <Select
                label="Format"
                options={[
                  { value: "mp3", label: "MP3" },
                  { value: "m4a", label: "M4A" },
                  { value: "wav", label: "WAV" },
                  { value: "opus", label: "Opus" },
                  { value: "aac", label: "AAC" },
                  { value: "aiff", label: "AIFF" },
                ]}
                value={speech.tts.outputFormat}
                onChange={(outputFormat) =>
                  setSpeech((current) => ({
                    ...current,
                    tts: {
                      ...current.tts,
                      outputFormat: outputFormat as SpeechSettingsState["tts"]["outputFormat"],
                    },
                  }))
                }
              />
              <Input
                label="Max characters"
                min={1}
                max={50000}
                type="number"
                value={speech.tts.maxTextLength}
                onChange={(event) =>
                  setSpeech((current) => ({
                    ...current,
                    tts: {
                      ...current.tts,
                      maxTextLength: Number(event.target.value) || 8000,
                    },
                  }))
                }
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Input
                label="Speed"
                min={0.5}
                max={2}
                step={0.05}
                type="number"
                value={speech.tts.speed}
                onChange={(event) =>
                  setSpeech((current) => ({
                    ...current,
                    tts: { ...current.tts, speed: Number(event.target.value) || 1 },
                  }))
                }
              />
              <label className="flex items-center gap-3 rounded-xl bg-white/5 border border-white/10 px-4 py-3 mt-6">
                <input
                  type="checkbox"
                  checked={speech.tts.fallbackToSystem}
                  onChange={(event) =>
                    setSpeech((current) => ({
                      ...current,
                      tts: { ...current.tts, fallbackToSystem: event.target.checked },
                    }))
                  }
                  className="w-4 h-4 rounded border-white/20 bg-white/5 text-indigo-500 focus:ring-indigo-500"
                />
                <span className="text-sm text-gray-300">Fallback to macOS system voice</span>
              </label>
            </div>
          </div>

          <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Mic className="w-4 h-4 text-emerald-300" />
              <h3 className="text-sm font-semibold text-white">Speech to Text</h3>
            </div>
            <Select
              label="Provider"
              options={[
                { value: "auto", label: "Auto: native when available, then model" },
                { value: "native", label: "Native dictation only" },
                { value: "openai", label: "OpenAI-compatible transcription" },
              ]}
              value={speech.stt.provider}
              onChange={(provider) =>
                setSpeech((current) => ({
                  ...current,
                  stt: {
                    ...current.stt,
                    provider: provider as SpeechSettingsState["stt"]["provider"],
                  },
                }))
              }
            />
            <Select
              label="Provider account"
              options={sttProviderOptions}
              value={speech.stt.providerId}
              onChange={(providerId) =>
                setSpeech((current) => ({ ...current, stt: { ...current.stt, providerId } }))
              }
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Model"
                placeholder="gpt-4o-mini-transcribe"
                value={speech.stt.model}
                onChange={(event) =>
                  setSpeech((current) => ({
                    ...current,
                    stt: { ...current.stt, model: event.target.value },
                  }))
                }
              />
              <Input
                label="Language"
                placeholder="en"
                value={speech.stt.language}
                onChange={(event) =>
                  setSpeech((current) => ({
                    ...current,
                    stt: { ...current.stt, language: event.target.value },
                  }))
                }
              />
            </div>
            <p className="text-xs text-gray-500">
              Native dictation uses browser or OS speech recognition when available. Model
              transcription records microphone audio and sends it to the configured provider.
            </p>
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            leftIcon={
              saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />
            }
            onClick={() => void save()}
            disabled={saving || loading}
          >
            Save Speech Settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
