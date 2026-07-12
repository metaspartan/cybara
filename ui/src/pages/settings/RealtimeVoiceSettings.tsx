import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { chatApi } from "@/lib/api";
import { useUIStore } from "@/stores/uiStore";
import { Activity, CheckCircle2, Loader2, Radio, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import type { SpeechSettingsState } from "./SpeechSettingsSection";

interface ProviderOption {
  id: string;
  name: string;
  provider?: string;
  type?: string;
}

interface RealtimeVoiceSettingsProps {
  providers: ProviderOption[];
  realtime: SpeechSettingsState["realtime"];
  status: Awaited<ReturnType<typeof chatApi.getSpeechStatus>>["data"] | null;
  statusLoading: boolean;
  onChange: (realtime: SpeechSettingsState["realtime"]) => void;
}

export function RealtimeVoiceSettings({
  providers,
  realtime,
  status,
  statusLoading,
  onChange,
}: RealtimeVoiceSettingsProps) {
  const addToast = useUIStore((state) => state.addToast);
  const [testing, setTesting] = useState(false);
  const providerOptions = useMemo(() => {
    const accepted =
      realtime.provider === "openai"
        ? new Set(["openai"])
        : new Set(["google", "gemini", "google-ai", "google_ai"]);
    return [
      { value: "", label: "Auto select" },
      ...providers
        .filter((provider) => accepted.has(provider.provider || provider.type || ""))
        .map((provider) => ({ value: provider.id, label: provider.name })),
    ];
  }, [providers, realtime.provider]);

  const patch = (value: Partial<SpeechSettingsState["realtime"]>) => {
    onChange({ ...realtime, ...value });
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const result = await chatApi.testRealtimeVoiceConnection();
      if (!result.success || !result.data?.result.success) {
        throw new Error(result.error || "Connection test failed");
      }
      addToast("success", result.data.result.detail);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Connection test failed");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Radio className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
          <div>
            <h3 className="text-sm font-semibold text-white">Hands-free conversation</h3>
            <p className="mt-1 max-w-xl text-xs leading-5 text-gray-400">
              Use Cybara's managed agent voice loop or connect a native full-duplex speech service.
            </p>
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-gray-400">
          {statusLoading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : status?.realtime?.ready ? (
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
          ) : (
            <TriangleAlert className="h-3 w-3 text-amber-500" />
          )}
          {statusLoading ? "Checking" : status?.realtime?.ready ? "Ready" : "Needs setup"}
        </span>
      </div>

      <Select
        label="Conversation engine"
        options={[
          { value: "managed", label: "Cybara managed" },
          { value: "openai", label: "OpenAI Realtime" },
          { value: "gemini", label: "Gemini Live" },
          { value: "moshi", label: "Moshi-compatible server" },
        ]}
        value={realtime.provider}
        onChange={(provider) =>
          patch({
            provider: provider as SpeechSettingsState["realtime"]["provider"],
            providerId: "",
          })
        }
      />

      {realtime.provider === "managed" ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-xs leading-5 text-gray-400">
          Voice activity detection, transcription, your selected agent and tools, then speech
          output. This preserves the full Cybara agent workflow.
        </div>
      ) : realtime.provider === "moshi" ? (
        <Input
          label="Server URL"
          placeholder="https://voice.example.com"
          value={realtime.serverUrl}
          onChange={(event) => patch({ serverUrl: event.target.value })}
        />
      ) : (
        <Select
          label="Provider account"
          options={providerOptions}
          value={realtime.providerId}
          onChange={(providerId) => patch({ providerId })}
        />
      )}

      {realtime.provider !== "managed" && realtime.provider !== "moshi" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Model"
            placeholder={
              realtime.provider === "openai" ? "gpt-realtime-2" : "gemini-3.1-flash-live-preview"
            }
            value={realtime.model}
            onChange={(event) => patch({ model: event.target.value })}
          />
          <Input
            label="Voice"
            placeholder={realtime.provider === "openai" ? "marin" : "Aoede"}
            value={realtime.voice}
            onChange={(event) => patch({ voice: event.target.value })}
          />
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex min-h-14 items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
          <div>
            <p className="text-sm text-white">Interrupt while speaking</p>
            <p className="text-[11px] text-gray-400">Stop the response when you begin talking.</p>
          </div>
          <Switch checked={realtime.bargeIn} onChange={(bargeIn) => patch({ bargeIn })} />
        </div>
        <Select
          label="End-of-turn pause"
          options={[
            { value: "400", label: "Fast · 0.4 seconds" },
            { value: "700", label: "Balanced · 0.7 seconds" },
            { value: "1000", label: "Patient · 1 second" },
            { value: "1500", label: "Very patient · 1.5 seconds" },
          ]}
          value={String(realtime.silenceDurationMs)}
          onChange={(value) => patch({ silenceDurationMs: Number(value) })}
        />
      </div>

      {status?.realtime?.error ? (
        <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
          {status.realtime.error}
        </p>
      ) : null}

      <Button
        variant="secondary"
        size="sm"
        leftIcon={
          testing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Activity className="h-3.5 w-3.5" />
          )
        }
        onClick={() => void testConnection()}
        disabled={testing || !status?.realtime?.ready}
      >
        Test connection
      </Button>
    </div>
  );
}
