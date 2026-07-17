import { config } from "../../core/config";
import {
  LOCAL_STT_MODELS,
  LOCAL_TTS_MODELS,
  LOCAL_TTS_VOICES,
  listLocalSttModelStatus,
  listLocalTtsModelStatus,
  loadLocalSttModel,
  loadLocalTtsModel,
  transcribeLocalSpeech,
  unloadLocalSttModel,
  unloadLocalTtsModel,
} from "../../core/local-speech";
import { normalizeLocalTranscriptionAudio } from "../../core/local-speech-audio";
import {
  createRealtimeVoiceSession,
  getRealtimeVoiceStatus,
  testRealtimeVoiceConnection,
} from "../../core/realtime-voice";
import { resolveSpeechTtsProvider, synthesizeSpeech } from "../../core/speech";
import { detectSystemSpeechCapability } from "../../core/system-speech";
import {
  decodeDictationAudioBase64,
  pickDictationProvider,
  type RouteHandler,
  transcribeWithOpenAICompatibleProvider,
} from "./_shared";

export const speechRoutes: Record<string, RouteHandler> = {
  "GET /api/speech/settings": () => config.getSpeechSettings(),
  "GET /api/speech/status": () => {
    const settings = config.getSpeechSettings();
    let tts: {
      ready: boolean;
      provider: string | null;
      type: string | null;
      systemFallback: boolean;
      error: string | null;
    } = {
      ready: false,
      provider: null,
      type: null,
      systemFallback: false,
      error: null,
    };
    const systemVoice = detectSystemSpeechCapability();
    tts.systemFallback = settings.tts.fallbackToSystem && systemVoice.available;
    if (settings.tts.provider === "local") {
      const localStatus = listLocalTtsModelStatus()[0];
      tts = {
        ...tts,
        ready: localStatus?.state !== "error",
        provider: "Kokoro 82M (local)",
        type: "local",
        error: localStatus?.state === "error" ? localStatus.lastError : null,
      };
    } else if (settings.tts.provider === "system") {
      tts = {
        ...tts,
        ready: systemVoice.available,
        provider: systemVoice.available ? systemVoice.label : null,
        type: "system",
        error: systemVoice.error,
      };
    } else {
      try {
        const resolved = resolveSpeechTtsProvider({ settings });
        if (resolved) {
          tts = {
            ...tts,
            ready: true,
            provider: resolved.provider.name,
            type: resolved.type,
          };
        } else if (tts.systemFallback) {
          tts = {
            ...tts,
            ready: true,
            provider: `${systemVoice.label} (fallback)`,
            type: "system",
          };
        } else {
          tts.error =
            settings.tts.provider === "auto"
              ? "No speech provider yet. Add OpenAI/ElevenLabs, pick Local Kokoro, or enable the system-voice fallback."
              : `No ${settings.tts.provider} provider with speech credentials is configured.`;
        }
      } catch (error) {
        tts.error = error instanceof Error ? error.message : "TTS provider resolution failed";
      }
    }
    let stt: {
      ready: boolean;
      provider: string | null;
      type: string | null;
      native: boolean;
      error: string | null;
    } = {
      ready: false,
      provider: null,
      type: null,
      native: settings.stt.provider === "native",
      error: null,
    };
    if (stt.native) {
      stt.ready = true;
    } else if (settings.stt.provider === "local" || settings.stt.provider === "auto") {
      const localStatus = listLocalSttModelStatus()[0];
      stt = {
        ...stt,
        ready: localStatus?.state !== "error",
        provider: "Whisper (local)",
        type: "local",
        error: localStatus?.state === "error" ? localStatus.lastError : null,
      };
    } else {
      try {
        const provider = pickDictationProvider(settings.stt.providerId || undefined);
        stt = {
          ...stt,
          ready: true,
          provider: provider.name,
          type: provider.provider,
        };
      } catch (error) {
        stt.error =
          error instanceof Error ? error.message : "Transcription provider resolution failed";
      }
    }
    return {
      success: true,
      tts,
      stt,
      realtime: getRealtimeVoiceStatus(settings.realtime),
      settings: {
        ttsProvider: settings.tts.provider,
        ttsVoice: settings.tts.voice,
        sttProvider: settings.stt.provider,
        realtimeProvider: settings.realtime.provider,
      },
    };
  },
  "PUT /api/speech/settings": (body) => ({
    success: true,
    speech: config.setSpeechSettings(body),
  }),
  "GET /api/speech/local/models": () => ({
    success: true,
    tts: {
      models: LOCAL_TTS_MODELS,
      voices: LOCAL_TTS_VOICES,
      status: listLocalTtsModelStatus(),
    },
    stt: {
      models: LOCAL_STT_MODELS,
      status: listLocalSttModelStatus(),
    },
  }),
  "POST /api/speech/local/load": async (body) => {
    const data = (body || {}) as { model?: string; kind?: string };
    try {
      if (data.kind === "stt") {
        await loadLocalSttModel(data.model?.trim() || undefined);
        return { success: true, status: listLocalSttModelStatus() };
      }
      await loadLocalTtsModel(data.model?.trim() || undefined);
      return { success: true, status: listLocalTtsModelStatus() };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Model load failed",
        status: data.kind === "stt" ? listLocalSttModelStatus() : listLocalTtsModelStatus(),
      };
    }
  },
  "POST /api/speech/local/unload": (body) => {
    const data = (body || {}) as { model?: string; kind?: string };
    const unloaded =
      data.kind === "stt"
        ? unloadLocalSttModel(data.model?.trim() || undefined)
        : unloadLocalTtsModel(data.model?.trim() || undefined);
    return {
      success: true,
      unloaded,
      status: data.kind === "stt" ? listLocalSttModelStatus() : listLocalTtsModelStatus(),
    };
  },
  "POST /api/speech/realtime/session": async () => ({
    success: true,
    session: await createRealtimeVoiceSession(),
  }),
  "POST /api/speech/realtime/test": async () => ({
    success: true,
    result: await testRealtimeVoiceConnection(),
  }),
  "POST /api/speech/dictate": async (body) => {
    const data = body as {
      audioBase64?: string;
      mimeType?: string;
      fileName?: string;
      model?: string;
      providerId?: string;
      provider?: string;
    };
    if (!data.audioBase64 || typeof data.audioBase64 !== "string") {
      throw new Error("Validation error: audioBase64 is required");
    }
    const fallbackMimeType =
      typeof data.mimeType === "string" && data.mimeType.trim()
        ? data.mimeType.trim()
        : "audio/webm";
    const decoded = decodeDictationAudioBase64(data.audioBase64, fallbackMimeType);
    const speechSettings = config.getSpeechSettings();
    const requestedProviderId =
      typeof data.providerId === "string" && data.providerId.trim()
        ? data.providerId.trim()
        : undefined;
    const requestedProvider =
      typeof data.provider === "string" && data.provider.trim()
        ? data.provider.trim().toLowerCase()
        : speechSettings.stt.provider;
    if (requestedProvider === "local") {
      let pcmBytes: Uint8Array;
      try {
        pcmBytes = normalizeLocalTranscriptionAudio(decoded);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Recording could not be decoded";
        throw new Error(`Validation error: ${message}`);
      }
      const result = await transcribeLocalSpeech({
        pcmBytes,
        model:
          typeof data.model === "string" && data.model.trim()
            ? data.model.trim()
            : speechSettings.stt.provider === "local"
              ? speechSettings.stt.model || undefined
              : undefined,
        language: speechSettings.stt.language || undefined,
      });
      return {
        success: true,
        text: result.text,
        providerId: "local",
        providerType: "local",
        model: result.model,
      };
    }
    const provider = pickDictationProvider(
      requestedProviderId ||
        (speechSettings.stt.providerId ? speechSettings.stt.providerId : undefined)
    );
    const result = await transcribeWithOpenAICompatibleProvider({
      provider,
      bytes: decoded.bytes,
      mimeType: decoded.mimeType,
      fileName:
        typeof data.fileName === "string" && data.fileName.trim()
          ? data.fileName.trim()
          : "dictation.webm",
      model:
        typeof data.model === "string" && data.model.trim()
          ? data.model.trim()
          : speechSettings.stt.model || undefined,
    });
    return {
      success: true,
      text: result.text,
      providerId: provider.id,
      providerType: provider.provider,
      model: result.model,
    };
  },
  "POST /api/speech/synthesize": async (body) => {
    const data = body as {
      text?: string;
      providerId?: string;
      model?: string;
      voice?: string;
      format?: string;
      speed?: number;
    };
    const result = await synthesizeSpeech({
      text: typeof data.text === "string" ? data.text : "",
      providerId: typeof data.providerId === "string" ? data.providerId : undefined,
      model: typeof data.model === "string" ? data.model : undefined,
      voice: typeof data.voice === "string" ? data.voice : undefined,
      format: typeof data.format === "string" ? data.format : undefined,
      speed: typeof data.speed === "number" ? data.speed : undefined,
    });
    return { success: true, ...result };
  },
};
