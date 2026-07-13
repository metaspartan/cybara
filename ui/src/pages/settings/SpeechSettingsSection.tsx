import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { chatApi, settingsApi } from "@/lib/api";
import { appendApiTokenParam } from "@/lib/auth";
import { useProviders } from "@/hooks/useApi";
import { useUIStore } from "@/stores/uiStore";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  Mic,
  Play,
  RefreshCw,
  Save,
  Trash2,
  Volume2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { RealtimeVoiceSettings } from "./RealtimeVoiceSettings";

type SpeechStatus = Awaited<ReturnType<typeof chatApi.getSpeechStatus>>["data"];

const TTS_PROVIDER_HINTS: Record<string, string> = {
  auto: "Uses your best configured cloud voice, falling back to the system voice if enabled.",
  local: "Kokoro 82M runs fully offline on this machine. No API key or network needed after load.",
  elevenlabs: "Highest-quality cloud voices. Requires an ElevenLabs provider with an API key.",
  openai: "OpenAI text-to-speech. Requires an OpenAI (or OpenAI-compatible) provider with a key.",
  system: "Uses the built-in voice available on this gateway's operating system.",
};

function ReadinessBadge({
  ready,
  loading,
  label,
}: {
  ready: boolean | undefined;
  loading: boolean;
  label: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
        loading
          ? "border-white/15 text-gray-400"
          : ready
            ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
            : "border-amber-400/30 bg-amber-400/10 text-amber-200"
      }`}
    >
      {loading ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : ready ? (
        <CheckCircle2 className="h-3 w-3" />
      ) : (
        <AlertTriangle className="h-3 w-3" />
      )}
      {loading ? "Checking" : label}
    </span>
  );
}

type LocalTtsCatalog = Awaited<ReturnType<typeof chatApi.localSpeechModels>>["data"];

function LocalModelManager({
  kind,
  modelId,
  onModelChange,
  voice,
  onVoiceChange,
}: {
  kind: "tts" | "stt";
  modelId?: string;
  onModelChange?: (model: string) => void;
  voice?: string;
  onVoiceChange?: (voice: string) => void;
}) {
  const addToast = useUIStore((state) => state.addToast);
  const [catalog, setCatalog] = useState<LocalTtsCatalog | null>(null);
  const [busy, setBusy] = useState<"load" | "unload" | null>(null);

  const refresh = useCallback(async () => {
    const response = await chatApi.localSpeechModels();
    if (response.success && response.data) setCatalog(response.data);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const models = kind === "tts" ? catalog?.tts?.models || [] : catalog?.stt?.models || [];
  const statuses = kind === "tts" ? catalog?.tts?.status || [] : catalog?.stt?.status || [];
  const model = models.find((entry) => entry.id === modelId) || models[0];
  const status = statuses.find((entry) => entry.id === model?.id) || statuses[0];
  const defaultVoice = model && "defaultVoice" in model ? model.defaultVoice : "";
  const loading = status?.state === "loading" || busy === "load";

  useEffect(() => {
    if (status?.state !== "loading") return;
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", refreshVisible);
    const timer = window.setInterval(refreshVisible, 1500);
    return () => {
      document.removeEventListener("visibilitychange", refreshVisible);
      window.clearInterval(timer);
    };
  }, [status?.state, refresh]);

  const handleLoad = async () => {
    setBusy("load");
    try {
      const response = await chatApi.loadLocalSpeechModel(model?.id, kind);
      if (!response.success) throw new Error(response.error || "Model load failed");
      addToast("success", kind === "tts" ? "Kokoro voice model is ready" : "Whisper is ready");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Model load failed");
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const handleUnload = async () => {
    setBusy("unload");
    try {
      await chatApi.unloadLocalSpeechModel(model?.id, kind);
      addToast("success", "Model unloaded from memory");
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-white">
            {model?.label || (kind === "tts" ? "Kokoro 82M" : "Whisper Tiny")}
          </p>
          <p className="mt-0.5 text-[11px] leading-4 text-gray-500">
            {model?.description || "Local neural TTS."}{" "}
            {model ? `~${model.sizeMb} MB download.` : ""}
          </p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
            status?.state === "ready"
              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
              : status?.state === "error"
                ? "border-red-400/30 bg-red-400/10 text-red-200"
                : "border-white/15 text-gray-400"
          }`}
        >
          {status?.state === "ready" ? (
            <CheckCircle2 className="h-3 w-3" />
          ) : loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : null}
          {loading ? "Loading" : status?.state === "ready" ? "Ready" : "Not loaded"}
        </span>
      </div>
      {loading && (
        <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full bg-cyan-400 transition-[width] duration-300"
            style={{ width: `${Math.max(4, status?.loadProgress ?? 0)}%` }}
          />
        </div>
      )}
      {status?.state === "error" && status.lastError && (
        <p className="text-[11px] text-red-300">{status.lastError}</p>
      )}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void handleLoad()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          {status?.state === "ready" ? "Reload" : "Download & load"}
        </Button>
        {status?.state === "ready" && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void handleUnload()}
            disabled={busy === "unload"}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Unload
          </Button>
        )}
      </div>
      {kind === "tts" && onVoiceChange ? (
        <Select
          label="Voice"
          options={(catalog?.tts?.voices || []).map((entry) => ({
            value: entry.id,
            label: `${entry.label} · ${entry.language} · ${entry.gender}`,
          }))}
          value={voice || defaultVoice || "af_heart"}
          onChange={onVoiceChange}
        />
      ) : (
        <Select
          label="Local model"
          options={models.map((entry) => ({ value: entry.id, label: entry.label }))}
          value={model?.id || modelId || ""}
          onChange={(value) => onModelChange?.(value)}
        />
      )}
    </div>
  );
}

export type SpeechSettingsState = {
  tts: {
    provider: "auto" | "system" | "elevenlabs" | "openai" | "local";
    providerId: string;
    model: string;
    voice: string;
    outputFormat: "mp3" | "m4a" | "wav" | "aiff" | "opus" | "aac";
    speed: number;
    maxTextLength: number;
    fallbackToSystem: boolean;
  };
  stt: {
    provider: "auto" | "native" | "local" | "openai";
    providerId: string;
    model: string;
    language: string;
  };
  realtime: {
    provider: "managed" | "openai" | "gemini" | "moshi";
    providerId: string;
    model: string;
    voice: string;
    serverUrl: string;
    bargeIn: boolean;
    silenceDurationMs: number;
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
  realtime: {
    provider: "managed",
    providerId: "",
    model: "",
    voice: "",
    serverUrl: "",
    bargeIn: true,
    silenceDurationMs: 700,
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
  const realtime = speechRecord(root.realtime);
  const ttsProvider =
    tts.provider === "system" ||
    tts.provider === "elevenlabs" ||
    tts.provider === "openai" ||
    tts.provider === "local"
      ? tts.provider
      : "auto";
  const sttProvider =
    stt.provider === "native" || stt.provider === "local" || stt.provider === "openai"
      ? stt.provider
      : "auto";
  const realtimeProvider =
    realtime.provider === "openai" ||
    realtime.provider === "gemini" ||
    realtime.provider === "moshi"
      ? realtime.provider
      : "managed";
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
    realtime: {
      provider: realtimeProvider,
      providerId: typeof realtime.providerId === "string" ? realtime.providerId : "",
      model: typeof realtime.model === "string" ? realtime.model : "",
      voice: typeof realtime.voice === "string" ? realtime.voice : "",
      serverUrl: typeof realtime.serverUrl === "string" ? realtime.serverUrl : "",
      bargeIn: typeof realtime.bargeIn === "boolean" ? realtime.bargeIn : true,
      silenceDurationMs:
        typeof realtime.silenceDurationMs === "number" ? realtime.silenceDurationMs : 700,
    },
  };
}

export function SpeechSettingsSection() {
  const { data: providers } = useProviders();
  const { addToast } = useUIStore();
  const [speech, setSpeech] = useState<SpeechSettingsState>(defaultSpeechSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [activeTab, setActiveTab] = useState<"output" | "input" | "realtime">("output");
  const testAudioRef = useRef<HTMLAudioElement | null>(null);

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const result = await chatApi.getSpeechStatus();
      if (result.success && result.data) setStatus(result.data);
    } catch {
      void 0;
    } finally {
      setStatusLoading(false);
    }
  }, []);

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
    void refreshStatus();
    return () => {
      mounted = false;
    };
  }, [refreshStatus]);

  const testVoice = async () => {
    setTesting(true);
    try {
      const result = await chatApi.synthesizeSpeech({
        text: "This is how the selected Cybara voice sounds.",
        providerId: speech.tts.providerId || undefined,
        model: speech.tts.model || undefined,
        voice: speech.tts.voice || undefined,
        speed: speech.tts.speed,
      });
      if (!result.success || !result.data?.audioPath) {
        throw new Error(result.error || "Voice test failed");
      }
      testAudioRef.current?.pause();
      const audio = new Audio(
        appendApiTokenParam(`/api/media?path=${encodeURIComponent(result.data.audioPath)}`)
      );
      testAudioRef.current = audio;
      await audio.play();
      addToast("success", `Playing ${result.data.provider} voice`);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Voice test failed");
    } finally {
      setTesting(false);
    }
  };

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
      void refreshStatus();
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
        <div
          className="inline-grid grid-cols-3 rounded-lg border border-white/10 bg-black/20 p-1"
          role="tablist"
        >
          {(["output", "input", "realtime"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              className={`rounded-md px-4 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab
                  ? "bg-white/10 text-white shadow-sm"
                  : "text-gray-400 hover:bg-white/5 hover:text-white"
              }`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === "output" ? "Output" : tab === "input" ? "Input" : "Realtime"}
            </button>
          ))}
        </div>
        <div>
          {activeTab === "output" ? (
            <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-cyan-300" />
                  <h3 className="text-sm font-semibold text-white">Text to Speech</h3>
                </div>
                <ReadinessBadge
                  loading={statusLoading}
                  ready={status?.tts?.ready}
                  label={status?.tts?.ready ? (status.tts.provider ?? "Ready") : "Needs setup"}
                />
              </div>
              <Select
                label="Provider"
                options={[
                  { value: "auto", label: "Auto (best available)" },
                  { value: "local", label: "Local · Kokoro 82M (offline)" },
                  { value: "elevenlabs", label: "ElevenLabs (cloud)" },
                  { value: "openai", label: "OpenAI (cloud)" },
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
              <p className="text-[11px] leading-4 text-gray-500">
                {TTS_PROVIDER_HINTS[speech.tts.provider] ?? ""}
              </p>
              {status?.tts && !status.tts.ready && status.tts.error && (
                <p className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[11px] leading-4 text-amber-200">
                  {status.tts.error}
                </p>
              )}
              {speech.tts.provider === "local" ? (
                <LocalModelManager
                  kind="tts"
                  voice={speech.tts.voice}
                  onVoiceChange={(voice) =>
                    setSpeech((current) => ({ ...current, tts: { ...current.tts, voice } }))
                  }
                />
              ) : speech.tts.provider === "system" ? (
                <div className="grid grid-cols-1 gap-3">
                  <Input
                    label="System voice name (optional)"
                    placeholder="Optional installed voice name"
                    value={speech.tts.voice}
                    onChange={(event) =>
                      setSpeech((current) => ({
                        ...current,
                        tts: { ...current.tts, voice: event.target.value },
                      }))
                    }
                  />
                </div>
              ) : (
                <Select
                  label="Provider account"
                  options={providerOptions}
                  value={speech.tts.providerId}
                  onChange={(providerId) =>
                    setSpeech((current) => ({ ...current, tts: { ...current.tts, providerId } }))
                  }
                />
              )}
              <div
                className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${
                  speech.tts.provider === "local" || speech.tts.provider === "system"
                    ? "hidden"
                    : ""
                }`}
              >
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
                {speech.tts.provider !== "system" && speech.tts.provider !== "local" && (
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-white/5 border border-white/10 px-4 py-3 mt-6">
                    <span className="text-sm text-gray-300">Fallback to system voice</span>
                    <Switch
                      checked={speech.tts.fallbackToSystem}
                      onChange={(next) =>
                        setSpeech((current) => ({
                          ...current,
                          tts: { ...current.tts, fallbackToSystem: next },
                        }))
                      }
                    />
                  </div>
                )}
              </div>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={
                  testing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )
                }
                onClick={() => void testVoice()}
                disabled={testing || !status?.tts?.ready}
              >
                Test voice
              </Button>
            </div>
          ) : activeTab === "input" ? (
            <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Mic className="w-4 h-4 text-emerald-300" />
                  <h3 className="text-sm font-semibold text-white">Speech to Text</h3>
                </div>
                <ReadinessBadge
                  loading={statusLoading}
                  ready={status?.stt?.ready}
                  label={
                    status?.stt?.ready
                      ? status.stt.native
                        ? "Native dictation"
                        : (status.stt.provider ?? "Ready")
                      : "Needs setup"
                  }
                />
              </div>
              <Select
                label="Provider"
                options={[
                  { value: "auto", label: "Auto: system, then local" },
                  { value: "native", label: "On-device: system, then local" },
                  { value: "local", label: "Local Whisper (offline)" },
                  { value: "openai", label: "OpenAI-compatible (cloud)" },
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
              {speech.stt.provider === "local" ? (
                <LocalModelManager
                  kind="stt"
                  modelId={speech.stt.model}
                  onModelChange={(model) =>
                    setSpeech((current) => ({ ...current, stt: { ...current.stt, model } }))
                  }
                />
              ) : speech.stt.provider === "openai" ? (
                <Select
                  label="Provider account"
                  options={sttProviderOptions}
                  value={speech.stt.providerId}
                  onChange={(providerId) =>
                    setSpeech((current) => ({ ...current, stt: { ...current.stt, providerId } }))
                  }
                />
              ) : null}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {speech.stt.provider === "openai" && (
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
                )}
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
                On-device mode uses platform recognition when available and local Whisper otherwise.
                Local audio stays on the gateway machine. Cloud mode sends recorded audio to the
                selected provider.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <RealtimeVoiceSettings
                providers={providers || []}
                realtime={speech.realtime}
                status={status}
                statusLoading={statusLoading}
                onChange={(realtime) => setSpeech((current) => ({ ...current, realtime }))}
              />
            </div>
          )}
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
