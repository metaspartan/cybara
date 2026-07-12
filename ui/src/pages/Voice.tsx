import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Mic,
  Send,
  Settings2,
  Square,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAgentSummaries } from "@/hooks/useApi";
import { chatApi } from "@/lib/api";
import { appendApiTokenParam } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/uiStore";

type VoiceStatus = "idle" | "listening" | "thinking" | "speaking";
type VoiceTurn = { role: "user" | "assistant"; content: string };
type MicPermission = "granted" | "denied" | "prompt" | "unknown";

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function SetupRow({
  ready,
  title,
  detail,
  action,
}: {
  ready: boolean;
  title: string;
  detail: string;
  action?: { label: string; to: string };
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      {ready ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
      ) : (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-gray-100">{title}</p>
        <p className="mt-0.5 text-[12px] leading-5 text-gray-500">{detail}</p>
      </div>
      {!ready && action && (
        <Link
          to={action.to}
          className="mt-0.5 shrink-0 rounded-md border border-white/15 px-2.5 py-1 text-[11px] text-gray-200 transition-colors hover:bg-white/10"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}

export function Voice() {
  const { data: agents = [] } = useAgentSummaries();
  const addToast = useUIStore((state) => state.addToast);
  const [agentId, setAgentId] = useState("");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [sessionId, setSessionId] = useState<string>();
  const [micPermission, setMicPermission] = useState<MicPermission>("unknown");
  const [setupOpen, setSetupOpen] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const orbRef = useRef<HTMLButtonElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const levelFrameRef = useRef<number | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const speechStatus = useQuery({
    queryKey: ["speech-status"],
    queryFn: async () => {
      const response = await chatApi.getSpeechStatus();
      if (!response.success || !response.data) {
        throw new Error(response.error || "Failed to load speech status");
      }
      return response.data;
    },
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    let active = true;
    const permissions = navigator.permissions as
      | { query?: (input: { name: string }) => Promise<{ state: string; onchange: unknown }> }
      | undefined;
    if (!permissions?.query) {
      setMicPermission("unknown");
      return;
    }
    permissions
      .query({ name: "microphone" })
      .then((result) => {
        if (!active) return;
        setMicPermission(result.state as MicPermission);
        result.onchange = () => setMicPermission(result.state as MicPermission);
      })
      .catch(() => setMicPermission("unknown"));
    return () => {
      active = false;
    };
  }, []);

  const ttsReady = speechStatus.data?.tts.ready || speechStatus.data?.tts.systemFallback || false;
  const sttReady = speechStatus.data?.stt.ready || false;
  const micReady = micPermission === "granted";
  const allReady = ttsReady && sttReady && micReady;
  const setupVisible = speechStatus.isSuccess && (!allReady || setupOpen);

  const setOrbLevel = useCallback((level: number) => {
    orbRef.current?.style.setProperty("--orb-level", String(Math.max(0, Math.min(1, level))));
  }, []);

  const stopLevelMeter = useCallback(() => {
    if (levelFrameRef.current !== null) cancelAnimationFrame(levelFrameRef.current);
    levelFrameRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    setOrbLevel(0);
  }, [setOrbLevel]);

  const startLevelMeter = useCallback(
    (stream: MediaStream) => {
      try {
        const context = new AudioContext();
        audioContextRef.current = context;
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) {
            const centered = (sample - 128) / 128;
            sum += centered * centered;
          }
          const rms = Math.sqrt(sum / samples.length);
          setOrbLevel(Math.min(1, rms * 4));
          levelFrameRef.current = requestAnimationFrame(tick);
        };
        levelFrameRef.current = requestAnimationFrame(tick);
      } catch {
        setOrbLevel(0.4);
      }
    },
    [setOrbLevel]
  );

  const stopAudio = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setStatus("idle");
  };

  const speak = async (text: string) => {
    const result = await chatApi.synthesizeSpeech({ text });
    if (!result.success || !result.data?.audioPath) {
      throw new Error(result.error || "Speech synthesis failed");
    }
    const audio = new Audio(
      appendApiTokenParam(`/api/media?path=${encodeURIComponent(result.data.audioPath)}`)
    );
    audioRef.current = audio;
    setStatus("speaking");
    const clear = () => {
      if (audioRef.current === audio) audioRef.current = null;
      setStatus("idle");
    };
    audio.addEventListener("ended", clear, { once: true });
    audio.addEventListener("error", clear, { once: true });
    await audio.play();
  };

  const send = async (overrideText?: string) => {
    const message = (overrideText ?? input).trim();
    if (!message || status === "thinking") return;
    stopAudio();
    setInput("");
    setTurns((current) => [...current, { role: "user", content: message }]);
    setStatus("thinking");
    try {
      const result = await chatApi.send(message, agentId || undefined, sessionId);
      const response = result.data?.message?.content?.trim();
      if (!result.success || !response) throw new Error(result.error || "Voice chat failed");
      setSessionId(result.data?.sessionId);
      setTurns((current) => [...current, { role: "assistant", content: response }]);
      await speak(response);
    } catch (error) {
      setStatus("idle");
      addToast("error", error instanceof Error ? error.message : "Voice chat failed");
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      addToast("error", "Microphone recording is unavailable in this runtime");
      return;
    }
    try {
      stopAudio();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicPermission("granted");
      streamRef.current = stream;
      chunksRef.current = [];
      startLevelMeter(stream);
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });
      recorder.addEventListener("stop", async () => {
        for (const track of stream.getTracks()) track.stop();
        streamRef.current = null;
        stopLevelMeter();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setStatus("thinking");
        try {
          const result = await chatApi.dictate({
            audioBase64: await blobToBase64(blob),
            mimeType: blob.type,
            fileName: "voice-message.webm",
          });
          if (!result.success || !result.data?.text) {
            throw new Error(result.error || "Transcription failed");
          }
          await send(result.data.text);
        } catch (error) {
          setStatus("idle");
          addToast("error", error instanceof Error ? error.message : "Transcription failed");
        }
      });
      recorder.start();
      setStatus("listening");
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        setMicPermission("denied");
      }
      addToast("error", error instanceof Error ? error.message : "Microphone access failed");
    }
  };

  useEffect(
    () => () => {
      audioRef.current?.pause();
      if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
      for (const track of streamRef.current?.getTracks() || []) track.stop();
      if (levelFrameRef.current !== null) cancelAnimationFrame(levelFrameRef.current);
      void audioContextRef.current?.close().catch(() => undefined);
    },
    []
  );

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [turns]);

  const statusLabel =
    status === "listening"
      ? "Listening…"
      : status === "thinking"
        ? "Thinking…"
        : status === "speaking"
          ? "Speaking"
          : allReady
            ? "Tap to talk"
            : "Ready";

  const orbDisabled = status === "thinking";

  return (
    <main className="min-h-full bg-[var(--color-bg-primary)] px-4 py-8 text-white sm:px-8">
      <div className="mx-auto flex max-w-3xl flex-col items-center">
        <div className="mb-2 flex w-full items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Voice</h1>
            <p className="mt-1 text-sm text-gray-500">Talk naturally with any configured agent.</p>
          </div>
          <button
            type="button"
            onClick={() => setSetupOpen((open) => !open)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11px] transition-colors",
              allReady
                ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/15"
                : "border-amber-400/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/15"
            )}
          >
            {allReady ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5" />
            )}
            {allReady ? "Voice ready" : "Setup needed"}
            <ChevronDown
              className={cn("h-3 w-3 transition-transform", setupVisible && "rotate-180")}
            />
          </button>
        </div>

        {setupVisible && (
          <section className="mb-6 w-full overflow-hidden rounded-xl border border-white/10 bg-white/[0.025]">
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
              <Settings2 className="h-3.5 w-3.5 text-gray-500" />
              <p className="text-[12px] font-medium text-gray-300">Voice setup</p>
            </div>
            <div className="divide-y divide-white/5">
              <SetupRow
                ready={ttsReady}
                title="Voice output"
                detail={
                  speechStatus.data?.tts.ready
                    ? `Speech is synthesized with ${speechStatus.data.tts.provider} (${speechStatus.data.tts.type}).`
                    : speechStatus.data?.tts.systemFallback
                      ? "No speech provider yet — falling back to the built-in system voice."
                      : "Add an OpenAI or ElevenLabs provider with API credentials so replies can be spoken."
                }
                action={{ label: "Add provider", to: "/providers" }}
              />
              <SetupRow
                ready={sttReady}
                title="Transcription"
                detail={
                  speechStatus.data?.stt.native
                    ? "Using native on-device dictation."
                    : speechStatus.data?.stt.ready
                      ? `Your voice is transcribed with ${speechStatus.data.stt.provider}.`
                      : "Add an OpenAI-compatible provider so recordings can be transcribed to text."
                }
                action={{ label: "Add provider", to: "/providers" }}
              />
              <SetupRow
                ready={micReady}
                title="Microphone access"
                detail={
                  micPermission === "granted"
                    ? "Microphone permission granted."
                    : micPermission === "denied"
                      ? "Microphone access is blocked. Allow it in your browser or system settings."
                      : "Tap the orb once to grant microphone access."
                }
              />
            </div>
            <div className="border-t border-white/10 px-4 py-2.5 text-[11px] text-gray-500">
              Voice provider, model, and voice can be tuned in{" "}
              <Link to="/settings" className="text-indigo-300 hover:text-indigo-200">
                Settings → Speech
              </Link>
              .
            </div>
          </section>
        )}

        <button
          ref={orbRef}
          type="button"
          onClick={status === "listening" ? stopRecording : () => void startRecording()}
          disabled={orbDisabled}
          className={cn("voice-orb my-10", `voice-orb--${status}`)}
          aria-label={status === "listening" ? "Stop recording" : "Start recording"}
        >
          <span className="voice-orb-aura" />
          <span className="voice-orb-body">
            <span className="voice-orb-blob voice-orb-blob-a" />
            <span className="voice-orb-blob voice-orb-blob-b" />
            <span className="voice-orb-sheen" />
          </span>
          <span className="voice-orb-ring" />
          <span className="voice-orb-icon">
            {status === "listening" ? (
              <Square className="h-6 w-6 fill-current" />
            ) : status === "thinking" ? (
              <Loader2 className="h-7 w-7 animate-spin" />
            ) : (
              <Mic className="h-7 w-7" />
            )}
          </span>
        </button>

        <div className="mb-8 text-center">
          <div className="text-sm font-medium text-gray-200">{statusLabel}</div>
          {status === "speaking" && (
            <button
              type="button"
              onClick={stopAudio}
              className="mt-1.5 text-xs text-gray-500 transition-colors hover:text-gray-300"
            >
              Tap to stop
            </button>
          )}
        </div>

        <section className="w-full max-w-2xl">
          <div className="mb-3 flex items-center gap-3">
            <select
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              className="h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-gray-200 outline-none focus:border-indigo-400/50"
              aria-label="Voice agent"
            >
              <option value="">Gateway default</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} - {agent.model}
                </option>
              ))}
            </select>
          </div>
          {turns.length > 0 && (
            <div
              ref={transcriptRef}
              className="mb-3 max-h-72 space-y-3 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.02] p-4"
            >
              {turns.map((turn, index) => (
                <div
                  key={`${turn.role}-${index}`}
                  className={cn("flex", turn.role === "user" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-6",
                      turn.role === "user"
                        ? "bg-indigo-500/20 text-indigo-50"
                        : "bg-white/[0.05] text-gray-200"
                    )}
                  >
                    {turn.content}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={1}
              placeholder="Type instead of talking"
              className="min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-gray-200 outline-none placeholder:text-gray-600"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={!input.trim() || status === "thinking"}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-500 text-white transition-colors hover:bg-indigo-400 disabled:opacity-40"
              aria-label="Send voice message"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
