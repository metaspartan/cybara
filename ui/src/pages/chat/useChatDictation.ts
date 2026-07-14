import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { chatApi, settingsApi } from "@/lib/api";
import {
  audioBlobToBase64,
  audioBlobToLocalPcm,
  preferredRecordingMimeType,
} from "@/lib/audioTranscription";
import { isTauriDesktopRuntime } from "@/lib/desktopHost";
import {
  nativeAudioErrorMessage,
  startNativeAudioRecording,
  stopNativeAudioRecording,
} from "@/lib/nativeDesktopAudio";
import { useUIStore } from "@/stores/uiStore";
import {
  canUseNativeSpeechRecognition,
  type DictationMode,
  type DictationRuntimeCapabilities,
  normalizeDictationMode,
  resolveDictationRuntime,
  type SpeechRecognitionLike,
  type SpeechRecognitionWindow,
} from "./chatModel";

interface ChatDictationState {
  dictating: boolean;
  error: string | null;
  handleToggle: () => Promise<void>;
  runtime: ReturnType<typeof resolveDictationRuntime>;
  status: string | null;
  transcribing: boolean;
}

const EMPTY_CAPABILITIES: DictationRuntimeCapabilities = {
  nativeRecognition: false,
  nativeRecorder: false,
  mediaRecorder: false,
  microphone: false,
};

export function useChatDictation(setInput: Dispatch<SetStateAction<string>>): ChatDictationState {
  const [mode, setMode] = useState<DictationMode>("auto");
  const [language, setLanguage] = useState("en-US");
  const [capabilities, setCapabilities] =
    useState<DictationRuntimeCapabilities>(EMPTY_CAPABILITIES);
  const [dictating, setDictating] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const nativeRecorderActiveRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const statusTimerRef = useRef<number | null>(null);
  const runtime = useMemo(() => resolveDictationRuntime(mode, capabilities), [capabilities, mode]);

  const flashStatus = useCallback((message: string): void => {
    setStatus(message);
    if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current);
    statusTimerRef.current = window.setTimeout(() => {
      setStatus(null);
      statusTimerRef.current = null;
    }, 3500);
  }, []);

  const failDictation = useCallback((message: string): void => {
    setError(message);
    setStatus(null);
    useUIStore.getState().addToast("error", message);
  }, []);

  const appendDictationText = useCallback(
    (text: string): void => {
      const normalized = text.trim();
      if (!normalized) return;
      setInput((previous) => {
        const trimmed = previous.trimEnd();
        return trimmed.length > 0 ? `${trimmed} ${normalized}` : normalized;
      });
      setError(null);
      flashStatus("Dictation inserted");
    },
    [flashStatus, setInput]
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      setCapabilities(EMPTY_CAPABILITIES);
      return;
    }
    const speechWindow = window as SpeechRecognitionWindow;
    const SpeechCtor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    setCapabilities({
      nativeRecognition: canUseNativeSpeechRecognition(!!SpeechCtor, isTauriDesktopRuntime()),
      nativeRecorder: isTauriDesktopRuntime(),
      mediaRecorder: typeof window.MediaRecorder !== "undefined",
      microphone: !!window.navigator?.mediaDevices?.getUserMedia,
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadSpeechSettings = async (): Promise<void> => {
      try {
        const result = await settingsApi.getConfig();
        if (!mounted || !result.success) return;
        const speech =
          result.data?.speech && typeof result.data.speech === "object"
            ? (result.data.speech as Record<string, unknown>)
            : {};
        const stt =
          speech.stt && typeof speech.stt === "object"
            ? (speech.stt as Record<string, unknown>)
            : {};
        setMode(normalizeDictationMode(stt.provider));
        setLanguage(
          typeof stt.language === "string" && stt.language.trim() ? stt.language.trim() : "en-US"
        );
      } catch {
        if (mounted) {
          setMode("auto");
          setLanguage("en-US");
        }
      }
    };
    void loadSpeechSettings();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current);
      speechRecognitionRef.current?.stop();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (nativeRecorderActiveRef.current) void stopNativeAudioRecording().catch(() => undefined);
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
      streamRef.current = null;
    };
  }, []);

  const toggleNativeRecognition = useCallback(async (): Promise<void> => {
    const speechWindow = window as SpeechRecognitionWindow;
    const SpeechCtor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechCtor) {
      failDictation("Native dictation is not available in this browser or desktop runtime.");
      return;
    }
    if (!speechRecognitionRef.current) {
      const recognition = new SpeechCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = language;
      recognition.onresult = (event) => {
        const results = event.results;
        if (!results || typeof results.length !== "number" || results.length === 0) return;
        const startIndex =
          typeof event.resultIndex === "number" && Number.isFinite(event.resultIndex)
            ? event.resultIndex
            : 0;
        const finalChunks: string[] = [];
        for (let index = startIndex; index < results.length; index += 1) {
          const result = results[index];
          const transcript =
            typeof result?.[0]?.transcript === "string" ? result[0].transcript.trim() : "";
          if (transcript && result?.isFinal) finalChunks.push(transcript);
        }
        if (finalChunks.length > 0) appendDictationText(finalChunks.join(" "));
      };
      recognition.onerror = (event) => {
        const code = event?.error || "unknown";
        const message =
          code === "not-allowed" || code === "service-not-allowed"
            ? "Microphone permission was denied for native dictation."
            : code === "audio-capture"
              ? "No microphone was available for native dictation."
              : code === "no-speech"
                ? "No speech was detected."
                : `Native dictation failed: ${code}`;
        failDictation(message);
        setDictating(false);
      };
      recognition.onend = () => {
        setDictating(false);
        setStatus(null);
      };
      speechRecognitionRef.current = recognition;
    }
    const recognition = speechRecognitionRef.current;
    if (dictating) {
      recognition.stop();
      setDictating(false);
      setStatus(null);
      return;
    }
    try {
      recognition.lang = language;
      setError(null);
      setStatus("Listening with native dictation...");
      recognition.start();
      setDictating(true);
    } catch (cause) {
      failDictation(cause instanceof Error ? cause.message : "Failed to start native dictation.");
      setDictating(false);
    }
  }, [appendDictationText, dictating, failDictation, language]);

  const toggleNativeRecorder = useCallback(async (): Promise<void> => {
    if (transcribing) return;
    if (dictating && nativeRecorderActiveRef.current) {
      nativeRecorderActiveRef.current = false;
      setDictating(false);
      setTranscribing(true);
      setStatus("Transcribing dictation...");
      try {
        const recording = await stopNativeAudioRecording();
        const response = await chatApi.dictate({
          ...recording,
          provider: runtime.serverProvider || undefined,
        });
        if (response.success && response.data?.text) appendDictationText(response.data.text);
        else failDictation(response.error || "No transcript was returned.");
      } catch (cause) {
        failDictation(nativeAudioErrorMessage(cause, "Dictation transcription failed."));
      } finally {
        setTranscribing(false);
      }
      return;
    }
    try {
      setError(null);
      setStatus("Requesting microphone access...");
      await startNativeAudioRecording();
      nativeRecorderActiveRef.current = true;
      setDictating(true);
      setStatus("Recording for model transcription...");
    } catch (cause) {
      failDictation(nativeAudioErrorMessage(cause, "Failed to start recording."));
    }
  }, [appendDictationText, dictating, failDictation, runtime.serverProvider, transcribing]);

  const transcribeRecordedChunks = useCallback(
    async (chunks: Blob[], mimeType: string): Promise<void> => {
      if (chunks.length === 0) return;
      try {
        setTranscribing(true);
        setStatus("Transcribing dictation...");
        const blob = new Blob(chunks, { type: mimeType });
        const payload =
          runtime.serverProvider === "local"
            ? await audioBlobToLocalPcm(blob)
            : {
                audioBase64: await audioBlobToBase64(blob),
                mimeType,
                fileName: "dictation.webm",
              };
        const response = await chatApi.dictate({
          ...payload,
          provider: runtime.serverProvider || undefined,
        });
        if (response.success && response.data?.text) appendDictationText(response.data.text);
        else failDictation(response.error || "No transcript was returned.");
      } catch (cause) {
        failDictation(cause instanceof Error ? cause.message : "Dictation transcription failed.");
      } finally {
        setTranscribing(false);
      }
    },
    [appendDictationText, failDictation, runtime.serverProvider]
  );

  const toggleBrowserRecorder = useCallback(async (): Promise<void> => {
    const canRecordAudio =
      !!window.navigator?.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== "undefined";
    if (!canRecordAudio) {
      failDictation(
        window.navigator?.mediaDevices?.getUserMedia
          ? "This runtime cannot record audio for model transcription."
          : "Microphone capture is not available in this browser or desktop runtime."
      );
      return;
    }
    if (transcribing) return;
    if (dictating) {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      return;
    }
    try {
      setError(null);
      setStatus("Requesting microphone access...");
      const stream = await window.navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const selectedMimeType = preferredRecordingMimeType();
      const recorder = selectedMimeType
        ? new window.MediaRecorder(stream, { mimeType: selectedMimeType })
        : new window.MediaRecorder(stream);
      const recorderMimeType = recorder.mimeType || selectedMimeType || "audio/webm";
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = (event) => {
        console.error("Dictation recorder error:", event);
        failDictation("Audio recording failed before transcription could start.");
        setDictating(false);
        setTranscribing(false);
      };
      recorder.onstop = () => {
        setDictating(false);
        const chunks = [...chunksRef.current];
        chunksRef.current = [];
        mediaRecorderRef.current = null;
        for (const track of streamRef.current?.getTracks() ?? []) track.stop();
        streamRef.current = null;
        void transcribeRecordedChunks(chunks, recorderMimeType);
      };
      recorder.start(250);
      setDictating(true);
      setStatus("Recording for model transcription...");
    } catch (cause) {
      failDictation(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Microphone permission was denied."
          : cause instanceof Error
            ? cause.message
            : "Failed to start dictation recording."
      );
      setDictating(false);
      setTranscribing(false);
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
      streamRef.current = null;
    }
  }, [dictating, failDictation, transcribeRecordedChunks, transcribing]);

  const handleToggle = useCallback(async (): Promise<void> => {
    if (typeof window === "undefined") return;
    if (!runtime.engine) {
      failDictation(runtime.unsupportedReason || "Dictation is not available here.");
      return;
    }
    if (runtime.engine === "native") {
      await toggleNativeRecognition();
      return;
    }
    if (capabilities.nativeRecorder) {
      await toggleNativeRecorder();
      return;
    }
    await toggleBrowserRecorder();
  }, [
    capabilities.nativeRecorder,
    failDictation,
    runtime,
    toggleBrowserRecorder,
    toggleNativeRecorder,
    toggleNativeRecognition,
  ]);

  return {
    dictating,
    error,
    handleToggle,
    runtime,
    status,
    transcribing,
  };
}
